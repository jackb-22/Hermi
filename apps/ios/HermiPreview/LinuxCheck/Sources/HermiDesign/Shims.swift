import Foundation

// Stand-ins for app types that the mirrored files mention but that live in files importing SwiftUI or
// CoreLocation (MapPreviewState.swift). Keep the initializers in step with the real ones; macOS CI compiles those.

struct GeoPoint: Codable, Equatable {
  var latitude: Double
  var longitude: Double
}

struct MapSamplePlace: Identifiable, Codable, Equatable, Sendable {
  let id: String
  let name: String
  let category: HermiCategory
  var latitude: Double
  var longitude: Double
  var address: String?
  var wouldGoAgainPct: Double?
  var been: Int?
  var tags: [String]?
  var isLive = false
}
