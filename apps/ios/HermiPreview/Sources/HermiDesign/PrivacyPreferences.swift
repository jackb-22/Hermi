import Foundation

enum RouteAudience: String, Codable, CaseIterable { case privateOnly = "Private", friends = "Friends", publicRoutes = "Public" }
enum PresenceAudience: String, Codable, CaseIterable { case nobody = "Nobody", friends = "Friends" }
struct PrivacyPreferences: Codable, Equatable {
  var routes: RouteAudience = .privateOnly
  var locationSharing = false
  var presence: PresenceAudience = .nobody
  static func migrated(routeAudience: String?) -> Self {
    var preferences = Self()
    preferences.routes = routeAudience == "Everyone" ? .publicRoutes : routeAudience == "Friends" ? .friends : .privateOnly
    return preferences
  }
}
extension MapPreviewState {
  var privacyOptions: PrivacyPreferences {
    get { storedPrivacyPreferences ?? PrivacyPreferences() }
    set { storedPrivacyPreferences = newValue }
  }
}
