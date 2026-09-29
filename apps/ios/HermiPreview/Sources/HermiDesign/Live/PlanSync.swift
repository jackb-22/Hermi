import Foundation
import Observation

/// The signed-in user's friends (GET /friends). Sample mode keeps the preview's sample names.
@Observable
final class FriendDirectory {
  static let shared = FriendDirectory()
  static let sampleNames = ["Alex", "Sam", "Riley"]

  private(set) var friends: [UserCardDTO] = []

  /// Names shown in invite pickers.
  var names: [String] { LiveSession.shared.isLive ? friends.map(\.name) : FriendDirectory.sampleNames }
  func userID(forName name: String) -> String? { friends.first { $0.name == name }?.id }

  @MainActor
  func load() async {
    guard let api = LiveSession.shared.api else { friends = []; return }
    if let page = try? await api.send("GET", "/friends", as: FriendsDTO.self) { friends = page.items.map(\.user) }
  }
}

/// Keeps the active plan draft and saved plans in step with `/v1/plans`, like SavedSync does for saves.
/// Key "draft" is the unsaved plan; saved plans use their local UUID. Server IDs are stored per account, so
/// one account's plan never becomes another's. Plans containing sample places stay local.
@Observable
final class PlanSync {
  static let shared = PlanSync()

  private(set) var notice: String?

  @ObservationIgnored private var baseline: [String: PlanSnapshot]?
  @ObservationIgnored private var queue: Task<Void, Never>?
  @ObservationIgnored private var serverIDs: [String: String] = [:]
  @ObservationIgnored private var account = ""
  private let defaults: UserDefaults
  static let draftKey = "draft"

  init(defaults: UserDefaults = .standard) { self.defaults = defaults }

  func serverID(forKey key: String) -> String? { serverIDs[key] }

  /// The server plan behind whatever My Plan is showing (a saved plan, or the draft).
  func serverPlanID(for state: MapPreviewState) -> String? {
    serverIDs[state.activeSavedPlanID?.uuidString ?? PlanSync.draftKey]
  }

  // MARK: Pull

  struct Hydration {
    var draft: PlanDTO?
    var saved: [PlanDTO] = []
  }

  @MainActor
  func hydrate() async -> Hydration? {
    guard let api = LiveSession.shared.api else { return nil }
    do {
      let page: PlansPageDTO = try await api.send("GET", "/plans", query: ["scope": "all"])
      let mine = page.items.filter { $0.isHost ?? true }
      for plan in mine { PlaceCatalog.shared.upsert(plan.stops.compactMap { $0.place?.place }) }
      var result = Hydration()
      result.draft = mine.first { $0.status == "draft" && !$0.stops.isEmpty }
      result.saved = mine.filter { $0.status == "planned" || $0.status == "active" }
      notice = nil
      return result
    } catch {
      notice = "Plans didn’t load: \(error.localizedDescription)"
      return nil
    }
  }

  /// Server plans replace this device's live plans. A local draft survives only for the account that made it.
  @MainActor
  func apply(_ hydration: Hydration, account: String, to state: inout MapPreviewState) {
    let previousOwner = defaults.string(forKey: "hermi.live.planOwner")
    self.account = account
    serverIDs = defaults.dictionary(forKey: mappingKey) as? [String: String] ?? [:]
    // First connect on this device: the local draft is this account's.
    let sameOwner = previousOwner == nil || previousOwner == account

    // Saved plans: drop live plans that aren't this account's server plans, then add/refresh the server's.
    var library = state.library
    let serverPlanIDs = Set(hydration.saved.map(\.id))
    library.plans.removeAll { plan in
      guard PlanSync.isLive(plan.stopIDs) else { return false }
      if let server = serverIDs[plan.id.uuidString] { return !serverPlanIDs.contains(server) }
      return !sameOwner
    }
    for plan in hydration.saved {
      let draft = PlanSync.savedDraft(from: plan)
      if let local = serverIDs.first(where: { $0.value == plan.id })?.key,
         let index = library.plans.firstIndex(where: { $0.id.uuidString == local }) {
        var updated = draft
        updated.id = library.plans[index].id
        updated.folderID = library.plans[index].folderID
        library.plans[index] = updated
      } else {
        library.plans.append(draft)
        serverIDs[draft.id.uuidString] = plan.id
      }
    }
    serverIDs = serverIDs.filter { key, _ in key == PlanSync.draftKey || library.plans.contains { $0.id.uuidString == key } }
    state.library = library
    if let active = state.activeSavedPlanID, !library.plans.contains(where: { $0.id == active }) {
      state.activeSavedPlanID = nil
      state.applyPlanContents(state.unsavedPlanContents ?? PlanContents(), recordUndo: false)
      state.unsavedPlanContents = nil
    }

    // Draft: the server's wins; otherwise keep a local live draft only if it belongs to this account.
    let localDraft = state.activeSavedPlanID == nil ? state.planContents : (state.unsavedPlanContents ?? PlanContents())
    var draft = localDraft
    if let server = hydration.draft {
      draft = PlanSync.contents(from: server)
      serverIDs[PlanSync.draftKey] = server.id
    } else {
      serverIDs[PlanSync.draftKey] = nil
      if !sameOwner && PlanSync.isLive(localDraft.ids) { draft = PlanContents() }
    }
    if state.activeSavedPlanID == nil { state.applyPlanContents(draft, recordUndo: false); state.planUndoHistory = [] }
    else { state.unsavedPlanContents = draft }

    defaults.set(account, forKey: "hermi.live.planOwner")
    saveMapping()
    // Baseline = what the server already has; local-only live plans are pushed by the diff below.
    baseline = PlanSnapshot.all(state).filter { serverIDs[$0.key] != nil }
    push(state)
  }

  func reset() { baseline = nil }

  /// Waits for queued writes, so the server plan is the one on screen (the AI button asks about it).
  @MainActor
  func flush() async { await queue?.value }

  /// The server plan behind My Plan once pending writes have landed; nil in sample mode or before the first sync.
  @MainActor
  func readyPlanID(for state: MapPreviewState) async -> String? {
    await flush()
    return serverPlanID(for: state)
  }

  /// Contents the server just produced (AI Apply): the app takes them without pushing them straight back.
  @MainActor
  func adopt(_ contents: PlanContents, for state: MapPreviewState) {
    let key = state.activeSavedPlanID?.uuidString ?? PlanSync.draftKey
    guard serverIDs[key] != nil, var next = baseline else { return }
    next[key] = PlanSnapshot(name: next[key]?.name, contents: contents)
    baseline = next
  }

  // MARK: Push

  @MainActor
  func push(_ state: MapPreviewState) {
    guard var old = baseline, LiveSession.shared.isLive else { return }
    let new = PlanSnapshot.all(state)
    guard new != old else { return }

    // Save Plan turns the current draft into a saved plan: keep the same server plan instead of re-creating it.
    if let draftServer = serverIDs[PlanSync.draftKey], let oldDraft = old[PlanSync.draftKey],
       (new[PlanSync.draftKey]?.stops ?? []).isEmpty,
       let adopted = new.first(where: { $0.key != PlanSync.draftKey && old[$0.key] == nil && serverIDs[$0.key] == nil
                                        && $0.value.stops == oldDraft.stops })?.key {
      serverIDs[adopted] = draftServer
      serverIDs[PlanSync.draftKey] = nil
      old[adopted] = oldDraft
      old[PlanSync.draftKey] = nil
      saveMapping()
      if let plan = state.library.plans.first(where: { $0.id.uuidString == adopted }) {
        enqueue([("save plan", savePlanOp(key: adopted, plan: plan))])
      }
    }
    baseline = new

    var ops: [(String, SyncOp)] = []
    for (key, snap) in new.sorted(by: { $0.key < $1.key }) {
      let before = old[key]
      guard before != snap else { continue }
      if serverIDs[key] == nil {
        guard !snap.stops.isEmpty else { continue }
        ops.append(("create plan", { [self] api in
          // A quick second edit can queue before the first create finishes: update instead of re-creating.
          if let id = serverIDs[key] {
            let _: PlanDTO = try await api.send("PUT", "/plans/\(id)/stops", body: PutStopsBody(stops: snap.stopInputs))
            return
          }
          let created: PlanDTO = try await api.send("POST", "/plans", body: CreatePlanBody(name: snap.name, startAt: snap.startAt, stops: snap.stopInputs))
          serverIDs[key] = created.id; saveMapping()
        }))
        if key != PlanSync.draftKey, let plan = state.library.plans.first(where: { $0.id.uuidString == key }) {
          ops.append(("save plan", savePlanOp(key: key, plan: plan)))
        }
        continue
      }
      if snap.stops.isEmpty {
        ops.append(("cancel plan", { [self] api in
          guard let id = serverIDs[key] else { return }
          let _: OKResponse = try await api.send("DELETE", "/plans/\(id)")
          serverIDs[key] = nil; saveMapping()
        }))
        continue
      }
      if before?.stops != snap.stops || before?.stays != snap.stays || before?.modes != snap.modes {
        ops.append(("update plan", { [self] api in
          guard let id = serverIDs[key] else { return }
          let _: PlanDTO = try await api.send("PUT", "/plans/\(id)/stops", body: PutStopsBody(stops: snap.stopInputs))
        }))
      }
      if (before?.startAt != snap.startAt && snap.startAt != nil) || (before?.name != snap.name && snap.name != nil) {
        ops.append(("update plan", { [self] api in
          guard let id = serverIDs[key] else { return }
          let _: PlanDTO = try await api.send("PATCH", "/plans/\(id)", body: PatchPlanBody(name: snap.name, startAt: snap.startAt))
        }))
      }
    }
    enqueue(ops)
  }

  /// Save once when the plan becomes a saved plan: visibility plus invites to real friends.
  @MainActor
  private func savePlanOp(key: String, plan: SavedPlanDraft) -> SyncOp {
    let body = SavePlanRequest(name: plan.name, visibility: PlanSync.serverVisibility(plan.visibility),
                               inviteeIds: plan.friendNames.compactMap { FriendDirectory.shared.userID(forName: $0) })
    return { [self] api in
      guard let id = serverIDs[key] else { return }
      let _: PlanDTO = try await api.send("POST", "/plans/\(id)/save", body: body)
    }
  }

  typealias SyncOp = @MainActor (HermiAPI) async throws -> Void

  @MainActor
  private func enqueue(_ ops: [(String, SyncOp)]) {
    guard !ops.isEmpty else { return }
    let previous = queue
    queue = Task { @MainActor in
      await previous?.value
      for (label, op) in ops {
        guard let api = LiveSession.shared.api else { return }
        do { try await op(api) } catch { notice = "Couldn’t \(label): \(error.localizedDescription)" }
      }
    }
  }

  private var mappingKey: String { "hermi.live.plans.\(account)" }
  private func saveMapping() { defaults.set(serverIDs, forKey: mappingKey) }

  // MARK: Mapping

  static func isLive(_ stops: [String]) -> Bool { stops.allSatisfy(SavedSync.isLivePlace) }

  static func serverVisibility(_ visibility: SavedVisibility) -> String {
    switch visibility {
    case .solo: return "just_me"
    case .friends: return "invite"
    case .publicPlan: return "find"
    }
  }

  static func localVisibility(_ visibility: String?) -> SavedVisibility {
    switch visibility {
    case "invite", "friends": return .friends
    case "find": return .publicPlan
    default: return .solo
    }
  }

  static func contents(from plan: PlanDTO) -> PlanContents { PlanContents(server: plan) }

  static func savedDraft(from plan: PlanDTO) -> SavedPlanDraft {
    let contents = contents(from: plan)
    let invited = (plan.members ?? []).filter { $0.status == "invited" || $0.status == "joined" }.map(\.name)
    return SavedPlanDraft(name: plan.name, folderID: nil, visibility: localVisibility(plan.visibility),
                          friendNames: invited, stopIDs: contents.ids, times: contents.times, isBookmarked: true,
                          legs: contents.legs)
  }
}

/// What the server holds for one plan: ordered places, stay lengths, leg modes, start time and (saved plans) name.
struct PlanSnapshot: Equatable {
  var name: String?
  var stops: [String]
  var stays: [Int]
  /// Mode of the leg into each stop while it is still valid (nil: the server's default).
  var modes: [String?]
  var startAt: Date?

  var stopInputs: [StopInputBody] {
    stops.indices.map { StopInputBody(placeId: stops[$0], stayMin: stays[$0], legMode: modes[$0]) }
  }

  init(name: String?, contents: PlanContents) {
    self.name = name
    stops = contents.ids
    stays = contents.ids.map { min(240, max(5, contents.times[$0]?.durationMinutes ?? 60)) }
    modes = contents.ids.map { contents.leg(into: $0)?.mode }
    startAt = contents.ids.first.flatMap { contents.times[$0]?.arrival }
  }

  /// Every live plan in the state: the draft (even while a saved plan is open) and each saved plan.
  static func all(_ state: MapPreviewState) -> [String: PlanSnapshot] {
    var result: [String: PlanSnapshot] = [:]
    let draft = state.activeSavedPlanID == nil ? state.planContents : (state.unsavedPlanContents ?? PlanContents())
    if PlanSync.isLive(draft.ids) { result[PlanSync.draftKey] = PlanSnapshot(name: nil, contents: draft) }
    for plan in state.library.plans where PlanSync.isLive(plan.stopIDs) {
      let contents = PlanContents(ids: plan.stopIDs, times: plan.times, legs: plan.legs)
      result[plan.id.uuidString] = PlanSnapshot(name: plan.name, contents: contents)
    }
    return result
  }
}

struct StopInputBody: Encodable, Equatable {
  var placeId: String
  var stayMin: Int
  var legMode: String?
}

struct CreatePlanBody: Encodable {
  var name: String?
  var startAt: Date?
  var mode = "walk"
  var stops: [StopInputBody]
}

struct PutStopsBody: Encodable { var stops: [StopInputBody] }

struct PatchPlanBody: Encodable {
  var name: String?
  var startAt: Date?
}

struct SavePlanRequest: Encodable {
  var name: String?
  var visibility: String
  var inviteeIds: [String]
}
