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
}
