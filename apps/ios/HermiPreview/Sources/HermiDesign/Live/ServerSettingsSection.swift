import SwiftUI

/// Settings → Server: dev login against the demo backend. Without it the app stays on sample fixtures.
struct ServerSettingsSection: View {
  private let live = LiveSession.shared
  @State private var baseURL: String
  @State private var devToken: String
  @State private var username: String
  @State private var accountError: String?

  init() {
    let config = LiveSession.shared.config
    _baseURL = State(initialValue: config.baseURL)
    _devToken = State(initialValue: config.devToken)
    _username = State(initialValue: config.username)
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack {
        Text("SERVER · DEV").font(.system(size: 10, design: .monospaced))
        Spacer()
        Text(badge).font(.system(size: 10, weight: .bold, design: .monospaced))
          .padding(.horizontal, 8).padding(.vertical, 4)
          .background(live.isLive ? HermiPalette.lime : HermiPalette.controlSurface, in: PixelPanel(corner: 4))
          .accessibilityLabel(live.isLive ? "Connected" : "Sample mode")
      }
      TextField("https://….trycloudflare.com", text: $baseURL).liveInputStyle()
      TextField("Dev token", text: $devToken).liveInputStyle()
      TextField("Username", text: $username).liveInputStyle()
      HStack(spacing: 8) {
        Text("Demo accounts:").font(.caption)
        ForEach(LiveConfig.demoAccounts, id: \.self) { account in
          Button("@\(account)") {
            username = account
            Task { await live.connect(baseURL: baseURL, devToken: devToken, username: account) }
          }.font(.caption.bold()).padding(.horizontal, 10).frame(minHeight: 32)
            .background(live.me?.username == account ? HermiPalette.lime : .white, in: PixelPanel(corner: 5))
        }
      }
      HStack(spacing: 10) {
        Button(live.status == .connecting ? "Connecting…" : "Connect") {
          Task { await live.connect(baseURL: baseURL, devToken: devToken, username: username) }
        }.font(.subheadline.bold()).padding(.horizontal, 14).frame(minHeight: 44)
          .background(HermiPalette.lime, in: PixelPanel(corner: 6))
          .disabled(live.status == .connecting)
        if live.isLive {
          Button("Disconnect") { live.disconnect() }
            .font(.subheadline).padding(.horizontal, 14).frame(minHeight: 44)
            .background(.white, in: PixelPanel(corner: 6))
        }
      }
      if !live.isLive, live.hasSavedLogin, live.status != .connecting {
        Text("Saved login for @\(live.config.username) is not active.").font(.caption)
      }
      if let me = live.me, live.isLive {
        Divider().padding(.vertical, 4)
        Text("ACCOUNT").font(.system(size: 10, design: .monospaced))
        Toggle("Ghost mode (hide your check-ins from friends)", isOn: Binding(
          get: { me.ghostMode ?? false },
          set: { value in Task { accountError = await live.updateMe(ghostMode: value) } }
        )).tint(HermiPalette.green).font(.subheadline)
        Toggle("Open to plans (verified students can match you to Find-someone plans)", isOn: Binding(
          get: { me.openToPlans ?? false },
          set: { value in Task { accountError = await live.updateMe(openToPlans: value) } }
        )).tint(HermiPalette.green).font(.subheadline)
        if let accountError { Text(accountError).font(.caption).foregroundStyle(HermiPalette.error) }
        TextHermiRow()
      }
      if case .failed(let message) = live.status {
        Text(message).font(.caption).foregroundStyle(HermiPalette.error)
      }
    }
  }

  private var badge: String {
    if let me = live.me, live.isLive { return "LIVE · @\(me.username)" }
    return live.status == .connecting ? "…" : "SAMPLE"
  }
}

private extension View {
  func liveInputStyle() -> some View {
    #if os(iOS)
    return self.textInputAutocapitalization(.never).autocorrectionDisabled()
      .font(.system(.footnote, design: .monospaced)).padding(10)
      .background(.white, in: PixelPanel(corner: 5))
    #else
    return self.autocorrectionDisabled()
      .font(.system(.footnote, design: .monospaced)).padding(10)
      .background(.white, in: PixelPanel(corner: 5))
    #endif
  }
}

/// Profile → ⚙︎ → Text Hermi: link this phone, then text plans to Hermi (DM, or "hermi …" in a group chat).
struct TextHermiRow: View {
  private let model = TextHermi.shared
  @Environment(\.openURL) private var openURL

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Divider().padding(.vertical, 4)
      Text("TEXT HERMI").font(.system(size: 10, design: .monospaced))
      if let status = model.status, status.linked {
        Text("Linked: \(status.handles.joined(separator: ", "))").font(.subheadline)
        Text("Text a plan, like “Sat 2pm: Hungarian Pastry Shop, then Riverside Park with ben”, or say “hermi plan this” in a group chat with Hermi in it.")
          .font(.caption).foregroundStyle(HermiPalette.secondary)
        HStack(spacing: 10) {
          if let url = model.messagesURL {
            Button("Text Hermi") { openURL(url) }
              .font(.subheadline.bold()).padding(.horizontal, 14).frame(minHeight: 44)
              .background(HermiPalette.lime, in: PixelPanel(corner: 6))
          }
          Button("Unlink") { Task { await model.unlink(api: LiveSession.shared.api) } }
            .font(.subheadline).padding(.horizontal, 14).frame(minHeight: 44)
            .background(.white, in: PixelPanel(corner: 6))
        }
      } else {
        Text("Plan by text: link this phone, then text Hermi a plan and it lands in My Plan with travel times and invites.")
          .font(.caption).foregroundStyle(HermiPalette.secondary)
        Button(model.working ? "Getting a code…" : "Link this phone") {
          Task { if let url = await model.linkURL(api: LiveSession.shared.api) { openURL(url) } }
        }.font(.subheadline.bold()).padding(.horizontal, 14).frame(minHeight: 44)
          .background(HermiPalette.lime, in: PixelPanel(corner: 6))
          .disabled(model.working || model.status?.agentAddress == nil)
        if model.status?.agentAddress == nil {
          Text("Hermi's texting number isn't set up on this server.").font(.caption2).foregroundStyle(HermiPalette.secondary)
        }
      }
      if let notice = model.notice { Text(notice).font(.caption) }
    }
    .task { await model.load(api: LiveSession.shared.api) }
  }
}

