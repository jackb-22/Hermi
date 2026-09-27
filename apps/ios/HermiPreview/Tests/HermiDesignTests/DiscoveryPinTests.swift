import XCTest
@testable import HermiDesign

final class DiscoveryPinTests: XCTestCase {
  func testLandMaskIncludesAllBoroughsAndRejectsWaterAndOutsideCity() {
    let mask = NYCLandMask.shared
    XCTAssertTrue(mask.available)
    for point in [GeoPoint(latitude: 40.8073, longitude: -73.9654),
                  .init(latitude: 40.6718, longitude: -73.9708),
                  .init(latitude: 40.7447, longitude: -73.9485),
                  .init(latitude: 40.827, longitude: -73.925),
                  .init(latitude: 40.642, longitude: -74.076)] {
      XCTAssertTrue(mask.allows(point), "Expected NYC land: \(point)")
    }
    for point in [GeoPoint(latitude: 40.8, longitude: -73.977),
                  .init(latitude: 40.79, longitude: -74.02),
                  .init(latitude: 40.7855, longitude: -73.963),
                  .init(latitude: 40.6574, longitude: -73.9654),
                  .init(latitude: 51.5, longitude: -0.1),
                  .init(latitude: .nan, longitude: 0)] {
      XCTAssertFalse(mask.allows(point), "Expected exclusion: \(point)")
    }
  }
  func testPolygonHoleIsNotLand() {
    let polygon = NYCLandMask.Polygon([
      [[0,0],[10,0],[10,10],[0,10],[0,0]],
      [[4,4],[6,4],[6,6],[4,6],[4,4]]
    ])
    XCTAssertTrue(polygon.contains(.init(latitude: 2, longitude: 2)))
    XCTAssertFalse(polygon.contains(.init(latitude: 5, longitude: 5)))
    XCTAssertFalse(polygon.contains(.init(latitude: 11, longitude: 5)))
  }
  func testDropMoveRadiusAndRemovePreservePlanAndSaved() throws {
    var state = MapPreviewState()
    state.addPlace("cafe"); state.toggleSave("garden")
    XCTAssertTrue(state.dropGeographicPin(at: .init(latitude: 40.8073, longitude: -73.9654)))
    let pin = try XCTUnwrap(state.discoveryPins.first)
    XCTAssertEqual(pin.radiusMiles, DiscoveryPin.initialRadiusMiles)
    XCTAssertEqual(pin.radiusMeters, 0.25 * 1609.344, accuracy: 1e-9)
    state.setDiscoveryRadius(id: pin.id, miles: 2)
    XCTAssertTrue(state.moveDiscovery(id: pin.id, to: .init(latitude: 40.808, longitude: -73.963)))
    let valid = state.discoveryPins.first
    XCTAssertFalse(state.moveDiscovery(id: pin.id, to: .init(latitude: 40.8, longitude: -73.977)))
    XCTAssertEqual(state.discoveryPins.first, valid)
    XCTAssertFalse(state.dropGeographicPin(at: .init(latitude: 51.5, longitude: -0.1)))
    XCTAssertEqual(state.discoveryPins.first, valid)
    XCTAssertEqual(state.discoveryPins.first?.radiusMiles, 2)
    state.removeDiscovery(id: pin.id)
    XCTAssertNil(state.discoveryPins.first); XCTAssertNil(state.geographicDiscovery)
    XCTAssertEqual(state.planIDs, ["cafe"]); XCTAssertEqual(state.savedIDs, ["garden"])
  }
  func testRadiusBoundsMidpointAndStaleEvents() throws {
    XCTAssertEqual(DiscoveryPin.miles(at: 0), 0.1)
    XCTAssertEqual(DiscoveryPin.miles(at: 0.5), sqrt(0.4), accuracy: 1e-12)
    XCTAssertEqual(DiscoveryPin.miles(at: 1), 4)
    XCTAssertEqual(DiscoveryPin.fraction(for: 1), log(10)/log(40), accuracy: 1e-12)
    var state = MapPreviewState()
    state.dropGeographicPin(at: .init(latitude: 40.8073, longitude: -73.9654))
    let pin = try XCTUnwrap(state.discoveryPins.first)
    let stale = UUID()
    state.setDiscoveryRadius(id: stale, miles: 3); state.removeDiscovery(id: stale)
    XCTAssertFalse(state.moveDiscovery(id: stale, to: .init(latitude: 40.808, longitude: -73.963)))
    XCTAssertEqual(state.discoveryPins.first, pin)
    state.setDiscoveryRadius(id: pin.id, miles: .nan)
    XCTAssertEqual(state.discoveryPins.first?.radiusMiles, DiscoveryPin.initialRadiusMiles)
    state.setDiscoveryRadius(id: pin.id, miles: 9)
    XCTAssertEqual(state.discoveryPins.first?.radiusMiles, 4)
    state.setDiscoveryRadius(id: pin.id, miles: -2)
    XCTAssertEqual(state.discoveryPins.first?.radiusMiles, 0.1)
  }
  func testRadiusChangesResultsAndMenuDoesNotReclassifyPlacedPin() throws {
    var state = MapPreviewState()
    XCTAssertTrue(state.dropGeographicPin(at: .init(latitude: 40.8073, longitude: -73.957)))
    let pin = try XCTUnwrap(state.discoveryPins.first)
    XCTAssertTrue(state.nearby.isEmpty, "cafe is ~700 m away, outside the 0.25 mi starting radius")
    state.setDiscoveryRadius(id: pin.id, miles: 1)
    XCTAssertEqual(state.nearby.map(\.id), ["cafe"])
    state.setDiscoveryRadius(id: pin.id, miles: 0.25)
    XCTAssertTrue(state.nearby.isEmpty)
    state.category = .nature
    XCTAssertEqual(state.discoveryPins.first?.category, .food)
  }
  func testRestoringNewAndLegacySnapshotsPreservesSavedAndPlan() throws {
    var state = MapPreviewState()
    state.addPlace("cafe"); state.toggleSave("garden")
    state.geographicDiscovery = .init(latitude: 40.8073, longitude: -73.9654)
    state.restoreDiscovery()
    let pin = try XCTUnwrap(state.discoveryPins.first)
    state.setDiscoveryRadius(id: pin.id, miles: 2.5)
    var restored = try JSONDecoder().decode(MapPreviewState.self, from: JSONEncoder().encode(state))
    restored.restoreDiscovery()
    XCTAssertEqual(restored, state)
    var legacy = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(state)) as? [String: Any])
    legacy.removeValue(forKey: "discoveryPin")
    legacy.removeValue(forKey: "storedDiscoveryPins")
    legacy["geographicDiscovery"] = ["latitude": 40.8073, "longitude": -73.9654]
    var migrated = try JSONDecoder().decode(MapPreviewState.self, from: JSONSerialization.data(withJSONObject: legacy))
    migrated.restoreDiscovery()
    XCTAssertEqual(migrated.discoveryPins.first?.radiusMiles, 1)
    XCTAssertEqual(migrated.planIDs, ["cafe"]); XCTAssertEqual(migrated.savedIDs, ["garden"])
  }
  func testDropProjectionUsesWebViewOriginAndBounds() {
    let frame = CGRect(x: 20, y: 80, width: 400, height: 800)
    XCTAssertEqual(MapDropProjection.normalized(CGPoint(x: 220, y: 480), in: frame), CGPoint(x: 0.5, y: 0.5))
    XCTAssertNil(MapDropProjection.normalized(CGPoint(x: 0, y: 480), in: frame))
    XCTAssertNil(MapDropProjection.normalized(CGPoint(x: 220, y: 900), in: frame))
    XCTAssertNil(MapDropProjection.normalized(.zero, in: .zero))
  }
}
