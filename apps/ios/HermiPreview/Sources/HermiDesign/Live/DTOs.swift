import Foundation

// Server shapes (packages/shared/src/api). Only fields the app reads; anything nullable is optional.

struct MeDTO: Decodable, Equatable, Sendable {
  var id: String
  var name: String
  var username: String
  var photoUrl: String?
  var verified: Bool?
  var campus: String?
  var is21: Bool?
  var ghostMode: Bool?
  var openToPlans: Bool?
}

struct AuthResponseDTO: Decodable, Sendable {
  var token: String
  var isNew: Bool?
  var user: MeDTO
}

struct DevAuthBody: Encodable {
  var username: String
}

struct LatLngDTO: Codable, Equatable, Sendable {
  var lat: Double
  var lng: Double
}

/// `Place` (packages/shared/src/api/places.ts).
struct PlaceDTO: Decodable, Sendable {
  var id: String
  var name: String
  var category: String
  var tags: [String]?
  var loc: LatLngDTO
  var address: String?
  var been: Int?
  var wouldGoAgainPct: Double?
  var distanceM: Double?
  var walkMin: Double?

  /// Nil when the server category isn't one of the seven the app draws (logged, never forced).
  var place: MapSamplePlace? {
    guard let category = HermiCategory(serverName: category) else { return nil }
    return MapSamplePlace(id: id, name: name, category: category, latitude: loc.lat, longitude: loc.lng,
                          address: address, wouldGoAgainPct: wouldGoAgainPct, been: been, tags: tags, isLive: true)
  }
}

struct PlacesResponseDTO: Decodable, Sendable {
  var items: [PlaceDTO]
}

extension HermiCategory {
  /// Server categories are lowercase (`food`); the app's raw values are capitalized (`Food`).
  init?(serverName: String) { self.init(rawValue: serverName.capitalized) }
  var serverName: String { rawValue.lowercased() }
}

/// `PlaceDetail`: a Place plus live counts, hours and the review summary (all nullable = unknown).
struct PlaceDetailDTO: Decodable, Sendable {
  struct Hours: Decodable, Equatable, Sendable {
    var day: Int
    var open: String
    var close: String
  }
  var id: String
  var name: String
  var category: String
  var tags: [String]?
  var loc: LatLngDTO
  var address: String?
  var been: Int?
  var wouldGoAgainPct: Double?
  var walkMin: Double?
  var tasteMatch: Double?
  var hereNow: Int?
  var friendsBeen: Int?
  var going: Int?
  var hours: [Hours]?
  var reviewSummary: String?
}

/// `UserCard` (packages/shared/src/api/social.ts).
struct UserCardDTO: Decodable, Equatable, Sendable {
  var id: String
  var name: String
  var username: String
  var photoUrl: String?
  var verified: Bool?
}

/// `Post` (packages/shared/src/api/posts.ts).
struct PostDTO: Decodable, Sendable {
  struct Media: Decodable, Sendable {
    var id: String
    var kind: String
    var url: String?
    var posterUrl: String?
  }
  struct PostPlace: Decodable, Sendable {
    var id: String
    var name: String
    var category: String
    var loc: LatLngDTO
  }
  var id: String
  var type: String
  var status: String?
  var author: UserCardDTO
  var place: PostPlace?
  var planId: String?
  struct Route: Decodable, Sendable {
    struct Stop: Decodable, Sendable {
      var placeId: String
      var name: String
      var index: Int
      var loc: LatLngDTO
    }
    var line: [LatLngDTO]
    var stops: [Stop]
  }
  var media: [Media]
  var text: String?
  var again: Bool?
  var route: Route?
  var createdAt: Date?
}

struct PostsPageDTO: Decodable, Sendable {
  var items: [PostDTO]
  var nextCursor: String?
}

/// `SavedItem`: a saved place, post or plan with its hydrated object (plans are handled in Step 6).
struct SavedItemDTO: Decodable, Sendable {
  var type: String
  var refId: String
  var place: PlaceDTO?
  var post: PostDTO?
}

struct SavedPageDTO: Decodable, Sendable {
  var items: [SavedItemDTO]
}

struct FolderDTO: Decodable, Sendable {
  var id: String
  var name: String
  var count: Int?
}

struct FoldersDTO: Decodable, Sendable {
  var items: [FolderDTO]
}

struct SaveResponseDTO: Decodable, Sendable {
  var copiedPlanId: String?
}

/// `Plan` (packages/shared/src/api/plans.ts): only what the app reads.
struct PlanDTO: Decodable, Sendable {
  struct Stop: Decodable, Sendable {
    var id: String
    var place: PlaceDTO?
    var stayMin: Int?
    var arriveAt: Date?
  }
  struct Member: Decodable, Sendable {
    var userId: String
    var name: String
    var status: String
  }
  var id: String
  var name: String
  var status: String
  var visibility: String?
  var isHost: Bool?
  var hostId: String?
  var startAt: Date?
  var stops: [Stop]
  var members: [Member]?
}

struct PlansPageDTO: Decodable, Sendable {
  var items: [PlanDTO]
}

struct FriendsDTO: Decodable, Sendable {
  struct Friend: Decodable, Sendable {
    var user: UserCardDTO
    var streak: StreakDTO?
    var score: Int?
    var lastCheckin: LastCheckinDTO?
  }
  var items: [Friend]
}

struct StreakDTO: Decodable, Equatable, Sendable {
  var weeks: Int
  var lit: Bool?
  var hangouts: Int?
}

struct LastCheckinDTO: Decodable, Equatable, Sendable {
  var placeId: String?
  var placeName: String
  var at: Date
}

/// `Score`: rolling 30-day XP, 7-day change, daily bars, what expires next and ranks.
struct ScoreDTO: Decodable, Sendable {
  struct Day: Decodable, Sendable { var day: String; var xp: Int }
  struct Expiring: Decodable, Sendable { var xp: Int; var by: String? }
  struct Rank: Decodable, Sendable { var rank: Int; var of: Int; var campus: String? }
  struct Ranks: Decodable, Sendable { var friends: Rank?; var campus: Rank? }
  var score: Int
  var delta7d: Int?
  var sparkline: [Day]
  var expiring: Expiring?
  var ranks: Ranks?
}

/// `GET /profile/:id`.
struct ProfileDTO: Decodable, Sendable {
  struct Counts: Decodable, Sendable { var posts: Int?; var plans: Int?; var placesVisited: Int? }
  var user: UserCardDTO
  var friendCount: Int?
  var streak: StreakDTO?
  var score: ScoreDTO?
  var lastCheckin: LastCheckinDTO?
  var counts: Counts?
}

/// `GET /stats`: private stats for your own profile.
struct StatsDTO: Decodable, Sendable {
  struct TopPlace: Decodable, Sendable { var placeId: String; var name: String; var category: String?; var visits: Int }
  struct Person: Decodable, Sendable { var user: UserCardDTO; var hangouts: Int?; var streakWeeks: Int? }
  struct OnFoot: Decodable, Sendable { var monthKm: Double?; var allTimeKm: Double?; var monthSteps: Int?; var allTimeSteps: Int? }
  struct Borough: Decodable, Sendable { var name: String; var colored: Int; var total: Int; var pct: Double }
  struct Hours: Decodable, Sendable { var month: Double?; var allTime: Double? }
  var topPlaces: [TopPlace]
  var peopleMost: [Person]
  var onFoot: OnFoot?
  var boroughs: [Borough]
  var hoursOut: Hours?
}

/// `GET /tiles`: explored zoom-18 map tiles.
struct TilesDTO: Decodable, Sendable {
  struct Tile: Decodable, Sendable { var x: Int; var y: Int }
  var zoom: Int
  var tiles: [Tile]
  var count: Int?
  var manhattanPct: Double?
}

struct LeaderboardDTO: Decodable, Sendable {
  struct Entry: Decodable, Sendable { var rank: Int; var user: UserCardDTO; var score: Int; var isMe: Bool? }
  struct Me: Decodable, Sendable { var rank: Int; var score: Int }
  var items: [Entry]
  var me: Me?
}

struct PatchMeBody: Encodable {
  var ghostMode: Bool?
  var openToPlans: Bool?
}

/// One Feed card. `action` is a string on plan cards ("join" / "request") and an object on the end card.
struct FeedCardDTO: Decodable, Sendable {
  var kind: String
  var post: PostDTO?
  var plan: PlanDTO?
  var joinAction: String?
  var title: String?

  private enum Keys: String, CodingKey { case kind, post, plan, action, title }
  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: Keys.self)
    kind = try container.decode(String.self, forKey: .kind)
    post = try container.decodeIfPresent(PostDTO.self, forKey: .post)
    plan = try container.decodeIfPresent(PlanDTO.self, forKey: .plan)
    title = try container.decodeIfPresent(String.self, forKey: .title)
    if kind == "plan" { joinAction = try container.decodeIfPresent(String.self, forKey: .action) } else { joinAction = nil }
  }
}

struct FeedResponseDTO: Decodable, Sendable {
  var cards: [FeedCardDTO]
  var unseenLeftToday: Int?
}

struct SeenBody: Encodable { var postIds: [String] }
struct JoinRequestBody: Encodable {}

/// `GET /social`: friends' recent check-ins (never live location), their plan lines and open "!" plans.
struct SocialDTO: Decodable, Sendable {
  struct Place: Decodable, Sendable { var id: String; var name: String; var loc: LatLngDTO }
  struct FriendOut: Decodable, Sendable {
    var user: UserCardDTO
    var place: Place
    var at: String
    var planId: String?
    var active: Bool
  }
  struct Route: Decodable, Sendable {
    var planId: String
    var name: String
    var host: UserCardDTO
    var status: String
    var style: String
    var line: [LatLngDTO]
    var doneThrough: Int
    var startAt: String?
  }
  struct OpenPlan: Decodable, Sendable { var plan: PlanDTO; var action: String }
  /// Friends' upcoming shared plans; action is "join", "joined" or "invited".
  struct FriendPlan: Decodable, Sendable { var plan: PlanDTO; var action: String }
  var friendsOut: [FriendOut]
  var routes: [Route]
  var friendPlans: [FriendPlan]?
  var openPlans: [OpenPlan]
  var refreshAfterS: Int?
}

// MARK: Outings (Action mode)

struct SessionDTO: Decodable, Sendable {
  var id: String
  var planId: String?
  var status: String
  var startedAt: String?
}

struct StartSessionResponseDTO: Decodable, Sendable { var session: SessionDTO }
struct ActiveSessionDTO: Decodable, Sendable { var session: SessionDTO? }
struct StartSessionBody: Encodable { var planId: String? }

struct XPItemDTO: Decodable, Equatable, Sendable { var kind: String; var xp: Int; var label: String }
struct XPDTO: Decodable, Equatable, Sendable { var total: Int; var items: [XPItemDTO] }

struct CheckinResultDTO: Decodable, Sendable {
  struct Checkin: Decodable, Sendable { var id: String; var placeId: String; var tier: String }
  struct Hangout: Decodable, Sendable { var friendId: String; var streakWeeks: Int }
  var checkin: Checkin
  var firstVisit: Bool?
  var xp: XPDTO
  var hangouts: [Hangout]?
}

struct DevTagBody: Encodable { var kind = "venue"; var placeId: String; var bindToMe = false }
struct DevTagDTO: Decodable, Sendable { var tagId: String; var url: String }

struct TagCheckinBody: Encodable {
  var tier = "tag"
  var tagUrl: String
  var sessionId: String?
  var lat: Double
  var lng: Double
  var accuracy: Double
}

struct PointBody: Encodable {
  var lat: Double
  var lng: Double
  var accuracy: Double
  var speed: Double?
  var time: Date
}
struct PointsBody: Encodable { var points: [PointBody] }
struct EndSessionBody: Encodable { var steps: Int? }

struct RecapResponseDTO: Decodable, Sendable {
  var status: String
  var recap: RecapDTO?
}

struct RecapDTO: Decodable, Sendable {
  struct Stop: Decodable, Sendable {
    var checkinId: String
    var placeId: String
    var placeName: String
    var category: String?
    var tier: String
    var firstVisit: Bool?
    var bestMediaId: String?
    var mediaIds: [String]
    var reviewed: Bool?
  }
  var sessionId: String
  var planId: String?
  var planName: String?
  var durationMin: Int?
  var route: [LatLngDTO]
  var newTiles: [TilesDTO.Tile]
  var footKm: Double?
  var totalKm: Double?
  var steps: Int?
  var stops: [Stop]
  var xp: XPDTO
  var planCompleted: Bool?
  var fullParty: Bool?
  var posted: Bool?
}

// MARK: Captures and posting

struct PresignBody: Encodable {
  var checkinId: String
  var kind = "photo"
  var contentType = "image/jpeg"
  var sha256: String
  var bytes: Int
  var capturedAt: Date
  var lat: Double
  var lng: Double
}

struct MediaDTO: Decodable, Sendable {
  var id: String
  var status: String
  var checkinId: String?
  var renditionUrl: String?
  var url: String?
  var verifyUrl: String?
  var rejectReason: String?
}

struct PresignResponseDTO: Decodable, Sendable {
  struct Upload: Decodable, Sendable { var url: String; var method: String?; var headers: [String: String] }
  var media: MediaDTO
  var upload: Upload
}

struct MediaListDTO: Decodable, Sendable { var items: [MediaDTO] }

struct CreatePostBody: Encodable {
  var sessionId: String?
  var mediaIds: [String]
  var includeRoute: Bool
  var caption: String?
}

struct ReviewBody: Encodable {
  var checkinId: String
  var again: Bool
  var text: String?
}
