import XCTest
@testable import HermiDesign

final class PlanTimelineTests: XCTestCase {
  private let start = Date(timeIntervalSince1970: 1_800_000_000)
  func testReorderingKeepsMetadataAndCanMoveAfterLast() {
    var state = MapPreviewState()
    for id in ["cafe", "gallery", "garden"] { state.addPlace(id) }
    let time = PreviewStopTime(arrival: start, durationMinutes: 60, reminderMinutes: 15)
    state.setStopTime(time, for: "cafe"); state.setInviteDraft(["Sam"], for: "cafe")
    state.movePlace("cafe", relativeTo: "garden", after: true)
    XCTAssertEqual(state.planIDs, ["gallery", "garden", "cafe"])
    XCTAssertEqual(state.stopTimes?["cafe"], time)
    XCTAssertEqual(state.stopInviteDrafts?["cafe"], ["Sam"])
    state.movePlace("cafe", before: "gallery")
    XCTAssertEqual(state.planIDs, ["cafe", "gallery", "garden"])
    state.movePlace("missing", before: "cafe")
    state.movePlace("cafe", before: "cafe")
    XCTAssertEqual(state.planIDs.count, 3)
  }
  func testTimingBoundaryAndWarningDoesNotBlockGo() {
    var state = MapPreviewState()
    XCTAssertFalse(state.canStartPlan)
    state.addPlace("cafe"); state.addPlace("gallery")
    state.setStopTime(.init(arrival: start, durationMinutes: 60), for: "cafe")
    state.setStopTime(.init(arrival: start.addingTimeInterval(3600)), for: "gallery")
    XCTAssertTrue(state.timingConflicts.isEmpty)
    state.setStopTime(.init(arrival: start.addingTimeInterval(3599)), for: "gallery")
    XCTAssertEqual(state.timingConflicts, [.init(firstID: "cafe", nextID: "gallery")])
    XCTAssertTrue(state.canStartPlan)
    state.setStopTime(nil, for: "gallery")
    XCTAssertTrue(state.timingConflicts.isEmpty)
    XCTAssertTrue(state.canStartPlan) // times are optional
  }
  func testRemovalClearsOnlyThatStopsDraftsAndKeepsBookmark() {
    var state = MapPreviewState()
    for id in ["cafe", "gallery"] { state.addPlace(id); state.setStopTime(.init(arrival: start), for: id) }
    state.toggleSave("cafe"); state.setInviteDraft(["Sam"], for: "cafe")
    state.removePlace("cafe")
    XCTAssertNil(state.stopTimes?["cafe"]); XCTAssertNil(state.stopInviteDrafts?["cafe"])
    XCTAssertNotNil(state.stopTimes?["gallery"]); XCTAssertTrue(state.savedIDs.contains("cafe"))
    state.setStopTime(.init(arrival: start), for: "cafe") // stale editor cannot restore removed stop
    XCTAssertNil(state.stopTimes?["cafe"])
    state.addPlace("cafe"); XCTAssertNil(state.stopTimes?["cafe"])
  }
  func testPlanDraftRoundTripAndDetailReturn() throws {
    var state = MapPreviewState()
    state.addPlace("cafe"); state.setStopTime(.init(arrival: start, reminderMinutes: 30), for: "cafe")
    state.setInviteDraft(["Sam", "Not a sample friend"], for: "cafe")
    state.sheet = .plan; state.selectPlace("cafe")
    XCTAssertEqual(state.returnSheet, .plan)
    state.goBack(); XCTAssertEqual(state.sheet, .plan)
    let restored = try JSONDecoder().decode(MapPreviewState.self, from: JSONEncoder().encode(state))
    XCTAssertEqual(restored, state)
    XCTAssertEqual(restored.stopInviteDrafts?["cafe"], ["Sam"])
    state.setStopTime(.init(arrival: start, durationMinutes: -1), for: "cafe")
    XCTAssertEqual(state.stopTimes?["cafe"]?.durationMinutes, 60)
  }
}
