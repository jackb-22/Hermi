import Foundation

enum SavedKind: String, Codable { case place, post, plan }

struct SavedReference: Codable, Hashable, Identifiable {
  var kind: SavedKind
  var refID: String
  var id: String { "\(kind.rawValue):\(refID)" }
}

struct SavedFolder: Codable, Equatable, Identifiable {
  var id: UUID = UUID()
  var name: String
  var items: [SavedReference] = []
}

enum SavedVisibility: String, Codable, CaseIterable { case solo = "Solo", friends = "Friends", publicPlan = "Public" }

struct SavedPlanDraft: Codable, Equatable, Identifiable {
  var id: UUID = UUID()
  var name: String
  var folderID: UUID?
  var visibility: SavedVisibility
  var friendNames: [String]
  var stopIDs: [String]
  var times: [String: PreviewStopTime]
  var inviteDrafts: [String: Set<String>]?
  var isBookmarked: Bool? // Older saved plans are bookmarked by default.
}

struct SavedLibrary: Codable, Equatable {
  var folders: [SavedFolder] = []
  var plans: [SavedPlanDraft] = []
  var posts: [SavedReference] = []

  func plan(_ id: String) -> SavedPlanDraft? { plans.first { $0.id.uuidString == id } }

  mutating func put(_ reference: SavedReference, in folderID: UUID) -> Bool {
    guard let destination = folders.firstIndex(where: { $0.id == folderID }) else { return false }
    for index in folders.indices { folders[index].items.removeAll { $0 == reference } }
    folders[destination].items.append(reference)
    if reference.kind == .plan, let index = plans.firstIndex(where: { $0.id.uuidString == reference.refID }) {
      plans[index].folderID = folderID
    }
    return true
  }

  mutating func savePlan(name: String, folderID: UUID?, newFolder: String?, visibility: SavedVisibility,
                         friends: Set<String>, stops: [String], times: [String: PreviewStopTime]) -> Bool {
    let cleanName = name.trimmingCharacters(in: .whitespacesAndNewlines)
    let cleanFolder = newFolder?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    guard !cleanName.isEmpty, cleanName.count <= 80, !stops.isEmpty,
          Set(stops).count == stops.count, stops.allSatisfy({ MapSamplePlace.find($0) != nil }),
          visibility != .friends || !friends.isEmpty,
          cleanFolder.isEmpty || cleanFolder.count <= 40,
          cleanFolder.isEmpty || !folders.contains(where: { $0.name.localizedCaseInsensitiveCompare(cleanFolder) == .orderedSame }),
          cleanFolder.isEmpty || folderID == nil,
          folderID == nil || folders.contains(where: { $0.id == folderID }) else { return false }
    var destination = folderID
    if !cleanFolder.isEmpty {
      let folder = SavedFolder(name: cleanFolder)
      folders.append(folder)
      destination = folder.id
    }
    let plan = SavedPlanDraft(name: cleanName, folderID: destination, visibility: visibility,
                              friendNames: visibility == .friends ? friends.sorted() : [], stopIDs: stops,
                              times: times.filter { stops.contains($0.key) })
    plans.append(plan)
    if let destination, let index = folders.firstIndex(where: { $0.id == destination }) {
      folders[index].items.append(.init(kind: .plan, refID: plan.id.uuidString))
    }
    return true
  }

  mutating func savePost(_ id: String, in folderID: UUID? = nil) -> Bool {
    guard PlaceFeedPost.find(id) != nil else { return false }
    let ref = SavedReference(kind: .post, refID: id)
    if !posts.contains(ref) { posts.append(ref) }
    if let folderID, let index = folders.firstIndex(where: { $0.id == folderID }), !folders[index].items.contains(ref) {
      folders[index].items.append(ref)
    }
    return true
  }
}

struct SavedAppendResult: Equatable {
  var added = 0
  var skipped = 0
  var unavailable = 0
}

extension MapPreviewState {
  var library: SavedLibrary {
    get { savedLibrary ?? SavedLibrary() }
    set { savedLibrary = newValue }
  }
  var savedReferences: [SavedReference] {
    let places = MapSamplePlace.known.filter { savedIDs.contains($0.id) }.map { SavedReference(kind: .place, refID: $0.id) }
    return places + library.posts + library.plans.filter { $0.isBookmarked != false }.map { SavedReference(kind: .plan, refID: $0.id.uuidString) }
  }
  mutating func appendSaved(_ reference: SavedReference) -> SavedAppendResult {
    let ids: [String]
    switch reference.kind {
    case .place: ids = MapSamplePlace.find(reference.refID).map { [$0.id] } ?? []
    case .post: ids = PlaceFeedPost.find(reference.refID).map { [$0.placeID] } ?? []
    case .plan: ids = library.plan(reference.refID)?.stopIDs ?? []
    }
    guard !ids.isEmpty else { return .init(unavailable: 1) }
    let savedPlan = reference.kind == .plan ? library.plan(reference.refID) : nil
    var result = SavedAppendResult()
    var contents = planContents
    for id in ids {
      guard MapSamplePlace.find(id) != nil else { result.unavailable += 1; continue }
      if contents.ids.contains(id) { result.skipped += 1; continue }
      contents.ids.append(id)
      if let time = savedPlan?.times[id] { contents.times[id] = time }
      result.added += 1
    }
    applyPlanContents(contents)
    return result
  }
}
