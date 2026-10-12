import SwiftUI

/// The one close control for sheets and full-screen views: a pixel X, always top-left.
struct CloseButton: View {
  var label = "Close"
  var action: () -> Void
  var body: some View {
    Button(action: action) {
      PixelIcon(name: "close").frame(width: 16, height: 16).frame(width: 36, height: 36)
        .background(HermiPalette.controlSurface, in: PixelPanel(corner: 7))
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
    VStack(alignment: .leading, spacing: HermiSpacing.medium) {
      if let place {
        PlaceDetailHeader(
          place: place,
          isSaved: state.savedIDs.contains(place.id),
          isPlanned: state.planIDs.contains(place.id),
          close: close,
          toggleSave: { state.toggleSave(place.id) },
          togglePlan: { state.togglePlan(place.id) }
        )
      } else {
        HStack(alignment: .top, spacing: HermiSpacing.small) {
          CloseButton(label: "Close place", action: close)
          Text("Place unavailable").font(HermiTypography.title).fixedSize(horizontal: false, vertical: true)
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

/// Shared place identity and actions keep Map, Plan and Saved details consistent.
struct PlaceDetailHeader: View {
  let place: MapSamplePlace
  let isSaved: Bool
  let isPlanned: Bool
  var close: (() -> Void)? = nil
  let toggleSave: () -> Void
  let togglePlan: () -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: HermiSpacing.medium) {
      HStack(alignment: .top, spacing: HermiSpacing.small) {
        if let close { CloseButton(label: "Close place", action: close) }
        VStack(alignment: .leading, spacing: HermiSpacing.tight) {
          Text(place.name)
            .font(HermiTypography.title)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityAddTraits(.isHeader)
          Text(place.category.rawValue)
            .font(HermiTypography.metadata)
            .foregroundStyle(HermiPalette.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
      }

      HStack(spacing: HermiSpacing.small) {
        Button(action: toggleSave) {
          Label {
            Text(isSaved ? "Saved" : "Save")
          } icon: {
            PixelIcon(name: isSaved ? "saved" : "save").frame(width: 17, height: 20)
          }
          .font(HermiTypography.label)
          .frame(maxWidth: .infinity, minHeight: 44)
          .foregroundStyle(HermiPalette.ink)
          .background(HermiPalette.controlSurface, in: PixelPanel(corner: 6))
          .overlay(PixelPanel(corner: 6).stroke(HermiPalette.line, lineWidth: 1))
          .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(isSaved ? "Unsave \(place.name)" : "Save \(place.name)")
        .accessibilityValue(isSaved ? "Saved" : "Not saved")
        .controlHelp("Save this place independently of My Plan")

        Button(action: togglePlan) {
          Label {
            Text(isPlanned ? "In My Plan" : "Add to Plan")
          } icon: {
            PixelIcon(name: isPlanned ? "check" : "plus").frame(width: 17, height: 17)
          }
          .font(HermiTypography.label)
          .frame(maxWidth: .infinity, minHeight: 44)
          .foregroundStyle(HermiPalette.ink)
          .background(HermiPalette.lime, in: PixelPanel(corner: 6))
          .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(isPlanned ? "Remove \(place.name) from My Plan" : "Add \(place.name) to My Plan")
        .accessibilityValue(isPlanned ? "In My Plan" : "Not in My Plan")
        .controlHelp("Add this explicit place to My Plan. This does not save it.")
      }
    }
  }
}
