import XCTest
@testable import HermiDesign

final class MultiPinTests: XCTestCase {
  func testGardenFixtureIsOnLand() throws {
    XCTAssertTrue(NYCLandMask.shared.allows(try XCTUnwrap(MapSamplePlace.find("garden")).coordinate))
  }
  func testUnionDeduplicationAndIndependentCategoryFilter() throws {
    var state = MapPreviewState()
    state.category = .food
    XCTAssertTrue(state.dropGeographicPin(at: .init(latitude: 40.8073, longitude: -73.9654)))
    XCTAssertTrue(state.dropGeographicPin(at: .init(latitude: 40.808, longitude: -73.963)))
    state.category = .nature
    XCTAssertTrue(state.dropGeographicPin(at: .init(latitude: 40.808, longitude: -73.963)))
    XCTAssertEqual(state.discoveryPins.count, 3)
    XCTAssertEqual(Set(state.nearby.map(\.id)), ["cafe", "garden"])
    XCTAssertEqual(state.nearby.count, 2)
    state.category = .music; state.toggleCategoryFilter()
    XCTAssertEqual(Set(state.nearby.map(\.id)), ["cafe", "garden", "music"])
    state.category = .shopping // choosing a source pin does not change active citywide filter
    XCTAssertEqual(state.activeCitywideCategory, .music)
    state.category = .music; state.toggleCategoryFilter()
    XCTAssertNil(state.activeCitywideCategory)
    XCTAssertEqual(state.discoveryPins.count, 3)
    XCTAssertEqual(Set(state.nearby.map(\.id)), ["cafe", "garden"])
    state.category = .food; state.toggleCategoryFilter()
    XCTAssertEqual(state.nearby.filter { $0.id == "cafe" }.count, 1)
    XCTAssertEqual(state.matchingPlaces(MapSamplePlace.all + MapSamplePlace.all).count, 2)
  }
  func testIndependentEditsRemovalAndInvalidDrop() throws {
    var state = MapPreviewState()
    state.dropGeographicPin(at: .init(latitude: 40.8073, longitude: -73.9654))
    let first = try XCTUnwrap(state.discoveryPins.first)
    state.dropGeographicPin(at: .init(latitude: 40.808, longitude: -73.963))
    let second = try XCTUnwrap(state.discoveryPins.last)
    state.setDiscoveryRadius(id: first.id, miles: 0.1)
    state.setDiscoveryRadius(id: second.id, miles: 4)
    XCTAssertTrue(state.moveDiscovery(id: first.id, to: .init(latitude: 40.805, longitude: -73.965)))
    XCTAssertEqual(state.pin(id: second.id)?.coordinate, second.coordinate)
    XCTAssertEqual(state.pin(id: second.id)?.radiusMiles, 4)
    let before = state.discoveryPins
    XCTAssertFalse(state.dropGeographicPin(at: .init(latitude: 40.8, longitude: -73.977)))
    XCTAssertEqual(state.discoveryPins, before)
    state.addPlace("cafe"); state.toggleSave("garden")
    state.removeDiscovery(id: first.id)
    state.setDiscoveryRadius(id: first.id, miles: 2) // late event for removed ID
    XCTAssertEqual(state.discoveryPins.count, 1)
    XCTAssertEqual(state.pin(id: second.id)?.radiusMiles, 4)
    state.category = .music; state.toggleCategoryFilter()
    state.removeDiscovery(id: second.id)
    XCTAssertEqual(state.nearby.map(\.id), ["music"])
    state.toggleCategoryFilter()
    XCTAssertEqual(state.nearby.count, MapSamplePlace.all.count)
    XCTAssertEqual(state.planIDs, ["cafe"]); XCTAssertEqual(state.savedIDs, ["garden"])
  }
  func testMultipleAndLegacySnapshotsMigrateWithoutResurrection() throws {
    var old = MapPreviewState()
    old.discoveryPin = DiscoveryPin(category: .food, coordinate: .init(latitude: 40.8073, longitude: -73.9654), radiusMiles: 0.3)
    let originalID = old.discoveryPin?.id
    old.filterEnabled = true; old.category = .nature
    var state = try JSONDecoder().decode(MapPreviewState.self, from: JSONEncoder().encode(old))
    state.restoreDiscovery()
    XCTAssertEqual(state.discoveryPins.first?.id, originalID)
    XCTAssertEqual(state.discoveryPins.first?.radiusMiles, 0.3)
    XCTAssertEqual(state.citywideCategory, .nature)
    state.dropGeographicPin(at: .init(latitude: 40.808, longitude: -73.963))
    var restored = try JSONDecoder().decode(MapPreviewState.self, from: JSONEncoder().encode(state))
    restored.restoreDiscovery(); XCTAssertEqual(restored, state)
    for pin in restored.discoveryPins { restored.removeDiscovery(id: pin.id) }
    restored.geographicDiscovery = .init(latitude: 40.8073, longitude: -73.9654)
    restored.restoreDiscovery(); XCTAssertTrue(restored.discoveryPins.isEmpty)
  }
}
