import Foundation
import CoreLocation

enum HomePanel: String, CaseIterable, Codable { case map = "Map", feed = "Feed", profile = "Profile" }
enum MapPreviewSheet: Equatable, Hashable, Codable { case nearby, place(String), plan, saved }

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
      "garden": .init(latitude: 40.808, longitude: -73.967),
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
  var geographicDiscovery: GeoPoint? // Legacy key retained for existing preview snapshots.
  var discoveryPin: DiscoveryPin? // Decode-only legacy single-pin snapshot.
  var storedDiscoveryPins: [DiscoveryPin]?
  var citywideCategory: HermiCategory?
  var discoveryPins: [DiscoveryPin] {
    get { storedDiscoveryPins ?? discoveryPin.map { [$0] } ?? [] }
    set { storedDiscoveryPins = newValue; discoveryPin = nil; geographicDiscovery = nil }
  }
  var activeCitywideCategory: HermiCategory? { citywideCategory ?? (filterEnabled ? category : nil) }
  func pin(id: UUID?) -> DiscoveryPin? { discoveryPins.first { $0.id == id } }
  mutating func toggleCategoryFilter() {
    citywideCategory = activeCitywideCategory == category ? nil : category
    filterEnabled = false
  }
  var planIDs: [String] = []
  var savedIDs: Set<String> = []

  var showsPlan: Bool { true }
  var nearby: [MapSamplePlace] { matchingPlaces(MapSamplePlace.all) }
  func matchingPlaces(_ places: [MapSamplePlace]) -> [MapSamplePlace] {
    let pins = discoveryPins, citywide = activeCitywideCategory
    var seen = Set<String>()
    return places.filter { place in
      let matches = (pins.isEmpty && citywide == nil) || place.category == citywide || pins.contains {
        place.category == $0.category && $0.coordinate.distance(to: place.coordinate) <= $0.radiusMeters
      }
      return matches && seen.insert(place.id).inserted
    }
  }

  mutating func restoreDiscovery() {
    var pins = discoveryPins
    if storedDiscoveryPins == nil, discoveryPin == nil, let point = geographicDiscovery, NYCLandMask.shared.allows(point) {
      pins = [DiscoveryPin(category: category, coordinate: point)]
    }
    var seen = Set<UUID>()
    discoveryPins = pins.filter {
      NYCLandMask.shared.allows($0.coordinate) && $0.radiusMiles.isFinite && (0.1...4).contains($0.radiusMiles) && seen.insert($0.id).inserted
    }
    if citywideCategory == nil && filterEnabled { citywideCategory = category }
    filterEnabled = false
  }

  @discardableResult mutating func moveDiscovery(id: UUID, to point: GeoPoint) -> Bool {
    guard let index = discoveryPins.firstIndex(where: { $0.id == id }), NYCLandMask.shared.allows(point) else { return false }
    discoveryPins[index].coordinate = point
    return true
  }
  mutating func setDiscoveryRadius(id: UUID, miles: Double) {
    guard let index = discoveryPins.firstIndex(where: { $0.id == id }), miles.isFinite else { return }
    discoveryPins[index].radiusMiles = min(4, max(0.1, miles))
  }
  mutating func removeDiscovery(id: UUID) {
    guard pin(id: id) != nil else { return }
    discoveryPins.removeAll { $0.id == id }
    discovery = nil
    if discoveryPins.isEmpty && activeCitywideCategory == nil {
      if sheet == .nearby { sheet = nil }
      if returnSheet == .nearby { returnSheet = nil }
    }
  }

  mutating func switchPanel(_ panel: HomePanel) { self.panel = panel; sheet = nil; returnSheet = nil }
  mutating func cycleCategory(_ delta: Int) {
    let categories = HermiCategory.allCases
    let current = categories.firstIndex(of: category)!
    category = categories[(current + delta % categories.count + categories.count) % categories.count]

  }
  mutating func dropPin(at point: CGPoint) {
    discovery = CGPoint(x: min(0.95, max(0.05, point.x)), y: min(0.88, max(0.15, point.y)))
    filterEnabled = true
    sheet = .nearby
  }
  @discardableResult mutating func dropGeographicPin(at point: GeoPoint) -> Bool {
    guard NYCLandMask.shared.allows(point) else { return false }
    discoveryPins.append(DiscoveryPin(category: category, coordinate: point))
    sheet = .nearby
    return true
  }
  mutating func selectPlace(_ id: String) {
    guard MapSamplePlace.find(id) != nil else { return }
    returnSheet = (sheet == .plan || sheet == .saved) ? sheet : (discovery == nil && discoveryPins.isEmpty && activeCitywideCategory == nil ? nil : .nearby)
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
