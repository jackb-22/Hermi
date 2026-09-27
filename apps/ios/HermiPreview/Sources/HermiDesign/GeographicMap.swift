import SwiftUI
import WebKit

struct MapCommand: Equatable {
  var id = UUID()
  var action: String
  var point: CGPoint = .zero
}
struct GeographicMap: View {
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var loading = true
  @State private var dismissedLoading = false
  var state: MapPreviewState
  var command: MapCommand?
  var editingPinID: UUID?
  var revision = 0
  var bottomInset: CGFloat = 110
  var adventure = false
  var showsPlaces = true
  var onEvent: ([String: Any]) -> Void = { _ in }
  var body: some View {
    GeographicWebMap(payload: payload, command: command) { event in
      if let type = event["type"] as? String, type == "ready" || type == "error" { loading = false }
      onEvent(event)
    }
    .overlay(alignment: .topLeading) {
      if loading && !dismissedLoading {
        CrabLoadingView(label: "Loading map…", cancel: { dismissedLoading = true }).padding(.leading, 14).padding(.top, 100)
      }
    }
    .task {
      // Never strand the indicator if WebKit fails before sending a bridge event.
      do { try await Task.sleep(for: .seconds(15)) } catch { return }
      loading = false
    }
  }
  private var payload: [String: Any] {
    var result: [String: Any] = [
      "editingDiscovery": state.pin(id: editingPinID) != nil,
      "revision": revision,
      "bottomInset": bottomInset,
      "places": adventure || !showsPlaces ? [] : state.nearby.map { place -> [String: Any] in
        ["rows": PinArtwork.rows(for: place.category), "id": place.id, "name": "Sample: " + place.name, "color": PinArtwork.hex(place.category), "lng": place.coordinate.longitude, "lat": place.coordinate.latitude]
      },
      "social": state.social && !adventure && showsPlaces,
      "socialMarkers": SocialMapPreview.markers(enabled: state.social && !adventure && showsPlaces),
      "socialRoutes": SocialMapPreview.routes(enabled: state.social && !adventure && showsPlaces),
      "reduceMotion": reduceMotion,
      "adventure": adventure
    ]
    let pins: [[String: Any]] = adventure || !showsPlaces ? [] : state.discoveryPins.map { pin in
      ["rows": PinArtwork.rows(for: pin.category), "categoryRows": CategorySprite.rows(for: pin.category),
       "id": pin.id.uuidString, "lng": pin.coordinate.longitude, "lat": pin.coordinate.latitude,
       "radiusMiles": pin.radiusMiles, "color": PinArtwork.hex(pin.category), "category": pin.category.rawValue]
    }
    result["discoveries"] = pins
    result["discovery"] = pins.first { $0["id"] as? String == editingPinID?.uuidString }
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
  private var pendingCommand: MapCommand?
  private var ready = false
  init(onEvent: @escaping ([String: Any]) -> Void) { self.onEvent = onEvent }
  func makeView() -> WKWebView {
    let configuration = WKWebViewConfiguration()
    // Inject before the map document runs; CSS, markers and terrain share SwiftUI's tokens.
    if let data = try? JSONSerialization.data(withJSONObject: HermiPalette.mapColors, options: [.sortedKeys]),
       let json = String(data: data, encoding: .utf8) {
      configuration.userContentController.addUserScript(WKUserScript(
        source: "window.hermiPalette = \(json);", injectionTime: .atDocumentStart, forMainFrameOnly: true))
    }
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
    self.payload = payload; self.onEvent = onEvent; self.pendingCommand = command
    guard ready else { return }
    if let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]), data != lastData {
      lastData = data
      view.callAsyncJavaScript("window.renderHermi(payload)", arguments: ["payload": payload], in: nil, in: .page) { _ in }
    }
    if let command, command.id != lastCommand {
      lastCommand = command.id
      view.callAsyncJavaScript("window.commandHermi(command)", arguments: ["command": ["id": command.id.uuidString, "action": command.action, "x": command.point.x, "y": command.point.y]], in: nil, in: .page) { _ in }
    }
  }
  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    ready = true; lastData = nil
    update(webView, payload: payload, command: pendingCommand, onEvent: onEvent)
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
