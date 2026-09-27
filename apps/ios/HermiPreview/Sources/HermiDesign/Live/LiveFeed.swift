import Foundation
import Observation

/// One full-screen Feed page from `GET /v1/feed`. Every kind shares the same overlay; the background differs.
struct LiveFeedCard: Identifiable, Equatable {
  enum Kind: Equatable {
    case photo, video, review
    /// A recap/adventure post with a route drawn on the map.
    case route
    /// Someone's open plan: route on the map plus a Join (or Request) button.
    case openPlan
  }
  var id: String
  var kind: Kind
  var authorID: String?
  var author: String
  var title: String
  /// Places for the strips and for Add: the post's place, or the route/plan stops in order.
  var placeIDs: [String]
  var media: [RemoteMediaItem] = []
  var route: [GeoPoint] = []
  var postID: String?
  var planID: String?
  /// "join" or "request" on open plans.
  var joinAction: String?
  var again: Bool?

  var isPlan: Bool { kind == .route || kind == .openPlan }

  /// Adapter for the existing bookmark/append plan actions.
  var planSample: FeedPlanSample {
    FeedPlanSample(id: planID ?? id, name: title, author: author, audience: .publicFeed, stops: placeIDs)
  }

  /// Nil for the end card and anything the app can't show.
  static func from(_ dto: FeedCardDTO) -> LiveFeedCard? {
    if let post = dto.post, dto.kind == "post" { return from(post) }
    if let plan = dto.plan, dto.kind == "plan" { return from(plan, action: dto.joinAction) }
    return nil
  }

  static func from(_ post: PostDTO) -> LiveFeedCard? {
    let media = post.feedPost?.media ?? post.media.map {
      RemoteMediaItem(id: $0.id, isVideo: $0.kind == "video", url: $0.url.flatMap { URL(string: $0) },
                      posterURL: $0.posterUrl.flatMap { URL(string: $0) })
    }
    let kind: Kind
    var placeIDs = post.place.map { [$0.id] } ?? []
    var route: [GeoPoint] = []
    if let line = post.route, !line.stops.isEmpty {
      kind = .route
      placeIDs = line.stops.sorted { $0.index < $1.index }.map(\.placeId)
      route = line.line.map { GeoPoint(latitude: $0.lat, longitude: $0.lng) }
      if route.count < 2 { route = line.stops.sorted { $0.index < $1.index }.map { GeoPoint(latitude: $0.loc.lat, longitude: $0.loc.lng) } }
    } else if media.contains(where: \.isVideo) {
      kind = .video
    } else if !media.isEmpty {
      kind = .photo
    } else if post.text != nil || post.again != nil {
      kind = .review
    } else {
      return nil
    }
    return LiveFeedCard(id: "post:\(post.id)", kind: kind, authorID: post.author.id, author: post.author.name,
                        title: post.text ?? post.place?.name ?? "", placeIDs: placeIDs, media: media, route: route,
                        postID: post.feedPost != nil ? post.id : nil, again: post.again)
  }

  static func from(_ plan: PlanDTO, action: String?) -> LiveFeedCard {
    let stops = plan.stops.compactMap(\.place)
    let host = plan.hostId.flatMap { id in FriendDirectory.shared.friends.first { $0.id == id }?.name }
    return LiveFeedCard(id: "plan:\(plan.id)", kind: .openPlan, authorID: plan.hostId,
                        author: host ?? (action == "request" ? "Open to verified students" : "A friend’s plan"),
                        title: plan.name, placeIDs: stops.map(\.id),
                        route: stops.map { GeoPoint(latitude: $0.loc.lat, longitude: $0.loc.lng) },
                        planID: plan.id, joinAction: action ?? "join")
  }
}

/// The signed-in Feed: loads once per visit (pull to refresh), filters Friends/General and content on the
/// device (the API has no audience parameter, see D8), reports seen posts and joins open plans.
@Observable
final class LiveFeed {
  static let shared = LiveFeed()

  private(set) var cards: [LiveFeedCard] = []
  private(set) var endTitle: String?
  private(set) var loading = false
  private(set) var error: String?
  /// Plan ID → "joined" / "requested" after a tap.
  private(set) var joinStates: [String: String] = [:]

  @ObservationIgnored private var loadedAt: Date?
  @ObservationIgnored private var pendingSeen: Set<String> = []
  @ObservationIgnored private var sentSeen: Set<String> = []
  @ObservationIgnored private var seenTask: Task<Void, Never>?

  func visible(audience: FeedAudience, content: FeedContent) -> [LiveFeedCard] {
    let friends = Set(FriendDirectory.shared.friends.map(\.id))
    return cards.filter { card in
      let audienceMatch = audience == .publicFeed || card.authorID.map { friends.contains($0) } == true
      let contentMatch = content == .all || (content == .plans) == card.isPlan
      return audienceMatch && contentMatch
    }
  }

  @MainActor
  func load(force: Bool = false) async {
    guard let api = LiveSession.shared.api, !loading else { return }
    if !force, let loadedAt, Date().timeIntervalSince(loadedAt) < 120, !cards.isEmpty { return }
    loading = true
    defer { loading = false }
    let center = PlaceCatalog.shared.mapCenter ?? GeoPoint(latitude: 40.8075, longitude: -73.965)
    do {
      let response: FeedResponseDTO = try await api.send("GET", "/feed", query: [
        "lat": String(format: "%.5f", center.latitude), "lng": String(format: "%.5f", center.longitude)])
      for card in response.cards {
        if let place = card.post?.place {
          PlaceCatalog.shared.upsert([MapSamplePlace(id: place.id, name: place.name,
            category: HermiCategory(serverName: place.category) ?? .culture,
            latitude: place.loc.lat, longitude: place.loc.lng, isLive: true)])
        }
        if let feedPost = card.post?.feedPost { PlaceCatalog.shared.remember(posts: [feedPost]) }
        if let plan = card.plan { PlaceCatalog.shared.upsert(plan.stops.compactMap { $0.place?.place }) }
      }
      cards = response.cards.compactMap { LiveFeedCard.from($0) }
      endTitle = response.cards.first { $0.kind == "end" }?.title
      loadedAt = Date(); error = nil
    } catch {
      self.error = error.localizedDescription
    }
  }

  /// Batches seen post IDs (only posts that were actually on screen) into POST /feed/seen.
  @MainActor
  func markSeen(_ postID: String) {
    guard !sentSeen.contains(postID) else { return }
    pendingSeen.insert(postID)
    seenTask?.cancel()
    seenTask = Task { @MainActor in
      do { try await Task.sleep(for: .seconds(1.5)) } catch { return }
      let batch = Array(pendingSeen.prefix(50))
      guard !batch.isEmpty, let api = LiveSession.shared.api else { return }
      pendingSeen.subtract(batch); sentSeen.formUnion(batch)
      _ = try? await api.send("POST", "/feed/seen", body: SeenBody(postIds: batch), as: OKResponse.self)
    }
  }

  /// Join a friend's plan, or request to join a matched open plan. Returns a message for the page.
  @MainActor
  func join(_ card: LiveFeedCard) async -> String? {
    guard let planID = card.planID, let api = LiveSession.shared.api, joinStates[planID] == nil else { return nil }
    let request = card.joinAction == "request"
    do {
      let _: PlanDTO = try await api.send("POST", "/plans/\(planID)/\(request ? "request" : "join")", body: JoinRequestBody())
      joinStates[planID] = request ? "requested" : "joined"
      return request ? "Request sent. The host approves it." : "You’re in. It’s in your plans."
    } catch {
      return "Couldn’t \(request ? "request" : "join"): \(error.localizedDescription)"
    }
  }

  func reset() { cards = []; endTitle = nil; loadedAt = nil; joinStates = [:]; sentSeen = []; pendingSeen = [] }
}
