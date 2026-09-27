import XCTest
@testable import HermiDesign

/// Decoding checks against JSON captured from the live API (apps/api on main).
final class LiveContractTests: XCTestCase {
  func testDevAuthResponseDecodes() throws {
    let json = #"{"token":"eyJ.abc.def","isNew":false,"user":{"id":"01M3GZSG3FXK30EZC45BYEJB04","name":"jack","username":"jack","photoUrl":null,"photoReview":null,"spriteUrl":null,"verified":false,"campus":null,"gradYear":null,"studentStatus":null,"is21":false,"ghostMode":false,"openToPlans":false,"tagId":null,"tasteDone":false,"createdAt":"2026-09-27T08:30:33.071Z"}}"#
    let auth = try HermiAPI.decoder.decode(AuthResponseDTO.self, from: Data(json.utf8))
    XCTAssertEqual(auth.token, "eyJ.abc.def")
    XCTAssertEqual(auth.user.username, "jack")
    XCTAssertNil(auth.user.photoUrl)
    XCTAssertEqual(auth.user.ghostMode, false)
  }

  func testDatesParseWithAndWithoutMilliseconds() {
    XCTAssertNotNil(HermiDates.parse("2026-09-27T08:30:33.071Z"))
    XCTAssertNotNil(HermiDates.parse("2026-09-27T08:30:33Z"))
    XCTAssertNotNil(HermiDates.parse("2026-09-27T04:30:33-04:00"))
    XCTAssertNil(HermiDates.parse("yesterday"))
    let date = Date(timeIntervalSince1970: 1_790_497_833)
    XCTAssertEqual(HermiDates.parse(HermiDates.format(date)), date)
  }

  func testURLBuildingAddsV1AndQuery() throws {
    let api = HermiAPI(baseURL: URL(string: "https://x.trycloudflare.com/")!, token: nil, devToken: nil)
    XCTAssertEqual(api.url("/me")?.absoluteString, "https://x.trycloudflare.com/v1/me")
    let url = try XCTUnwrap(api.url("/places", query: ["bbox": "-74,40.7,-73.9,40.8", "cat": "all"]))
    XCTAssertEqual(url.path, "/v1/places")
    let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
    XCTAssertEqual(items.first { $0.name == "bbox" }?.value, "-74,40.7,-73.9,40.8")
    XCTAssertEqual(items.first { $0.name == "cat" }?.value, "all")
  }

  func testConfigPersistsAndEnvironmentOnlyFillsBlanks() throws {
    let defaults = try XCTUnwrap(UserDefaults(suiteName: "hermi.tests.live-config"))
    defaults.removePersistentDomain(forName: "hermi.tests.live-config")
    let env = ["HERMI_API_BASE": "https://env.example", "HERMI_DEV_TOKEN": "envtoken"]
    var config = LiveConfig.load(defaults, environment: env)
    XCTAssertEqual(config.baseURL, "https://env.example")
    XCTAssertEqual(config.devToken, "envtoken")
    XCTAssertEqual(config.username, "jack")
    XCTAssertNil(config.jwt)
    config.baseURL = "https://saved.example"; config.jwt = "jwt"
    config.save(defaults)
    let loaded = LiveConfig.load(defaults, environment: env)
    XCTAssertEqual(loaded.baseURL, "https://saved.example")
    XCTAssertEqual(loaded.jwt, "jwt")
    XCTAssertNotNil(loaded.url)
    XCTAssertNil(LiveConfig(baseURL: "not a url").url)
    XCTAssertNil(LiveConfig(baseURL: "ftp://x.example").url)
  }

  func testSampleModeHasNoClient() {
    let session = LiveSession(config: LiveConfig(baseURL: "https://x.example", jwt: "jwt"))
    XCTAssertFalse(session.isLive)
    XCTAssertNil(session.api)
  }

  func testPlacesResponseDecodesAndMapsCategories() throws {
    let json = #"{"items":[{"id":"01M3FJEN9H7Z2V5JB4SNEKDEW3","name":"Oren’s Coffee","category":"food","tags":["coffee","indoor"],"loc":{"lat":40.80554248930695,"lng":-73.96533068914333},"address":"2882 Broadway, New York","been":8,"wouldGoAgainPct":null},{"id":"01M3FJEN4ZD4C1NRC2W656FCH7","name":"Zanny's Cafe","category":"food","tags":["coffee"],"loc":{"lat":40.8004,"lng":-73.9619},"address":"975 Columbus Ave, New York","been":6,"wouldGoAgainPct":100},{"id":"x","name":"Odd","category":"spaceport","tags":[],"loc":{"lat":40.8,"lng":-73.9},"address":null,"been":0,"wouldGoAgainPct":null}],"nextCursor":null}"#
    let response = try HermiAPI.decoder.decode(PlacesResponseDTO.self, from: Data(json.utf8))
    let places = response.items.compactMap(\.place)
    XCTAssertEqual(places.count, 2, "unknown categories are dropped, not forced")
    XCTAssertEqual(places[0].category, .food)
    XCTAssertTrue(places[0].isLive)
    XCTAssertEqual(places[0].coordinate.latitude, 40.80554248930695, accuracy: 1e-9)
    XCTAssertNil(places[0].wouldGoAgainPct)
    XCTAssertEqual(places[1].wouldGoAgainPct, 100)
    for category in HermiCategory.allCases { XCTAssertEqual(HermiCategory(serverName: category.serverName), category) }
  }

  func testCatalogResolvesFixturesAndPersistsLivePlaces() throws {
    let defaults = try XCTUnwrap(UserDefaults(suiteName: "hermi.tests.place-catalog"))
    defaults.removePersistentDomain(forName: "hermi.tests.place-catalog")
    let catalog = PlaceCatalog(defaults: defaults)
    XCTAssertEqual(catalog.place("cafe")?.name, "Corner café")
    XCTAssertNil(catalog.place("live-1"))
    catalog.upsert([MapSamplePlace(id: "live-1", name: "Real place", category: .music, latitude: 40.8, longitude: -73.96, isLive: true)])
    let reloaded = PlaceCatalog(defaults: defaults)
    XCTAssertEqual(reloaded.place("live-1")?.name, "Real place")
    XCTAssertEqual(reloaded.place("live-1")?.isLive, true)
    // Sample mode keeps discovery on fixtures even with a warm cache.
    XCTAssertEqual(reloaded.discoverable.map(\.id), MapSamplePlace.fixtures.map(\.id))
  }

  func testLivePlacesNeverGetSamplePosts() {
    XCTAssertEqual(PlaceFeedPost.samples(for: "cafe").count, 3)
    XCTAssertTrue(PlaceFeedPost.samples(for: "01M3FJEN9H7Z2V5JB4SNEKDEW3").isEmpty)
  }
}
