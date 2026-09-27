import Foundation

struct PlanContents: Codable, Equatable {
  var ids: [String] = []
  var times: [String: PreviewStopTime] = [:]
  var inviteDrafts: [String: Set<String>] = [:]
}

extension MapPreviewState {
  var planContents: PlanContents {
    .init(ids: planIDs, times: stopTimes ?? [:], inviteDrafts: stopInviteDrafts ?? [:])
  }
  var editingSavedPlan: SavedPlanDraft? {
    guard let activeSavedPlanID else { return nil }
    return library.plans.first { $0.id == activeSavedPlanID }
  }
  var canUndoPlan: Bool { !(planUndoHistory ?? []).isEmpty }

  mutating func applyPlanContents(_ contents: PlanContents, recordUndo: Bool = true) {
    guard contents != planContents else { return }
    if recordUndo {
      var history = planUndoHistory ?? []
      history.append(planContents)
      planUndoHistory = Array(history.suffix(20))
    }
    planIDs = contents.ids
    stopTimes = contents.times
    stopInviteDrafts = contents.inviteDrafts
    autosaveActivePlan()
  }

  mutating func autosaveActivePlan() {
    guard let activeSavedPlanID, var library = savedLibrary,
          let index = library.plans.firstIndex(where: { $0.id == activeSavedPlanID }) else { return }
    library.plans[index].stopIDs = planIDs
    library.plans[index].times = stopTimes ?? [:]
    library.plans[index].inviteDrafts = stopInviteDrafts ?? [:]
    savedLibrary = library
  }

  @discardableResult mutating func openSavedPlan(_ id: String) -> Bool {
    guard let plan = library.plan(id) else { return false }
    if activeSavedPlanID == plan.id { sheet = .plan; return true }
    if activeSavedPlanID == nil { unsavedPlanContents = planContents }
    autosaveActivePlan()
    activeSavedPlanID = plan.id
    planUndoHistory = []
    applyPlanContents(.init(ids: plan.stopIDs, times: plan.times, inviteDrafts: plan.inviteDrafts ?? [:]), recordUndo: false)
    sheet = .plan
    return true
  }

  mutating func returnToPlanDraft() {
    guard activeSavedPlanID != nil else { return }
    autosaveActivePlan()
    activeSavedPlanID = nil
    planUndoHistory = []
    applyPlanContents(unsavedPlanContents ?? PlanContents(), recordUndo: false)
    unsavedPlanContents = nil
    sheet = .plan
  }

  mutating func bindNewSavedPlan(_ id: UUID) {
    guard library.plans.contains(where: { $0.id == id }) else { return }
    if activeSavedPlanID == nil { unsavedPlanContents = PlanContents() }
    activeSavedPlanID = id
    planUndoHistory = []
    autosaveActivePlan()
  }

  mutating func undoPlanEdit() {
    guard var history = planUndoHistory, let previous = history.popLast() else { return }
    planUndoHistory = history
    applyPlanContents(previous, recordUndo: false)
  }

  mutating func setSharingIntent(visibility: SavedVisibility, friends: Set<String>) -> Bool {
    guard let activeSavedPlanID, var library = savedLibrary,
          let index = library.plans.firstIndex(where: { $0.id == activeSavedPlanID }),
          visibility != .friends || !friends.isEmpty else { return false }
    library.plans[index].visibility = visibility
    library.plans[index].friendNames = visibility == .friends ? friends.sorted() : []
    savedLibrary = library
    return true // Local intent only; never calls an invite or publish endpoint.
  }
}
