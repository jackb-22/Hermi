import CoreLocation
import CoreMotion
import Foundation

/// Owns tracking outside the view lifecycle. An interrupted upload retains its outbox.
@MainActor final class OutingTracker: ObservableObject {
  let location = LocationService()
  private weak var store: CairnStore?
  private var uploadTask: Task<Void, Never>?
  private var retryTask: Task<Void, Never>?
  private var activeID = ""
  private var points: [JSON] = []
  private var submitting = false
  private var autoCheckinPending = false
  private var dwellStarted: [String: Date] = [:]
  private var lastAttempt: [String: Date] = [:]
  private let pedometer = CMPedometer()
  private(set) var steps: Int?
  private var outboxURL: URL {
    let directory = FileManager.default.urls(
      for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent(
        "Cairn", isDirectory: true)
    try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    return directory.appendingPathComponent("active-outing.json")
  }
  func start(_ store: CairnStore) {
    guard !store.preview, store.session["status"].text == "active" else { return }
    self.store = store
    guard activeID != store.session.id else { return }
    stop()
    activeID = store.session.id
    if let data = try? Data(contentsOf: outboxURL),
      let saved = try? JSONDecoder().decode(JSON.self, from: data),
      saved["sessionId"].text == activeID
    {
      points = saved["points"].list
    }
    location.onFix = { [weak self] fix in self?.received(fix) }
    location.startOuting()
    #if os(iOS)
      if CMPedometer.isStepCountingAvailable() {
        pedometer.startUpdates(from: parseDate(store.session["startedAt"].text) ?? Date()) {
          [weak self] data, _ in
          Task { @MainActor in self?.steps = data?.numberOfSteps.intValue }
        }
      }
    #endif
    retryTask = Task { [weak self] in
      while !Task.isCancelled {
        try? await Task.sleep(for: .seconds(15))
        guard !Task.isCancelled else { return }
        do { try await self?.flush() } catch {
          self?.store?.notice = "Your route is saved on this device. Upload will retry."
        }
      }
    }
  }
  private func received(_ fix: CLLocation) {
    guard let store, store.session["status"].text == "active" else { return }
    let point: JSON = [
      "lat": .number(fix.coordinate.latitude), "lng": .number(fix.coordinate.longitude),
      "accuracy": .number(fix.horizontalAccuracy), "speed": .number(max(0, fix.speed)),
      "time": iso(fix.timestamp),
    ]
    points.append(point)
    persist()
    guard !autoCheckinPending else { return }
    for stop in store.plan["stops"].list where !stop["done"].flag && stop["place"].exists {
      let p = stop["place"]["loc"]
      let target = CLLocation(latitude: p["lat"].number, longitude: p["lng"].number)
      if fix.distance(from: target) <= 100 && fix.horizontalAccuracy <= 50 {
        if dwellStarted[stop.id] == nil { dwellStarted[stop.id] = Date() }
        let waited = Date().timeIntervalSince(dwellStarted[stop.id] ?? Date())
        let sinceAttempt = Date().timeIntervalSince(lastAttempt[stop.id] ?? .distantPast)
        if waited >= 300 && sinceAttempt > 60 {
          autoCheckinPending = true
          lastAttempt[stop.id] = Date()
          Task { [weak self] in
            defer { self?.autoCheckinPending = false }
            do {
              try await self?.flush()
              let body = try self?.location.body().setting("tier", "gps").setting(
                "placeId", stop["place"]["id"]
              ).setting("sessionId", store.session["id"])
              guard let body else { return }
              let result = try await store.call("checkins", "POST", body)
              store.checkin = result["checkin"]
              store.plan = try await store.call("plans/\(store.plan.id)")
              store.toast("Checked in at \(stop["label"].text) · +\(result["xp"]["total"].int) XP")
            } catch { /* Server remains authoritative; a manual check-in can show its error. */  }
          }
        }
      } else {
        dwellStarted[stop.id] = nil
      }
    }
  }
  func flush() async throws {
    while submitting { try await Task.sleep(for: .milliseconds(100)) }
    guard let store, !activeID.isEmpty else { return }
    submitting = true
    defer { submitting = false }
    while !points.isEmpty {
      let batch = Array(points.prefix(500))
      _ = try await store.call("sessions/\(activeID)/points", "POST", ["points": .array(batch)])
      points.removeFirst(batch.count)
      persist()
    }
  }
  func endBody() -> JSON {
    if let steps { return ["steps": .number(Double(steps))] }
    return [:]
  }
  func stop() {
    location.stop()
    retryTask?.cancel()
    retryTask = nil
    #if os(iOS)
      pedometer.stopUpdates()
    #endif
    activeID = ""
    points = []
    dwellStarted = [:]
    lastAttempt = [:]
    steps = nil
  }
  func clearFinishedOutbox() {
    try? FileManager.default.removeItem(at: outboxURL)
    stop()
  }
  private func persist() {
    let saved: JSON = ["sessionId": .string(activeID), "points": .array(points)]
    guard let data = try? JSONEncoder().encode(saved) else { return }
    do {
      #if os(iOS)
        try data.write(
          to: outboxURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
      #else
        try data.write(to: outboxURL, options: .atomic)
      #endif
    } catch {
      store?.error =
        "Couldn't save your route on this device. Keep Cairn open and check available storage."
    }
  }
}
