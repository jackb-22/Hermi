import Foundation
import Observation

/// Places known to the app. Sample mode: the fixtures. Live mode: whatever `/v1/places` returned for the
/// current map area, plus a persisted cache so saved/plan IDs still resolve before login restores at launch.
@Observable
final class PlaceCatalog {
  static let shared = PlaceCatalog()

  /// Live places ever seen, by ID (persisted).
  private(set) var cache: [String: MapSamplePlace]
  /// Latest map-area result, in server rank order.
  private(set) var viewportIDs: [String] = []
  private(set) var loading = false
  private(set) var lastError: String?

  @ObservationIgnored private var viewportTask: Task<Void, Never>?
  @ObservationIgnored private var lastBounds: [Double]?
  private let defaults: UserDefaults
  private static let storageKey = "hermi.live.places.v1"

  init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
    if let data = defaults.data(forKey: PlaceCatalog.storageKey),
       let places = try? JSONDecoder().decode([MapSamplePlace].self, from: data) {
      cache = Dictionary(places.map { ($0.id, $0) }, uniquingKeysWith: { _, last in last })
    } else {
      cache = [:]
    }
  }

  var discoverable: [MapSamplePlace] {
    LiveSession.shared.isLive ? viewportIDs.compactMap { cache[$0] } : MapSamplePlace.fixtures
  }
  var cached: [MapSamplePlace] { cache.values.sorted { $0.id < $1.id } }

  func place(_ id: String) -> MapSamplePlace? {
    cache[id] ?? MapSamplePlace.fixtures.first { $0.id == id }
  }

  func upsert(_ places: [MapSamplePlace]) {
    guard !places.isEmpty else { return }
    for place in places { cache[place.id] = place }
    if let data = try? JSONEncoder().encode(Array(cache.values)) { defaults.set(data, forKey: PlaceCatalog.storageKey) }
  }

  /// Map finished moving. Bounds are [west, south, east, north]. Debounced; superseded requests are dropped.
  @MainActor
  func viewportChanged(_ bounds: [Double]) {
    guard bounds.count == 4, bounds.allSatisfy({ $0.isFinite }), bounds[0] < bounds[2], bounds[1] < bounds[3] else { return }
    lastBounds = bounds
    refresh(debounce: true)
  }

  /// Refetch the last map area (e.g. right after connecting).
  @MainActor
  func refresh(debounce: Bool = false) {
    viewportTask?.cancel()
    guard let bounds = lastBounds, let api = LiveSession.shared.api else { return }
    viewportTask = Task { @MainActor in
      if debounce {
        do { try await Task.sleep(for: .milliseconds(400)) } catch { return }
      }
      loading = true
      defer { loading = false }
      let bbox = bounds.map { String(format: "%.5f", $0) }.joined(separator: ",")
      do {
        let response: PlacesResponseDTO = try await api.send("GET", "/places", query: ["bbox": bbox, "cat": "all", "limit": "25"])
        guard !Task.isCancelled else { return }
        let places = response.items.compactMap(\.place)
        upsert(places)
        viewportIDs = places.map(\.id)
        lastError = nil
      } catch {
        guard !Task.isCancelled else { return }
        lastError = error.localizedDescription
      }
    }
  }
}
