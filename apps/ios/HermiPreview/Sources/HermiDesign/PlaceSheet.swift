import SwiftUI

/// The one close control for sheets and full-screen views: a pixel X, always top-left.
struct CloseButton: View {
  var label = "Close"
  var action: () -> Void
  var body: some View {
    Button(action: action) {
      PixelIcon(name: "close").frame(width: 16, height: 16).frame(width: 36, height: 36)
        .background(HermiPalette.paper, in: PixelPanel(corner: 7))
        .frame(width: 44, height: 44).contentShape(Rectangle())
    }.buttonStyle(.plain).accessibilityLabel(label)
  }
}

/// A place opened on top of wherever you are (Saved, My Plan, a post), instead of navigating away.
struct PlaceSheet: View {
  @Binding var state: MapPreviewState
  let placeID: String
  var close: () -> Void
  @State private var viewingPost: SavedReference?

  var body: some View {
    let place = MapSamplePlace.find(placeID)
    VStack(alignment: .leading, spacing: 10) {
      HStack(spacing: 6) {
        CloseButton(label: "Close place", action: close)
        Text(place?.name ?? "Place unavailable").font(.headline).lineLimit(1)
        Spacer(minLength: 4)
        if let place {
          Button { state.toggleSave(place.id) } label: {
            PixelIcon(name: state.savedIDs.contains(place.id) ? "saved" : "save").frame(width: 20, height: 24).frame(width: 44, height: 44)
          }.buttonStyle(.plain).accessibilityLabel(state.savedIDs.contains(place.id) ? "Unsave place" : "Save place")
          Button { state.togglePlan(place.id) } label: {
            PixelIcon(name: state.planIDs.contains(place.id) ? "minus" : "plus").frame(width: 20, height: 20).frame(width: 32, height: 32)
              .background(HermiPalette.lime, in: PixelPanel(corner: 6)).frame(width: 44, height: 44)
          }.buttonStyle(.plain).accessibilityLabel(state.planIDs.contains(place.id) ? "Remove from plan" : "Add to plan")
        }
      }
      ScrollView {
        if let place {
          PlaceFeedContent(place: place, savedPostIDs: Set(state.library.posts.map(\.refID)),
                           togglePostSave: { state.togglePostBookmark($0) },
                           openPost: { viewingPost = SavedReference(kind: .post, refID: $0) })
            .id(place.id)
        }
      }.scrollIndicators(.hidden)
    }
    .padding(.horizontal, 16).padding(.top, 12)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    .background(HermiPalette.paper).foregroundStyle(HermiPalette.ink)
    .presentationDetents([.medium, .large])
    .coverScreen(item: $viewingPost) { reference in
      SavedViewer(state: $state, reference: reference, close: { viewingPost = nil }, openPlan: { _ in viewingPost = nil }, append: { _ = state.appendSaved($0) })
    }
  }
}
