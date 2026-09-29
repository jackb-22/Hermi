import XCTest
@testable import HermiDesign

/// The AI button's server responses decode (fixtures are real API output; see AIFixtures).
final class AssistantContractTests: XCTestCase {
  func testEveryFixtureIsPresent() {
    for name in ["plan", "ask-space_stops", "apply-space_stops", "ask-suggest_activity", "apply-suggest_activity",
                 "ask-best_weather_day", "apply-best_weather_day", "ask-chat", "apply-chat", "ask-chat-answer",
                 "dismiss-chat", "error-400"] {
      XCTAssertNotNil(AIFixtures.data(name), name)
    }
  }

  func testPlanCarriesLegsAndTimes() throws {
    let plan = try AIFixtures.decode(PlanDTO.self, "apply-space_stops")
    XCTAssertEqual(plan.stops.map { $0.place?.id }, ["cafe", "gallery", "garden"])
    XCTAssertNil(plan.stops[0].legMode)
    XCTAssertEqual(plan.stops[1].legMode, "walk")
    XCTAssertEqual(plan.stops[1].legMin, 4)
    XCTAssertEqual(plan.stops[1].legSource, "google")
    let gap = try XCTUnwrap(plan.stops[1].arriveAt).timeIntervalSince(try XCTUnwrap(plan.stops[0].departAt))
    XCTAssertEqual(gap, 4 * 60)
    XCTAssertEqual(plan.ghostChanges?.count, 0)
    XCTAssertNotNil(plan.totals?.endsAt)
  }

  func testSpaceItOutIsLegChangesWithMinutes() throws {
    let r = try AIFixtures.decode(AskResponseDTO.self, "ask-space_stops")
    XCTAssertEqual(r.via, "code")
    XCTAssertTrue(r.message.hasPrefix("Spaced with travel times: Walk 4 min"))
    let changes = try XCTUnwrap(r.plan.ghostChanges)
    XCTAssertEqual(changes.map(\.kind), ["set_mode", "set_mode"])
    XCTAssertEqual(changes.map(\.legMin), [4, 5])
    XCTAssertEqual(changes[0].label, "Walk 4 min to Little gallery")
    XCTAssertNotNil(changes[0].stopId)
  }

  func testSuggestAndWeatherAndChat() throws {
    let add = try AIFixtures.decode(AskResponseDTO.self, "ask-suggest_activity")
    XCTAssertEqual(add.plan.ghostChanges?.first?.kind, "add_stop")
    XCTAssertEqual(add.plan.ghostChanges?.first?.stop?.placeId, "music")
    XCTAssertEqual(add.plan.ghostChanges?.first?.toIndex, 1)

    let weather = try AIFixtures.decode(AskResponseDTO.self, "ask-best_weather_day")
    let move = try XCTUnwrap(weather.plan.ghostChanges?.first)
    XCTAssertEqual(move.kind, "set_start")
    XCTAssertNotNil(move.startAt)

    let chat = try AIFixtures.decode(AskResponseDTO.self, "ask-chat")
    XCTAssertEqual(chat.via, "gemini")
    XCTAssertEqual(chat.plan.ghostChanges?.map(\.kind), ["remove_stop", "add_stop"])
    let answer = try AIFixtures.decode(AskResponseDTO.self, "ask-chat-answer")
    XCTAssertEqual(answer.plan.ghostChanges?.count, 0)
    XCTAssertEqual(answer.sources.first?.title, "Tea room")
  }

  func testAskBodyEncodesOnlyWhatIsSet() throws {
    func json(_ body: AskBody) throws -> [String: Any] {
      try XCTUnwrap(JSONSerialization.jsonObject(with: HermiAPI.encoder.encode(body)) as? [String: Any])
    }
    XCTAssertEqual(try json(.chip("space_stops")).keys.sorted(), ["chip"])
    let add = try json(.chip("suggest_activity", category: "music"))
    XCTAssertEqual(add["category"] as? String, "music")
    XCTAssertEqual(try json(.chat("hi", history: [])).keys.sorted(), ["prompt"])
    let chat = try json(.chat("and then?", history: [AskTurn(role: "user", text: "hi")]))
    XCTAssertEqual((chat["history"] as? [[String: String]])?.first?["role"], "user")
  }
}
