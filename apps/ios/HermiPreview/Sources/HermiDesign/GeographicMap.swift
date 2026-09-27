import SwiftUI
import WebKit

struct MapCommand: Equatable {
  var id = UUID()
  var action: String
  var point: CGPoint = .zero
}
struct GeographicMap: View {
  var state: MapPreviewState
  var command: MapCommand?
  var adventure = false
  var showsPlaces = true
  var onEvent: ([String: Any]) -> Void = { _ in }
  var body: some View { GeographicWebMap(payload: payload, command: command, onEvent: onEvent) }
  private var payload: [String: Any] {
    var result: [String: Any] = [
      "pinRows": PinArtwork.rows,
      "places": adventure || !showsPlaces ? [] : state.nearby.map { place -> [String: Any] in
        ["id": place.id, "name": "Sample: " + place.name, "color": PinArtwork.hex(place.category), "lng": place.coordinate.longitude, "lat": place.coordinate.latitude]
      },
      "social": state.social,
      "adventure": adventure
    ]
    if let point = state.geographicDiscovery {
      result["discovery"] = ["lng": point.longitude, "lat": point.latitude, "color": PinArtwork.hex(state.category)]
    }
    return result
  }
}
#if os(macOS)
struct GeographicWebMap: NSViewRepresentable {
  var payload: [String: Any]
  var command: MapCommand?
  var onEvent: ([String: Any]) -> Void
  func makeCoordinator() -> GeographicCoordinator { GeographicCoordinator(onEvent: onEvent) }
  func makeNSView(context: Context) -> WKWebView { context.coordinator.makeView() }
  func updateNSView(_ view: WKWebView, context: Context) { context.coordinator.update(view, payload: payload, command: command, onEvent: onEvent) }
  static func dismantleNSView(_ view: WKWebView, coordinator: GeographicCoordinator) { coordinator.stop(view) }
}
#else
struct GeographicWebMap: UIViewRepresentable {
  var payload: [String: Any]
  var command: MapCommand?
  var onEvent: ([String: Any]) -> Void
  func makeCoordinator() -> GeographicCoordinator { GeographicCoordinator(onEvent: onEvent) }
  func makeUIView(context: Context) -> WKWebView { context.coordinator.makeView() }
  func updateUIView(_ view: WKWebView, context: Context) { context.coordinator.update(view, payload: payload, command: command, onEvent: onEvent) }
  static func dismantleUIView(_ view: WKWebView, coordinator: GeographicCoordinator) { coordinator.stop(view) }
}
#endif
@MainActor final class GeographicCoordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
  var onEvent: ([String: Any]) -> Void
  private var payload: [String: Any] = [:]
  private var lastData: Data?
  private var lastCommand: UUID?
  private var ready = false
  init(onEvent: @escaping ([String: Any]) -> Void) { self.onEvent = onEvent }
  func makeView() -> WKWebView {
    let configuration = WKWebViewConfiguration()
    configuration.userContentController.add(self, name: "hermi")
    let view = WKWebView(frame: .zero, configuration: configuration)
    view.navigationDelegate = self
    #if os(iOS)
    view.isOpaque = false
    view.backgroundColor = UIColor(HermiPalette.lake)
    view.scrollView.contentInsetAdjustmentBehavior = .never
    view.scrollView.isScrollEnabled = false
    #endif
    if let url = Bundle.module.url(forResource: "map", withExtension: "html", subdirectory: "Resources") {
      view.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
    }
    return view
  }
  func update(_ view: WKWebView, payload: [String: Any], command: MapCommand?, onEvent: @escaping ([String: Any]) -> Void) {
    self.payload = payload; self.onEvent = onEvent
    guard ready else { return }
    if let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]), data != lastData {
      lastData = data
      view.callAsyncJavaScript("window.renderHermi(payload)", arguments: ["payload": payload], in: nil, in: .page) { _ in }
    }
    if let command, command.id != lastCommand {
      lastCommand = command.id
      view.callAsyncJavaScript("window.commandHermi(command)", arguments: ["command": ["action": command.action, "x": command.point.x, "y": command.point.y]], in: nil, in: .page) { _ in }
    }
  }
  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    ready = true; lastData = nil
    update(webView, payload: payload, command: nil, onEvent: onEvent)
  }
  func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    // Basemap requests are subresources. Never navigate the app to an arbitrary document.
    if navigationAction.navigationType == .linkActivated, let url = navigationAction.request.url, url.scheme == "https" {
      #if os(macOS)
      NSWorkspace.shared.open(url)
      #else
      UIApplication.shared.open(url)
      #endif
    }
    decisionHandler(navigationAction.request.url?.isFileURL == true ? .allow : .cancel)
  }
  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { ready = false; webView.reload() }
  func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
    guard message.frameInfo.isMainFrame, let body = message.body as? [String: Any] else { return }
    onEvent(body)
  }
  func stop(_ view: WKWebView) { view.stopLoading(); view.configuration.userContentController.removeScriptMessageHandler(forName: "hermi"); view.navigationDelegate = nil }
}
