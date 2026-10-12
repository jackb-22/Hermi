import SwiftUI

enum DiscoveryPanelLevel: Int, CaseIterable {
  case compact, medium, full
  var next: Self { Self(rawValue: rawValue + 1) ?? .compact }
  func afterDrag(_ translation: CGFloat, predicted: CGFloat) -> Self? {
    let delta = abs(predicted) > abs(translation) ? predicted : translation
    guard abs(delta) >= 40 else { return self }
    if delta < 0 { return Self(rawValue: min(2, rawValue + 1)) }
    return Self(rawValue: rawValue - 1) // dragging down from compact dismisses
  }
  func height(viewport: CGFloat, safeTop: CGFloat, isPlace: Bool = false) -> CGFloat {
    let compactHeight = isPlace ? min(360, viewport * 0.52) : min(300, viewport * 0.39)
    switch self {
    // Place peek must show its identity and independent Save/Add controls as a
    // complete group before the feed begins scrolling below it.
    case .compact: return compactHeight
    case .medium: return max(compactHeight, min(viewport * 0.65, viewport - 460))
    case .full: return viewport - safeTop
    }
  }
}
