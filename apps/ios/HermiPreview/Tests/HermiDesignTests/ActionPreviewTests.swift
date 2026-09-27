import XCTest
@testable import HermiDesign

final class ActionPreviewTests: XCTestCase {
  func testEmptyAndInvalidPlansCannotStart() {
    var state = MapPreviewState()
    state.startActionPreview(); XCTAssertNil(state.actionSession)
    XCTAssertNil(ActionPreviewSession(stops: ["missing"], now: Date()))
    XCTAssertNil(ActionPreviewSession(stops: ["cafe", "cafe"], now: Date()))
  }
  func testStartSnapshotsPlanAndRepeatedGoCannotReplaceSession() throws {
    var state = MapPreviewState()
    state.addPlace("cafe"); state.addPlace("garden")
    state.startActionPreview(now: Date(timeIntervalSince1970: 100))
    let session = try XCTUnwrap(state.actionSession)
    state.addPlace("books"); state.startActionPreview()
    XCTAssertEqual(state.actionSession, session)
    XCTAssertEqual(session.stopIDs, ["cafe", "garden"])
    state.dismissActionRecap(); XCTAssertNotNil(state.actionSession)
  }
  func testFinishIsIdempotentAndRecapReturnPreservesPlan() throws {
    var state = MapPreviewState()
    state.addPlace("cafe"); state.sheet = .plan
    state.startActionPreview(now: Date(timeIntervalSince1970: 100))
    state.finishActionPreview(now: Date(timeIntervalSince1970: 200))
    state.finishActionPreview(now: Date(timeIntervalSince1970: 300))
    XCTAssertEqual(state.actionSession?.endedAt, Date(timeIntervalSince1970: 200))
    let data = try JSONEncoder().encode(state)
    var restored = try JSONDecoder().decode(MapPreviewState.self, from: data)
    XCTAssertEqual(restored.actionSession, state.actionSession)
    restored.dismissActionRecap()
    XCTAssertNil(restored.actionSession); XCTAssertNil(restored.sheet)
    XCTAssertEqual(restored.panel, .map); XCTAssertEqual(restored.planIDs, ["cafe"])
  }
  func testActiveCameraRestoresWithoutMakingCaptureOrTrackingClaims() throws {
    var state = MapPreviewState(); state.addPlace("cafe"); state.startActionPreview()
    state.actionSession?.mode = .camera
    let restored = try JSONDecoder().decode(MapPreviewState.self, from: JSONEncoder().encode(state))
    XCTAssertEqual(restored.actionSession?.mode, .camera)
    XCTAssertNil(restored.actionSession?.endedAt)
  }
}
