import SwiftUI

struct FeedPager: View {
  @Binding var state: MapPreviewState
  let size: CGSize
  var onMoving: () -> Void
  var onStopped: () -> Void
  @State private var current: String?
  @State private var notice: String?
  private var visibleIDs: [String] {
    state.feedOptions.content == .posts ? state.feedPosts.map(\.id) : state.feedPlans.map(\.id)
  }
  var body: some View {
    ScrollView(.vertical) {
      LazyVStack(spacing: 0) {
        if state.feedOptions.content == .posts {
          ForEach(Array(state.feedPosts.enumerated()), id: \.element.id) { index, post in
            if let place = MapSamplePlace.find(post.placeID) {
              postPage(post, place: place, index: index).frame(width: size.width, height: size.height).id(post.id)
            }
          }
        } else {
          ForEach(state.feedPlans) { plan in
            planPage(plan).frame(width: size.width, height: size.height).id(plan.id)
          }
        }
        VStack(spacing: 20) {
          HermitBrandMark().frame(width: 60, height: 68)
          Text(visibleIDs.isEmpty ? "Nothing here yet" : "You’re caught up").font(.title2.bold())
          Text(visibleIDs.isEmpty ? "No samples match these filters." : "End of sample feed").font(.caption)
          Button("My Plan") { state.sheet = .plan }
            .padding(14).background(HermiPalette.lime, in: PixelPanel(corner: 6))
          Button("Browse Saved") { state.sheet = .saved }.font(.subheadline)
        }.frame(width: size.width, height: size.height).background(HermiPalette.paper).id("end")
      }.scrollTargetLayout()
    }.scrollTargetBehavior(.paging).scrollPosition(id: $current).scrollIndicators(.hidden)
      .overlay(alignment: .topLeading) {
        Text("\(state.feedOptions.audience.rawValue) · \(state.feedOptions.content == .plans ? "Plans" : "Posts")")
          .font(.caption.bold()).padding(10).background(HermiPalette.paper, in: PixelPanel(corner: 5))
          .padding(.top, 105).padding(.leading, 20).allowsHitTesting(false)
      }
      .simultaneousGesture(DragGesture(minimumDistance: 20)
        .onChanged { _ in onMoving() }.onEnded { _ in onStopped() })
      .onChange(of: current) { _, _ in onStopped(); notice = nil }
      .onChange(of: visibleIDs) { _, ids in current = ids.first ?? "end"; notice = nil }
      .onDisappear { onStopped() }
  }
  private func postPage(_ post: PlaceFeedPost, place: MapSamplePlace, index: Int) -> some View {
    ZStack {
      mediaBackground(index: index)
      VStack(alignment: .leading, spacing: 12) {
        Spacer()
        HStack(alignment: .bottom) {
          VStack(alignment: .leading, spacing: 6) {
            Text(post.author).font(.subheadline.bold())
            Text(post.caption).font(.title3.weight(.medium))
          }
          Spacer()
          VStack(spacing: 10) {
            Button { state.togglePostBookmark(post.id) } label: {
              icon(state.library.posts.contains(where: { $0.refID == post.id }) ? "saved" : "save")
            }.accessibilityLabel("Toggle saved post by \(post.author)")
              .controlHelp("Bookmark this post without changing your plan")
            Button { state.togglePlan(place.id) } label: {
              icon(state.planIDs.contains(place.id) ? "check" : "plus", active: state.planIDs.contains(place.id))
            }.accessibilityLabel(state.planIDs.contains(place.id) ? "Remove from plan" : "Add to plan")
              .controlHelp("Toggle this place in My Plan without changing Saved")
          }
        }
        placeStrip(place)
        Text("SAMPLE POST · MEDIA PLACEHOLDER · SWIPE UP").font(.system(size: 9, design: .monospaced))
      }.foregroundStyle(.white).padding(.horizontal, 24).padding(.bottom, 115)
    }.buttonStyle(.plain).clipped()
  }
  private func planPage(_ plan: FeedPlanSample) -> some View {
    ZStack {
      HermiPalette.lake.ignoresSafeArea()
      ParkPlacement().opacity(0.55).frame(width: size.width, height: size.height).clipped()
      SamplePlanRoute(stops: plan.stops).frame(height: size.height * 0.45).padding(.horizontal, 40).offset(y: -50)
      LinearGradient(colors: [.clear, .black.opacity(0.75)], startPoint: .center, endPoint: .bottom)
      VStack(alignment: .leading, spacing: 12) {
        Spacer()
        HStack(alignment: .bottom) {
          VStack(alignment: .leading, spacing: 6) {
            Text(plan.author).font(.subheadline.bold())
            Text(plan.name).font(.title2.bold())
          }
          Spacer()
          VStack(spacing: 10) {
            Button { state.toggleFeedPlanBookmark(plan) } label: {
              icon(state.bookmarkedFeedPlan(plan) ? "saved" : "save")
            }.accessibilityLabel("Toggle saved plan \(plan.name)")
              .controlHelp("Bookmark a private local copy without adding its stops")
            Button {
              let count = state.appendFeedPlan(plan)
              notice = count == 0 ? "All stops already in your plan" : "Added \(count) stops to your plan"
            } label: { icon("plus") }
              .accessibilityLabel("Append \(plan.name) to My Plan")
              .controlHelp("Append missing places in order; leave existing stops unchanged")
          }
        }
        ScrollView(.horizontal) {
          HStack(spacing: 8) {
            ForEach(plan.stops, id: \.self) { id in
              if let place = MapSamplePlace.find(id) { placeStrip(place).fixedSize(horizontal: true, vertical: false) }
            }
          }
        }.scrollIndicators(.hidden)
        if let notice { Text(notice).font(.caption) }
        Text("SAMPLE PLAN · ILLUSTRATED ROUTE · SWIPE UP").font(.system(size: 9, design: .monospaced))
      }.foregroundStyle(.white).padding(.horizontal, 24).padding(.bottom, 115)
    }.buttonStyle(.plain).clipped()
  }
  private func mediaBackground(index: Int) -> some View {
    ZStack {
      ParkPlacement().frame(width: max(size.width, size.height * 4/3), height: max(size.height, size.width * 3/4))
        .hueRotation(.degrees(Double(index)*25)).frame(width: size.width, height: size.height).clipped()
      LinearGradient(colors: [.clear, .black.opacity(0.7)], startPoint: .center, endPoint: .bottom)
    }
  }
  private func placeStrip(_ place: MapSamplePlace) -> some View {
    Button { state.selectPlace(place.id) } label: {
      HStack { BallpointPin(category: place.category).frame(width: 16, height: 22); Text(place.name); Spacer(minLength: 0) }
        .font(.subheadline).foregroundStyle(HermiPalette.ink).padding(.horizontal, 12).frame(minHeight: 44)
        .background(HermiPalette.paper, in: PixelPanel(corner: 6))
    }.controlHelp("Open \(place.name): media, description and reviews")
  }
  private func icon(_ name: String, active: Bool = false) -> some View {
    PixelIcon(name: name).frame(width: 22, height: 24).frame(width: 44, height: 44)
      .foregroundStyle(HermiPalette.ink)
      .background(active ? HermiPalette.lime : HermiPalette.paper, in: PixelPanel(corner: 6))
  }
}

private struct SamplePlanRoute: View {
  let stops: [String]
  var body: some View {
    GeometryReader { geometry in
      let places = stops.compactMap(MapSamplePlace.find)
      let points = places.enumerated().map { index, _ in
        CGPoint(x: geometry.size.width * (index.isMultiple(of: 2) ? 0.2 : 0.8),
                y: geometry.size.height * CGFloat(index + 1) / CGFloat(places.count + 1))
      }
      ZStack {
        Path { path in
          guard let first = points.first else { return }
          path.move(to: first)
          for point in points.dropFirst() {
            let current = path.currentPoint ?? first
            path.addLine(to: CGPoint(x: current.x, y: point.y)); path.addLine(to: point)
          }
        }.stroke(HermiPalette.paper, style: StrokeStyle(lineWidth: 8, lineCap: .square))
        ForEach(Array(places.enumerated()), id: \.element.id) { index, place in
          PixelPanel(corner: 5).fill(HermiPalette.category(place.category))
            .frame(width: 32, height: 32).overlay(Text("\(index+1)").font(.caption.bold()))
            .position(points[index])
        }
      }.accessibilityLabel("Illustrated sample itinerary, \(stops.count) stops")
    }
  }
}
