import SwiftUI

struct FeedPager: View {
  @Binding var state: MapPreviewState
  let size: CGSize
  var friendsOnly: Bool
  var onMoving: () -> Void
  var onStopped: () -> Void
  @State private var current: String?
  private var items: [MapSamplePlace] {
    Array(MapSamplePlace.all.prefix(friendsOnly ? 2 : 4))
  }
  var body: some View {
    ScrollView(.vertical) {
      LazyVStack(spacing: 0) {
        ForEach(Array(items.enumerated()), id: \.element.id) { index, place in
          page(place, index: index).frame(width: size.width, height: size.height).id(place.id)
        }
        VStack(spacing: 20) {
          PixelIcon(name: "check").frame(width: 35, height: 35)
          Text("You’re caught up").font(.title2.bold())
          Button("Plan from Saved") { state.sheet = .saved }
            .buttonStyle(.borderedProminent).tint(HermiPalette.green)
            .controlHelp("Open your saved places to plan an outing")
          Text("End of sample feed").font(.caption)
        }.frame(width: size.width, height: size.height).background(HermiPalette.paper).id("end")
      }.scrollTargetLayout()
    }.scrollTargetBehavior(.paging).scrollPosition(id: $current).scrollIndicators(.hidden)
      .simultaneousGesture(DragGesture(minimumDistance: 20)
        .onChanged { _ in onMoving() }.onEnded { _ in onStopped() })
      .onChange(of: current) { _, _ in onStopped() }
      .onChange(of: friendsOnly) { _, _ in current = items.first?.id }
      .onDisappear { onStopped() }
  }
  private func page(_ place: MapSamplePlace, index: Int) -> some View {
    ZStack {
      ParkPlacement()
        .frame(width: max(size.width, size.height * 4/3), height: max(size.height, size.width * 3/4))
        .hueRotation(.degrees(Double(index)*25))
        .frame(width: size.width, height: size.height).clipped()
      LinearGradient(colors: [.clear, .black.opacity(0.7)], startPoint: .center, endPoint: .bottom)
      VStack(alignment: .leading, spacing: 12) {
        Spacer()
        HStack(alignment: .bottom) {
          VStack(alignment: .leading, spacing: 6) {
            Text(index % 2 == 0 ? "@alex" : "@sam").font(.subheadline.bold())
            Text(["A little detour.", "Meet me around the corner.", "Something new today.", "One more stop."][index]).font(.title3.weight(.medium))
          }
          Spacer()
          VStack(spacing: 10) {
            Button { state.toggleSave(place.id) } label: {
              icon(state.savedIDs.contains(place.id) ? "saved" : "save")
            }.buttonStyle(.plain)
              .accessibilityLabel(state.savedIDs.contains(place.id) ? "Remove from Saved" : "Save for later")
              .controlHelp(state.savedIDs.contains(place.id) ? "Remove this place from Saved; keep its plan stop" : "Save this place for later without adding it to your plan")
            Button { state.togglePlan(place.id) } label: {
              icon(state.planIDs.contains(place.id) ? "check" : "plus", active: state.planIDs.contains(place.id))
            }.buttonStyle(.plain)
              .accessibilityLabel(state.planIDs.contains(place.id) ? "Remove from plan" : "Add to plan")
              .controlHelp(state.planIDs.contains(place.id) ? "Remove this place from My Plan; keep its bookmark" : "Add this place to My Plan. Tap again to remove it")
          }
        }
        Button { state.selectPlace(place.id) } label: {
          HStack { BallpointPin(category: place.category).frame(width: 16, height: 22); Text(place.name); Spacer() }
            .font(.subheadline).foregroundStyle(HermiPalette.ink).padding(.horizontal, 12).frame(minHeight: 44)
            .background(HermiPalette.paper, in: PixelPanel(corner: 6))
        }.buttonStyle(.plain).controlHelp("Open \(place.name): media, description and reviews")
        Text("SAMPLE \(index+1)/\(items.count) · SWIPE UP").font(.system(size: 9, design: .monospaced))
      }.foregroundStyle(.white).padding(.horizontal, 24).padding(.bottom, 115)
    }.clipped()
  }
  private func icon(_ name: String, active: Bool = false) -> some View {
    PixelIcon(name: name).frame(width: 22, height: 24).frame(width: 44, height: 44)
      .background(active ? HermiPalette.lime : HermiPalette.paper, in: PixelPanel(corner: 6))
  }
}
