import XCTest
@testable import HermiDesign

final class DiscoveryPanelTests: XCTestCase {
  func testHandleTransitionsAndCancellation() {
    XCTAssertEqual(DiscoveryPanelLevel.compact.afterDrag(-80, predicted: -100), .medium)
    XCTAssertEqual(DiscoveryPanelLevel.medium.afterDrag(-60, predicted: -70), .full)
    XCTAssertEqual(DiscoveryPanelLevel.full.afterDrag(-80, predicted: -100), .full)
    XCTAssertEqual(DiscoveryPanelLevel.full.afterDrag(80, predicted: 100), .medium)
    XCTAssertNil(DiscoveryPanelLevel.compact.afterDrag(80, predicted: 100))
    XCTAssertEqual(DiscoveryPanelLevel.medium.afterDrag(8, predicted: 12), .medium)
  }
  func testPanelHeightAndPlaceScope() {
    for height in [844.0, 956.0] {
      let compact = DiscoveryPanelLevel.compact.height(viewport: height, safeTop: 62)
      let medium = DiscoveryPanelLevel.medium.height(viewport: height, safeTop: 62)
      XCTAssertLessThanOrEqual(compact, medium)
      XCTAssertLessThan(medium, DiscoveryPanelLevel.full.height(viewport: height, safeTop: 62))
    }
    let cafe = PlaceFeedPost.samples(for: "cafe"), garden = PlaceFeedPost.samples(for: "garden")
    XCTAssertEqual(cafe.count, 3)
    XCTAssertTrue(cafe.allSatisfy { $0.placeID == "cafe" })
    XCTAssertTrue(Set(cafe.map(\.id)).isDisjoint(with: garden.map(\.id)))
    XCTAssertTrue(PlaceFeedPost.samples(for: "missing").isEmpty)
  }
  func testOpeningPlacePreservesMapFiltersAndMainFeedRoute() {
    var state = MapPreviewState()
    state.dropGeographicPin(at: .init(latitude: 40.8073, longitude: -73.9654))
    state.category = .nature; state.toggleCategoryFilter()
    let pins = state.discoveryPins
    state.selectPlace("cafe")
    XCTAssertEqual(state.panel, .map)
    XCTAssertEqual(state.sheet, .place("cafe"))
    state.sheet = nil
    XCTAssertEqual(state.discoveryPins, pins)
    XCTAssertEqual(state.citywideCategory, .nature)
    state.switchPanel(.feed); state.selectPlace("cafe")
    XCTAssertEqual(state.panel, .feed)
  }
}
