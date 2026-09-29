import Foundation
import Observation

/// The three presets of the AI button. Each is one chip on `POST /plans/:id/ask`.
enum AssistantPreset: Equatable, Sendable {
  case space
  case weather
  case add(HermiCategory)

  var body: AskBody {
    switch self {
    case .space: return .chip("space_stops")
    case .weather: return .chip("best_weather_day")
    case .add(let category): return .chip("suggest_activity", category: category.serverName)
    }
  }
  var title: String {
    switch self {
    case .space: return "Space it out"
    case .weather: return "Best weather day"
    case .add(let category): return "Add \(category.rawValue.lowercased())"
    }
  }
}

/// Where the AI button's requests go: the live API, or recorded server responses for previews and tests.
protocol AssistantBackend: Sendable {
  func ask(planID: String, body: AskBody) async throws -> AskResponseDTO
  func apply(planID: String) async throws -> PlanDTO
  func dismiss(planID: String) async throws -> PlanDTO
}

struct LiveAssistantBackend: AssistantBackend {
  var api: HermiAPI
  func ask(planID: String, body: AskBody) async throws -> AskResponseDTO {
    try await api.send("POST", "/plans/\(planID)/ask", body: body)
  }
  func apply(planID: String) async throws -> PlanDTO {
    try await api.send("POST", "/plans/\(planID)/changes/apply", body: ApplyChangesBody())
  }
  func dismiss(planID: String) async throws -> PlanDTO {
    try await api.send("POST", "/plans/\(planID)/changes/dismiss", body: ApplyChangesBody())
  }
}

/// Replays AIFixtures (real server output) so screenshot scenarios and tests need no server.
final class FixtureAssistantBackend: AssistantBackend, @unchecked Sendable {
  private let delay: Duration
  private let lock = NSLock()
  private var last = "space_stops"
  private(set) var requests: [AskBody] = []

  init(delay: Duration = .zero) { self.delay = delay }

  func ask(planID: String, body: AskBody) async throws -> AskResponseDTO {
    let name: String
    if let chip = body.chip { name = chip } else { name = body.prompt?.hasSuffix("?") == true ? "chat-answer" : "chat" }
    lock.withLock { last = name; requests.append(body) }
    if delay > .zero { try await Task.sleep(for: delay) }
    return try AIFixtures.decode(AskResponseDTO.self, "ask-\(name)")
  }
  func apply(planID: String) async throws -> PlanDTO {
    let name = lock.withLock { last == "chat-answer" ? "chat" : last }
    return try AIFixtures.decode(PlanDTO.self, "apply-\(name)")
  }
  func dismiss(planID: String) async throws -> PlanDTO {
    try AIFixtures.decode(PlanDTO.self, "dismiss-chat")
  }
}

/// One line of the AI chat.
struct AssistantLine: Equatable, Identifiable, Sendable {
  enum Role: String, Sendable { case user, model }
  var id = UUID()
  var role: Role
  var text: String
  var sources: [SourceDTO] = []
}

/**
 The AI button's state. It only ever edits the open plan: presets and chat become suggested changes (a preview),
 and nothing changes until Apply. A reply is thrown away when the plan changed while it was on its way (AI-01).
 */
@Observable
@MainActor
final class PlanAssistant {
  enum Phase: Equatable {
    case closed
    case menu
    case categories
    case chat
    /// Waiting on the server; the title says what for.
    case asking(String)
    case applying
  }

  private(set) var phase: Phase = .closed
  /// The suggestion waiting for Apply or Dismiss (shown over whichever mode asked for it).
  private(set) var suggestion: AskResponseDTO?
  private(set) var lines: [AssistantLine] = []
  /// A short problem to show (offline, rate limited, plan changed); cleared by the next action.
  private(set) var notice: String?
  var draft = ""

  /// The mode to return to after a reply: the menu for presets, the chat for prompts.
  private var home: Phase = .menu
  private var askedFor: PlanContents?

  var isOpen: Bool { phase != .closed }
  var isBusy: Bool {
    if case .asking = phase { return true }
    return phase == .applying
  }

  func open() { phase = .menu; notice = nil }
  func close() { phase = .closed; notice = nil }
  func showCategories() { guard !isBusy else { return }; phase = .categories; notice = nil }
  func showChat() { guard !isBusy else { return }; phase = .chat; home = .chat; notice = nil }
  func back() { guard !isBusy else { return }; phase = .menu; home = .menu; notice = nil }

  /// The earlier chat turns to send along (the newest 8, each at most 600 characters).
  var history: [AskTurn] {
    lines.suffix(8).map { AskTurn(role: $0.role.rawValue, text: String($0.text.prefix(600))) }
  }

  /// `plan` reads the plan as it is now: once when asking, and again when the reply lands.
  func ask(_ preset: AssistantPreset, plan: () -> PlanContents, backend: AssistantBackend?,
           planID: () async -> String?) async {
    guard !isBusy else { return }
    home = .menu
    await run(preset.body, title: preset.title, plan: plan, backend: backend, planID: planID)
  }

  func send(plan: () -> PlanContents, backend: AssistantBackend?, planID: () async -> String?) async {
    guard !isBusy else { return }
    let prompt = draft.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !prompt.isEmpty else { return }
    home = .chat
    let body = AskBody.chat(String(prompt.prefix(300)), history: history)
    lines.append(AssistantLine(role: .user, text: prompt))
    draft = ""
    let ok = await run(body, title: "Thinking", plan: plan, backend: backend, planID: planID)
    if !ok, lines.last?.role == .user {
      // Keep what they typed so they can send it again.
      draft = lines.removeLast().text
    }
  }

  /// The plan changed under a waiting suggestion: the server has cleared it, so the preview goes too.
  func planChanged(to plan: PlanContents) {
    guard suggestion != nil, plan != askedFor else { return }
    suggestion = nil
    notice = "Your plan changed, so I dropped that suggestion."
  }

  /// Applies the suggestion on the server; the caller puts the returned plan into the app's state.
  func apply(backend: AssistantBackend?, planID: String?) async -> PlanDTO? {
    guard suggestion != nil, let backend, let planID, !isBusy else { return nil }
    phase = .applying
    do {
      let plan = try await backend.apply(planID: planID)
      suggestion = nil
      phase = home
      if home == .chat { lines.append(AssistantLine(role: .model, text: "Applied.")) }
      return plan
    } catch {
      phase = home
      notice = Self.describe(error)
      return nil
    }
  }

  func dismiss(backend: AssistantBackend?, planID: String?) async {
    guard suggestion != nil else { return }
    suggestion = nil
    if let backend, let planID { _ = try? await backend.dismiss(planID: planID) }
  }

  @discardableResult
  private func run(_ body: AskBody, title: String, plan: () -> PlanContents, backend: AssistantBackend?,
                   planID: () async -> String?) async -> Bool {
    notice = nil
    suggestion = nil
    let asked = plan()
    guard let backend else { notice = Self.signedOut; phase = home; return false }
    guard !asked.ids.isEmpty else { notice = "Add a place to your plan first."; phase = home; return false }
    phase = .asking(title)
    guard let id = await planID() else { phase = home; notice = Self.signedOut; return false }
    do {
      let reply = try await backend.ask(planID: id, body: body)
      phase = home
      guard plan() == asked else {
        notice = "Your plan changed while I was thinking. Ask again."
        return false
      }
      askedFor = asked
      if home == .chat { lines.append(AssistantLine(role: .model, text: reply.message, sources: reply.sources)) }
      suggestion = (reply.plan.ghostChanges ?? []).isEmpty ? nil : reply
      if suggestion == nil, home == .menu { notice = reply.message }
      return true
    } catch {
      phase = home
      notice = Self.describe(error)
      return false
    }
  }

  static let signedOut = "Connect your account (Profile → Server) to use Hermi AI."

  static func describe(_ error: Error) -> String {
    guard let error = error as? HermiAPIError else { return "Something went wrong. Try again." }
    switch error.status {
    case 429: return "You’ve asked a lot this hour. Try again in a bit."
    case 0: return "Couldn’t reach Hermi. Check your connection."
    case 403: return "Only the plan’s host can use AI on it."
    default: return error.message
    }
  }
}
