import Foundation
import Observation

/// Own-profile data: header counts, score, stats, explored tiles, leaderboards, friends and own posts.
/// Loaded when Profile opens (at most every 60 s unless forced); each part fails independently.
@Observable
final class LiveProfile {
  static let shared = LiveProfile()

  private(set) var profile: ProfileDTO?
  private(set) var score: ScoreDTO?
  private(set) var stats: StatsDTO?
  private(set) var tiles: TilesDTO?
  private(set) var friendsBoard: LeaderboardDTO?
  private(set) var campusBoard: LeaderboardDTO?
  private(set) var friends: [FriendsDTO.Friend] = []
  private(set) var posts: [PlaceFeedPost] = []
  private(set) var loading = false
  private(set) var error: String?
  @ObservationIgnored private var loadedAt: Date?

  var stones: Int { HermiStoneScale.count(score?.score ?? 0) }

  @MainActor
  func load(force: Bool = false) async {
    guard let api = LiveSession.shared.api, let me = LiveSession.shared.me, !loading else { return }
    if !force, let loadedAt, Date().timeIntervalSince(loadedAt) < 60 { return }
    loading = true
    defer { loading = false }
    async let profile: ProfileDTO? = LiveProfile.fetch(api, "/profile/me")
    async let score: ScoreDTO? = LiveProfile.fetch(api, "/score")
    async let stats: StatsDTO? = LiveProfile.fetch(api, "/stats")
    async let tiles: TilesDTO? = LiveProfile.fetch(api, "/tiles")
    async let friendsBoard: LeaderboardDTO? = LiveProfile.fetch(api, "/leaderboard", ["scope": "friends"])
    async let campusBoard: LeaderboardDTO? = LiveProfile.fetch(api, "/leaderboard", ["scope": "campus"])
    async let friends: FriendsDTO? = LiveProfile.fetch(api, "/friends")
    async let posts: PostsPageDTO? = LiveProfile.fetch(api, "/posts", ["authorId": me.id])
    self.profile = await profile
    let loadedScore = await score
    self.score = loadedScore ?? self.profile?.score
    self.stats = await stats
    self.tiles = await tiles
    self.friendsBoard = await friendsBoard
    self.campusBoard = await campusBoard
    let loadedFriends = await friends
    self.friends = loadedFriends?.items ?? []
    let ownPage = await posts
    let own = ownPage?.items.compactMap(\.feedPost) ?? []
    PlaceCatalog.shared.remember(posts: own)
    self.posts = own
    error = self.profile == nil ? "Profile didn’t load. Pull to retry." : nil
    loadedAt = Date()
  }

  private static func fetch<T: Decodable & Sendable>(_ api: HermiAPI, _ path: String, _ query: [String: String] = [:]) async -> T? {
    try? await api.send("GET", path, query: query, as: T.self)
  }

  func reset() {
    profile = nil; score = nil; stats = nil; tiles = nil; friendsBoard = nil; campusBoard = nil
    friends = []; posts = []; loadedAt = nil; error = nil
  }

  /// Explored tiles as [x, y] pairs for the Adventures map.
  var tilePairs: [[Int]] { tiles?.tiles.map { [$0.x, $0.y] } ?? [] }
}

extension LiveSession {
  /// Ghost mode / open to plans (PATCH /me). Returns an error message, or nil on success.
  @MainActor
  func updateMe(ghostMode: Bool? = nil, openToPlans: Bool? = nil) async -> String? {
    guard let api else { return "Not connected" }
    do {
      let updated: MeDTO = try await api.send("PATCH", "/me", body: PatchMeBody(ghostMode: ghostMode, openToPlans: openToPlans))
      replaceMe(updated)
      return nil
    } catch {
      return error.localizedDescription
    }
  }
}
