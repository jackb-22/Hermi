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

struct HomeNavigationPill: View {
  let selected: HomePanel
  var select: (HomePanel) -> Void
  @State private var candidate: HomePanel?
  @State private var held = false
  static func panel(at x: CGFloat) -> HomePanel {
    HomePanel.allCases[min(2, max(0, Int((x - 6) / 72)))]
  }
  var body: some View {
    HStack(spacing: 8) {
      ForEach(HomePanel.allCases, id: \.self) { panel in
        Button { select(panel) } label: {
          VStack(spacing: 3) {
            NavigationSprite(panel: panel, selected: (candidate ?? selected) == panel).frame(width: 23, height: 23)
            Text(panel.rawValue).font(.system(size: 10, weight: .medium))
          }.frame(width: 64, height: 48)
            .foregroundStyle((candidate ?? selected) == panel ? HermiPalette.paper : HermiPalette.ink)
            .background((candidate ?? selected) == panel ? HermiPalette.ink : .clear, in: Capsule())
        }.buttonStyle(.plain).accessibilityLabel(panel.rawValue)
          .accessibilityAddTraits(selected == panel ? .isSelected : [])
          .help("Open \(panel.rawValue). Hold the pill and slide to another page.")
      }
    }.padding(6).background(HermiPalette.paper, in: Capsule())
      .overlay(Capsule().stroke(HermiPalette.ink.opacity(0.15)))
      .coordinateSpace(name: "homePill")
      .highPriorityGesture(LongPressGesture(minimumDuration: 0.35, maximumDistance: 18)
        .sequenced(before: DragGesture(minimumDistance: 0, coordinateSpace: .named("homePill")))
        .onChanged { value in
          if case .second(true, let drag) = value {
            held = true
            if let drag { candidate = Self.panel(at: drag.location.x) }
          }
        }.onEnded { value in
          if case .second(true, let drag?) = value { select(Self.panel(at: drag.location.x)) }
          held = false; candidate = nil
        })
      .overlay(alignment: .top) {
        if held {
          Text(candidate.map { "Release to open \($0.rawValue)" } ?? "Slide left or right")
            .font(.caption).padding(10).background(HermiPalette.paper, in: PixelPanel(corner: 5)).offset(y: -48)
            .allowsHitTesting(false)
        }
      }
      .sensoryFeedback(.selection, trigger: candidate)
      .onDisappear { held = false; candidate = nil }
  }
}
