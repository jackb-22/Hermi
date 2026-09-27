import SwiftUI

/// Accessibility descriptions only; no press-and-hold explanation or gesture interception.
extension View {
  func controlHelp(_ text: String) -> some View { accessibilityHint(text) }
}

/// Standard buttons: no hold recognizer or cross-tab drag gesture.
struct HomeNavigationPill: View {
  let selected: HomePanel
  var select: (HomePanel) -> Void

  var body: some View {
    HStack(spacing: 8) {
      ForEach(HomePanel.allCases, id: \.self) { panel in
        Button { select(panel) } label: {
          VStack(spacing: 3) {
            NavigationSprite(panel: panel, selected: selected == panel).frame(width: 23, height: 23)
            Text(panel.rawValue).font(.system(size: 10, weight: .medium))
          }.frame(width: 64, height: 48)
            .foregroundStyle(selected == panel ? HermiPalette.paper : HermiPalette.ink)
            .background(selected == panel ? HermiPalette.ink : .clear, in: Capsule())
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(panel.rawValue)
        .accessibilityIdentifier("home-tab-\(panel.rawValue.lowercased())")
        .accessibilityAddTraits(selected == panel ? .isSelected : [])
        .accessibilityHint("Open \(panel.rawValue)")
        .help("Open \(panel.rawValue)")
      }
    }.padding(6).background(HermiPalette.controlSurface, in: Capsule())
      .overlay(Capsule().stroke(HermiPalette.ink.opacity(0.15)).allowsHitTesting(false))
  }
}
