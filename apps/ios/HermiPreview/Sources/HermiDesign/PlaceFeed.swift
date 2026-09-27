import SwiftUI

/// One photo or clip on a live post. Sample posts have none and draw placeholders instead.
struct RemoteMediaItem: Equatable, Identifiable {
  let id: String
  let isVideo: Bool
  let url: URL?
  let posterURL: URL?
}

/// Explicit place scope: this fixture never includes another location's posts.
struct PlaceFeedPost: Identifiable, Equatable {
  let id: String
  let placeID: String
  let author: String
  let caption: String
  let mediaCount: Int
  var media: [RemoteMediaItem] = []
  var isLive = false

  static func find(_ id: String) -> Self? {
    PlaceCatalog.shared.posts[id] ?? MapSamplePlace.fixtures.lazy.flatMap { samples(for: $0.id) }.first { $0.id == id }
  }
  static func samples(for placeID: String) -> [Self] {
    // Sample posts belong to sample places only; live places never show invented posts.
    guard MapSamplePlace.fixtures.contains(where: { $0.id == placeID }) else { return [] }
    return [
      .init(id: "\(placeID)-alex", placeID: placeID, author: "@alex", caption: "A little detour.", mediaCount: 3),
      .init(id: "\(placeID)-sam", placeID: placeID, author: "@sam", caption: "Worth stepping outside for.", mediaCount: 2),
      .init(id: "\(placeID)-lee", placeID: placeID, author: "@lee", caption: "One for next time.", mediaCount: 1)
    ]
  }
}

extension PostDTO {
  /// Nil for posts without a place (they can't be scoped to a place sheet or plan).
  var feedPost: PlaceFeedPost? {
    guard let place else { return nil }
    let items = media.map {
      RemoteMediaItem(id: $0.id, isVideo: $0.kind == "video", url: $0.url.flatMap { URL(string: $0) },
                      posterURL: $0.posterUrl.flatMap { URL(string: $0) })
    }
    return PlaceFeedPost(id: id, placeID: place.id, author: author.name, caption: text ?? "",
                         mediaCount: items.count, media: items, isLive: true)
  }
}

/// Participates in the panel's vertical scroll; each post owns only horizontal media.
struct PlaceFeedContent: View {
  let place: MapSamplePlace
  var savedPostIDs: Set<String> = []
  var togglePostSave: ((String) -> Void)?
  /// Opens a post full screen (parts page sideways; clips play).
  var openPost: ((String) -> Void)? = nil
  @State private var livePosts: [PlaceFeedPost]?
  @State private var loadError: String?

  private var posts: [PlaceFeedPost] { place.isLive ? (livePosts ?? []) : PlaceFeedPost.samples(for: place.id) }

  var body: some View {
    LazyVStack(alignment: .leading, spacing: 22) {
      if place.isLive { PlaceDetailSummary(place: place) }
      ForEach(posts) { post in
        VStack(alignment: .leading, spacing: 8) {
          HStack {
            Text(post.author).font(.subheadline.weight(.semibold))
            Spacer()
            if let togglePostSave {
              Button { togglePostSave(post.id) } label: {
                PixelIcon(name: savedPostIDs.contains(post.id) ? "saved" : "save")
                  .frame(width: 18, height: 22).frame(width: 44, height: 44)
              }.accessibilityLabel(savedPostIDs.contains(post.id) ? "Unsave post by \(post.author)" : "Save post by \(post.author)")
                .controlHelp("Save this post and its media placeholder to Saved")
            }
          }
          if post.mediaCount > 0 {
            ScrollView(.horizontal) {
              HStack(spacing: 8) {
                if post.isLive {
                  ForEach(post.media) { item in
                    RemoteMediaTile(item: item).frame(width: 260, height: 220).clipShape(PixelPanel(corner: 6))
                  }
                } else {
                  ForEach(0..<post.mediaCount, id: \.self) { index in
                    ZStack(alignment: .bottomLeading) {
                      ParkPlacement().frame(width: 260, height: 220).clipped()
                      if index == 2 {
                        PixelIcon(name: "play").frame(width: 24, height: 24).padding(12)
                          .background(HermiPalette.controlSurface, in: PixelPanel(corner: 6)).padding(12)
                      }
                    }
                    .hueRotation(.degrees(Double(index) * 12))
                    .clipShape(PixelPanel(corner: 6))
                    .accessibilityLabel("\(index == 2 ? "Video" : "Photo") placeholder \(index + 1) of \(post.mediaCount) at \(place.name)")
                  }
                }
              }
            }.scrollIndicators(.hidden)
              .onTapGesture { if post.isLive { openPost?(post.id) } }
          }
          if !post.caption.isEmpty { Text(post.caption).font(.subheadline) }
        }.accessibilityElement(children: .contain)
      }
      Text(footer).font(.caption).foregroundStyle(HermiPalette.secondary)
    }
    .task(id: place.id) { await loadPosts() }
  }

  private var footer: String {
    guard place.isLive else { return "End of sample posts · reviews not connected" }
    if let loadError { return "Posts unavailable: \(loadError)" }
    guard let livePosts else { return "Loading posts…" }
    return livePosts.isEmpty ? "No posts here yet." : "End of posts"
  }

  private func loadPosts() async {
    guard place.isLive, let api = LiveSession.shared.api else { return }
    do {
      let page: PostsPageDTO = try await api.send("GET", "/posts", query: ["placeId": place.id])
      let posts = page.items.filter { $0.status == nil || $0.status == "live" }.compactMap(\.feedPost)
      PlaceCatalog.shared.remember(posts: posts)
      livePosts = posts; loadError = nil
    } catch {
      if livePosts == nil { loadError = error.localizedDescription }
    }
  }
}

/// A live photo, or a clip's poster with a play mark. Loading and failures keep the pixel placement.
struct RemoteMediaTile: View {
  let item: RemoteMediaItem
  var body: some View {
    ZStack(alignment: .bottomLeading) {
      CachedImage(url: item.isVideo ? item.posterURL : item.url)
      if item.isVideo {
        PixelIcon(name: "play").frame(width: 24, height: 24).padding(12)
          .background(HermiPalette.controlSurface, in: PixelPanel(corner: 6)).padding(12)
      }
    }
    .clipped()
    .accessibilityLabel(item.isVideo ? "Video" : "Photo")
  }
}

/// Live place facts: counts, would-go-again, today's hours and the review summary. Unknown stays unknown.
struct PlaceDetailSummary: View {
  let place: MapSamplePlace
  @State private var detail: PlaceDetailDTO?
  @State private var failed = false

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      if let address = detail?.address ?? place.address {
        Text(address).font(.caption).foregroundStyle(HermiPalette.secondary)
      }
      HStack(spacing: 14) {
        stat(detail?.been ?? place.been, "been")
        stat(detail?.friendsBeen, "friends")
        stat(detail?.hereNow, "here now")
        stat(detail?.going, "going")
      }
      Text(facts).font(.caption)
      if let summary = detail?.reviewSummary, !summary.isEmpty {
        Text(summary).font(.subheadline).italic()
      }
    }
    .task(id: place.id) { await load() }
  }

  private func stat(_ value: Int?, _ label: String) -> some View {
    VStack(alignment: .leading, spacing: 1) {
      Text(value.map(String.init) ?? "—").font(.system(.headline, design: .monospaced))
      Text(label).font(.caption2).foregroundStyle(HermiPalette.secondary)
    }.accessibilityElement(children: .combine)
  }

  private var facts: String {
    var parts: [String] = []
    if let pct = detail?.wouldGoAgainPct ?? place.wouldGoAgainPct { parts.append("\(Int(pct))% would go again") }
    if let walk = detail?.walkMin { parts.append("\(Int(walk)) min walk") }
    if detail != nil { parts.append(todayHours) } else if failed { parts.append("Details unavailable") }
    return parts.isEmpty ? " " : parts.joined(separator: " · ")
  }

  private var todayHours: String {
    guard let hours = detail?.hours else { return "Hours unknown" }
    let today = Calendar.current.component(.weekday, from: Date()) - 1 // 0 = Sunday, as the API
    let spans = hours.filter { $0.day == today }.map { "\($0.open)–\($0.close)" }
    return spans.isEmpty ? "Closed today" : "Today " + spans.joined(separator: ", ")
  }

  private func load() async {
    guard let api = LiveSession.shared.api else { return }
    do {
      detail = try await api.send("GET", "/places/\(place.id)", as: PlaceDetailDTO.self)
      failed = false
    } catch {
      failed = true
    }
  }
}
