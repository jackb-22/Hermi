import XCTest
@testable import HermiDesign

final class FeedSettingsTests: XCTestCase {
  func testAudienceAndContentAreIndependentAndDoNotNavigateOrEditPlan() {
    var state = MapPreviewState()
    state.switchPanel(.feed); state.addPlace("cafe")
    XCTAssertTrue(state.feedPosts.allSatisfy { $0.author == "@lee" })
    state.toggleFeedAudience()
    XCTAssertEqual(state.feedOptions.content, .all) // Everything is the default (user amendment 2026-09-27)
    XCTAssertTrue(state.feedPosts.allSatisfy { $0.author == "@sam" })
    state.toggleFeedContent()
    XCTAssertEqual(state.feedOptions.audience, .friends)
    XCTAssertTrue(state.feedPlans.allSatisfy { $0.audience == .friends })
    state.toggleFeedAudience()
    XCTAssertEqual(state.feedOptions.content, .posts)
    XCTAssertTrue(state.feedPlans.allSatisfy { $0.audience == .publicFeed })
    XCTAssertEqual(state.panel, .feed); XCTAssertNil(state.sheet)
    XCTAssertEqual(state.planIDs, ["cafe"])
  }
  func testDiscoveryFiltersScopeFeedWithoutAddingPlaces() {
    var state = MapPreviewState()
    state.citywideCategory = .food
    XCTAssertEqual(state.feedPosts.map(\.placeID), ["cafe"])
    state.feedOptions.audience = .friends
    XCTAssertEqual(state.feedPlans.count, 1)
    XCTAssertTrue(state.feedPlans[0].stops.contains("cafe"))
    XCTAssertTrue(state.planIDs.isEmpty)
  }
  func testPostBookmarkAndPlanMembershipRemainIndependent() {
    var state = MapPreviewState()
    state.togglePostBookmark("cafe-sam")
    XCTAssertTrue(state.planIDs.isEmpty)
    XCTAssertEqual(state.library.posts.count, 1)
    state.togglePlan("cafe")
    state.togglePostBookmark("cafe-sam")
    XCTAssertEqual(state.planIDs, ["cafe"])
    XCTAssertTrue(state.library.posts.isEmpty)
  }
  func testFeedPlanCopyAppendDedupAndUnbookmarkPreserveEditingData() {
    var state = MapPreviewState()
    let sample = FeedPlanSample.all[0]
    state.toggleFeedPlanBookmark(sample)
    let id = state.savedFeedPlanIDs![sample.id]!
    XCTAssertTrue(state.bookmarkedFeedPlan(sample))
    XCTAssertEqual(state.library.plan(id)?.visibility, .solo)
    XCTAssertTrue(state.planIDs.isEmpty)
    XCTAssertEqual(state.appendFeedPlan(sample), 3)
    XCTAssertEqual(state.appendFeedPlan(sample), 0)
    state.undoPlanEdit()
    XCTAssertTrue(state.planIDs.isEmpty)
    state.openSavedPlan(id)
    state.toggleFeedPlanBookmark(sample)
    XCTAssertFalse(state.bookmarkedFeedPlan(sample))
    XCTAssertEqual(state.planIDs, sample.stops)
    XCTAssertNotNil(state.editingSavedPlan)
    state.toggleFeedPlanBookmark(sample)
    XCTAssertEqual(state.library.plans.count, 1)
  }
  func testPrivateDefaultsMigrationAndPreferencesRoundTrip() throws {
    var state = MapPreviewState()
    XCTAssertEqual(state.privacyOptions.routes, .privateOnly)
    XCTAssertFalse(state.privacyOptions.locationSharing)
    XCTAssertEqual(state.privacyOptions.presence, .nobody)
    state.privacyOptions = .migrated(routeAudience: "Everyone")
    XCTAssertEqual(state.privacyOptions.routes, .publicRoutes)
    XCTAssertFalse(state.privacyOptions.locationSharing)
    state.toggleFeedAudience(); state.toggleFeedContent()
    let restored = try JSONDecoder().decode(MapPreviewState.self, from: JSONEncoder().encode(state))
    XCTAssertEqual(restored.privacyOptions, state.privacyOptions)
    XCTAssertEqual(restored.feedOptions, state.feedOptions)
    XCTAssertFalse(restored.social) // Privacy draft never enables map Social or live sharing.
  }
}
