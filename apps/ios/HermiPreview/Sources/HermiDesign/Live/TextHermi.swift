import Foundation
import Observation

/// `GET /me/imessage`.
struct ImessageStatusDTO: Decodable, Equatable, Sendable {
  var linked: Bool
  var handles: [String]
  var agentAddress: String?
}

/// `POST /me/imessage/link-code`.
struct ImessageLinkCodeDTO: Decodable, Equatable, Sendable {
  var code: String
  var expiresAt: Date
  var agentAddress: String?
  var smsUrl: String?
}

/// Texting Hermi: link this phone (Messages opens with "link CODE" typed in), then text plans to the agent.
@Observable
@MainActor
final class TextHermi {
  static let shared = TextHermi()
  private(set) var status: ImessageStatusDTO?
  private(set) var notice: String?
  private(set) var working = false

  func load(api: HermiAPI?) async {
    guard let api else { status = nil; return }
    status = try? await api.send("GET", "/me/imessage")
  }

  /// The Messages URL to open: to the agent, with the link code typed in.
  func linkURL(api: HermiAPI?) async -> URL? {
    guard let api, !working else { return nil }
    working = true
    defer { working = false }
    do {
      let code: ImessageLinkCodeDTO = try await api.send("POST", "/me/imessage/link-code")
      notice = "Send the text Messages opens with. The code works for 10 minutes."
      return code.smsUrl.flatMap(URL.init(string:))
    } catch {
      notice = PlanAssistant.describe(error)
      return nil
    }
  }

  /// Messages, to the agent, empty: for texting a plan once linked.
  var messagesURL: URL? { status?.agentAddress.flatMap { URL(string: "sms:\($0)") } }

  func unlink(api: HermiAPI?) async {
    guard let api else { return }
    let _: OKResponse? = try? await api.send("DELETE", "/me/imessage")
    await load(api: api)
  }

  #if DEBUG
  func showFixture(_ status: ImessageStatusDTO) { self.status = status }
  #endif
}
