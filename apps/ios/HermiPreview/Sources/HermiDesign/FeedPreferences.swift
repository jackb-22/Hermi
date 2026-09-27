import Foundation

enum FeedAudience: String, Codable, CaseIterable { case friends = "Friends", publicFeed = "Public" }
enum FeedContent: String, Codable { case posts, plans }
struct FeedPreferences: Codable, Equatable {
  var audience: FeedAudience = .publicFeed
  var content: FeedContent = .posts
}
struct FeedPlanSample: Identifiable {
  let id: String
  let name: String
  let author: String
  let audience: FeedAudience
  let stops: [String]
  static let all: [Self] = [
    .init(id: "alex-loop", name: "A slow Saturday", author: "@sam", audience: .friends, stops: ["cafe", "garden", "books"]),
    .init(id: "sam-evening", name: "After class", author: "@riley", audience: .friends, stops: ["gallery", "tea"]),
    .init(id: "lee-loop", name: "Small discoveries", author: "@lee", audience: .publicFeed, stops: ["books", "gallery", "music"]),
    .init(id: "river-day", name: "By the river", author: "@jules", audience: .publicFeed, stops: ["garden", "court"])
  ]
}
extension MapPreviewState {
  var feedOptions: FeedPreferences {
    get { storedFeedPreferences ?? FeedPreferences() }
    set { storedFeedPreferences = newValue }
  }
  var feedPosts: [PlaceFeedPost] {
    let author = feedOptions.audience == .friends ? "sam" : "lee"
    return nearby.compactMap { PlaceFeedPost.find("\($0.id)-\(author)") }
  }
  var feedPlans: [FeedPlanSample] {
    let matches = Set(nearby.map(\.id))
    return FeedPlanSample.all.filter { $0.audience == feedOptions.audience && $0.stops.contains(where: matches.contains) }
  }
  mutating func toggleFeedAudience() {
    feedOptions.audience = feedOptions.audience == .friends ? .publicFeed : .friends
  }
  mutating func toggleFeedContent() {
    feedOptions.content = feedOptions.content == .posts ? .plans : .posts
  }
  mutating func togglePostBookmark(_ id: String) {
    var library = library
    if library.posts.contains(where: { $0.refID == id }) {
      library.posts.removeAll { $0.refID == id }
      for index in library.folders.indices { library.folders[index].items.removeAll { $0.kind == .post && $0.refID == id } }
    } else { _ = library.savePost(id) }
    self.library = library
  }
  func bookmarkedFeedPlan(_ plan: FeedPlanSample) -> Bool {
    guard let id = savedFeedPlanIDs?[plan.id], let saved = library.plan(id) else { return false }
    return saved.isBookmarked != false
  }
  mutating func toggleFeedPlanBookmark(_ plan: FeedPlanSample) {
    var library = library
    if let id = savedFeedPlanIDs?[plan.id], let index = library.plans.firstIndex(where: { $0.id.uuidString == id }) {
      let bookmark = library.plans[index].isBookmarked == false
      library.plans[index].isBookmarked = bookmark
      if !bookmark {
        for folder in library.folders.indices { library.folders[folder].items.removeAll { $0.kind == .plan && $0.refID == id } }
        library.plans[index].folderID = nil
      }
    } else {
      guard library.savePlan(name: plan.name, folderID: nil, newFolder: nil, visibility: .solo,
                             friends: [], stops: plan.stops, times: [:]), let id = library.plans.last?.id else { return }
      if savedFeedPlanIDs == nil { savedFeedPlanIDs = [:] }
      savedFeedPlanIDs?[plan.id] = id.uuidString
    }
    self.library = library
  }
  mutating func appendFeedPlan(_ plan: FeedPlanSample) -> Int {
    var contents = planContents
    let newIDs = plan.stops.filter { MapSamplePlace.find($0) != nil && !contents.ids.contains($0) }
    contents.ids.append(contentsOf: newIDs)
    applyPlanContents(contents)
    return newIDs.count
  }
}
