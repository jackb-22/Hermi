import SwiftUI
#if os(iOS)
import AVFoundation
import UIKit
#endif

/// Signed-in Feed: finite vertical pages of photos, videos, reviews, adventure routes and open plans.
/// Every page shares one overlay (author, title, bookmark, +, place strips); open plans add a Join button.
struct LiveFeedPager: View {
  @Binding var state: MapPreviewState
  let size: CGSize
  var onMoving: () -> Void
  var onStopped: () -> Void
  @State private var current: String?
  @State private var notice: String?
  @State private var joining: String?
  private let feed = LiveFeed.shared

  private var cards: [LiveFeedCard] { feed.visible(audience: state.feedOptions.audience, content: state.feedOptions.content) }

  var body: some View {
    ScrollView(.vertical) {
      LazyVStack(spacing: 0) {
        ForEach(cards) { card in
          page(card).frame(width: size.width, height: size.height).id(card.id)
        }
        endPage.frame(width: size.width, height: size.height).id("end")
      }.scrollTargetLayout()
    }
    .scrollTargetBehavior(.paging).scrollPosition(id: $current).scrollIndicators(.hidden)
    .refreshable { await feed.load(force: true) }
    .overlay(alignment: .topLeading) {
      Text("\(state.feedOptions.audience == .friends ? "Friends" : "General") · \(state.feedOptions.content.label)")
        .font(.caption.bold()).padding(10).background(HermiPalette.paper, in: PixelPanel(corner: 5))
        .padding(.top, 105).padding(.leading, 20).allowsHitTesting(false)
    }
    .simultaneousGesture(DragGesture(minimumDistance: 20).onChanged { _ in onMoving() }.onEnded { _ in onStopped() })
    .onChange(of: current) { _, id in
      onStopped(); notice = nil
      if let post = cards.first(where: { $0.id == id })?.postID { feed.markSeen(post) }
    }
    .onChange(of: cards.map(\.id)) { _, ids in current = ids.first ?? "end"; notice = nil }
    .task {
      await feed.load()
      if current == nil { current = cards.first?.id ?? "end" }
      if let post = cards.first?.postID { feed.markSeen(post) }
    }
    .onDisappear { onStopped() }
  }

  // MARK: Page

  private func page(_ card: LiveFeedCard) -> some View {
    let places = card.placeIDs.compactMap(MapSamplePlace.find)
    return ZStack {
      background(card, places: places)
      LinearGradient(colors: [.clear, .black.opacity(0.75)], startPoint: .center, endPoint: .bottom).allowsHitTesting(false)
      VStack(alignment: .leading, spacing: 12) {
        Spacer()
        HStack(alignment: .bottom) {
          VStack(alignment: .leading, spacing: 6) {
            Text(card.author).font(.subheadline.bold())
            if !card.title.isEmpty { Text(card.title).font(card.isPlan ? Font.title2.bold() : Font.title3.weight(.medium)).lineLimit(3) }
            if let again = card.again { Text(again ? "Would go again" : "Wouldn’t go again").font(.caption.bold()) }
          }
          Spacer()
          VStack(spacing: 10) { bookmarkButton(card); addButton(card, places: places) }
        }
        if card.kind == .openPlan { joinButton(card) }
        if !places.isEmpty {
          ScrollView(.horizontal) {
            HStack(spacing: 8) {
              ForEach(Array(places.enumerated()), id: \.element.id) { index, place in
                placeStrip(place, number: card.isPlan ? index + 1 : nil).fixedSize(horizontal: true, vertical: false)
              }
            }
          }.scrollIndicators(.hidden)
        }
        if let notice, current == card.id { Text(notice).font(.caption.bold()) }
      }.foregroundStyle(.white).padding(.horizontal, 24).padding(.bottom, 115)
    }.buttonStyle(.plain).clipped()
  }

  @ViewBuilder
  private func background(_ card: LiveFeedCard, places: [MapSamplePlace]) -> some View {
    switch card.kind {
    case .photo:
      AsyncImage(url: card.media.first?.url) { phase in
        if let image = phase.image { image.resizable().scaledToFill() }
        else { ParkPlacement().overlay { if phase.error == nil { ProgressView() } } }
      }.frame(width: size.width, height: size.height).clipped()
    case .video:
      let clip = card.media.first { $0.isVideo }
      FeedVideo(url: clip?.url, poster: clip?.posterURL, playing: current == card.id)
        .frame(width: size.width, height: size.height).clipped()
    case .route, .openPlan:
      GeographicMap(state: MapPreviewState(), showsPlaces: false, routeLine: card.route, routeStops: places)
        .frame(width: size.width, height: size.height).allowsHitTesting(false)
    case .review:
      ZStack {
        HermiPalette.lavender
        Text("“\(card.title)”").font(.title.bold()).multilineTextAlignment(.center).padding(40)
          .foregroundStyle(HermiPalette.ink).offset(y: -80)
      }
    }
  }

  // MARK: Controls

  @ViewBuilder
  private func bookmarkButton(_ card: LiveFeedCard) -> some View {
    if let post = card.postID {
      let saved = state.library.posts.contains { $0.refID == post }
      Button { state.togglePostBookmark(post) } label: { icon(saved ? "saved" : "save") }
        .accessibilityLabel(saved ? "Unsave post" : "Save post")
    } else if card.kind == .openPlan {
      let saved = state.bookmarkedFeedPlan(card.planSample)
      Button { state.toggleFeedPlanBookmark(card.planSample) } label: { icon(saved ? "saved" : "save") }
        .accessibilityLabel(saved ? "Unsave plan" : "Save a copy of this plan")
    }
  }

  @ViewBuilder
  private func addButton(_ card: LiveFeedCard, places: [MapSamplePlace]) -> some View {
    if card.isPlan {
      Button {
        let count = state.appendFeedPlan(card.planSample)
        notice = count == 0 ? "All stops already in your plan" : "Added \(count) stops to your plan"
      } label: { icon("plus") }
        .accessibilityLabel("Add these stops to My Plan")
    } else if let place = places.first {
      let inPlan = state.planIDs.contains(place.id)
      Button { state.togglePlan(place.id) } label: { icon(inPlan ? "check" : "plus", active: inPlan) }
        .accessibilityLabel(inPlan ? "Remove \(place.name) from plan" : "Add \(place.name) to plan")
    }
  }

  private func joinButton(_ card: LiveFeedCard) -> some View {
    let request = card.joinAction == "request"
    let done = card.planID.flatMap { feed.joinStates[$0] }
    let title = done == "joined" ? "Joined ✓" : done == "requested" ? "Requested ✓" : (request ? "Request to join" : "Join plan")
    return Button {
      guard done == nil, joining == nil else { return }
      joining = card.id
      Task { @MainActor in
        notice = await feed.join(card)
        joining = nil
      }
    } label: {
      HStack {
        if joining == card.id { ProgressView().tint(HermiPalette.ink) }
        Text(title).font(.title3.bold())
      }
      .foregroundStyle(HermiPalette.ink).frame(maxWidth: .infinity, minHeight: 56)
      .background(done == nil ? HermiPalette.lime : HermiPalette.paper, in: PixelPanel(corner: 8))
    }.disabled(done != nil).accessibilityLabel(title)
  }

  private var endPage: some View {
    VStack(spacing: 20) {
      HermitBrandMark().frame(width: 60, height: 68)
      Text(cards.isEmpty ? (feed.loading ? "Loading feed…" : "Nothing here yet") : (feed.endTitle ?? "You’re caught up")).font(.title2.bold())
        .multilineTextAlignment(.center)
      if let error = feed.error { Text(error).font(.caption).foregroundStyle(HermiPalette.error) }
      if cards.isEmpty, !feed.loading, state.feedOptions.audience == .friends {
        Text("No friend posts right now. Switch to General at the top right.").font(.caption)
      }
      Button("My Plan") { state.sheet = .plan }
        .padding(14).background(HermiPalette.lime, in: PixelPanel(corner: 6))
      Button("Browse Saved") { state.sheet = .saved }.font(.subheadline)
      Button("Refresh") { Task { await feed.load(force: true) } }.font(.caption)
    }.padding(24).background(HermiPalette.paper)
  }

  private func placeStrip(_ place: MapSamplePlace, number: Int?) -> some View {
    Button { state.selectPlace(place.id) } label: {
      HStack {
        if let number { Text("\(number)").font(.caption.bold()).frame(width: 18) }
        BallpointPin(category: place.category).frame(width: 16, height: 22)
        Text(place.name); Spacer(minLength: 0)
      }
      .font(.subheadline).foregroundStyle(HermiPalette.ink).padding(.horizontal, 12).frame(minHeight: 44)
      .background(HermiPalette.paper, in: PixelPanel(corner: 6))
    }
  }

  private func icon(_ name: String, active: Bool = false) -> some View {
    PixelIcon(name: name).frame(width: 22, height: 24).frame(width: 44, height: 44)
      .foregroundStyle(HermiPalette.ink)
      .background(active ? HermiPalette.lime : HermiPalette.paper, in: PixelPanel(corner: 6))
  }
}

/// Muted looping clip that plays only while its page is on screen. The Mac preview shows the poster.
struct FeedVideo: View {
  let url: URL?
  let poster: URL?
  let playing: Bool
  var body: some View {
    #if os(iOS)
    if let url {
      LoopingVideoView(url: url, playing: playing)
    } else {
      RemoteMediaTile(item: RemoteMediaItem(id: "poster", isVideo: true, url: nil, posterURL: poster))
    }
    #else
    RemoteMediaTile(item: RemoteMediaItem(id: "poster", isVideo: true, url: url, posterURL: poster))
    #endif
  }
}

#if os(iOS)
struct LoopingVideoView: UIViewRepresentable {
  let url: URL
  let playing: Bool
  func makeUIView(context: Context) -> LoopingPlayerView {
    let view = LoopingPlayerView()
    view.load(url)
    return view
  }
  func updateUIView(_ view: LoopingPlayerView, context: Context) {
    if playing { view.player.play() } else { view.player.pause() }
  }
  static func dismantleUIView(_ view: LoopingPlayerView, coordinator: ()) {
    view.player.pause()
    view.player.removeAllItems()
  }
}

final class LoopingPlayerView: UIView {
  override static var layerClass: AnyClass { AVPlayerLayer.self }
  let player = AVQueuePlayer()
  private var looper: AVPlayerLooper?
  func load(_ url: URL) {
    player.isMuted = true
    looper = AVPlayerLooper(player: player, templateItem: AVPlayerItem(url: url))
    if let layer = layer as? AVPlayerLayer {
      layer.player = player
      layer.videoGravity = .resizeAspectFill
    }
    backgroundColor = .black
  }
}
#endif
