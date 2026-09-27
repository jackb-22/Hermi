import Foundation

struct DiscoveryPin: Identifiable, Codable, Equatable {
  var id = UUID()
  var category: HermiCategory
  var coordinate: GeoPoint
  var radiusMiles: Double = 1
  /// Radius for a newly dropped pin (user amendment 2026-09-27: smaller than the old 1-mile start).
  static let initialRadiusMiles = 0.25
  var radiusMeters: Double { radiusMiles * 1609.344 }
  static func miles(at fraction: Double) -> Double {
    pow(40, min(1, max(0, fraction))) * 0.1
  }
  static func fraction(for miles: Double) -> Double {
    log(min(4, max(0.1, miles)) / 0.1) / log(40)
  }
}

/// Root-space drop -> normalized web-view coordinates -> CSS pixels in map.html.
enum MapDropProjection {
  static func normalized(_ point: CGPoint, in frame: CGRect) -> CGPoint? {
    guard point.x.isFinite, point.y.isFinite, frame.width > 0, frame.height > 0,
          frame.contains(point) else { return nil }
    return CGPoint(x: (point.x-frame.minX)/frame.width, y: (point.y-frame.minY)/frame.height)
  }
}

/// Offline NYC borough shoreline polygons minus hydrography (including inland water).
/// These approximate map-placement boundaries, not proof of access or verified presence.
struct NYCLandMask {
  private struct Document: Decodable {
    let land: [[[[Double]]]]
    let water: [[[[Double]]]]
  }
  struct Polygon {
    let rings: [[[Double]]]
    let minX: Double, maxX: Double, minY: Double, maxY: Double
    init(_ rings: [[[Double]]]) {
      self.rings = rings
      let outer = rings.first ?? []
      minX = outer.map { $0[0] }.min() ?? .infinity
      maxX = outer.map { $0[0] }.max() ?? -.infinity
      minY = outer.map { $0[1] }.min() ?? .infinity
      maxY = outer.map { $0[1] }.max() ?? -.infinity
    }
    func contains(_ point: GeoPoint) -> Bool {
      let x = point.longitude, y = point.latitude
      guard x >= minX, x <= maxX, y >= minY, y <= maxY, let outer = rings.first else { return false }
      return Self.inRing(x, y, outer) && !rings.dropFirst().contains { Self.inRing(x, y, $0) }
    }
    private static func inRing(_ x: Double, _ y: Double, _ ring: [[Double]]) -> Bool {
      guard ring.count >= 4 else { return false }
      var inside = false
      var previous = ring.last!
      for current in ring {
        let ax = previous[0], ay = previous[1], bx = current[0], by = current[1]
        if (ay > y) != (by > y), x < (bx-ax)*(y-ay)/(by-ay)+ax { inside.toggle() }
        previous = current
      }
      return inside
    }
  }
  private var land: [Polygon] = []
  private var water: [Polygon] = []
  var available: Bool { !land.isEmpty && !water.isEmpty }
  static let shared = NYCLandMask()
  init() {
    guard let url = Bundle.module.url(forResource: "nyc-landmask", withExtension: "json", subdirectory: "Resources"),
          let data = try? Data(contentsOf: url), let document = try? JSONDecoder().decode(Document.self, from: data) else { return }
    land = document.land.map(Polygon.init)
    water = document.water.map(Polygon.init)
  }
  func allows(_ point: GeoPoint) -> Bool {
    guard point.isValid, available else { return false }
    return land.contains { $0.contains(point) } && !water.contains { $0.contains(point) }
  }
}
