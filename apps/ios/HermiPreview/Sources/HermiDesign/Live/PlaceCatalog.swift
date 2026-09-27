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
  /// Latest results for discovery pins and the citywide category (see `discoveryChanged`).
  private(set) var filterIDs: [String] = []
  private(set) var loading = false
  private(set) var lastError: String?

  @ObservationIgnored private var viewportTask: Task<Void, Never>?
  @ObservationIgnored private var lastBounds: [Double]?
  @ObservationIgnored private var filterTask: Task<Void, Never>?
  @ObservationIgnored private var query = DiscoveryQuery()
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
    guard LiveSession.shared.isLive else { return MapSamplePlace.fixtures }
    // MapPreviewState.matchingPlaces applies category/radius and removes duplicates.
    return (filterIDs + viewportIDs).compactMap { cache[$0] }
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
    refreshViewport(debounce: true)
    if query.citywide != nil { refreshFilters(debounce: true) }
  }

  /// Refetch everything (e.g. right after connecting).
  @MainActor
  func refresh() {
    refreshViewport(debounce: false)
    refreshFilters(debounce: false)
  }

  /// Discovery pins or the citywide category changed.
  @MainActor
  func discoveryChanged(_ next: DiscoveryQuery) {
    guard next != query else { return }
    query = next
    refreshFilters(debounce: true)
  }

  @MainActor
  private func refreshFilters(debounce: Bool) {
    filterTask?.cancel()
    var requests: [(bbox: [Double], category: HermiCategory)] = query.pins.map {
      (PlaceCatalog.bbox(latitude: $0.latitude, longitude: $0.longitude, radiusMeters: $0.radiusMeters), $0.category)
    }
    if let citywide = query.citywide, let bounds = lastBounds { requests.append((bounds, citywide)) }
    guard !requests.isEmpty else { filterIDs = []; return }
    guard let api = LiveSession.shared.api else { return }
    let batch = requests
    filterTask = Task { @MainActor in
      if debounce {
        do { try await Task.sleep(for: .milliseconds(300)) } catch { return }
      }
      do {
        let results = try await withThrowingTaskGroup(of: (Int, [MapSamplePlace]).self, returning: [MapSamplePlace].self) { group in
          for (index, request) in batch.enumerated() {
            group.addTask {
              let bbox = request.bbox.map { String(format: "%.5f", $0) }.joined(separator: ",")
              let response: PlacesResponseDTO = try await api.send("GET", "/places",
                query: ["bbox": bbox, "cat": request.category.serverName, "limit": "100"])
              return (index, response.items.compactMap(\.place))
            }
          }
          var ordered = [[MapSamplePlace]](repeating: [], count: batch.count)
          for try await (index, places) in group { ordered[index] = places }
          return ordered.flatMap { $0 }
        }
        guard !Task.isCancelled else { return }
        upsert(results)
        filterIDs = results.map(\.id)
        lastError = nil
      } catch {
        guard !Task.isCancelled else { return }
        lastError = error.localizedDescription
      }
    }
  }

  /// Box enclosing a circle, as [west, south, east, north].
  static func bbox(latitude: Double, longitude: Double, radiusMeters: Double) -> [Double] {
    let dLat = radiusMeters / 111_320
    let dLng = radiusMeters / (111_320 * max(0.01, cos(latitude * .pi / 180)))
    return [longitude - dLng, latitude - dLat, longitude + dLng, latitude + dLat]
  }

  @MainActor
  private func refreshViewport(debounce: Bool) {
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

/// What discovery is asking for: each pin's category and circle, plus the optional citywide category.
struct DiscoveryQuery: Equatable {
  struct Pin: Equatable {
    var category: HermiCategory
    var latitude: Double
    var longitude: Double
    var radiusMeters: Double
  }
  var pins: [Pin] = []
  var citywide: HermiCategory?
}

extension MapPreviewState {
  var discoveryQuery: DiscoveryQuery {
    DiscoveryQuery(pins: discoveryPins.map {
      .init(category: $0.category, latitude: $0.coordinate.latitude, longitude: $0.coordinate.longitude, radiusMeters: $0.radiusMeters)
    }, citywide: activeCitywideCategory)
  }
}
