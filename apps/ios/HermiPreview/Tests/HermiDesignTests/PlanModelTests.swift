import XCTest
@testable import HermiDesign

/// Plan value types (Foundation only; also runs on Linux via LinuxCheck).
final class PlanModelTests: XCTestCase {
  func testServerPlanBecomesPlacesTimesAndLegs() throws {
    let plan = try AIFixtures.decode(PlanDTO.self, "apply-space_stops")
    let contents = PlanContents(server: plan)
    XCTAssertEqual(contents.ids, ["cafe", "gallery", "garden"])
    XCTAssertEqual(contents.times["gallery"]?.durationMinutes, 60)
    XCTAssertEqual(contents.times["gallery"]?.arrival, plan.stops[1].arriveAt)
    XCTAssertNil(contents.leg(into: "cafe"))
    XCTAssertEqual(contents.leg(into: "gallery"), PreviewLeg(from: "cafe", minutes: 4, mode: "walk", source: "google"))
    XCTAssertEqual(contents.leg(into: "garden")?.minutes, 5)
    XCTAssertFalse(try XCTUnwrap(contents.leg(into: "garden")).isEstimate)
  }

  func testALegOnlyCountsWhileTheStopBeforeIsUnchanged() throws {
    var contents = PlanContents(server: try AIFixtures.decode(PlanDTO.self, "apply-space_stops"))
    contents.ids = ["gallery", "cafe", "garden"]
    XCTAssertNil(contents.leg(into: "gallery"), "now first")
    XCTAssertNil(contents.leg(into: "garden"), "now reached from the cafe")
    contents.ids = ["cafe", "garden"]
    XCTAssertNil(contents.leg(into: "garden"), "the gallery it was measured from is gone")
    contents.ids = ["cafe", "gallery", "garden"]
    XCTAssertNotNil(contents.leg(into: "garden"), "restored order restores the leg (Undo)")
  }

  func testPlansSavedBeforeLegsStillDecode() throws {
    let old = #"{"ids":["cafe","gallery"],"times":{},"inviteDrafts":{}}"#
    let contents = try JSONDecoder().decode(PlanContents.self, from: Data(old.utf8))
    XCTAssertEqual(contents.ids, ["cafe", "gallery"])
    XCTAssertNil(contents.legs)
    let roundTrip = try JSONDecoder().decode(PlanContents.self, from: JSONEncoder().encode(
      PlanContents(ids: ["a", "b"], legs: ["b": PreviewLeg(from: "a", minutes: 9, mode: "transit", source: "apple")])))
    XCTAssertEqual(roundTrip.leg(into: "b")?.mode, "transit")
  }

  func testSuggestionFixturesMapToThePlanAfterApply() throws {
    let added = PlanContents(server: try AIFixtures.decode(PlanDTO.self, "apply-suggest_activity"))
    XCTAssertEqual(added.ids.first, "music")
    let chat = PlanContents(server: try AIFixtures.decode(PlanDTO.self, "apply-chat"))
    XCTAssertEqual(chat.ids, ["cafe", "gallery", "tea"])
  }
}
