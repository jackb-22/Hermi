import XCTest

@testable import CairnKit

final class CairnTests: XCTestCase {
  func testStoneThresholdsAndDecay() {
    XCTAssertEqual(CairnScale.threshold(for: 1), 25)
    XCTAssertEqual(CairnScale.threshold(for: 7), 700)
    XCTAssertEqual(CairnScale.stones(for: 24), 0)
    XCTAssertEqual(CairnScale.stones(for: 25), 1)
    XCTAssertEqual(CairnScale.stones(for: 900), 8)
    XCTAssertEqual(CairnScale.stones(for: 899), 7)
    XCTAssertEqual(CairnScale.stones(for: -10), 0)
    for score in 0...10000 {
      let n = CairnScale.stones(for: score)
      XCTAssertLessThanOrEqual(CairnScale.threshold(for: n), score)
      XCTAssertGreaterThan(CairnScale.threshold(for: n + 1), score)
      XCTAssertTrue((0..<1).contains(CairnScale.progress(for: score)))
    }
  }
  func testJSONRoundTripPreservesNullableContract() throws {
    let data = Data(#"{"score":875,"delta7d":-40,"campus":null,"stops":[],"isHost":true}"#.utf8)
    let decoded = try JSONDecoder().decode(JSON.self, from: data)
    XCTAssertEqual(decoded["delta7d"].int, -40)
    XCTAssertFalse(decoded["campus"].exists)
    XCTAssertTrue(decoded["isHost"].flag)
    XCTAssertEqual(
      try JSONDecoder().decode(JSON.self, from: JSONEncoder().encode(decoded)), decoded)
  }
  @MainActor func testStopEditsRetainIdentityWithoutTurningAIDurationIntoOverride() {
    let stop: JSON = [
      "id": "original-stop", "place": ["id": "venue"], "stayMin": 45, "staySource": "ai",
      "legMode": "walk",
    ]
    let input = CairnStore.stopInput(stop)
    XCTAssertEqual(input["id"].text, "original-stop")
    XCTAssertEqual(input["placeId"].text, "venue")
    XCTAssertFalse(input["stayMin"].exists)
    XCTAssertFalse(input["slot"].exists)
    let userStop = stop.setting("staySource", "user")
    XCTAssertEqual(CairnStore.stopInput(userStop)["stayMin"].int, 45)
  }
  @MainActor func testPreviewDoesNotSendRealActions() async {
    let store = CairnStore(preview: true)
    do {
      _ = try await store.call("checkins", "POST", [:])
      XCTFail("Preview must not send proof")
    } catch let e as APIError { XCTAssertEqual(e.code, "PREVIEW") } catch {
      XCTFail(error.localizedDescription)
    }
    XCTAssertFalse(store.session.exists)
  }
}
