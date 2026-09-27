import SwiftUI

/// Saved as a grid of boxes: folders, posts, plans and places, each with a thumbnail. Posts and plans open
/// full screen (X top-left); a folder opens the same grid of its items with a back button. Add to plan,
/// move to folder and remove are in each box's press-and-hold menu.
struct SavedGrid: View {
  @Binding var state: MapPreviewState
  var feedback: String?
  var append: (SavedReference) -> Void
  var openPlan: (String) -> Void
  @State private var folderID: UUID?
  @State private var viewing: SavedReference?
  @State private var openPlace: SavedReference?
  @State private var creatingFolder = false
  @State private var folderName = ""
  private let columns = [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)]

  private var folder: SavedFolder? { state.library.folders.first { $0.id == folderID } }
  private var items: [SavedReference] {
    let valid = Set(state.savedReferences)
    if let folder { return folder.items.filter { valid.contains($0) || $0.kind == .plan && state.library.plan($0.refID) != nil } }
    let foldered = Set(state.library.folders.flatMap(\.items))
    return state.savedReferences.filter { !foldered.contains($0) }
  }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 14) {
        HStack {
          if let folder {
            Button { folderID = nil } label: {
              HStack(spacing: 6) { PixelIcon(name: "back").frame(width: 16, height: 12); Text("Saved") }
                .font(.subheadline.bold()).frame(minHeight: 44)
            }.accessibilityLabel("Back to all saved")
            Spacer()
            Text("\(folder.name) · \(folder.items.count)").font(.headline).lineLimit(1)
          } else {
            Text("\(state.savedReferences.count) saved").font(.caption).foregroundStyle(HermiPalette.secondary)
            Spacer()
            Button { folderName = ""; creatingFolder = true } label: {
              HStack(spacing: 6) { PixelIcon(name: "plus").frame(width: 12, height: 12); Text("New folder") }
                .font(.caption.bold()).padding(.horizontal, 10).frame(minHeight: 36)
                .background(HermiPalette.lime, in: PixelPanel(corner: 5))
            }
          }
        }
        if let feedback { Text(feedback).font(.caption).foregroundStyle(HermiPalette.green) }
        LazyVGrid(columns: columns, spacing: 14) {
          if folder == nil {
            ForEach(state.library.folders) { folder in
              Button { folderID = folder.id } label: { folderTile(folder) }.buttonStyle(.plain)
            }
          }
          ForEach(items) { reference in
            Button { open(reference) } label: { tile(reference) }.buttonStyle(.plain)
              .contextMenu { menu(reference) }
          }
        }
        if items.isEmpty && (folder != nil || state.library.folders.isEmpty) {
          VStack(spacing: 12) {
            HermitBrandMark().frame(width: 56, height: 63)
            Text(folder == nil ? "Nothing saved yet. Bookmark places, posts or plans." : "This folder is empty. Hold any saved item to move it here.")
              .font(.subheadline).multilineTextAlignment(.center)
          }.frame(maxWidth: .infinity).padding(20)
        }
      }.padding(20)
    }
    .coverScreen(item: $viewing) { reference in
      SavedViewer(state: $state, reference: reference, close: { viewing = nil },
                  openPlan: { id in viewing = nil; openPlan(id) }, append: append)
    }
    .sheet(item: $openPlace) { reference in
      PlaceSheet(state: $state, placeID: reference.refID) { openPlace = nil }
    }
    .alert("New folder", isPresented: $creatingFolder) {
      TextField("Folder name", text: $folderName)
      Button("Create") {
        let name = folderName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, name.count <= 40,
              !state.library.folders.contains(where: { $0.name.localizedCaseInsensitiveCompare(name) == .orderedSame }) else { return }
        var library = state.library
        library.folders.append(SavedFolder(name: name))
        state.library = library
      }
      Button("Cancel", role: .cancel) {}
    }
  }

  private func open(_ reference: SavedReference) {
    switch reference.kind {
    case .place: openPlace = reference
    case .post, .plan: viewing = reference
    }
  }

  // MARK: Tiles

  private func tile(_ reference: SavedReference) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      SavedThumbnail(state: state, reference: reference)
        .aspectRatio(1, contentMode: .fit).clipShape(PixelPanel(corner: 8))
        .overlay(alignment: .topLeading) { badge(reference.kind.rawValue.uppercased()) }
      Text(state.savedTitle(reference)).font(.caption.weight(.semibold)).lineLimit(2)
    }
  }

  private func folderTile(_ folder: SavedFolder) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      let previews = Array(folder.items.prefix(4))
      LazyVGrid(columns: [GridItem(.flexible(), spacing: 3), GridItem(.flexible(), spacing: 3)], spacing: 3) {
        ForEach(0..<4, id: \.self) { index in
          Group {
            if index < previews.count { SavedThumbnail(state: state, reference: previews[index]) }
            else { HermiPalette.line.opacity(0.5) }
          }.aspectRatio(1, contentMode: .fit).clipped()
        }
      }
      .padding(4).background(HermiPalette.controlSurface, in: PixelPanel(corner: 8))
      .overlay(PixelPanel(corner: 8).stroke(HermiPalette.ink, lineWidth: 2))
      .overlay(alignment: .topLeading) { badge("FOLDER") }
      Text("\(folder.name) · \(folder.items.count)").font(.caption.weight(.semibold)).lineLimit(1)
    }.accessibilityLabel("Folder \(folder.name), \(folder.items.count) items")
  }

  private func badge(_ text: String) -> some View {
    Text(text).font(.system(size: 9, weight: .bold, design: .monospaced))
      .padding(.horizontal, 5).padding(.vertical, 3)
      .background(HermiPalette.controlSurface.opacity(0.9), in: PixelPanel(corner: 3)).padding(6)
  }

  @ViewBuilder
  private func menu(_ reference: SavedReference) -> some View {
    Button("Add to My Plan") { append(reference) }
    if !state.library.folders.isEmpty {
      Menu("Move to folder") {
        ForEach(state.library.folders) { destination in
          Button(destination.name) {
            var library = state.library
            if library.put(reference, in: destination.id) { state.library = library }
          }
        }
      }
    }
    if let folderID {
      Button("Remove from folder") {
        var library = state.library
        if let index = library.folders.firstIndex(where: { $0.id == folderID }) {
          library.folders[index].items.removeAll { $0 == reference }
          state.library = library
        }
      }
    }
    Button("Remove from Saved", role: .destructive) { state.unsave(reference) }
  }
}

/// Thumbnail for a saved item: first photo or clip poster, a route sketch for plans, a category tile for places.
struct SavedThumbnail: View {
  let state: MapPreviewState
  let reference: SavedReference
  var body: some View {
    switch reference.kind {
    case .post:
      if let post = PlaceFeedPost.find(reference.refID) {
        if let item = post.media.first {
          CachedImage(url: item.isVideo ? item.posterURL : item.url)
            .overlay(alignment: .bottomTrailing) {
              if item.isVideo || post.media.count > 1 {
                Text(item.isVideo ? "▶" : "1/\(post.media.count)").font(.caption2.bold()).foregroundStyle(HermiPalette.ink)
                  .padding(4).background(HermiPalette.controlSurface, in: PixelPanel(corner: 3)).padding(6)
              }
            }
        } else if post.isLive {
          ZStack { HermiPalette.lavender; Text(post.caption).font(.caption).lineLimit(5).padding(10).foregroundStyle(HermiPalette.ink) }
        } else {
          ParkPlacement()
        }
      } else {
        HermiPalette.line
      }
    case .plan:
      PlanRouteSketch(places: (state.library.plan(reference.refID)?.stopIDs ?? []).compactMap(MapSamplePlace.find))
    case .place:
      let place = MapSamplePlace.find(reference.refID)
      ZStack {
        HermiPalette.category(place?.category ?? .culture).opacity(0.55)
        BallpointPin(category: place?.category ?? .culture).frame(width: 30, height: 38)
      }
    }
  }
}

/// A plan's stops as numbered squares joined by a line, scaled into the box.
struct PlanRouteSketch: View {
  let places: [MapSamplePlace]
  var body: some View {
    GeometryReader { geometry in
      let points = project(in: geometry.size)
      ZStack {
        HermiPalette.paper
        Path { path in
          guard let first = points.first else { return }
          path.move(to: first)
          for point in points.dropFirst() { path.addLine(to: point) }
        }.stroke(HermiPalette.green, style: StrokeStyle(lineWidth: 3, lineCap: .square, dash: [6, 4]))
        ForEach(Array(places.enumerated()), id: \.element.id) { index, place in
          Text("\(index + 1)").font(.caption2.bold()).foregroundStyle(HermiPalette.ink)
            .frame(width: 20, height: 20)
            .background(HermiPalette.category(place.category), in: PixelPanel(corner: 3))
            .position(points[index])
        }
      }
    }.accessibilityLabel("Route with \(places.count) stops")
  }

  private func project(in size: CGSize) -> [CGPoint] {
    guard !places.isEmpty else { return [] }
    let lats = places.map(\.latitude), lngs = places.map(\.longitude)
    let minLat = lats.min()!, maxLat = lats.max()!, minLng = lngs.min()!, maxLng = lngs.max()!
    let inset: CGFloat = 22
    let width = max(1, size.width - inset * 2), height = max(1, size.height - inset * 2)
    return places.map { place in
      let x = maxLng > minLng ? (place.longitude - minLng) / (maxLng - minLng) : 0.5
      let y = maxLat > minLat ? (maxLat - place.latitude) / (maxLat - minLat) : 0.5
      return CGPoint(x: inset + CGFloat(x) * width, y: inset + CGFloat(y) * height)
    }
  }
}

/// Full-screen saved post (horizontal parts) or plan (route map, stops, open/add). X is top-left.
struct SavedViewer: View {
  @Binding var state: MapPreviewState
  let reference: SavedReference
  var close: () -> Void
  var openPlan: (String) -> Void
  var append: (SavedReference) -> Void
  @State private var openPlace: SavedReference?

  var body: some View {
    ZStack(alignment: .topLeading) {
      HermiPalette.ink.ignoresSafeArea()
      content.ignoresSafeArea()
      CloseButton(action: close).padding(.leading, 12).padding(.top, 4)
    }
    .sheet(item: $openPlace) { reference in
      PlaceSheet(state: $state, placeID: reference.refID) { openPlace = nil }
    }
  }

  @ViewBuilder
  private var content: some View {
    switch reference.kind {
    case .post:
      if let post = PlaceFeedPost.find(reference.refID) {
        let place = MapSamplePlace.find(post.placeID)
        ZStack(alignment: .bottomLeading) {
          MediaSlidesView(slides: FeedSlide.build(media: post.media, text: post.isLive ? post.caption : nil, hasRoute: false))
          LinearGradient(colors: [.clear, .black.opacity(0.7)], startPoint: .center, endPoint: .bottom).allowsHitTesting(false)
          VStack(alignment: .leading, spacing: 8) {
            Text(post.author).font(.subheadline.bold())
            if !post.caption.isEmpty { Text(post.caption).font(.title3.weight(.medium)).lineLimit(3) }
            if let place {
              Button { openPlace = SavedReference(kind: .place, refID: place.id) } label: {
                HStack { BallpointPin(category: place.category).frame(width: 16, height: 22); Text(place.name) }
                  .font(.subheadline).foregroundStyle(HermiPalette.ink).padding(.horizontal, 12).frame(minHeight: 44)
                  .background(HermiPalette.controlSurface, in: PixelPanel(corner: 6))
              }.buttonStyle(.plain)
            }
          }.foregroundStyle(.white).padding(24).padding(.bottom, 20)
        }
      } else {
        Text("This post isn’t available.").foregroundStyle(HermiPalette.paper).frame(maxWidth: .infinity, maxHeight: .infinity)
      }
    case .plan:
      if let plan = state.library.plan(reference.refID) {
        let places = plan.stopIDs.compactMap(MapSamplePlace.find)
        ZStack(alignment: .bottom) {
          GeographicMap(state: MapPreviewState(), showsPlaces: false,
                        routeLine: places.map(\.coordinate), routeStops: places)
          VStack(alignment: .leading, spacing: 10) {
            Text(plan.name).font(.title2.bold())
            ForEach(Array(places.enumerated()), id: \.element.id) { index, place in
              HStack { Text("\(index + 1)").font(.caption.bold()).frame(width: 20); Text(place.name).font(.subheadline) }
            }
            HStack(spacing: 10) {
              Button("Open in My Plan") { openPlan(reference.refID) }
                .font(.subheadline.bold()).frame(maxWidth: .infinity, minHeight: 48)
                .background(HermiPalette.lime, in: PixelPanel(corner: 6))
              Button("Add stops") { append(reference) }
                .font(.subheadline).frame(maxWidth: .infinity, minHeight: 48)
                .background(.white, in: PixelPanel(corner: 6))
            }.buttonStyle(.plain)
          }
          .foregroundStyle(HermiPalette.ink).padding(20)
          .background(HermiPalette.controlSurface, in: PixelPanel(corner: 12)).padding(16).padding(.bottom, 12)
        }
      }
    case .place:
      EmptyView()
    }
  }
}

extension MapPreviewState {
  func savedTitle(_ reference: SavedReference) -> String {
    switch reference.kind {
    case .place: return MapSamplePlace.find(reference.refID)?.name ?? "Unavailable place"
    case .post:
      guard let post = PlaceFeedPost.find(reference.refID) else { return "Unavailable post" }
      return "\(post.author) · \(MapSamplePlace.find(post.placeID)?.name ?? "Post")"
    case .plan: return library.plan(reference.refID)?.name ?? "Unavailable plan"
    }
  }

  /// Remove from Saved (and every folder). Saved plans are unbookmarked, keeping their editing data.
  mutating func unsave(_ reference: SavedReference) {
    switch reference.kind {
    case .place: if savedIDs.contains(reference.refID) { toggleSave(reference.refID) }
    case .post: if library.posts.contains(reference) { togglePostBookmark(reference.refID) }
    case .plan:
      var library = library
      guard let index = library.plans.firstIndex(where: { $0.id.uuidString == reference.refID }) else { return }
      library.plans[index].isBookmarked = false
      library.plans[index].folderID = nil
      for folder in library.folders.indices { library.folders[folder].items.removeAll { $0 == reference } }
      self.library = library
    }
  }
}
