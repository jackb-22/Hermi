import Foundation

/// Local layout-review lifecycle only. Never represents a server session or verified outing.
struct ActionPreviewSession: Codable, Equatable {
  enum Mode: String, Codable { case directions, camera }
  let id: UUID
  let stopIDs: [String]
  let startedAt: Date
  var mode: Mode = .directions
  private(set) var endedAt: Date?

  init?(stops: [String], now: Date) {
    guard !stops.isEmpty, stops.allSatisfy({ MapSamplePlace.find($0) != nil }), Set(stops).count == stops.count else { return nil }
    id = UUID(); stopIDs = stops; startedAt = now
  }
  mutating func finish(now: Date) {
    guard endedAt == nil else { return }
    endedAt = max(startedAt, now)
  }
}

extension MapPreviewState {
  mutating func startActionPreview(now: Date = Date()) {
    guard actionSession == nil, canStartPlan else { return }
    actionSession = ActionPreviewSession(stops: planIDs, now: now)
  }
  mutating func finishActionPreview(now: Date = Date()) { actionSession?.finish(now: now) }
  mutating func dismissActionRecap() {
    guard actionSession?.endedAt != nil else { return }
    actionSession = nil; sheet = nil; returnSheet = nil; panel = .map
  }
}
