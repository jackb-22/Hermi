import XCTest
@testable import HermiDesign

/// Pulling plans later (foreground, My Plan opened) takes only changes made elsewhere, e.g. by a text to Hermi.
@MainActor
final class PlanSyncRefreshTests: XCTestCase {
  /// A recorded server plan with live-looking place ids (sample ids never sync).
  private func plan(_ fixture: String, id: String? = nil, status: String? = nil) throws -> PlanDTO {
    var text = String(decoding: try XCTUnwrap(AIFixtures.data(fixture)), as: UTF8.self)
    for sample in ["cafe", "gallery", "garden", "tea", "music"] {
      text = text.replacingOccurrences(of: "\"id\": \"\(sample)\"", with: "\"id\": \"01\(sample.uppercased())\"")
    }
    var dto = try HermiAPI.decoder.decode(PlanDTO.self, from: Data(text.utf8))
    if let id { dto.id = id }
    if let status { dto.status = status }
    return dto
  }

  private func connected() throws -> (PlanSync, MapPreviewState) {
    let defaults = try XCTUnwrap(UserDefaults(suiteName: "hermi.tests.plan-refresh"))
    defaults.removePersistentDomain(forName: "hermi.tests.plan-refresh")
    let sync = PlanSync(defaults: defaults)
    var state = MapPreviewState()
    var hydration = PlanSync.Hydration()
    hydration.draft = try plan("apply-space_stops", id: "01DRAFT")
    sync.apply(hydration, account: "ava", to: &state)
    XCTAssertEqual(state.planIDs, ["01CAFE", "01GALLERY", "01GARDEN"])
    return (sync, state)
  }

  func testNothingChangedElsewhereLeavesThePlanAndUndoAlone() throws {
    var (sync, state) = try connected()
    state.movePlace("01GARDEN", before: "01CAFE")
    state.movePlace("01GARDEN", relativeTo: "01GALLERY", after: true) // Back, with two Undo steps.
    let history = state.planUndoHistory
    var same = PlanSync.Hydration()
    same.draft = try plan("apply-space_stops", id: "01DRAFT")
    XCTAssertFalse(sync.refresh(same, to: &state))
    XCTAssertEqual(state.planUndoHistory, history)
  }

  func testADraftATextRewroteReplacesMyPlanAndCanBeUndone() throws {
    var (sync, state) = try connected()
    var texted = PlanSync.Hydration()
    texted.draft = try plan("apply-chat", id: "01DRAFT") // gardens → tea room
    XCTAssertTrue(sync.refresh(texted, to: &state))
    XCTAssertEqual(state.planIDs, ["01CAFE", "01GALLERY", "01TEA"])
    XCTAssertEqual(sync.notice, "My Plan was updated from Hermi.")
    XCTAssertFalse(sync.refresh(texted, to: &state), "applied once")
    state.undoPlanEdit()
    XCTAssertEqual(state.planIDs, ["01CAFE", "01GALLERY", "01GARDEN"])
  }

  func testADraftSavedByATextOpensAsTheCurrentSavedPlan() throws {
    var (sync, state) = try connected()
    var saved = PlanSync.Hydration()
    saved.saved = [try plan("apply-chat", id: "01DRAFT", status: "planned")]
    XCTAssertTrue(sync.refresh(saved, to: &state))
    let open = try XCTUnwrap(state.editingSavedPlan)
    XCTAssertEqual(open.stopIDs, ["01CAFE", "01GALLERY", "01TEA"])
    XCTAssertEqual(sync.serverID(forKey: open.id.uuidString), "01DRAFT")
    XCTAssertNil(sync.serverID(forKey: PlanSync.draftKey))
    XCTAssertEqual(state.unsavedPlanContents, PlanContents(), "the old draft does not come back as a new plan")
    XCTAssertFalse(sync.refresh(saved, to: &state), "only once")
  }
}
