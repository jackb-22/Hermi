import Foundation
import SwiftUI

@MainActor public final class CairnStore: ObservableObject {
  @Published var preview: Bool
  @Published var panel = "Map"
  @Published var sheet: String?
  @Published var error: String?
  @Published var notice: String?
  @Published var busy = false
  @Published var me: JSON = .null
  @Published var places: [JSON] = []
  @Published var selectedPlace: JSON = .null
  @Published var plan: JSON = .null
  @Published var profile: JSON = .null
  @Published var tiles: JSON = .null
  @Published var feed: JSON = .null
  @Published var social: JSON = .null
  @Published var session: JSON = .null
  @Published var recap: JSON = .null
  @Published var checkin: JSON = .null
  @Published var tap: JSON = .null
  @Published var category = "all"
  @Published var socialOn = false
  @Published var baseAddress: String
  @Published var signedIn = false
  @Published var onboardingComplete = false
  @Published var mapMoving = false
  @Published var center: JSON = ["lat": 40.8075, "lng": -73.9636]
  @Published var bbox = "-73.985,40.793,-73.947,40.822"
  @Published var radius = 400.0
  @Published var captured: [JSON] = []
  let tracker = OutingTracker()
  @Published var pendingTag = ""
  var token: String?
  var mapTask: Task<Void, Never>?
  var mutationTask: Task<Void, Never>?
  public init(preview: Bool = false) {
    self.preview = preview
    baseAddress = UserDefaults.standard.string(forKey: "cairn.api") ?? ""
    token = SessionKeychain.read()
    signedIn = token != nil
    onboardingComplete = token != nil
    if preview {
      me = PreviewData.me
      places = PreviewData.places
      profile = PreviewData.profile
      tiles = ["manhattanPct": 6.4, "count": 282, "tiles": []]
    }
  }
  var api: CairnAPI {
    get throws {
      guard let url = URL(string: baseAddress), let scheme = url.scheme, let host = url.host,
        scheme == "https" || (scheme == "http" && (host == "localhost" || host == "127.0.0.1"))
      else {
        throw APIError(
          code: "CONFIG",
          message:
            "Set your HTTPS API address in Connection. Localhost HTTP is supported for development."
        )
      }
      return CairnAPI(baseURL: url, token: token)
    }
  }
  func call(
    _ path: String, _ method: String = "GET", _ body: JSON? = nil, query: [String: String] = [:]
  ) async throws -> JSON {
    guard !preview else {
      throw APIError(
        code: "PREVIEW",
        message: "This is a design preview. Connect your account to use this action.")
    }
    do { return try await api.request(path, method: method, body: body, query: query) } catch let e
      as APIError
    {
      if e.code == "UNAUTHORIZED" { signedIn = false }
      throw e
    }
  }
  func run(_ action: @escaping @MainActor () async throws -> Void) {
    guard !busy else { return }
    busy = true
    error = nil
    mutationTask = Task {
      defer { busy = false }
      do { try await action() } catch is CancellationError {} catch {
        self.error = error.localizedDescription
      }
    }
  }
  func toast(_ message: String) {
    notice = message
    Task {
      try? await Task.sleep(for: .seconds(3))
      if notice == message { notice = nil }
    }
  }
  func bootstrap() async {
    guard !preview && signedIn else { return }
    do {
      me = try await call("me")
      let active = try await call("sessions/active")
      session = active["session"]
      if session["status"].text == "ending" {
        sheet = "recap"
        try await pollRecap(session.id)
      }
      if session.exists {
        if !session["planId"].text.isEmpty {
          plan = try await call("plans/\(session["planId"].text)")
        }
        panel = "Directions"
      }
      await refreshMap()
    } catch { self.error = error.localizedDescription }
  }
  func refreshMap() async {
    let cat = category
    let bounds = bbox
    if preview {
      places = PreviewData.places.filter { cat == "all" || $0["category"].text == cat }
      return
    }
    do {
      let result = try await call("places", query: ["bbox": bounds, "cat": cat, "limit": "12"])
      guard cat == category && bounds == bbox && !Task.isCancelled else { return }
      places = result["items"].list
    } catch is CancellationError {} catch { self.error = error.localizedDescription }
  }
  func mapChanged(_ value: JSON) {
    center = value["center"]
    bbox = value["bbox"].text
    radius = value["radius"].number
    mapTask?.cancel()
    mapTask = Task {
      try? await Task.sleep(for: .milliseconds(300))
      guard !Task.isCancelled else { return }
      mapMoving = false
      await refreshMap()
    }
  }
  func openPlace(_ p: JSON) {
    selectedPlace = p
    sheet = "place"
    guard !preview else { return }
    Task {
      do {
        let full = try await call("places/\(p.id)")
        if selectedPlace.id == p.id { selectedPlace = full }
      } catch { self.error = error.localizedDescription }
    }
  }
  func addPlace(_ p: JSON) {
    run {
      if self.preview {
        self.plan = PreviewData.makePlan(
          self.plan["stops"].list.compactMap { $0["place"].exists ? $0["place"] : nil } + [p])
        self.sheet = "plan"
        return
      }
      let stops = self.plan["stops"].list.map(Self.stopInput) + [["placeId": p["id"]]]
      guard stops.count <= 12 else {
        throw APIError(code: "LIMIT", message: "A plan can have up to 12 stops.")
      }
      self.plan = try await self.call(
        self.plan.exists ? "plans/\(self.plan.id)/stops" : "plans",
        self.plan.exists ? "PUT" : "POST", ["stops": .array(stops)])
      self.sheet = "plan"
    }
  }
  static func stopInput(_ stop: JSON) -> JSON {
    var value: JSON = ["id": stop["id"]]
    value = value.setting(
      stop["place"].exists ? "placeId" : "slot",
      stop["place"].exists ? stop["place"]["id"] : stop["slot"])
    if stop["legMode"].exists { value = value.setting("legMode", stop["legMode"]) }
    if stop["staySource"].text == "user" { value = value.setting("stayMin", stop["stayMin"]) }
    return value
  }
  func replaceStops(_ stops: [JSON]) {
    run {
      if self.preview {
        self.plan = self.plan.setting("stops", .array(stops))
        return
      }
      self.plan = try await self.call(
        "plans/\(self.plan.id)/stops", "PUT", ["stops": .array(stops.map(Self.stopInput))])
    }
  }
  func updatePlan(_ body: JSON) {
    run { self.plan = try await self.call("plans/\(self.plan.id)", "PATCH", body) }
  }
  func planAction(_ path: String, body: JSON = [:]) {
    run { self.plan = try await self.call("plans/\(self.plan.id)/\(path)", "POST", body) }
  }
  func save(_ type: String, _ id: String, folderId: String? = nil) {
    run {
      var body: JSON = ["type": .string(type), "refId": .string(id)]
      if let folderId { body = body.setting("folderId", .string(folderId)) }
      _ = try await self.call("saves", "POST", body)
      self.toast("Saved. Find it in Profile → Saved.")
    }
  }
  func start() async throws {
    guard !preview else {
      throw APIError(
        code: "PREVIEW",
        message:
          "Start requires a connected account and real location. Preview does not create check-ins or XP."
      )
    }
    let response = try await call("sessions", "POST", plan.exists ? ["planId": plan["id"]] : [:])
    session = response["session"]
    plan = response["plan"]
    panel = "Directions"
    sheet = nil
  }
  func end() {
    run {
      _ = try await self.call("sessions/\(self.session.id)/end", "POST", [:])
      self.sheet = "recap"
      self.session = self.session.setting("status", "ending")
      try await self.pollRecap(self.session.id)
    }
  }
  func pollRecap(_ id: String) async throws {
    for _ in 0..<30 {
      try Task.checkCancellation()
      let r = try await call("sessions/\(id)/recap")
      if r["status"].text == "ready" {
        recap = r["recap"]
        captured = try await call("media", query: ["sessionId": id])["items"].list
        return
      }
      try await Task.sleep(for: .seconds(2))
    }
    throw APIError(
      code: "PENDING", message: "Your recap is still being prepared. Tap Refresh to check again.")
  }
  func finishRecap() {
    tracker.clearFinishedOutbox()
    session = .null
    checkin = .null
    recap = .null
    captured = []
    sheet = nil
    panel = "Map"
    Task { await loadProfile() }
  }
  func loadProfile(_ id: String = "me") async {
    if preview { return }
    do {
      let p = try await call("profile/\(id)")
      let t = try await call("tiles", query: id == "me" ? [:] : ["userId": id])
      profile = p
      tiles = t
    } catch { self.error = error.localizedDescription }
  }
  func loadFeed() async {
    if preview {
      feed = [
        "cards": [["kind": "end", "title": "A little less scrolling.\nA little more outside."]],
        "unseenLeftToday": 30,
      ]
      return
    }
    do { feed = try await call("feed") } catch { self.error = error.localizedDescription }
  }
  func authenticate(_ identityToken: String, _ name: String) async throws {
    let result = try await call(
      "auth/apple", "POST", ["identityToken": .string(identityToken), "name": .string(name)])
    try acceptAuth(result)
  }
  func acceptAuth(_ result: JSON) throws {
    guard !result["token"].text.isEmpty else {
      throw APIError(code: "CONTRACT", message: "Sign-in did not return a token.")
    }
    try SessionKeychain.write(result["token"].text)
    token = result["token"].text
    me = result["user"]
    signedIn = true
  }
  func signOut() {
    guard !session.exists else {
      error = "End your outing before signing out so your route can finish uploading."
      return
    }
    run {
      tracker.stop()
      try SessionKeychain.write(nil)
      self.token = nil
      self.signedIn = false
      self.me = .null
      self.profile = .null
      self.tiles = .null
      self.feed = .null
      self.social = .null
      self.plan = .null
      self.session = .null
      self.captured = []
      self.sheet = nil
      self.panel = "Map"
    }
  }
}
