import Foundation

enum Specimen: String, Codable, CaseIterable { case places = "Places", controls = "Controls", score = "Score" }
enum SampleState: String, Codable, CaseIterable { case ready = "Ready", loading = "Loading", empty = "Empty", error = "Error" }
enum PreviewTextSize: String, Codable, CaseIterable { case standard = "Standard", large = "Large", accessible = "Accessibility" }

enum HermiCategory: String, Codable, CaseIterable, Sendable {
  case food = "Food", shopping = "Shopping", nature = "Nature", culture = "Culture"
  case drinks = "Drinks", sports = "Sports", music = "Music"

  var placeName: String {
    switch self {
    case .food: return "The corner café"
    case .shopping: return "A little bookshop"
    case .nature: return "Riverside Park"
    case .culture: return "The neighborhood gallery"
    case .drinks: return "Tea by the window"
    case .sports: return "The riverside courts"
    case .music: return "An evening of live music"
    }
  }
  var detail: String {
    switch self {
    case .food: return "A pastry, a window seat, a little time outside."
    case .shopping: return "Find a new story on a familiar street."
    case .nature: return "A quieter path. A little room to wander."
    case .culture: return "Something new to see, just around the corner."
    case .drinks: return "Catch up over something warm."
    case .sports: return "A quick game. A reason to stay a little longer."
    case .music: return "Follow the sound. Bring a friend."
    }
  }
}

/// Sample-only state. No API, credentials, permissions, real place IDs or location.
struct GalleryState: Codable, Equatable {
  var specimen: Specimen = .places
  var scenario: SampleState = .ready
  var category: HermiCategory = .nature
  var saved: Set<HermiCategory> = []
  var planItems: Set<HermiCategory> = []
  var name = "Alex"
  var controlConfirmed = false
  var score = 250
  var textSize: PreviewTextSize = .standard
  var reduceMotion = false

  mutating func addSelectedPlace() {
    guard scenario == .ready else { return }
    planItems.insert(category)
  }
  mutating func toggleSave() {
    guard scenario == .ready else { return }
    if saved.contains(category) { saved.remove(category) } else { saved.insert(category) }
  }
  mutating func recover() { scenario = .ready }
  mutating func reset() { self = GalleryState() }

  static func restore(_ data: Data?) -> GalleryState {
    guard let data, let state = try? JSONDecoder().decode(GalleryState.self, from: data),
      (0...50_000).contains(state.score), state.name.count <= 80 else { return GalleryState() }
    return state
  }
}

/// Visual mapping only. These functions never calculate or award earned XP.
enum HermiStoneScale {
  static func threshold(_ stones: Int) -> Int { 25 * stones * (stones + 1) / 2 }
  static func count(_ score: Int) -> Int {
    guard score > 0 else { return 0 }
    return Int((sqrt(1 + 8 * Double(score) / 25) - 1) / 2)
  }
  static func progress(_ score: Int) -> Double {
    let count = count(score)
    return Double(max(0, score) - threshold(count)) / Double(threshold(count + 1) - threshold(count))
  }
  static func losesStone(from old: Int, to new: Int) -> Bool { count(new) < count(old) }
}
