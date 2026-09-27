import XCTest
@testable import HermiDesign

final class MapCompositionTests: XCTestCase {
  func testMapStartsSelectedInCenterWithNoPlanOrSheet() {
    let state = MapPreviewState()
    XCTAssertEqual(HomePanel.allCases, [.feed, .map, .profile])
    XCTAssertEqual(state.panel, .map)
    XCTAssertNil(state.sheet)
    XCTAssertTrue(state.showsPlan)
    XCTAssertTrue(state.planIDs.isEmpty)
  }

  func testDropAndInspectionNeverInsertPlanItem() {
    var state = MapPreviewState()
    state.dropPin(at: CGPoint(x: 0.4, y: 0.5))
    XCTAssertTrue(state.showsPlan)
    XCTAssertEqual(state.sheet, .nearby)
    XCTAssertTrue(state.planIDs.isEmpty)
    state.selectPlace("cafe")
    XCTAssertEqual(state.sheet, .place("cafe"))
    XCTAssertTrue(state.planIDs.isEmpty)
    state.goBack()
    XCTAssertEqual(state.sheet, .nearby)
  }

  func testExplicitPlanPreservesOrderAndRejectsInvalidOrDuplicatePlaces() {
    var state = MapPreviewState()
    state.addPlace("cafe"); state.addPlace("garden"); state.addPlace("cafe"); state.addPlace("missing")
    XCTAssertEqual(state.planIDs, ["cafe", "garden"])
    state.removePlace("cafe")
    XCTAssertEqual(state.planIDs, ["garden"])
  }

  func testPlanPlaceBackReturnsToPlanAndPanelSwitchClosesSheet() {
    var state = MapPreviewState()
    state.addPlace("garden"); state.sheet = .plan
    state.selectPlace("garden"); state.goBack()
    XCTAssertEqual(state.sheet, .plan)
    state.switchPanel(.feed)
    XCTAssertNil(state.sheet)
    XCTAssertEqual(state.planIDs, ["garden"])
    state.switchPanel(.map)
    XCTAssertNil(state.sheet)
  }

  func testCategoriesWrapAndFilterWithoutAddingDestinations() {
    var state = MapPreviewState()
    state.cycleCategory(-1)
    XCTAssertEqual(state.category, .music)
    state.cycleCategory(1)
    XCTAssertEqual(state.category, .food)
    XCTAssertEqual(state.nearby.count, 7)
    state.filterEnabled = true
    XCTAssertEqual(state.nearby.map(\.id), ["cafe"])
    XCTAssertTrue(state.planIDs.isEmpty)
  }

  func testDropClampsToIllustrationAndResetRestoresComposition() {
    var state = MapPreviewState()
    state.dropPin(at: CGPoint(x: -3, y: 4))
    XCTAssertEqual(state.discovery, CGPoint(x: 0.05, y: 0.88))
    state.addPlace("garden"); state.toggleSave("garden"); state.social = true
    state.reset()
    XCTAssertEqual(state, MapPreviewState())
  }

  func testLocalCompositionRestoresSelectionsWithoutBackendData() throws {
    var state = MapPreviewState()
    state.addPlace("garden"); state.toggleSave("garden")
    state.dropPin(at: CGPoint(x: 0.3, y: 0.5))
    let restored = try JSONDecoder().decode(MapPreviewState.self, from: JSONEncoder().encode(state))
    XCTAssertEqual(restored, state)
  }
  func testGeographicDropRejectsInvalidCoordinatesAndDoesNotAddDestinations() {
    var state = MapPreviewState()
    state.dropGeographicPin(at: .init(latitude: .nan, longitude: 0))
    XCTAssertNil(state.geographicDiscovery)
    state.dropGeographicPin(at: .init(latitude: 40.8073, longitude: -73.9654))
    XCTAssertEqual(state.nearby.map(\.id), ["cafe"])
    XCTAssertTrue(state.planIDs.isEmpty)
    state.selectPlace("cafe"); state.goBack()
    XCTAssertEqual(state.sheet, .nearby)
    state.dropGeographicPin(at: .init(latitude: 51.5, longitude: -0.1))
    XCTAssertTrue(state.nearby.isEmpty)
    XCTAssertTrue(state.planIDs.isEmpty)
  }
  func testSavedAndPlanRemainIndependentAndBothAvailableFromEmptyState() {
    var state = MapPreviewState()
    state.toggleSave("garden")
    XCTAssertTrue(state.showsPlan)
    XCTAssertTrue(state.planIDs.isEmpty)
    state.sheet = .plan; state.selectPlace("garden"); state.goBack()
    XCTAssertEqual(state.sheet, .plan)
    state.addPlace("garden"); state.removePlace("garden")
    XCTAssertEqual(state.savedIDs, ["garden"])
  }

}
