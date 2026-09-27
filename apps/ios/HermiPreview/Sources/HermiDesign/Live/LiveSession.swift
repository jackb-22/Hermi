import Foundation
import Observation

/// Connection settings for the live backend. Kept in UserDefaults (hackathon shortcut, see INTEGRATION.md D2).
struct LiveConfig: Equatable {
  var baseURL: String = ""
  var devToken: String = ""
  var username: String = "jack"
  var jwt: String?

  private static let keys = (base: "hermi.live.baseURL", dev: "hermi.live.devToken", user: "hermi.live.username", jwt: "hermi.live.jwt")

  /// Saved values win; the launch environment (HERMI_API_BASE / HERMI_DEV_TOKEN) only fills blanks.
  static func load(_ defaults: UserDefaults = .standard, environment: [String: String] = ProcessInfo.processInfo.environment) -> LiveConfig {
    var config = LiveConfig()
    config.baseURL = defaults.string(forKey: keys.base) ?? environment["HERMI_API_BASE"] ?? ""
    config.devToken = defaults.string(forKey: keys.dev) ?? environment["HERMI_DEV_TOKEN"] ?? ""
    config.username = defaults.string(forKey: keys.user) ?? environment["HERMI_USERNAME"] ?? "jack"
    config.jwt = defaults.string(forKey: keys.jwt)
    return config
  }

  func save(_ defaults: UserDefaults = .standard) {
    defaults.set(baseURL, forKey: LiveConfig.keys.base)
    defaults.set(devToken, forKey: LiveConfig.keys.dev)
    defaults.set(username, forKey: LiveConfig.keys.user)
    if let jwt { defaults.set(jwt, forKey: LiveConfig.keys.jwt) } else { defaults.removeObject(forKey: LiveConfig.keys.jwt) }
  }

  var url: URL? {
    let trimmed = baseURL.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let url = URL(string: trimmed), let scheme = url.scheme, scheme.hasPrefix("http"), url.host != nil else { return nil }
    return url
  }
}

/// The signed-in account. When `me` is nil the app runs on its sample fixtures.
@Observable
final class LiveSession {
  enum Status: Equatable { case sample, connecting, live, failed(String) }

  static let shared = LiveSession()

  private(set) var config: LiveConfig
  private(set) var me: MeDTO?
  private(set) var status: Status = .sample

  init(config: LiveConfig = .load()) { self.config = config }

  var isLive: Bool { me != nil && status == .live }

  /// Authenticated client, or nil in sample mode.
  var api: HermiAPI? {
    guard isLive, let url = config.url, let jwt = config.jwt else { return nil }
    return HermiAPI(baseURL: url, token: jwt, devToken: config.devToken)
  }

  @MainActor
  func connect(baseURL: String, devToken: String, username: String) async {
    var next = config
    next.baseURL = baseURL.trimmingCharacters(in: .whitespacesAndNewlines)
    next.devToken = devToken.trimmingCharacters(in: .whitespacesAndNewlines)
    next.username = username.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    next.jwt = nil
    guard let url = next.url else {
      config = next; config.save(); status = .failed("Enter the full https:// server URL.")
      return
    }
    status = .connecting
    let client = HermiAPI(baseURL: url, token: nil, devToken: next.devToken)
    do {
      let auth: AuthResponseDTO = try await client.send("POST", "/auth/dev", body: DevAuthBody(username: next.username))
      next.jwt = auth.token
      config = next; config.save()
      me = auth.user; status = .live
    } catch {
      config = next; config.save()
      me = nil; status = .failed(error.localizedDescription)
    }
  }

  /// On launch: reuse a saved token if the server still accepts it.
  @MainActor
  func restore() async {
    guard me == nil, let url = config.url, let jwt = config.jwt else { return }
    status = .connecting
    let client = HermiAPI(baseURL: url, token: jwt, devToken: config.devToken)
    do {
      me = try await client.send("GET", "/me", as: MeDTO.self)
      status = .live
    } catch let error as HermiAPIError where error.status == 401 {
      config.jwt = nil; config.save()
      me = nil; status = .failed("Session expired. Connect again.")
    } catch {
      // Keep the token (the tunnel may just be down) but stay in sample mode.
      me = nil; status = .failed(error.localizedDescription)
    }
  }

  @MainActor
  func disconnect() {
    config.jwt = nil; config.save()
    me = nil; status = .sample
  }
}
