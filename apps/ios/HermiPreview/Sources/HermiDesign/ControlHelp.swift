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

/// Hit testing is confined to the pill; an off-pill release cancels rather than clamping.
enum HomePillLayout {
  static let segmentWidth: CGFloat = 64
  static let spacing: CGFloat = 8
  static let inset: CGFloat = 6
  static let height: CGFloat = 60
  static let width: CGFloat = 220

  static func panel(at point: CGPoint) -> HomePanel? {
    guard point.x.isFinite, point.y.isFinite,
          point.x >= 0, point.x <= width, point.y >= 0, point.y <= height else { return nil }
    let index = min(HomePanel.allCases.count - 1, max(0, Int((point.x - inset + spacing / 2) / (segmentWidth + spacing))))
    return HomePanel.allCases[index]
  }
}

/// Own both gestures at the button level. A short release fails the hold immediately
/// and triggers the tap; a recognized hold never falls through to the tap action.
private struct PillButtonStyle: PrimitiveButtonStyle {
  let panel: HomePanel
  let update: (HomePanel?) -> Void
  let finish: (HomePanel?) -> Void
  @GestureState private var holding = false

  func makeBody(configuration: Configuration) -> some View {
    let hold = LongPressGesture(minimumDuration: 0.35, maximumDistance: 18)
      .sequenced(before: DragGesture(minimumDistance: 0, coordinateSpace: .named("homePill")))
      .onChanged { value in
        if case .second(true, let drag) = value {
          update(drag.map { HomePillLayout.panel(at: $0.location) } ?? panel)
        }
      }
    configuration.label
      .contentShape(Rectangle())
      .gesture(hold.exclusively(before: TapGesture())
        .updating($holding) { value, state, _ in
          if case .first(.second(true, _)) = value { state = true }
        }
        .onEnded { value in
          switch value {
          case .second: configuration.trigger()
          case .first(.second(true, let drag)):
            finish(drag.map { HomePillLayout.panel(at: $0.location) } ?? panel)
          default: finish(nil)
          }
        })
      .onChange(of: holding) { _, active in
        if !active { update(nil) }
      }
      .accessibilityAction { configuration.trigger() }
  }
}

struct HomeNavigationPill: View {
  let selected: HomePanel
  var select: (HomePanel) -> Void
  @State private var candidate: HomePanel?
  @State private var helpPanel: HomePanel?

  var body: some View {
    HStack(spacing: HomePillLayout.spacing) {
      ForEach(HomePanel.allCases, id: \.self) { panel in
        Button {
          candidate = nil; helpPanel = nil
          select(panel)
        } label: {
          VStack(spacing: 3) {
            NavigationSprite(panel: panel, selected: (candidate ?? selected) == panel).frame(width: 23, height: 23)
            Text(panel.rawValue).font(.system(size: 10, weight: .medium))
          }.frame(width: HomePillLayout.segmentWidth, height: 48)
            .foregroundStyle((candidate ?? selected) == panel ? HermiPalette.paper : HermiPalette.ink)
            .background((candidate ?? selected) == panel ? HermiPalette.ink : .clear, in: Capsule())
        }
        .buttonStyle(PillButtonStyle(panel: panel, update: { candidate = $0 }, finish: { destination in
          candidate = nil
          if let destination, destination != panel {
            helpPanel = nil
            select(destination)
          } else {
            helpPanel = destination
          }
        }))
        .accessibilityLabel(panel.rawValue)
        .accessibilityIdentifier("home-tab-\(panel.rawValue.lowercased())")
        .accessibilityAddTraits(selected == panel ? .isSelected : [])
        .accessibilityHint("Open \(panel.rawValue). Hold for help, or hold and slide to another page.")
        .help("Open \(panel.rawValue). Hold the pill and slide to another page.")
      }
    }.padding(HomePillLayout.inset).background(HermiPalette.paper, in: Capsule())
      .overlay(Capsule().stroke(HermiPalette.ink.opacity(0.15)).allowsHitTesting(false))
      .coordinateSpace(name: "homePill")
      .overlay(alignment: .top) {
        if let panel = candidate ?? helpPanel {
          Text(candidate == nil ? "\(panel.rawValue): tap to open" : "\(panel.rawValue): slide to another page, then release")
            .font(.caption).multilineTextAlignment(.center).padding(10)
            .fixedSize(horizontal: false, vertical: true)
            .background(HermiPalette.paper, in: PixelPanel(corner: 5)).offset(y: -68)
            .allowsHitTesting(false)
        }
      }
      .sensoryFeedback(.selection, trigger: candidate)
      .task(id: helpPanel) {
        guard helpPanel != nil else { return }
        do { try await Task.sleep(for: .seconds(3)) } catch { return }
        helpPanel = nil
      }
      .onDisappear { candidate = nil; helpPanel = nil }
  }
}
