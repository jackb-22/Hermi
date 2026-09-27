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
    catalog.upsert([MapSamplePlace(id: "live-1", name: "Real place", category: .music, latitude: 40.8, longitude: -73.96, isLive: true),
                    MapSamplePlace(id: "live-2", name: "Just browsed", category: .food, latitude: 40.8, longitude: -73.96, isLive: true)])
    // Only places the user's plan/saved items reference are written to disk.
    catalog.persist(referenced: ["live-1", "cafe"])
    let reloaded = PlaceCatalog(defaults: defaults)
    XCTAssertNil(reloaded.place("live-2"))
    XCTAssertEqual(reloaded.place("live-1")?.name, "Real place")
    XCTAssertEqual(reloaded.place("live-1")?.isLive, true)
    // Sample mode keeps discovery on fixtures even with a warm cache.
    XCTAssertEqual(reloaded.discoverable.map(\.id), MapSamplePlace.fixtures.map(\.id))
  }

  func testLivePlacesNeverGetSamplePosts() {
    XCTAssertEqual(PlaceFeedPost.samples(for: "cafe").count, 3)
    XCTAssertTrue(PlaceFeedPost.samples(for: "01M3FJEN9H7Z2V5JB4SNEKDEW3").isEmpty)
  }

  func testPinBoundingBoxEnclosesItsCircle() {
    let center = GeoPoint(latitude: 40.8075, longitude: -73.965)
    for miles in [0.1, 1, 4] {
      let meters = miles * 1609.344
      let box = PlaceCatalog.bbox(latitude: center.latitude, longitude: center.longitude, radiusMeters: meters)
      XCTAssertLessThan(box[0], box[2]); XCTAssertLessThan(box[1], box[3])
      // The four compass points of the circle sit inside (or on) the box.
      let north = GeoPoint(latitude: box[3], longitude: center.longitude)
      let east = GeoPoint(latitude: center.latitude, longitude: box[2])
      XCTAssertGreaterThanOrEqual(center.distance(to: north), meters * 0.99)
      XCTAssertGreaterThanOrEqual(center.distance(to: east), meters * 0.99)
    }
  }

  func testDiscoveryQueryFollowsPinsAndCitywideFilter() {
    var state = MapPreviewState()
    XCTAssertEqual(state.discoveryQuery, DiscoveryQuery())
    state.dropGeographicPin(at: GeoPoint(latitude: 40.8073, longitude: -73.9666))
    XCTAssertEqual(state.discoveryQuery.pins.count, 1)
    XCTAssertEqual(state.discoveryQuery.pins[0].category, state.category)
    let before = state.discoveryQuery
    if let id = state.discoveryPins.first?.id { state.setDiscoveryRadius(id: id, miles: 2) }
    XCTAssertNotEqual(state.discoveryQuery, before)
    state.toggleCategoryFilter()
    XCTAssertEqual(state.discoveryQuery.citywide, state.category)
  }

  func testNearbyRowShowsOnlyTheSelectedPinsPlacesNearestFirst() throws {
    var state = MapPreviewState()
    state.category = .food
    XCTAssertTrue(state.dropGeographicPin(at: .init(latitude: 40.8073, longitude: -73.9654)))
    let food = try XCTUnwrap(state.discoveryPins.last)
    state.category = .nature
    XCTAssertTrue(state.dropGeographicPin(at: .init(latitude: 40.808, longitude: -73.963)))
    let nature = try XCTUnwrap(state.discoveryPins.last)
    XCTAssertEqual(Set(state.nearby.map(\.id)), ["cafe", "garden"])
    XCTAssertEqual(state.nearbyPlaces(for: food.id).map(\.id), ["cafe"])
    XCTAssertEqual(state.nearbyPlaces(for: nature.id).map(\.id), ["garden"])
    XCTAssertEqual(Set(state.nearbyPlaces(for: nil).map(\.id)), ["cafe", "garden"])
  }

  func testViewportGridCoversBoundsWithoutGaps() {
    let cells = PlaceCatalog.grid([-74, 40.7, -73.9, 40.8], 3)
    XCTAssertEqual(cells.count, 9)
    XCTAssertEqual(cells.map { $0[0] }.min(), -74)
    XCTAssertEqual(cells.map { $0[3] }.max() ?? 0, 40.8, accuracy: 1e-9)
    XCTAssertEqual(cells.map { ($0[2] - $0[0]) * ($0[3] - $0[1]) }.reduce(0, +), 0.1 * 0.1, accuracy: 1e-9)
    XCTAssertEqual(PlaceCatalog.grid([-74, 40.7, -73.9, 40.8], 1), [[-74, 40.7, -73.9, 40.8]])
  }

  func testReferencedPlaceIDsCoverPlanAndSaved() {
    var state = MapPreviewState()
    state.addPlace("cafe"); state.toggleSave("garden")
    XCTAssertEqual(state.referencedPlaceIDs, ["cafe", "garden"])
  }

  func testCityFilterDropsNewJerseyButKeepsBoroughsAndWaterfront() {
    let mask = NYCLandMask.shared
    XCTAssertTrue(mask.available)
    XCTAssertFalse(mask.isInCity(.init(latitude: 40.7440, longitude: -74.0324)), "Hoboken")
    XCTAssertFalse(mask.isInCity(.init(latitude: 40.7178, longitude: -74.0431)), "Jersey City")
    XCTAssertTrue(mask.isInCity(.init(latitude: 40.7580, longitude: -73.9855)), "Times Square")
    XCTAssertTrue(mask.isInCity(.init(latitude: 40.6710, longitude: -73.9814)), "Park Slope")
    XCTAssertTrue(mask.isInCity(.init(latitude: 40.7447, longitude: -73.9485)), "Long Island City")
  }

  func testPlacePostsDecodeToScopedFeedPosts() throws {
    let json = #"{"items":[{"id":"01M3H03ZC2X0HNJ1DMXPQPG059","type":"photos","status":"live","author":{"id":"01M3H03RA9YANZGQVSVQGHATRN","name":"Pixel Pat","username":"seed_pixel_pat","spriteUrl":null,"photoUrl":null,"verified":true,"campus":"Columbia"},"place":{"id":"01M3GBFK883G2J74GXT99ZZZ9V","name":"Barnard Archives and Special Collections","category":"culture","loc":{"lat":40.80905654,"lng":-73.96376181}},"planId":null,"media":[{"id":"01M3H03Z7SBZEH6M11MQFZ1HVE","kind":"photo","url":"https://x.trycloudflare.com/media/r/60ec61bb.jpg","posterUrl":null,"ambientUrl":null,"verifyUrl":"https://x.trycloudflare.com/verify/03d4"},{"id":"v1","kind":"video","url":"https://x.trycloudflare.com/media/r/clip.mp4","posterUrl":"https://x.trycloudflare.com/media/p/clip.jpg","ambientUrl":null,"verifyUrl":null}],"text":"new favorite spot","again":null,"route":null,"stamp":{"placeName":"Barnard","time":"2026-09-26T17:20:09.376Z","tier":"gps"},"counts":{"been":5,"going":0},"createdAt":"2026-09-26T18:20:09.376Z"},{"id":"noplace","type":"recap","status":"live","author":{"id":"a","name":"A","username":"a","spriteUrl":null,"photoUrl":null,"verified":true,"campus":null},"place":null,"planId":"p","media":[],"text":null,"again":null,"route":null,"stamp":{"placeName":"","time":"2026-09-26T17:20:09.376Z","tier":"gps"},"counts":{"been":0,"going":0},"createdAt":"2026-09-26T18:20:09.376Z"}],"nextCursor":null}"#
    let page = try HermiAPI.decoder.decode(PostsPageDTO.self, from: Data(json.utf8))
    XCTAssertEqual(page.items.count, 2)
    let posts = page.items.compactMap(\.feedPost)
    XCTAssertEqual(posts.count, 1, "posts without a place cannot be place-scoped")
    let post = try XCTUnwrap(posts.first)
    XCTAssertEqual(post.placeID, "01M3GBFK883G2J74GXT99ZZZ9V")
    XCTAssertEqual(post.author, "Pixel Pat")
    XCTAssertEqual(post.caption, "new favorite spot")
    XCTAssertTrue(post.isLive)
    XCTAssertEqual(post.mediaCount, 2)
    XCTAssertFalse(post.media[0].isVideo)
    XCTAssertEqual(post.media[0].url?.lastPathComponent, "60ec61bb.jpg")
    XCTAssertTrue(post.media[1].isVideo)
    XCTAssertEqual(post.media[1].posterURL?.lastPathComponent, "clip.jpg")
  }

  func testPlaceDetailDecodesWithUnknownHoursAndSummary() throws {
    let json = #"{"id":"01M3GBFK883G2J74GXT99ZZZ9V","name":"Barnard Archives and Special Collections","category":"culture","tags":["library","indoor","cheap"],"loc":{"lat":40.80905654,"lng":-73.96376181},"address":"3009 Broadway, New York","been":5,"wouldGoAgainPct":100,"distanceM":202,"walkMin":3,"tasteMatch":0.615,"hereNow":0,"friendsBeen":3,"going":0,"hours":null,"reviewSummary":null}"#
    let detail = try HermiAPI.decoder.decode(PlaceDetailDTO.self, from: Data(json.utf8))
    XCTAssertEqual(detail.friendsBeen, 3)
    XCTAssertEqual(detail.hereNow, 0)
    XCTAssertNil(detail.hours, "null hours means unknown, not closed")
    XCTAssertNil(detail.reviewSummary)
    let withHours = #"{"id":"x","name":"X","category":"food","loc":{"lat":40.8,"lng":-73.9},"hereNow":1,"friendsBeen":0,"going":2,"hours":[{"day":1,"open":"09:00","close":"17:00"}],"reviewSummary":"Cozy and quiet."}"#
    let open = try HermiAPI.decoder.decode(PlaceDetailDTO.self, from: Data(withHours.utf8))
    XCTAssertEqual(open.hours?.first, .init(day: 1, open: "09:00", close: "17:00"))
    XCTAssertEqual(open.reviewSummary, "Cozy and quiet.")
  }

  func testMapTilesMatchSlippyMathAndStayInsideTheCity() throws {
    let times = PlaceCatalog.tile(latitude: 40.7580, longitude: -73.9855, zoom: 15)
    XCTAssertEqual(times.x, 9649); XCTAssertEqual(times.y, 12314)
    let box = try XCTUnwrap(PlaceCatalog.tileBounds("15/9649/12314"))
    XCTAssertTrue(box[0] <= -73.9855 && -73.9855 <= box[2] && box[1] <= 40.7580 && 40.7580 <= box[3])
    let screen = [-73.995, 40.750, -73.975, 40.766]
    let visible = PlaceCatalog.tiles(covering: screen, zoom: 15, ring: 0)
    let shown = PlaceCatalog.tiles(covering: screen, zoom: 15, ring: 1)
    XCTAssertTrue(visible.contains("15/9649/12314"))
    XCTAssertTrue(Set(visible).isSubset(of: Set(shown)))
    XCTAssertGreaterThan(shown.count, visible.count)
    XCTAssertTrue(PlaceCatalog.tiles(covering: [-75.5, 39.0, -75.0, 39.5], zoom: 15, ring: 1).isEmpty, "outside NYC")
    XCTAssertEqual(PlaceCatalog.tileZoom(forMapZoom: 15.9), 15)
    XCTAssertEqual(PlaceCatalog.tileZoom(forMapZoom: 3), 10)
    XCTAssertEqual(PlaceCatalog.tileZoom(forMapZoom: 19), 16)
    XCTAssertNil(PlaceCatalog.tileBounds("nope"))
  }

  func testSavedSnapshotOnlyCarriesLiveItems() {
    var state = MapPreviewState()
    state.toggleSave("cafe")
    state.savedIDs.insert("01LIVEPLACE")
    var library = state.library
    library.posts = [.init(kind: .post, refID: "cafe-alex"), .init(kind: .post, refID: "01LIVEPOST")]
    library.folders = [SavedFolder(name: "Mix", items: [.init(kind: .place, refID: "cafe"), .init(kind: .place, refID: "01LIVEPLACE"),
                                                        .init(kind: .plan, refID: UUID().uuidString)])]
    state.library = library
    let snapshot = SavedSnapshot(state, folderIDs: Set(state.library.folders.map(\.id)))
    XCTAssertEqual(snapshot.places, ["01LIVEPLACE"])
    XCTAssertEqual(snapshot.posts, ["01LIVEPOST"])
    XCTAssertEqual(snapshot.folders.values.first?.items, [.init(kind: .place, refID: "01LIVEPLACE")])
  }

  @MainActor
  func testHydrationMergesServerSavesWithoutDuplicatingFolders() throws {
    let defaults = try XCTUnwrap(UserDefaults(suiteName: "hermi.tests.saved-sync"))
    defaults.removePersistentDomain(forName: "hermi.tests.saved-sync")
    let sync = SavedSync(defaults: defaults)
    var state = MapPreviewState()
    state.toggleSave("cafe")
    var library = state.library
    library.posts = [.init(kind: .post, refID: "cafe-alex")]
    library.folders = [SavedFolder(name: "Mine", items: [.init(kind: .place, refID: "cafe")])]
    state.library = library
    var hydration = SavedSync.Hydration()
    hydration.places = ["01LIVE"]
    hydration.folders = [(serverID: "srv1", name: "Weekend", items: [.init(kind: .place, refID: "01LIVE")])]
    sync.apply(hydration, to: &state)
    XCTAssertEqual(state.savedIDs, ["cafe", "01LIVE"])
    XCTAssertEqual(state.library.posts.map(\.refID), ["cafe-alex"])
    XCTAssertEqual(Set(state.library.folders.map(\.name)), ["Mine", "Weekend"])
    sync.apply(hydration, to: &state)
    XCTAssertEqual(state.library.folders.filter { $0.name == "Weekend" }.count, 1)
    XCTAssertEqual(state.library.folders.first { $0.name == "Weekend" }?.items, [.init(kind: .place, refID: "01LIVE")])
    // A folder deleted on the server disappears locally; never-synced local folders stay.
    hydration.folders = []
    sync.apply(hydration, to: &state)
    XCTAssertEqual(state.library.folders.map(\.name), ["Mine"])
  }
}
