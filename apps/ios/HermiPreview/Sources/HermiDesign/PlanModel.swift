import Foundation

// The plan's value types, Foundation only (so LinuxCheck builds and tests them on Linux).

struct PreviewStopTime: Codable, Equatable {
  var arrival: Date
  var durationMinutes: Int = 60
  var reminderMinutes: Int = 0
  var isValid: Bool { arrival.timeIntervalSince1970.isFinite && durationMinutes > 0 && [0, 5, 15, 30].contains(reminderMinutes) }
}

/// Travel into a stop, as the server measured it ("Space it out") or estimated it.
struct PreviewLeg: Codable, Equatable, Sendable {
  /// The place this leg leaves from: the leg only counts while that place is still the stop before.
  var from: String
  var minutes: Int
  /// walk, transit, bike or car.
  var mode: String
  /// estimate, apple or google.
  var source: String
  var isEstimate: Bool { source == "estimate" }
}

struct PlanContents: Codable, Equatable {
  var ids: [String] = []
  var times: [String: PreviewStopTime] = [:]
  var inviteDrafts: [String: Set<String>] = [:]
  /// Keyed by the stop the leg arrives at. Optional so plans saved before legs existed still decode.
  var legs: [String: PreviewLeg]? = nil

  /// The leg into `id`, while the stop before it is still the one it was measured from (a reorder voids it).
  func leg(into id: String) -> PreviewLeg? {
    guard let index = ids.firstIndex(of: id), index > 0, let leg = legs?[id], leg.from == ids[index - 1] else { return nil }
    return leg
  }
}

extension PlanContents {
  /// A server plan as the app's plan: places in order, arrival and stay per stop, and each measured leg.
  init(server plan: PlanDTO) {
    self.init()
    var previous: String?
    for stop in plan.stops {
      guard let id = stop.place?.id, !ids.contains(id) else { continue }
      ids.append(id)
      if let arrival = stop.arriveAt { times[id] = PreviewStopTime(arrival: arrival, durationMinutes: stop.stayMin ?? 60) }
      if let from = previous, let mode = stop.legMode, let minutes = stop.legMin {
        if legs == nil { legs = [:] }
        legs?[id] = PreviewLeg(from: from, minutes: minutes, mode: mode, source: stop.legSource ?? "estimate")
      }
      previous = id
    }
  }
}

extension PlanContents {
  /// A plan the server returned, keeping what only the app knows about stops that are still there:
  /// reminder choices and invite picks.
  func keepingLocalDetails(from current: PlanContents) -> PlanContents {
    var merged = self
    for id in merged.ids {
      if let reminder = current.times[id]?.reminderMinutes, merged.times[id] != nil {
        merged.times[id]?.reminderMinutes = reminder
      }
      if let invites = current.inviteDrafts[id] { merged.inviteDrafts[id] = invites }
    }
    return merged
  }
}

