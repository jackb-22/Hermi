import Foundation
import CoreLocation

enum HomePanel: String, CaseIterable, Codable { case map = "Map", feed = "Feed", profile = "Profile" }
enum MapPreviewSheet: Equatable, Codable { case nearby, place(String), plan, saved }

struct MapSamplePlace: Identifiable {
  let id: String
  let name: String
  let category: HermiCategory
  let x: Double
  let y: Double

  static let all: [MapSamplePlace] = [
    .init(id: "garden", name: "Riverside gardens", category: .nature, x: 0.31, y: 0.48),
    .init(id: "cafe", name: "Corner café", category: .food, x: 0.48, y: 0.41),
    .init(id: "gallery", name: "Little gallery", category: .culture, x: 0.74, y: 0.51),
    .init(id: "books", name: "The book nook", category: .shopping, x: 0.46, y: 0.65),
    .init(id: "tea", name: "Tea room", category: .drinks, x: 0.76, y: 0.31),
    .init(id: "court", name: "Riverside courts", category: .sports, x: 0.33, y: 0.73),
    .init(id: "music", name: "Evening jazz", category: .music, x: 0.69, y: 0.78),
  ]
  var coordinate: GeoPoint {
    // Explicit sample locations around Columbia; fixture names are not verified businesses.
    let coordinates: [String: GeoPoint] = [
      "garden": .init(latitude: 40.8078, longitude: -73.9715),
      "cafe": .init(latitude: 40.8073, longitude: -73.9654),
      "gallery": .init(latitude: 40.8077, longitude: -73.9625),
      "books": .init(latitude: 40.8050, longitude: -73.9653),
      "tea": .init(latitude: 40.8101, longitude: -73.9620),
      "court": .init(latitude: 40.8039, longitude: -73.9708),
      "music": .init(latitude: 40.8026, longitude: -73.9661)
    ]
    return coordinates[id]!
  }
  static func find(_ id: String) -> MapSamplePlace? { all.first { $0.id == id } }
}

struct GeoPoint: Codable, Equatable {
  var latitude: Double
  var longitude: Double
  var isValid: Bool { latitude.isFinite && longitude.isFinite && abs(latitude) <= 85 && abs(longitude) <= 180 }
  func distance(to other: GeoPoint) -> Double {
    CLLocation(latitude: latitude, longitude: longitude).distance(from: CLLocation(latitude: other.latitude, longitude: other.longitude))
  }
}

/// Product data remains local fixtures; map projection and basemap are geographic.
struct MapPreviewState: Codable, Equatable {
  var panel: HomePanel = .map
  var category: HermiCategory = .food
  var filterEnabled = false
  var social = false
  var sheet: MapPreviewSheet?
  var returnSheet: MapPreviewSheet?
  var discovery: CGPoint? // Legacy illustration state, retained only for migration/tests.
  var geographicDiscovery: GeoPoint?
  var planIDs: [String] = []
  var savedIDs: Set<String> = []

  var showsPlan: Bool { true }
  var nearby: [MapSamplePlace] { MapSamplePlace.all.filter { place in
    (!filterEnabled || place.category == category) && (geographicDiscovery.map { $0.distance(to: place.coordinate) <= 1500 } ?? true)
  } }

  mutating func switchPanel(_ panel: HomePanel) { self.panel = panel; sheet = nil; returnSheet = nil }
  mutating func cycleCategory(_ delta: Int) {
    let categories = HermiCategory.allCases
    let current = categories.firstIndex(of: category)!
    category = categories[(current + delta % categories.count + categories.count) % categories.count]
    if sheet == .nearby { filterEnabled = true }
  }
  mutating func dropPin(at point: CGPoint) {
    discovery = CGPoint(x: min(0.95, max(0.05, point.x)), y: min(0.88, max(0.15, point.y)))
    filterEnabled = true
    sheet = .nearby
  }
  mutating func dropGeographicPin(at point: GeoPoint) {
    guard point.isValid else { return }
    geographicDiscovery = point
    filterEnabled = true
    sheet = .nearby
  }
  mutating func selectPlace(_ id: String) {
    guard MapSamplePlace.find(id) != nil else { return }
    returnSheet = (sheet == .plan || sheet == .saved) ? sheet : (discovery == nil && geographicDiscovery == nil ? nil : .nearby)
    sheet = .place(id)
  }
  mutating func goBack() { sheet = returnSheet; returnSheet = nil }
  mutating func addPlace(_ id: String) {
    guard MapSamplePlace.find(id) != nil, !planIDs.contains(id) else { return }
    planIDs.append(id)
  }
  mutating func togglePlan(_ id: String) {
    guard MapSamplePlace.find(id) != nil else { return }
    if planIDs.contains(id) { removePlace(id) } else { addPlace(id) }
  }
  mutating func movePlace(_ id: String, before target: String) {
    guard id != target, planIDs.contains(id), planIDs.contains(target) else { return }
    planIDs.removeAll { $0 == id }
    if let index = planIDs.firstIndex(of: target) { planIDs.insert(id, at: index) }
  }
  mutating func removePlace(_ id: String) { planIDs.removeAll { $0 == id } }
  mutating func toggleSave(_ id: String) {
    guard MapSamplePlace.find(id) != nil else { return }
    if savedIDs.contains(id) { savedIDs.remove(id) } else { savedIDs.insert(id) }
  }
  mutating func reset() { self = MapPreviewState() }
}
