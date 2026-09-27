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
  var media: [Media]
  var text: String?
  var again: Bool?
  var createdAt: Date?
}

struct PostsPageDTO: Decodable, Sendable {
  var items: [PostDTO]
  var nextCursor: String?
}
