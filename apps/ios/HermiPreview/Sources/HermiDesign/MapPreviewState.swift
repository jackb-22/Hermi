import Foundation
import CoreLocation

enum HomePanel: String, CaseIterable, Codable { case map = "Map", feed = "Feed", profile = "Profile" }
enum MapPreviewSheet: Equatable, Hashable, Codable { case nearby, place(String), plan, saved }

/// A place the map can show: a labeled sample fixture, or a live place from `/v1/places` (see PlaceCatalog).
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

  var coordinate: GeoPoint { .init(latitude: latitude, longitude: longitude) }

  // Explicit sample locations around Columbia; fixture names are not verified businesses.
  static let fixtures: [MapSamplePlace] = [
    .init(id: "garden", name: "Riverside gardens", category: .nature, latitude: 40.808, longitude: -73.967),
    .init(id: "cafe", name: "Corner café", category: .food, latitude: 40.8073, longitude: -73.9654),
    .init(id: "gallery", name: "Little gallery", category: .culture, latitude: 40.8077, longitude: -73.9625),
    .init(id: "books", name: "The book nook", category: .shopping, latitude: 40.8050, longitude: -73.9653),
    .init(id: "tea", name: "Tea room", category: .drinks, latitude: 40.8101, longitude: -73.9620),
    .init(id: "court", name: "Riverside courts", category: .sports, latitude: 40.8039, longitude: -73.9708),
    .init(id: "music", name: "Evening jazz", category: .music, latitude: 40.8026, longitude: -73.9661),
  ]
  /// Discovery candidates: live places for the current map area when signed in, otherwise the fixtures.
  static var all: [MapSamplePlace] { PlaceCatalog.shared.discoverable }
  /// Every place an ID can resolve to (fixtures plus cached live places), for saved/plan lookups.
  static var known: [MapSamplePlace] { fixtures + PlaceCatalog.shared.cached }
  static func find(_ id: String) -> MapSamplePlace? { PlaceCatalog.shared.place(id) }
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
  var stopTimes: [String: PreviewStopTime]?
  var stopInviteDrafts: [String: Set<String>]?
  var savedIDs: Set<String> = []
  var savedLibrary: SavedLibrary? // Optional so older local snapshots still decode.
  var activeSavedPlanID: UUID?
  var unsavedPlanContents: PlanContents?
  var planUndoHistory: [PlanContents]?
  var storedFeedPreferences: FeedPreferences?
  var storedPrivacyPreferences: PrivacyPreferences?
  var savedFeedPlanIDs: [String: String]?
  var actionSession: ActionPreviewSession?

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
    discoveryPins.append(DiscoveryPin(category: category, coordinate: point, radiusMiles: DiscoveryPin.initialRadiusMiles))
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
    var contents = planContents
    contents.ids.append(id)
    applyPlanContents(contents)
  }
  mutating func togglePlan(_ id: String) {
    guard MapSamplePlace.find(id) != nil else { return }
    if planIDs.contains(id) { removePlace(id) } else { addPlace(id) }
  }
  mutating func movePlace(_ id: String, before target: String) { movePlace(id, relativeTo: target, after: false) }
  mutating func movePlace(_ id: String, relativeTo target: String, after: Bool) {
    guard id != target, planIDs.contains(id), planIDs.contains(target) else { return }
    var contents = planContents
    contents.ids.removeAll { $0 == id }
    if let index = contents.ids.firstIndex(of: target) { contents.ids.insert(id, at: index + (after ? 1 : 0)) }
    applyPlanContents(contents)
  }
  mutating func removePlace(_ id: String) {
    var contents = planContents
    contents.ids.removeAll { $0 == id }
    contents.times[id] = nil
    contents.inviteDrafts[id] = nil
    applyPlanContents(contents)
  }
  mutating func toggleSave(_ id: String) {
    guard MapSamplePlace.find(id) != nil else { return }
    if savedIDs.contains(id) {
      savedIDs.remove(id)
      if var library = savedLibrary {
        for index in library.folders.indices { library.folders[index].items.removeAll { $0.kind == .place && $0.refID == id } }
        savedLibrary = library
      }
    } else { savedIDs.insert(id) }
  }
  mutating func reset() { self = MapPreviewState() }
}
