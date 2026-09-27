import Foundation

struct PreviewStopTime: Codable, Equatable {
  var arrival: Date
  var durationMinutes: Int = 60
  var reminderMinutes: Int = 0
  var isValid: Bool { arrival.timeIntervalSince1970.isFinite && durationMinutes > 0 && [0, 5, 15, 30].contains(reminderMinutes) }
}
struct PlanTimingConflict: Equatable {
  let firstID: String
  let nextID: String
}
extension MapPreviewState {
  var canStartPlan: Bool { !planIDs.isEmpty && planIDs.allSatisfy { MapSamplePlace.find($0) != nil } }
  var timingConflicts: [PlanTimingConflict] {
    let timed = planIDs.compactMap { id -> (String, PreviewStopTime)? in
      guard let time = stopTimes?[id], time.isValid else { return nil }
      return (id, time)
    }
    return zip(timed, timed.dropFirst()).compactMap { first, next in
      next.1.arrival < first.1.arrival.addingTimeInterval(Double(first.1.durationMinutes) * 60)
        ? PlanTimingConflict(firstID: first.0, nextID: next.0) : nil
    }
  }
  mutating func setStopTime(_ value: PreviewStopTime?, for id: String) {
    guard planIDs.contains(id), value?.isValid != false else { return }
    var contents = planContents
    contents.times[id] = value
    applyPlanContents(contents)
  }
  mutating func setInviteDraft(_ value: Set<String>, for id: String) {
    guard planIDs.contains(id) else { return }
    var contents = planContents
    contents.inviteDrafts[id] = value.intersection(["Alex", "Sam", "Riley"])
    applyPlanContents(contents)
  }
}
