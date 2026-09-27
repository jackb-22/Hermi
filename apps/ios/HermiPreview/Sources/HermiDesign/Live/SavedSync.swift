import Foundation
import Observation

/// Keeps saved places, posts and folders in step with `/v1/saves` and `/v1/folders`.
/// On connect it pulls the server copy into state; afterwards every state change is diffed against the last
/// synced snapshot and only the differences are sent, in order, one request at a time. Sample fixtures and
/// saved plans (Step 6) stay local.
@Observable
final class SavedSync {
  static let shared = SavedSync()

  /// Latest sync problem, shown briefly on the map.
  private(set) var notice: String?

  @ObservationIgnored private var baseline: SavedSnapshot?
  @ObservationIgnored private var queue: Task<Void, Never>?
  @ObservationIgnored private var folderServerIDs: [UUID: String]
  private let defaults: UserDefaults
  private static let folderKey = "hermi.live.folders.v1"

  init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
    let stored = defaults.dictionary(forKey: SavedSync.folderKey) as? [String: String] ?? [:]
    folderServerIDs = Dictionary(uniqueKeysWithValues: stored.compactMap { key, value in UUID(uuidString: key).map { ($0, value) } })
  }

  // MARK: Pull

  struct Hydration {
    var places: [String] = []
    var posts: [String] = []
    var folders: [(serverID: String, name: String, items: [SavedReference])] = []
  }

  /// Fetches everything saved on the server (places/posts are cached in PlaceCatalog as a side effect).
  @MainActor
  func hydrate() async -> Hydration? {
    guard let api = LiveSession.shared.api else { return nil }
    do {
      var result = Hydration()
      let all: SavedPageDTO = try await api.send("GET", "/saves")
      for item in all.items {
        switch item.type {
        case "place": if let place = item.place?.place { PlaceCatalog.shared.upsert([place]); result.places.append(place.id) }
        case "post": if let post = item.post?.feedPost { PlaceCatalog.shared.remember(posts: [post]); result.posts.append(post.id) }
        default: break
        }
      }
      let folders: FoldersDTO = try await api.send("GET", "/folders")
      for folder in folders.items {
        let page: SavedPageDTO = try await api.send("GET", "/saves", query: ["folderId": folder.id])
        let refs = page.items.compactMap { item -> SavedReference? in
          switch item.type {
          case "place": return item.place != nil ? SavedReference(kind: .place, refID: item.refId) : nil
          case "post": return item.post != nil ? SavedReference(kind: .post, refID: item.refId) : nil
          default: return nil
          }
        }
        result.folders.append((folder.id, folder.name, refs))
      }
      notice = nil
      return result
    } catch {
      notice = "Saved items didn’t load: \(error.localizedDescription)"
      return nil
    }
  }

  /// Server copy replaces live items; sample items and saved plans stay. Starts diff-syncing from here.
  @MainActor
  func apply(_ hydration: Hydration, to state: inout MapPreviewState) {
    state.savedIDs = state.savedIDs.filter { !SavedSync.isLivePlace($0) }.union(hydration.places)
    var library = state.library
    library.posts = library.posts.filter { !SavedSync.isLivePost($0.refID) }
      + hydration.posts.map { SavedReference(kind: .post, refID: $0) }
    let serverIDs = Set(hydration.folders.map { $0.serverID })
    // Folders deleted elsewhere go; folders never synced stay and are pushed as new.
    library.folders.removeAll { folder in folderServerIDs[folder.id].map { !serverIDs.contains($0) } ?? false }
    for folder in hydration.folders {
      if let local = folderServerIDs.first(where: { $0.value == folder.serverID })?.key,
         let index = library.folders.firstIndex(where: { $0.id == local }) {
        library.folders[index].name = folder.name
        let kept = library.folders[index].items.filter { !SavedSync.isSynced($0) }
        library.folders[index].items = kept + folder.items
      } else {
        let created = SavedFolder(name: folder.name, items: folder.items)
        library.folders.append(created)
        folderServerIDs[created.id] = folder.serverID
      }
    }
    state.library = library
    saveFolderIDs()
    // Baseline = what the server has, so anything local-only is pushed by the next diff.
    var server = SavedSnapshot(places: Set(hydration.places), posts: Set(hydration.posts), folders: [:])
    for folder in hydration.folders {
      if let local = folderServerIDs.first(where: { $0.value == folder.serverID })?.key {
        server.folders[local] = .init(name: folder.name, items: Set(folder.items))
      }
    }
    baseline = server
    push(state)
  }

  /// Disconnect: stop syncing (pending requests finish or fail harmlessly).
  func reset() { baseline = nil }

  // MARK: Push

  /// Called on every state change while live. Sends only what changed since the last snapshot.
  @MainActor
  func push(_ state: MapPreviewState) {
    guard let old = baseline, LiveSession.shared.isLive else { return }
    let new = SavedSnapshot(state, folderIDs: Set(state.library.folders.map(\.id)))
    guard new != old else { return }
    baseline = new
    var ops: [(String, SyncOp)] = []

    for id in Set(old.folders.keys).subtracting(new.folders.keys) {
      ops.append(("delete folder", { [self] api in
        guard let server = folderServerIDs[id] else { return }
        let _: OKResponse = try await api.send("DELETE", "/folders/\(server)")
        folderServerIDs[id] = nil; saveFolderIDs()
      }))
    }
    for (id, folder) in new.folders {
      let before = old.folders[id]
      if before == nil {
        ops.append(("create folder", { [self] api in
          guard folderServerIDs[id] == nil else { return }
          let created: FolderDTO = try await api.send("POST", "/folders", body: FolderBody(name: folder.name))
          folderServerIDs[id] = created.id; saveFolderIDs()
        }))
      } else if before?.name != folder.name {
        ops.append(("rename folder", { [self] api in
          guard let server = folderServerIDs[id] else { return }
          let _: FolderDTO = try await api.send("PATCH", "/folders/\(server)", body: FolderBody(name: folder.name))
        }))
      }
      let oldItems = before?.items ?? []
      for item in folder.items.subtracting(oldItems) {
        ops.append(("add to folder", { [self] api in
          guard let server = folderServerIDs[id] else { return }
          let _: OKResponse = try await api.send("POST", "/folders/\(server)/items", body: SaveRef(item))
        }))
      }
      for item in oldItems.subtracting(folder.items) {
        ops.append(("remove from folder", { [self] api in
          guard let server = folderServerIDs[id] else { return }
          let _: OKResponse = try await api.send("DELETE", "/folders/\(server)/items", body: SaveRef(item))
        }))
      }
    }
    let sets: [(SavedKind, Set<String>, Set<String>)] = [(.place, old.places, new.places), (.post, old.posts, new.posts)]
    for (kind, before, after) in sets {
      for id in after.subtracting(before) {
        ops.append(("save", { api in
          let _: SaveResponseDTO = try await api.send("POST", "/saves", body: SaveRef(kind: kind, refID: id))
        }))
      }
      for id in before.subtracting(after) {
        ops.append(("unsave", { api in
          let _: OKResponse = try await api.send("DELETE", "/saves", body: SaveRef(kind: kind, refID: id))
        }))
      }
    }
    enqueue(ops)
  }

  /// Runs requests strictly in order after anything already queued (folder creation before its items).
  @MainActor
  private func enqueue(_ ops: [(String, SyncOp)]) {
    guard !ops.isEmpty else { return }
    let previous = queue
    queue = Task { @MainActor in
      await previous?.value
      for (label, op) in ops {
        guard let api = LiveSession.shared.api else { return }
        do { try await op(api) } catch {
          notice = "Couldn’t \(label): \(error.localizedDescription)"
        }
      }
    }
  }

  /// One server request; main-actor so folder ID bookkeeping never races.
  typealias SyncOp = @MainActor (HermiAPI) async throws -> Void

  private func saveFolderIDs() {
    defaults.set(Dictionary(uniqueKeysWithValues: folderServerIDs.map { ($0.key.uuidString, $0.value) }), forKey: SavedSync.folderKey)
  }

  // MARK: Live vs sample

  static func isLivePlace(_ id: String) -> Bool { !MapSamplePlace.fixtures.contains { $0.id == id } }
  static func isLivePost(_ id: String) -> Bool { PlaceFeedPost.find(id)?.isLive ?? true }
  static func isSynced(_ ref: SavedReference) -> Bool {
    switch ref.kind {
    case .place: return isLivePlace(ref.refID)
    case .post: return isLivePost(ref.refID)
    case .plan: return false // Step 6
    }
  }
}

/// The server-relevant part of saved state: live places, live posts, and folder names/items.
struct SavedSnapshot: Equatable {
  struct Folder: Equatable {
    var name: String
    var items: Set<SavedReference>
  }
  var places: Set<String>
  var posts: Set<String>
  var folders: [UUID: Folder]

  init(places: Set<String>, posts: Set<String>, folders: [UUID: Folder]) {
    self.places = places; self.posts = posts; self.folders = folders
  }

  init(_ state: MapPreviewState, folderIDs: Set<UUID>) {
    places = state.savedIDs.filter(SavedSync.isLivePlace)
    posts = Set(state.library.posts.map(\.refID).filter(SavedSync.isLivePost))
    folders = [:]
    for folder in state.library.folders where folderIDs.contains(folder.id) {
      folders[folder.id] = Folder(name: folder.name, items: Set(folder.items.filter(SavedSync.isSynced)))
    }
  }
}

struct SaveRef: Encodable {
  var type: String
  var refId: String
  init(kind: SavedKind, refID: String) { type = kind.rawValue; refId = refID }
  init(_ ref: SavedReference) { self.init(kind: ref.kind, refID: ref.refID) }
}

struct FolderBody: Encodable { var name: String }
