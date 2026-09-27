import Foundation

enum HomePanel: String, CaseIterable, Codable { case feed = "Feed", map = "Map", profile = "Profile" }
enum MapPreviewSheet: Equatable, Codable { case nearby, place(String), plan }

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
  static func find(_ id: String) -> MapSamplePlace? { all.first { $0.id == id } }
}

/// Composition preview only; coordinates are normalized illustration positions, never GPS.
struct MapPreviewState: Codable, Equatable {
  var panel: HomePanel = .map
  var category: HermiCategory = .food
  var filterEnabled = false
  var social = false
  var sheet: MapPreviewSheet?
  var returnSheet: MapPreviewSheet?
  var discovery: CGPoint?
  var planIDs: [String] = []
  var savedIDs: Set<String> = []

  var showsPlan: Bool { discovery != nil || !planIDs.isEmpty }
  var nearby: [MapSamplePlace] { MapSamplePlace.all.filter { !filterEnabled || $0.category == category } }

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
  mutating func selectPlace(_ id: String) {
    guard MapSamplePlace.find(id) != nil else { return }
    returnSheet = sheet == .plan ? .plan : (discovery == nil ? nil : .nearby)
    sheet = .place(id)
  }
  mutating func goBack() { sheet = returnSheet; returnSheet = nil }
  mutating func addPlace(_ id: String) {
    guard MapSamplePlace.find(id) != nil, !planIDs.contains(id) else { return }
    planIDs.append(id)
  }
  mutating func removePlace(_ id: String) { planIDs.removeAll { $0 == id } }
  mutating func toggleSave(_ id: String) {
    guard MapSamplePlace.find(id) != nil else { return }
    if savedIDs.contains(id) { savedIDs.remove(id) } else { savedIDs.insert(id) }
  }
  mutating func reset() { self = MapPreviewState() }
}
