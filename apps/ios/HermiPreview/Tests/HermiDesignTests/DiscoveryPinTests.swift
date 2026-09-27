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
    let pin = try XCTUnwrap(state.discoveryPin)
    XCTAssertEqual(pin.radiusMiles, 1)
    XCTAssertEqual(pin.radiusMeters, 1609.344)
    state.setDiscoveryRadius(id: pin.id, miles: 2)
    XCTAssertTrue(state.moveDiscovery(id: pin.id, to: .init(latitude: 40.808, longitude: -73.963)))
    let valid = state.discoveryPin
    XCTAssertFalse(state.moveDiscovery(id: pin.id, to: .init(latitude: 40.8, longitude: -73.977)))
    XCTAssertEqual(state.discoveryPin, valid)
    XCTAssertFalse(state.dropGeographicPin(at: .init(latitude: 51.5, longitude: -0.1)))
    XCTAssertEqual(state.discoveryPin, valid)
    XCTAssertEqual(state.discoveryPin?.radiusMiles, 2)
    state.removeDiscovery(id: pin.id)
    XCTAssertNil(state.discoveryPin); XCTAssertNil(state.geographicDiscovery)
    XCTAssertEqual(state.planIDs, ["cafe"]); XCTAssertEqual(state.savedIDs, ["garden"])
  }
  func testRadiusBoundsMidpointAndStaleEvents() throws {
    XCTAssertEqual(DiscoveryPin.miles(at: 0), 0.1)
    XCTAssertEqual(DiscoveryPin.miles(at: 0.5), sqrt(0.4), accuracy: 1e-12)
    XCTAssertEqual(DiscoveryPin.miles(at: 1), 4)
    XCTAssertEqual(DiscoveryPin.fraction(for: 1), log(10)/log(40), accuracy: 1e-12)
    var state = MapPreviewState()
    state.dropGeographicPin(at: .init(latitude: 40.8073, longitude: -73.9654))
    let pin = try XCTUnwrap(state.discoveryPin)
    let stale = UUID()
    state.setDiscoveryRadius(id: stale, miles: 3); state.removeDiscovery(id: stale)
    XCTAssertFalse(state.moveDiscovery(id: stale, to: .init(latitude: 40.808, longitude: -73.963)))
    XCTAssertEqual(state.discoveryPin, pin)
    state.setDiscoveryRadius(id: pin.id, miles: .nan)
    XCTAssertEqual(state.discoveryPin?.radiusMiles, 1)
    state.setDiscoveryRadius(id: pin.id, miles: 9)
    XCTAssertEqual(state.discoveryPin?.radiusMiles, 4)
    state.setDiscoveryRadius(id: pin.id, miles: -2)
    XCTAssertEqual(state.discoveryPin?.radiusMiles, 0.1)
  }
  func testRadiusChangesResultsAndMenuDoesNotReclassifyPlacedPin() throws {
    var state = MapPreviewState()
    XCTAssertTrue(state.dropGeographicPin(at: .init(latitude: 40.8073, longitude: -73.957)))
    let pin = try XCTUnwrap(state.discoveryPin)
    XCTAssertEqual(state.nearby.map(\.id), ["cafe"])
    state.setDiscoveryRadius(id: pin.id, miles: 0.25)
    XCTAssertTrue(state.nearby.isEmpty)
    state.category = .nature
    XCTAssertEqual(state.discoveryPin?.category, .food)
  }
  func testRestoringNewAndLegacySnapshotsPreservesSavedAndPlan() throws {
    var state = MapPreviewState()
    state.addPlace("cafe"); state.toggleSave("garden")
    state.geographicDiscovery = .init(latitude: 40.8073, longitude: -73.9654)
    state.restoreDiscovery()
    let pin = try XCTUnwrap(state.discoveryPin)
    state.setDiscoveryRadius(id: pin.id, miles: 2.5)
    var restored = try JSONDecoder().decode(MapPreviewState.self, from: JSONEncoder().encode(state))
    restored.restoreDiscovery()
    XCTAssertEqual(restored, state)
    var legacy = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(state)) as? [String: Any])
    legacy.removeValue(forKey: "discoveryPin")
    var migrated = try JSONDecoder().decode(MapPreviewState.self, from: JSONSerialization.data(withJSONObject: legacy))
    migrated.restoreDiscovery()
    XCTAssertEqual(migrated.discoveryPin?.radiusMiles, 1)
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
