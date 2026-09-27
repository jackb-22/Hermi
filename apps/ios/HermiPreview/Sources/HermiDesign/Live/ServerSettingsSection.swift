import SwiftUI

/// Settings → Server: dev login against the demo backend. Without it the app stays on sample fixtures.
struct ServerSettingsSection: View {
  private let live = LiveSession.shared
  @State private var baseURL: String
  @State private var devToken: String
  @State private var username: String

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
          .background(live.isLive ? HermiPalette.lime : HermiPalette.paper, in: PixelPanel(corner: 4))
          .accessibilityLabel(live.isLive ? "Connected" : "Sample mode")
      }
      TextField("https://….trycloudflare.com", text: $baseURL).liveInputStyle()
      TextField("Dev token", text: $devToken).liveInputStyle()
      TextField("Username (jack or jenny)", text: $username).liveInputStyle()
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
