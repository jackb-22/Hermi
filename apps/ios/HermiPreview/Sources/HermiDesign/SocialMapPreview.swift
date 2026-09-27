import Foundation

/// Explicit sample sharing, never inferred from a friend's raw GPS or Saved data.
enum SocialMapPreview {
  struct Place {
    let id: String
    let kind: String
    let placeID: String
    let detail: String
  }
  static let places: [Place] = [
    .init(id: "sam-now", kind: "current", placeID: "cafe", detail: "Sample: Sam at Corner café · shared current place · not live data"),
    .init(id: "riley-love", kind: "loved", placeID: "garden", detail: "Sample: Riley loves Riverside gardens · shared with friends")
  ]
  static func detail(_ id: String) -> String? { places.first { $0.id == id }?.detail }
  static func markers(enabled: Bool) -> [[String: Any]] {
    guard enabled else { return [] }
    return places.compactMap { item in
      guard let place = MapSamplePlace.find(item.placeID) else { return nil }
      return ["id": item.id, "kind": item.kind, "name": item.detail,
              "lng": place.coordinate.longitude, "lat": place.coordinate.latitude]
    }
  }
  static func routes(enabled: Bool) -> [[String: Any]] {
    guard enabled else { return [] }
    // Illustrative geometry only: no claim of road routing or recorded friend movement.
    return [
      ["type": "Feature", "properties": ["kind": "current"], "geometry": ["type": "LineString", "coordinates": [
        [-73.9654, 40.8073], [-73.9648, 40.8076], [-73.9636, 40.8059], [-73.9653, 40.8050]
      ]]],
      ["type": "Feature", "properties": ["kind": "loved"], "geometry": ["type": "LineString", "coordinates": [
        [-73.967, 40.808], [-73.9682, 40.8074], [-73.9690, 40.8062], [-73.9708, 40.8039]
      ]]]
    ]
  }
}
