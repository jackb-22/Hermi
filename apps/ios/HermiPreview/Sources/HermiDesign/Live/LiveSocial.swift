import Foundation
import Observation

/// Social map data for the signed-in user, polled while Social is on and the map is showing.
@Observable
final class LiveSocial {
  static let shared = LiveSocial()

  private(set) var friendsOut: [SocialDTO.FriendOut] = []
  private(set) var routes: [SocialDTO.Route] = []
  private(set) var openPlans: [SocialDTO.OpenPlan] = []
  private(set) var refreshAfter = 30
  private(set) var error: String?

  @MainActor
  func load() async {
    guard let api = LiveSession.shared.api else { return }
    do {
      let social: SocialDTO = try await api.send("GET", "/social")
      apply(social)
    } catch {
      self.error = error.localizedDescription
    }
  }

  func apply(_ social: SocialDTO) {
    friendsOut = social.friendsOut
    routes = social.routes
    openPlans = social.openPlans
    refreshAfter = social.refreshAfterS ?? 30
    error = nil
  }

  func reset() { friendsOut = []; routes = []; openPlans = []; error = nil }

  /// Markers for map.html: "current" blinks (there now, per check-ins), "recent" is steady, "quest" is an open plan.
  var markers: [[String: Any]] {
    var result: [[String: Any]] = friendsOut.map { friend in
      ["id": "friend:\(friend.user.id)", "kind": friend.active ? "current" : "recent",
       "name": "\(friend.user.name) at \(friend.place.name)", "lng": friend.place.loc.lng, "lat": friend.place.loc.lat]
    }
    for open in openPlans {
      guard let first = open.plan.stops.compactMap(\.place).first else { continue }
      result.append(["id": "open:\(open.plan.id)", "kind": "quest", "name": "Open plan: \(open.plan.name)",
                     "lng": first.loc.lng, "lat": first.loc.lat])
    }
    return result
  }

  /// Plan lines: planned dotted, completed solid, under way solid through `doneThrough` then dotted.
  var routeFeatures: [[String: Any]] {
    routes.flatMap { route -> [[String: Any]] in
      let coordinates = route.line.map { [$0.lng, $0.lat] }
      guard coordinates.count > 1 else { return [] }
      func feature(_ kind: String, _ points: ArraySlice<[Double]>) -> [String: Any] {
        ["type": "Feature", "properties": ["kind": kind, "name": route.name],
         "geometry": ["type": "LineString", "coordinates": Array(points)]]
      }
      switch route.style {
      case "solid": return [feature("done", coordinates[...])]
      case "mixed":
        let split = min(max(route.doneThrough, 1), coordinates.count) - 1
        var parts: [[String: Any]] = []
        if split >= 1 { parts.append(feature("done", coordinates[0...split])) }
        if split < coordinates.count - 1 { parts.append(feature("planned", coordinates[split...])) }
        return parts
      default: return [feature("planned", coordinates[...])]
      }
    }
  }

  /// Text for a tapped marker.
  func detail(_ id: String) -> String? {
    if id.hasPrefix("friend:"), let friend = friendsOut.first(where: { "friend:\($0.user.id)" == id }) {
      let when = HermiDates.parse(friend.at).map { $0.formatted(.relative(presentation: .named)) } ?? "recently"
      return "\(friend.user.name) checked in at \(friend.place.name) \(when)\(friend.active ? " · there now" : "")"
    }
    if id.hasPrefix("open:"), let open = openPlans.first(where: { "open:\($0.plan.id)" == id }) {
      return "Open plan “\(open.plan.name)” · \(open.action == "requested" ? "request sent" : "request to join from the Feed")"
    }
    return nil
  }

  var label: String {
    "SOCIAL · \(friendsOut.count) OUT · \(routes.count) PLAN\(routes.count == 1 ? "" : "S") · CHECK-INS, NOT LIVE GPS"
  }
}
