import Foundation
import Observation

/// Places known to the app. Sample mode: the fixtures. Live mode: whatever `/v1/places` returned for the
/// visible map, the discovery pins and the citywide category. Places referenced by plans/saved items are
/// persisted so their IDs still resolve before login restores at launch.
@Observable
final class PlaceCatalog {
  static let shared = PlaceCatalog()

  /// Live places seen this run (plus persisted referenced ones), by ID.
  private(set) var cache: [String: MapSamplePlace]
  /// Latest map-area result.
  private(set) var viewportIDs: [String] = []
  /// Latest results for discovery pins and the citywide category (see `discoveryChanged`).
  private(set) var filterIDs: [String] = []
  private(set) var loading = false
  private(set) var lastError: String?

  @ObservationIgnored private var viewportTask: Task<Void, Never>?
  @ObservationIgnored private var lastBounds: [Double]?
  @ObservationIgnored private var filterTask: Task<Void, Never>?
  @ObservationIgnored private var query = DiscoveryQuery()
  @ObservationIgnored private var persistedIDs: Set<String> = []
  private let defaults: UserDefaults
  private static let storageKey = "hermi.live.places.v1"

  /// Viewport grid (n×n requests) and places per category per cell.
  static let viewportGrid = 3, viewportLimit = 18
  /// Citywide category: all of NYC in a grid, up to `citywideLimit` per cell.
  static let citywideBounds: [Double] = [-74.26, 40.49, -73.70, 40.92]
  static let citywideGrid = 4, citywideLimit = 100

  init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
    if let data = defaults.data(forKey: PlaceCatalog.storageKey),
       let places = try? JSONDecoder().decode([MapSamplePlace].self, from: data) {
      cache = Dictionary(places.map { ($0.id, $0) }, uniquingKeysWith: { _, last in last })
    } else {
      cache = [:]
    }
    persistedIDs = Set(cache.keys)
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
    for place in places { cache[place.id] = place }
  }

  /// Keep only places the user's plans/saved items point at on disk (the cache can hold thousands).
  func persist(referenced ids: Set<String>) {
    let keep = ids.filter { cache[$0] != nil }
    guard keep != persistedIDs else { return }
    persistedIDs = keep
    let places = keep.sorted().compactMap { cache[$0] }
    if let data = try? JSONEncoder().encode(places) { defaults.set(data, forKey: PlaceCatalog.storageKey) }
  }

  /// Map finished moving. Bounds are [west, south, east, north]. Debounced; superseded requests are dropped.
  @MainActor
  func viewportChanged(_ bounds: [Double]) {
    guard bounds.count == 4, bounds.allSatisfy({ $0.isFinite }), bounds[0] < bounds[2], bounds[1] < bounds[3] else { return }
    lastBounds = bounds
    refreshViewport(debounce: true)
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
  private func refreshViewport(debounce: Bool) {
    viewportTask?.cancel()
    guard let bounds = lastBounds, let api = LiveSession.shared.api else { return }
    let requests = PlaceCatalog.grid(bounds, PlaceCatalog.viewportGrid).map {
      PlaceRequest(bbox: $0, category: "all", limit: PlaceCatalog.viewportLimit)
    }
    viewportTask = Task { @MainActor in
      if debounce {
        do { try await Task.sleep(for: .milliseconds(400)) } catch { return }
      }
      loading = true
      defer { loading = false }
      do {
        let places = try await PlaceCatalog.fetch(api, requests)
        guard !Task.isCancelled else { return }
        upsert(places)
        viewportIDs = places.map(\.id)
        lastError = nil
      } catch {
        guard !Task.isCancelled else { return }
        lastError = error.localizedDescription
      }
    }
  }

  @MainActor
  private func refreshFilters(debounce: Bool) {
    filterTask?.cancel()
    var requests: [PlaceRequest] = []
    for pin in query.pins {
      let box = PlaceCatalog.bbox(latitude: pin.latitude, longitude: pin.longitude, radiusMeters: pin.radiusMeters)
      // Big circles are split so the server's per-request cap doesn't thin them out.
      let cells = pin.radiusMeters > 2 * 1609.344 ? 3 : (pin.radiusMeters > 0.5 * 1609.344 ? 2 : 1)
      requests += PlaceCatalog.grid(box, cells).map { PlaceRequest(bbox: $0, category: pin.category.serverName, limit: 100) }
    }
    if let citywide = query.citywide {
      requests += PlaceCatalog.grid(PlaceCatalog.citywideBounds, PlaceCatalog.citywideGrid).map {
        PlaceRequest(bbox: $0, category: citywide.serverName, limit: PlaceCatalog.citywideLimit)
      }
    }
    guard !requests.isEmpty else { filterIDs = []; return }
    guard let api = LiveSession.shared.api else { return }
    let batch = requests
    filterTask = Task { @MainActor in
      if debounce {
        do { try await Task.sleep(for: .milliseconds(300)) } catch { return }
      }
      do {
        let places = try await PlaceCatalog.fetch(api, batch)
        guard !Task.isCancelled else { return }
        upsert(places)
        filterIDs = places.map(\.id)
        lastError = nil
      } catch {
        guard !Task.isCancelled else { return }
        lastError = error.localizedDescription
      }
    }
  }

  struct PlaceRequest: Sendable {
    var bbox: [Double]
    var category: String
    var limit: Int
  }

  /// Runs the requests in parallel; results keep request order, deduplicated by ID.
  static func fetch(_ api: HermiAPI, _ requests: [PlaceRequest]) async throws -> [MapSamplePlace] {
    let lists = try await withThrowingTaskGroup(of: (Int, [MapSamplePlace]).self, returning: [[MapSamplePlace]].self) { group in
      for (index, request) in requests.enumerated() {
        group.addTask {
          let bbox = request.bbox.map { String(format: "%.5f", $0) }.joined(separator: ",")
          let response: PlacesResponseDTO = try await api.send("GET", "/places",
            query: ["bbox": bbox, "cat": request.category, "limit": String(request.limit)])
          // Five boroughs only: earlier imports clipped New Jersey.
          return (index, response.items.compactMap(\.place).filter { NYCLandMask.shared.isInCity($0.coordinate) })
        }
      }
      var ordered = [[MapSamplePlace]](repeating: [], count: requests.count)
      for try await (index, places) in group { ordered[index] = places }
      return ordered
    }
    var seen = Set<String>()
    return lists.flatMap { $0 }.filter { seen.insert($0.id).inserted }
  }

  /// Splits [west, south, east, north] into n×n cells.
  static func grid(_ bounds: [Double], _ n: Int) -> [[Double]] {
    guard n > 1 else { return [bounds] }
    let width = (bounds[2] - bounds[0]) / Double(n), height = (bounds[3] - bounds[1]) / Double(n)
    var cells: [[Double]] = []
    for row in 0..<n {
      for column in 0..<n {
        let west = bounds[0] + Double(column) * width, south = bounds[1] + Double(row) * height
        cells.append([west, south, west + width, south + height])
      }
    }
    return cells
  }

  /// Box enclosing a circle, as [west, south, east, north].
  static func bbox(latitude: Double, longitude: Double, radiusMeters: Double) -> [Double] {
    let dLat = radiusMeters / 111_320
    let dLng = radiusMeters / (111_320 * max(0.01, cos(latitude * .pi / 180)))
    return [longitude - dLng, latitude - dLat, longitude + dLng, latitude + dLat]
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

  /// Every place ID the user's own data points at (plan, saved, saved plans, active outing).
  var referencedPlaceIDs: Set<String> {
    var ids = Set(planIDs).union(savedIDs)
    for plan in library.plans { ids.formUnion(plan.stopIDs) }
    if let draft = unsavedPlanContents { ids.formUnion(draft.ids) }
    if let session = actionSession { ids.formUnion(session.stopIDs) }
    return ids
  }

  /// Places for the Nearby row: only the selected pin's matches (nearest first) when a pin is selected.
  func nearbyPlaces(for pinID: UUID?, limit: Int = 60) -> [MapSamplePlace] {
    guard let pin = pin(id: pinID) else { return Array(nearby.prefix(limit)) }
    var seen = Set<String>()
    let matches = MapSamplePlace.all
      .filter { $0.category == pin.category && seen.insert($0.id).inserted }
      .map { (place: $0, meters: pin.coordinate.distance(to: $0.coordinate)) }
      .filter { $0.meters <= pin.radiusMeters }
      .sorted { $0.meters < $1.meters }
    return matches.prefix(limit).map { $0.place }
  }
}
