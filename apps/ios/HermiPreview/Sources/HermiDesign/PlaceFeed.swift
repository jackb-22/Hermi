import SwiftUI

/// Explicit place scope: this fixture never includes another location's posts.
struct PlaceFeedPost: Identifiable, Equatable {
  let id: String
  let placeID: String
  let author: String
  let caption: String
  let mediaCount: Int
  static func find(_ id: String) -> Self? {
    MapSamplePlace.fixtures.lazy.flatMap { samples(for: $0.id) }.first { $0.id == id }
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

/// Participates in the panel's vertical scroll; each post owns only horizontal media.
struct PlaceFeedContent: View {
  let place: MapSamplePlace
  var savedPostIDs: Set<String> = []
  var togglePostSave: ((String) -> Void)?
  var body: some View {
    LazyVStack(alignment: .leading, spacing: 22) {
      ForEach(PlaceFeedPost.samples(for: place.id)) { post in
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
          ScrollView(.horizontal) {
            HStack(spacing: 8) {
              ForEach(0..<post.mediaCount, id: \.self) { index in
                ZStack(alignment: .bottomLeading) {
                  ParkPlacement().frame(width: 260, height: 220).clipped()
                  if index == 2 {
                    PixelIcon(name: "play").frame(width: 24, height: 24).padding(12)
                      .background(HermiPalette.paper, in: PixelPanel(corner: 6)).padding(12)
                  }
                }
                .hueRotation(.degrees(Double(index) * 12))
                .clipShape(PixelPanel(corner: 6))
                .accessibilityLabel("\(index == 2 ? "Video" : "Photo") placeholder \(index + 1) of \(post.mediaCount) at \(place.name)")
              }
            }
          }.scrollIndicators(.hidden)
          Text(post.caption).font(.subheadline)
        }.accessibilityElement(children: .contain)
      }
      Text(place.isLive ? "No posts here yet." : "End of sample posts · reviews not connected")
        .font(.caption).foregroundStyle(HermiPalette.secondary)
    }
  }
}
