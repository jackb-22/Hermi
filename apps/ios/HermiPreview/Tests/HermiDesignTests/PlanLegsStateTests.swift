import XCTest
@testable import HermiDesign

/// Legs in the app's plan state: applied with the plan, undone with it, saved with it, and synced as leg modes.
final class PlanLegsStateTests: XCTestCase {
  private func spaced() throws -> PlanContents {
    PlanContents(server: try AIFixtures.decode(PlanDTO.self, "apply-space_stops"))
  }

  func testApplyingAServerPlanBringsItsLegsAndUndoTakesThemAway() throws {
    var state = MapPreviewState()
    state.addPlace("cafe"); state.addPlace("gallery"); state.addPlace("garden")
    let before = state.planContents
    state.applyPlanContents(try spaced())
    XCTAssertEqual(state.planContents.leg(into: "gallery")?.minutes, 4)
    XCTAssertEqual(state.stopLegs?["garden"]?.source, "google")
    state.undoPlanEdit()
    XCTAssertEqual(state.planContents, before)
    XCTAssertNil(state.planContents.leg(into: "gallery"))
  }

  func testReorderingVoidsTheMovedLegsWithoutEditingThem() throws {
    var state = MapPreviewState()
    state.applyPlanContents(try spaced(), recordUndo: false)
    state.movePlace("garden", before: "cafe")
    XCTAssertEqual(state.planIDs, ["garden", "cafe", "gallery"])
    XCTAssertNil(state.planContents.leg(into: "cafe"))
    XCTAssertNotNil(state.planContents.leg(into: "gallery"), "cafe → gallery is still the same leg")
  }

  func testSnapshotSendsLegModesOnlyForValidLegs() throws {
    var contents = try spaced()
    contents.legs?["garden"]?.mode = "transit"
    let snap = PlanSnapshot(name: nil, contents: contents)
    XCTAssertEqual(snap.modes, [nil, "walk", "transit"])
    XCTAssertEqual(snap.stopInputs.map(\.legMode), [nil, "walk", "transit"])
    contents.ids = ["gallery", "cafe", "garden"]
    XCTAssertEqual(PlanSnapshot(name: nil, contents: contents).modes, [nil, nil, nil])
  }

  func testSavingThePlanKeepsItsLegs() throws {
    var state = MapPreviewState()
    state.applyPlanContents(try spaced(), recordUndo: false)
    var library = state.library
    XCTAssertTrue(library.savePlan(name: "Sat", folderID: nil, newFolder: nil, visibility: .solo, friends: [],
                                   stops: state.planIDs, times: state.stopTimes ?? [:], legs: state.stopLegs))
    state.library = library
    let id = try XCTUnwrap(library.plans.last?.id)
    state.returnToPlanDraft()
    XCTAssertTrue(state.openSavedPlan(id.uuidString))
    XCTAssertEqual(state.planContents.leg(into: "garden")?.minutes, 5)
  }
}
