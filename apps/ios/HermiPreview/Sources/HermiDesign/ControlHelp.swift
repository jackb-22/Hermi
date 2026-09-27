import SwiftUI

/// A long hold describes a control without invoking its tap action. Desktop uses native hover help.
private struct ControlHelp: ViewModifier {
  let text: String
  @State private var showing = false
  func body(content: Content) -> some View {
    content.help(text).accessibilityHint(text)
      .highPriorityGesture(LongPressGesture(minimumDuration: 0.6).onEnded { _ in showing = true })
      .popover(isPresented: $showing) {
        Text(text).font(.subheadline).padding(16).frame(maxWidth: 240)
          .foregroundStyle(HermiPalette.ink).background(HermiPalette.paper)
          .presentationCompactAdaptation(.popover)
      }
  }
}
extension View {
  func controlHelp(_ text: String) -> some View { modifier(ControlHelp(text: text)) }
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
    }.padding(6).background(HermiPalette.paper, in: Capsule())
      .overlay(Capsule().stroke(HermiPalette.ink.opacity(0.15)).allowsHitTesting(false))
  }
}
