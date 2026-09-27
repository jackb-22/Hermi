import SwiftUI
#if os(iOS)
import UIKit
typealias PlatformImage = UIImage
extension Image { init(platform: PlatformImage) { self.init(uiImage: platform) } }
#else
import AppKit
typealias PlatformImage = NSImage
extension Image { init(platform: PlatformImage) { self.init(nsImage: platform) } }
#endif

/// In-memory image cache so pages re-created by lazy stacks show instantly instead of reloading.
enum ImageMemoryCache {
  static let shared: NSCache<NSURL, PlatformImage> = {
    let cache = NSCache<NSURL, PlatformImage>()
    cache.countLimit = 300
    return cache
  }()
}

/// Remote image with a cache and a plain dark placeholder (never the pixel park art, which flashed while scrolling).
struct CachedImage: View {
  let url: URL?
  var contentMode: ContentMode = .fill
  @State private var image: PlatformImage?
  @State private var failed = false

  init(url: URL?, contentMode: ContentMode = .fill) {
    self.url = url
    self.contentMode = contentMode
    _image = State(initialValue: url.flatMap { ImageMemoryCache.shared.object(forKey: $0 as NSURL) })
  }

  var body: some View {
    ZStack {
      if let image {
        Image(platform: image).resizable().aspectRatio(contentMode: contentMode)
      } else {
        HermiPalette.ink.opacity(0.9)
        if failed || url == nil {
          PixelIcon(name: "photo").frame(width: 24, height: 24).opacity(0.4)
        } else {
          ProgressView().tint(HermiPalette.paper)
        }
      }
    }
    .task(id: url) { await load() }
  }

  private func load() async {
    guard let url, image == nil else { return }
    if let cached = ImageMemoryCache.shared.object(forKey: url as NSURL) { image = cached; return }
    do {
      let (data, _) = try await URLSession.shared.data(from: url)
      if let loaded = PlatformImage(data: data) {
        ImageMemoryCache.shared.setObject(loaded, forKey: url as NSURL)
        image = loaded
      } else { failed = true }
    } catch { failed = true }
  }
}

/// One horizontal page of a post: a photo or clip, a page of text, or the plan's route on the map.
enum FeedSlide: Identifiable, Equatable {
  case media(RemoteMediaItem)
  case text(String)
  case route

  var id: String {
    switch self {
    case .media(let item): return "media:\(item.id)"
    case .text: return "text"
    case .route: return "route"
    }
  }

  /// Route first, then media, then a text page when the words don't fit a caption (or are the whole post).
  static func build(media: [RemoteMediaItem], text: String?, hasRoute: Bool) -> [FeedSlide] {
    var slides: [FeedSlide] = hasRoute ? [.route] : []
    slides += media.map { FeedSlide.media($0) }
    if let text, !text.isEmpty, text.count > 90 || slides.isEmpty { slides.append(.text(text)) }
    return slides
  }
}

/// Full-bleed slides; more than one pages horizontally with dots. Clips play only when `active` and on screen.
struct MediaSlidesView: View {
  let slides: [FeedSlide]
  var route: [GeoPoint] = []
  var routeStops: [MapSamplePlace] = []
  var active = true
  @State private var current: String?

  var body: some View {
    GeometryReader { geometry in
      if slides.count <= 1 {
        slide(slides.first, size: geometry.size)
      } else {
        ScrollView(.horizontal) {
          LazyHStack(spacing: 0) {
            ForEach(slides) { item in
              slide(item, size: geometry.size).frame(width: geometry.size.width, height: geometry.size.height).id(item.id)
            }
          }.scrollTargetLayout()
        }
        .scrollTargetBehavior(.paging).scrollPosition(id: $current).scrollIndicators(.hidden)
        .overlay(alignment: .top) { dots.padding(.top, 64) }
      }
    }
  }

  private var dots: some View {
    let selected = current ?? slides.first?.id
    return HStack(spacing: 6) {
      ForEach(slides) { item in
        Rectangle().fill(item.id == selected ? HermiPalette.paper : HermiPalette.paper.opacity(0.4)).frame(width: 7, height: 7)
      }
    }.padding(6).background(HermiPalette.ink.opacity(0.35), in: PixelPanel(corner: 4))
      .accessibilityLabel("\(slides.count) parts. Swipe sideways.")
  }

  @ViewBuilder
  private func slide(_ item: FeedSlide?, size: CGSize) -> some View {
    switch item {
    case .media(let media)?:
      if media.isVideo {
        FeedVideo(url: media.url, poster: media.posterURL, playing: active && (current ?? slides.first?.id) == item?.id)
          .frame(width: size.width, height: size.height).clipped()
      } else {
        CachedImage(url: media.url).frame(width: size.width, height: size.height).clipped()
      }
    case .text(let text)?:
      ZStack {
        HermiPalette.lavender
        Text(text).font(.title3.weight(.medium)).multilineTextAlignment(.leading)
          .minimumScaleFactor(0.6).foregroundStyle(HermiPalette.ink)
          .padding(.horizontal, 32).padding(.top, 110).padding(.bottom, 300)
      }.frame(width: size.width, height: size.height)
    case .route?:
      GeographicMap(state: MapPreviewState(), showsPlaces: false, routeLine: route, routeStops: routeStops)
        .frame(width: size.width, height: size.height).allowsHitTesting(false)
    case nil:
      HermiPalette.ink.frame(width: size.width, height: size.height)
    }
  }
}

/// Full-screen presentation: a cover on iPhone, a sheet on the Mac preview.
extension View {
  @ViewBuilder
  func coverScreen<Item: Identifiable, Content: View>(item: Binding<Item?>, @ViewBuilder content: @escaping (Item) -> Content) -> some View {
    #if os(iOS)
    fullScreenCover(item: item, content: content)
    #else
    sheet(item: item, content: content)
    #endif
  }
}
