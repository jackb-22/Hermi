import XCTest
@testable import HermiDesign

final class GalleryTests: XCTestCase {
  func testDiscoveryAndRepeatedAddNeverInsertUnchosenOrDuplicateItems() {
    var state = GalleryState()
    state.category = .food
    XCTAssertTrue(state.planItems.isEmpty)
    state.addSelectedPlace()
    state.addSelectedPlace()
    XCTAssertEqual(state.planItems, [.food])
    state.category = .nature
    XCTAssertEqual(state.planItems, [.food])
    state.addSelectedPlace()
    XCTAssertEqual(state.planItems, [.food, .nature])
  }

  func testUnavailableStatesCannotSaveOrAddAndRecoveryPreservesSelections() {
    for scenario in [SampleState.loading, .empty, .error] {
      var state = GalleryState()
      state.category = .culture
      state.scenario = scenario
      state.addSelectedPlace(); state.toggleSave()
      XCTAssertTrue(state.planItems.isEmpty)
      XCTAssertTrue(state.saved.isEmpty)
      state.recover()
      XCTAssertEqual(state.category, .culture)
      state.addSelectedPlace()
      XCTAssertEqual(state.planItems, [.culture])
    }
  }

  func testBookmarksBelongToTheirSelectedPlace() {
    var state = GalleryState()
    state.toggleSave()
    state.category = .music
    XCTAssertFalse(state.saved.contains(.music))
    state.toggleSave()
    state.category = .nature
    state.toggleSave()
    XCTAssertEqual(state.saved, [.music])
  }

  func testRestoreAndResetAllUserChanges() throws {
    var state = GalleryState()
    state.specimen = .score; state.category = .shopping
    state.toggleSave(); state.addSelectedPlace()
    state.name = "Sam"; state.score = 5000; state.textSize = .accessible
    state.reduceMotion = true; state.controlConfirmed = true; state.scenario = .error
    let restored = GalleryState.restore(try JSONEncoder().encode(state))
    XCTAssertEqual(restored, state)
    state.reset()
    XCTAssertEqual(state, GalleryState())
  }

  func testCorruptOrOutOfRangeStorageRecoversToSafeSample() throws {
    XCTAssertEqual(GalleryState.restore(Data("broken".utf8)), GalleryState())
    var bad = GalleryState(); bad.score = -1
    XCTAssertEqual(GalleryState.restore(try JSONEncoder().encode(bad)), GalleryState())
    bad.score = 100_000
    XCTAssertEqual(GalleryState.restore(try JSONEncoder().encode(bad)), GalleryState())
  }

  func testThresholdBoundariesAndLargeStacks() {
    for count in 1...62 {
      let threshold = HermiStoneScale.threshold(count)
      XCTAssertEqual(HermiStoneScale.count(threshold-1), count-1)
      XCTAssertEqual(HermiStoneScale.count(threshold), count)
      XCTAssertEqual(HermiStoneScale.count(threshold+1), count)
      XCTAssertEqual(HermiStoneScale.progress(threshold), 0)
    }
    XCTAssertEqual(HermiStoneScale.count(5000), 19)
    XCTAssertEqual(HermiStoneScale.count(0), 0)
  }

  func testWindOnlyOnDownwardStoneCrossing() {
    XCTAssertTrue(HermiStoneScale.losesStone(from: 75, to: 74))
    XCTAssertFalse(HermiStoneScale.losesStone(from: 74, to: 73))
    XCTAssertFalse(HermiStoneScale.losesStone(from: 75, to: 75))
    XCTAssertFalse(HermiStoneScale.losesStone(from: 74, to: 75))
  }
}
