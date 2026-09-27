import XCTest
@testable import HermiDesign

final class SavedPlanEditingTests: XCTestCase {
  private func fixture() -> (MapPreviewState, String) {
    var state = MapPreviewState()
    state.addPlace("books")
    var library = SavedLibrary()
    _ = library.savePlan(name: "Loop", folderID: nil, newFolder: nil, visibility: .friends,
                         friends: ["Sam"], stops: ["cafe", "garden"], times: [:])
    state.library = library
    return (state, library.plans[0].id.uuidString)
  }
  func testOpenEditUndoAndReturnPreservesUnfinishedDraft() {
    var (state, id) = fixture()
    XCTAssertTrue(state.openSavedPlan(id))
    XCTAssertEqual(state.planIDs, ["cafe", "garden"])
    state.addPlace("gallery")
    XCTAssertEqual(state.library.plan(id)?.stopIDs, ["cafe", "garden", "gallery"])
    state.undoPlanEdit()
    XCTAssertEqual(state.library.plan(id)?.stopIDs, ["cafe", "garden"])
    state.returnToPlanDraft()
    XCTAssertEqual(state.planIDs, ["books"])
    XCTAssertNil(state.activeSavedPlanID)
    XCTAssertFalse(state.canUndoPlan)
  }
  func testRemovalUndoRestoresTimeAndInvitesWithoutChangingSharing() {
    var (state, id) = fixture()
    state.openSavedPlan(id)
    let time = PreviewStopTime(arrival: Date(timeIntervalSince1970: 1_800_000_000), reminderMinutes: 15)
    state.setStopTime(time, for: "cafe")
    state.setInviteDraft(["Alex"], for: "cafe")
    state.removePlace("cafe")
    XCTAssertNil(state.library.plan(id)?.times["cafe"])
    state.undoPlanEdit()
    XCTAssertEqual(state.stopTimes?["cafe"], time)
    XCTAssertEqual(state.stopInviteDrafts?["cafe"], ["Alex"])
    XCTAssertEqual(state.library.plan(id)?.visibility, .friends)
    XCTAssertEqual(state.library.plan(id)?.friendNames, ["Sam"])
  }
  func testAppendIsOneUndoAndDuplicateDoesNotConsumeUndo() {
    var (state, id) = fixture()
    state.openSavedPlan(id)
    var library = state.library
    _ = library.savePlan(name: "Other", folderID: nil, newFolder: nil, visibility: .solo,
                         friends: [], stops: ["garden", "gallery", "tea"], times: [:])
    state.library = library
    let reference = SavedReference(kind: .plan, refID: library.plans.last!.id.uuidString)
    XCTAssertEqual(state.appendSaved(reference), .init(added: 2, skipped: 1))
    XCTAssertEqual(state.planUndoHistory?.count, 1)
    _ = state.appendSaved(reference)
    XCTAssertEqual(state.planUndoHistory?.count, 1)
    state.undoPlanEdit()
    XCTAssertEqual(state.planIDs, ["cafe", "garden"])
  }
  func testRestartKeepsEditingIdentityUndoAndOriginalDraft() throws {
    var (state, id) = fixture()
    state.openSavedPlan(id)
    state.movePlace("garden", before: "cafe")
    var restored = try JSONDecoder().decode(MapPreviewState.self, from: JSONEncoder().encode(state))
    XCTAssertEqual(restored.activeSavedPlanID, state.activeSavedPlanID)
    XCTAssertEqual(restored.planIDs, ["garden", "cafe"])
    restored.undoPlanEdit()
    XCTAssertEqual(restored.planIDs, ["cafe", "garden"])
    restored.returnToPlanDraft()
    XCTAssertEqual(restored.planIDs, ["books"])
  }
  func testEmptySavedPlanRemainsRecoverableAndCannotGo() {
    var (state, id) = fixture()
    state.openSavedPlan(id)
    state.removePlace("cafe"); state.removePlace("garden")
    XCTAssertFalse(state.canStartPlan)
    XCTAssertEqual(state.library.plan(id)?.stopIDs, [])
    state.returnToPlanDraft()
    XCTAssertTrue(state.openSavedPlan(id))
    XCTAssertEqual(state.planIDs, [])
    state.addPlace("tea")
    XCTAssertTrue(state.canStartPlan)
    XCTAssertEqual(state.library.plan(id)?.stopIDs, ["tea"])
  }
  func testSharingIntentDoesNotAlterContentsOrPermitEmptyFriends() {
    var (state, id) = fixture()
    state.openSavedPlan(id)
    XCTAssertFalse(state.setSharingIntent(visibility: .friends, friends: []))
    XCTAssertEqual(state.library.plan(id)?.friendNames, ["Sam"])
    XCTAssertTrue(state.setSharingIntent(visibility: .publicPlan, friends: ["Sam"]))
    XCTAssertEqual(state.library.plan(id)?.friendNames, [])
    XCTAssertEqual(state.planIDs, ["cafe", "garden"])
    XCTAssertFalse(state.canUndoPlan) // Sharing preferences are a separate explicit draft action.
  }
}
