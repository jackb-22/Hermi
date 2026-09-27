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
