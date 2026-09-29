import XCTest
@testable import HermiDesign

/// The AI button's state machine, against recorded server responses (Foundation only; runs on Linux too).
@MainActor
final class AssistantModelTests: XCTestCase {
  private let draftPlan = PlanContents(ids: ["cafe", "gallery", "garden"])

  /// A backend that fails with a given error, or waits until released.
  private final class Scripted: AssistantBackend, @unchecked Sendable {
    var error: Error?
    var onAsk: (() -> Void)?
    var asks = 0
    func ask(planID: String, body: AskBody) async throws -> AskResponseDTO {
      asks += 1
      onAsk?()
      if let error { throw error }
      return try AIFixtures.decode(AskResponseDTO.self, body.chip.map { "ask-\($0)" } ?? "ask-chat")
    }
    func apply(planID: String) async throws -> PlanDTO {
      if let error { throw error }
      return try AIFixtures.decode(PlanDTO.self, "apply-space_stops")
    }
    func dismiss(planID: String) async throws -> PlanDTO { try AIFixtures.decode(PlanDTO.self, "dismiss-chat") }
  }

  func testPresetBecomesASuggestionThenApplyReturnsTheServerPlan() async throws {
    let model = PlanAssistant()
    let backend = FixtureAssistantBackend()
    model.open()
    await model.ask(.space, plan: { self.draftPlan }, backend: backend, planID: { "p1" })
    XCTAssertEqual(model.phase, .menu)
    let suggestion = try XCTUnwrap(model.suggestion)
    XCTAssertEqual(suggestion.plan.ghostChanges?.count, 2)
    XCTAssertNotNil(suggestion.preview)
    XCTAssertEqual(backend.requests, [.chip("space_stops")])

    let applied = await model.apply(backend: backend, planID: "p1")
    XCTAssertEqual(applied.map { PlanContents(server: $0).ids }, ["cafe", "gallery", "garden"])
    XCTAssertNil(model.suggestion)
    XCTAssertNil(model.notice)
  }

  func testAddPresetSendsTheCategory() async {
    let model = PlanAssistant()
    let backend = FixtureAssistantBackend()
    model.showCategories()
    await model.ask(.add(.music), plan: { self.draftPlan }, backend: backend, planID: { "p1" })
    XCTAssertEqual(backend.requests, [.chip("suggest_activity", category: "music")])
    XCTAssertEqual(model.phase, .menu)
    XCTAssertEqual(model.suggestion?.plan.ghostChanges?.first?.kind, "add_stop")
  }

  func testChatKeepsTurnsAndSendsEarlierOnesAsHistory() async {
    let model = PlanAssistant()
    let backend = FixtureAssistantBackend()
    model.showChat()
    model.draft = "does the tea room have seats?"
    await model.send(plan: { self.draftPlan }, backend: backend, planID: { "p1" })
    XCTAssertEqual(model.lines.map(\.role), [.user, .model])
    XCTAssertEqual(model.lines.last?.sources.first?.title, "Tea room")
    XCTAssertNil(model.suggestion, "an answer changes nothing")
    XCTAssertEqual(model.draft, "")

    model.draft = "make the last stop indoors"
    await model.send(plan: { self.draftPlan }, backend: backend, planID: { "p1" })
    XCTAssertEqual(backend.requests.last?.history?.map(\.role), ["user", "model"])
    XCTAssertEqual(backend.requests.last?.prompt, "make the last stop indoors")
    XCTAssertEqual(model.suggestion?.plan.ghostChanges?.map(\.kind), ["remove_stop", "add_stop"])
    XCTAssertEqual(model.phase, .chat)
  }

  func testAReplyForAPlanThatChangedMeanwhileIsDiscarded() async {
    let model = PlanAssistant()
    let backend = Scripted()
    var plan = draftPlan
    backend.onAsk = { plan.ids.removeLast() } // The user removed a stop while the AI was thinking.
    await model.ask(.space, plan: { plan }, backend: backend, planID: { "p1" })
    XCTAssertNil(model.suggestion)
    XCTAssertEqual(model.notice, "Your plan changed while I was thinking. Ask again.")
  }

  func testAPreviewIsDroppedWhenThePlanChanges() async {
    let model = PlanAssistant()
    await model.ask(.space, plan: { self.draftPlan }, backend: FixtureAssistantBackend(), planID: { "p1" })
    model.planChanged(to: draftPlan)
    XCTAssertNotNil(model.suggestion, "same plan: keep it")
    model.planChanged(to: PlanContents(ids: ["cafe"]))
    XCTAssertNil(model.suggestion)
  }

  func testErrorsKeepTheChatDraftAndExplainThemselves() async {
    let model = PlanAssistant()
    let backend = Scripted()
    model.showChat()
    backend.error = HermiAPIError(status: 429, code: "RATE_LIMITED", message: "Too many requests")
    model.draft = "add dinner"
    await model.send(plan: { self.draftPlan }, backend: backend, planID: { "p1" })
    XCTAssertEqual(model.draft, "add dinner")
    XCTAssertTrue(model.lines.isEmpty)
    XCTAssertEqual(model.notice, "You’ve asked a lot this hour. Try again in a bit.")

    backend.error = HermiAPIError.transport(URLError(.notConnectedToInternet))
    await model.ask(.weather, plan: { self.draftPlan }, backend: backend, planID: { "p1" })
    XCTAssertEqual(model.notice, "Couldn’t reach Hermi. Check your connection.")
  }

  func testSignedOutOrEmptyPlanNeverCallsTheServer() async {
    let model = PlanAssistant()
    let backend = Scripted()
    await model.ask(.space, plan: { self.draftPlan }, backend: nil, planID: { "p1" })
    XCTAssertEqual(model.notice, PlanAssistant.signedOut)
    await model.ask(.space, plan: { self.draftPlan }, backend: backend, planID: { nil })
    XCTAssertEqual(model.notice, PlanAssistant.signedOut)
    await model.ask(.space, plan: { PlanContents() }, backend: backend, planID: { "p1" })
    XCTAssertEqual(model.notice, "Add a place to your plan first.")
    XCTAssertEqual(backend.asks, 0)
  }

  func testNoSecondRequestWhileOneIsInFlight() async {
    let model = PlanAssistant()
    let backend = Scripted()
    var second: Task<Void, Never>?
    backend.onAsk = {
      // A second tap while the first request is out: ignored.
      second = Task { @MainActor in
        await model.ask(.weather, plan: { self.draftPlan }, backend: backend, planID: { "p1" })
      }
    }
    await model.ask(.space, plan: { self.draftPlan }, backend: backend, planID: { "p1" })
    await second?.value
    XCTAssertEqual(backend.asks, 1)
  }

  func testNothingToChangeIsShownAsTheMessage() async throws {
    let model = PlanAssistant()
    final class Answer: AssistantBackend, @unchecked Sendable {
      func ask(planID: String, body: AskBody) async throws -> AskResponseDTO {
        try AIFixtures.decode(AskResponseDTO.self, "ask-chat-answer")
      }
      func apply(planID: String) async throws -> PlanDTO { throw URLError(.badURL) }
      func dismiss(planID: String) async throws -> PlanDTO { throw URLError(.badURL) }
    }
    await model.ask(.space, plan: { self.draftPlan }, backend: Answer(), planID: { "p1" })
    XCTAssertNil(model.suggestion)
    XCTAssertEqual(model.notice, "Yes: window seats, open until 9 PM.")
  }
}
