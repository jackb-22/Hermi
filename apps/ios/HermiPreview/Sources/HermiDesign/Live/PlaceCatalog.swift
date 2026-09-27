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
  /// General discovery is loaded in fixed map tiles ("z/x/y" → place IDs), each fetched once per run,
  /// so panning back is instant and new areas fill in tile by tile.
  private(set) var tilePlaces: [String: [String]] = [:]
  /// Tiles on screen plus a one-tile ring around it (what the map shows).
  private(set) var shownTiles: [String] = []
  /// After a zoom crosses a tile level, the previous level's tiles stay drawn until the new ones load (no flicker).
  private(set) var fallbackTiles: [String] = []
  /// Latest results for discovery pins and the citywide category (see `discoveryChanged`).
  private(set) var filterIDs: [String] = []
  private(set) var loading = false
  private(set) var lastError: String?
  /// Live posts seen this run, so Saved and the Feed can resolve a post ID.
  private(set) var posts: [String: PlaceFeedPost] = [:]

  @ObservationIgnored private var viewportTask: Task<Void, Never>?
  @ObservationIgnored private var tileTasks: [String: Task<Void, Never>] = [:]
  @ObservationIgnored private var lastBounds: [Double]?
  @ObservationIgnored private var lastZoom: Double = 15
  @ObservationIgnored private var shownZoom: Int?
  @ObservationIgnored private var visibleKeys: [String] = []
  @ObservationIgnored private var filterTask: Task<Void, Never>?
  @ObservationIgnored private var query = DiscoveryQuery()
  @ObservationIgnored private var persistedIDs: Set<String> = []
  private let defaults: UserDefaults
  private static let storageKey = "hermi.live.places.v1"

  /// Places per category per map tile for general discovery.
  static let tileLimit = 18
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
    return (filterIDs + (shownTiles + fallbackTiles).flatMap { tilePlaces[$0] ?? [] }).compactMap { cache[$0] }
  }
  var cached: [MapSamplePlace] { cache.values.sorted { $0.id < $1.id } }

  /// Centre of the last reported map area (the Feed's location until the app has real location).
  var mapCenter: GeoPoint? {
    guard let b = lastBounds else { return nil }
    return GeoPoint(latitude: (b[1] + b[3]) / 2, longitude: (b[0] + b[2]) / 2)
  }

  func place(_ id: String) -> MapSamplePlace? {
    cache[id] ?? MapSamplePlace.fixtures.first { $0.id == id }
  }

  func remember(posts: [PlaceFeedPost]) {
    for post in posts { self.posts[post.id] = post }
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

  /// Map moved (sent while panning, throttled, and when it stops). Bounds are [west, south, east, north].
  @MainActor
  func viewportChanged(_ bounds: [Double], zoom: Double?) {
    guard bounds.count == 4, bounds.allSatisfy({ $0.isFinite }), bounds[0] < bounds[2], bounds[1] < bounds[3] else { return }
    lastBounds = bounds
    if let zoom, zoom.isFinite { lastZoom = zoom }
    viewportTask?.cancel()
    viewportTask = Task { @MainActor in
      do { try await Task.sleep(for: .milliseconds(120)) } catch { return }
      loadTiles()
    }
  }

  /// Refetch everything (e.g. right after connecting).
  @MainActor
  func refresh() {
    for task in tileTasks.values { task.cancel() }
    tileTasks = [:]; tilePlaces = [:]; fallbackTiles = []
    loadTiles()
    refreshFilters(debounce: false)
  }

  @MainActor
  private func loadTiles() {
    guard let bounds = lastBounds, let api = LiveSession.shared.api else { return }
    let z = PlaceCatalog.tileZoom(forMapZoom: lastZoom)
    let visible = PlaceCatalog.tiles(covering: bounds, zoom: z, ring: 0)
    let shown = PlaceCatalog.tiles(covering: bounds, zoom: z, ring: 1)
    if let previous = shownZoom, previous != z {
      let loaded = shownTiles.filter { tilePlaces[$0] != nil }
      fallbackTiles = Array(Set(fallbackTiles + loaded)).sorted()
    }
    shownZoom = z
    visibleKeys = visible
    if shown != shownTiles { shownTiles = shown }
    // Drop requests for tiles that scrolled well away; keep ones still in view.
    for (key, task) in tileTasks where !shown.contains(key) { task.cancel(); tileTasks[key] = nil }
    // On-screen tiles first, then the prefetch ring.
    for key in visible + shown.filter({ !visible.contains($0) }) where tilePlaces[key] == nil && tileTasks[key] == nil {
      guard let box = PlaceCatalog.tileBounds(key) else { continue }
      tileTasks[key] = Task { @MainActor in
        defer {
          // A cancelled task was already replaced or dropped; only a finished one clears its slot.
          if !Task.isCancelled { tileTasks[key] = nil; loading = !tileTasks.isEmpty }
        }
        do {
          let places = try await PlaceCatalog.fetch(api, [PlaceRequest(bbox: box, category: "all", limit: PlaceCatalog.tileLimit)])
          guard !Task.isCancelled else { return }
          upsert(places)
          tilePlaces[key] = places.map(\.id)
          lastError = nil
          releaseFallbackIfReady()
        } catch {
          guard !Task.isCancelled else { return }
          lastError = error.localizedDescription
        }
      }
    }
    loading = !tileTasks.isEmpty
    releaseFallbackIfReady()
  }

  private func releaseFallbackIfReady() {
    if !fallbackTiles.isEmpty, visibleKeys.allSatisfy({ tilePlaces[$0] != nil }) { fallbackTiles = [] }
  }

  /// Tile zoom follows the map so each screen holds roughly 8–15 tiles; clamped to the city's useful range.
  static func tileZoom(forMapZoom zoom: Double) -> Int { min(16, max(10, Int(zoom.rounded(.down)))) }

  /// Slippy-map tiles ("z/x/y") covering the bounds, plus `ring` tiles on every side, clipped to NYC.
  static func tiles(covering bounds: [Double], zoom z: Int, ring: Int) -> [String] {
    let city = citywideBounds
    let west = max(bounds[0], city[0]), south = max(bounds[1], city[1])
    let east = min(bounds[2], city[2]), north = min(bounds[3], city[3])
    guard west < east, south < north else { return [] }
    let (x0, y0) = tile(latitude: north, longitude: west, zoom: z)
    let (x1, y1) = tile(latitude: south, longitude: east, zoom: z)
    let (cx0, cy0) = tile(latitude: city[3], longitude: city[0], zoom: z)
    let (cx1, cy1) = tile(latitude: city[1], longitude: city[2], zoom: z)
    let rows = (low: max(cy0, y0 - ring), high: min(cy1, y1 + ring))
    let columns = (low: max(cx0, x0 - ring), high: min(cx1, x1 + ring))
    guard rows.low <= rows.high, columns.low <= columns.high else { return [] }
    var keys: [String] = []
    for y in rows.low...rows.high {
      for x in columns.low...columns.high { keys.append("\(z)/\(x)/\(y)") }
    }
    return keys
  }

  static func tile(latitude: Double, longitude: Double, zoom z: Int) -> (x: Int, y: Int) {
    let n = pow(2, Double(z)), lat = latitude * .pi / 180
    let x = Int(((longitude + 180) / 360 * n).rounded(.down))
    let y = Int(((1 - log(tan(lat) + 1 / cos(lat)) / .pi) / 2 * n).rounded(.down))
    return (x, y)
  }

  /// [west, south, east, north] of a "z/x/y" tile key.
  static func tileBounds(_ key: String) -> [Double]? {
    let parts = key.split(separator: "/").compactMap { Int($0) }
    guard parts.count == 3 else { return nil }
    let n = pow(2, Double(parts[0])), x = Double(parts[1]), y = Double(parts[2])
    func lat(_ y: Double) -> Double { atan(sinh(.pi * (1 - 2 * y / n))) * 180 / .pi }
    return [x / n * 360 - 180, lat(y + 1), (x + 1) / n * 360 - 180, lat(y)]
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
