import XCTest
@testable import HermiDesign

final class SavedLibraryTests: XCTestCase {
  func testFolderCanHoldPostPlaceAndPlanWithoutChangingActivePlan() {
    var state = MapPreviewState()
    state.addPlace("cafe"); state.addPlace("garden")
    state.toggleSave("books")
    var library = state.library
    XCTAssertTrue(library.savePlan(name: "Saturday", folderID: nil, newFolder: "Ideas", visibility: .solo,
                                   friends: [], stops: state.planIDs, times: [:]))
    let folderID = try! XCTUnwrap(library.folders.first?.id)
    XCTAssertTrue(library.savePost("cafe-alex", in: folderID))
    XCTAssertTrue(library.put(.init(kind: .place, refID: "books"), in: folderID))
    state.library = library
    XCTAssertEqual(state.planIDs, ["cafe", "garden"])
    XCTAssertEqual(Set(state.library.folders[0].items.map(\.kind.rawValue)), ["place", "post", "plan"])
    XCTAssertEqual(state.savedReferences.count, 3)
    state.toggleSave("books")
    XCTAssertFalse(state.library.folders[0].items.contains(.init(kind: .place, refID: "books")))
    XCTAssertEqual(state.library.folders[0].items.count, 2)
  }

  func testAppendSavedPlanPreservesOrderSkipsDuplicatesAndRestoresNewStopTime() {
    var state = MapPreviewState()
    state.addPlace("cafe")
    let time = PreviewStopTime(arrival: Date(timeIntervalSince1970: 1_800_000_000))
    var library = state.library
    XCTAssertTrue(library.savePlan(name: "Loop", folderID: nil, newFolder: nil, visibility: .solo,
                                   friends: [], stops: ["cafe", "gallery", "garden"], times: ["gallery": time]))
    state.library = library
    let id = try! XCTUnwrap(library.plans.first?.id.uuidString)
    XCTAssertEqual(state.appendSaved(.init(kind: .plan, refID: id)), .init(added: 2, skipped: 1))
    XCTAssertEqual(state.planIDs, ["cafe", "gallery", "garden"])
    XCTAssertEqual(state.stopTimes?["gallery"], time)
    XCTAssertEqual(state.appendSaved(.init(kind: .plan, refID: id)), .init(skipped: 3))
  }

  func testInvalidSaveHasNoMutationAndFriendsAreDraftOnly() {
    var library = SavedLibrary()
    XCTAssertFalse(library.savePlan(name: "No stops", folderID: nil, newFolder: "Ideas", visibility: .solo,
                                    friends: [], stops: [], times: [:]))
    XCTAssertTrue(library.folders.isEmpty)
    XCTAssertFalse(library.savePlan(name: "Friends", folderID: nil, newFolder: nil, visibility: .friends,
                                    friends: [], stops: ["cafe"], times: [:]))
    XCTAssertTrue(library.savePlan(name: "Friends", folderID: nil, newFolder: nil, visibility: .friends,
                                   friends: ["Sam"], stops: ["cafe"], times: [:]))
    XCTAssertEqual(library.plans[0].friendNames, ["Sam"])
    XCTAssertEqual(library.plans[0].visibility, .friends)
  }

  func testLegacySnapshotDecodesAndSavedLibraryPersists() throws {
    var state = MapPreviewState()
    state.toggleSave("cafe")
    let legacy = try JSONEncoder().encode(state)
    let oldJSON = try XCTUnwrap(String(data: legacy, encoding: .utf8))
    let withoutLibrary = oldJSON.replacingOccurrences(of: ",\"savedLibrary\":null", with: "")
      .replacingOccurrences(of: "\"savedLibrary\":null,", with: "")
    let restored = try JSONDecoder().decode(MapPreviewState.self, from: Data(withoutLibrary.utf8))
    XCTAssertTrue(restored.savedIDs.contains("cafe"))
    XCTAssertNil(restored.savedLibrary)
    var updated = restored
    var library = updated.library
    _ = library.savePost("cafe-alex")
    updated.library = library
    let roundTrip = try JSONDecoder().decode(MapPreviewState.self, from: JSONEncoder().encode(updated))
    XCTAssertEqual(roundTrip, updated)
  }
}
