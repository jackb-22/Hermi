import SwiftUI

/// Vector pixel mark derived from App logo.jpg: coral crab + stepped skyscraper shell.
/// No bitmap scaling, gradients, street scenery, or tiny window detail.
struct HermitBrandMark: View {
  var emergence: Double = 1
  var stride: Int = 0
  var body: some View {
    Canvas { context, size in
      let unit = min(size.width / 32, size.height / 36)
      let origin = CGPoint(x: (size.width - 32 * unit) / 2, y: (size.height - 36 * unit) / 2)
      func box(_ x: Double, _ y: Double, _ w: Double, _ h: Double, _ color: Color) {
        context.fill(Path(CGRect(x: origin.x + x * unit, y: origin.y + y * unit, width: w * unit, height: h * unit)), with: .color(color))
      }
      let ink = HermiPalette.ink, coral = HermiPalette.coral
      // Broad, tiered spire silhouette remains legible even at 40 points.
      box(22, 1, 2, 5, ink); box(20, 6, 5, 5, ink)
      box(17, 10, 9, 5, ink); box(13, 14, 14, 6, ink)
      box(8, 19, 21, 10, ink)
      box(21, 7, 2, 4, HermiPalette.lavender)
      box(18, 11, 6, 4, HermiPalette.paper)
      box(14, 15, 11, 5, HermiPalette.lavender)
      box(9, 20, 18, 7, HermiPalette.paper)
      box(23, 11, 1, 4, HermiPalette.lavender)
      box(22, 16, 2, 4, HermiPalette.paper)
      box(11, 22, 13, 1, HermiPalette.lavender)
      // Hidden body emerges below the shell. Two alternating foot positions suggest a crawl.
      let peek = max(0, min(1, emergence))
      if peek > 0 {
        let y = 25 + (1 - peek) * 3
        let foot = Double(stride % 2)
        box(9, y, 17, 8 * peek, ink)
        box(10, y + 1, 15, 6 * peek, coral)
        box(12, y + 2, 2, 2, ink); box(21, y + 2, 2, 2, ink)
        box(17, y + 5, 3, 1, ink)
        box(7 - foot, 30, 3, 4 * peek, ink); box(8 - foot, 30, 1, 3 * peek, coral)
        box(25 + foot, 30, 3, 4 * peek, ink); box(26 + foot, 30, 1, 3 * peek, coral)
        box(12 + foot, 32, 2, 3 * peek, coral); box(20 - foot, 32, 2, 3 * peek, coral)
        box(3, 27, 5, 4 * peek, ink); box(4, 27, 3, 3 * peek, coral)
        box(27, 27, 4, 4 * peek, ink); box(28, 27, 2, 3 * peek, coral)
      }
    }.accessibilityHidden(true)
  }
}

struct CrabIntroFrame: Equatable {
  static let duration: Double = 5.4
  let elapsed: Double
  var emergence: Double { min(1, max(0, (elapsed - 0.2) / 0.6)) }
  var travel: Double {
    if elapsed < 1 { return 0 }
    if elapsed < 1.35 { return (elapsed - 1) / 0.35 * 0.04 }
    if elapsed < 1.65 { return 0.04 } // Cautious first step, then a pause.
    return min(1, 0.04 + (elapsed - 1.65) / 2.25 * 0.96)
  }
  var crabVisible: Bool { elapsed < 4 }
  var logoOpacity: Double { min(1, max(0, (elapsed - 4.05) / 0.6)) }
  var stride: Int { travel > 0 && elapsed < 3.9 ? Int(elapsed * 7) % 2 : 0 }
}

enum BrandIntroPolicy {
  static let key = "hermi.brand.introSeen.v1"
  static func shouldShow(seen: Bool, demo: Bool, fixture: Bool, recoveringAction: Bool = false) -> Bool {
    !recoveringAction && (demo || (!seen && !fixture))
  }
}

extension Notification.Name { static let hermiReplayIntro = Notification.Name("hermi.brand.replayIntro") }

struct CrabIntroView: View {
  var complete: () -> Void
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @Environment(\.scenePhase) private var scenePhase
  @State private var start = Date()
  private var reviewTime: Double? {
    #if DEBUG
    guard let argument = ProcessInfo.processInfo.arguments.first(where: { $0.hasPrefix("--hermi-brand-frame=") }),
          let time = Double(argument.split(separator: "=").last ?? ""), time.isFinite else { return nil }
    return min(CrabIntroFrame.duration, max(0, time))
    #else
    return nil
    #endif
  }
  var body: some View {
    GeometryReader { geometry in
      ZStack {
        HermiPalette.paper.ignoresSafeArea()
        TimelineView(.animation(minimumInterval: 1.0 / 30, paused: scenePhase != .active)) { timeline in
          let frame = CrabIntroFrame(elapsed: reviewTime ?? timeline.date.timeIntervalSince(start))
          ZStack {
            if !reduceMotion && frame.crabVisible {
              let size = min(108.0, geometry.size.width * 0.26)
              let x = 18 + (geometry.size.width + size) * frame.travel
              ForEach(0..<12) { index in
                let progress = Double(index) / 12
                if progress < frame.travel {
                  Rectangle().fill(HermiPalette.ink.opacity(0.1 * (1 - frame.travel)))
                    .frame(width: 5, height: 2)
                    .position(x: 30 + (geometry.size.width - 40) * progress, y: geometry.size.height * 0.53 + Double(index % 2) * 5)
                }
              }
              HermitBrandMark(emergence: frame.emergence, stride: frame.stride)
                .frame(width: size, height: size * 1.125)
                .position(x: x + size / 2, y: geometry.size.height * 0.53 - size / 2)
            }
            VStack(spacing: 14) {
              HermitBrandMark().frame(width: 128, height: 144)
              Text("hermi").font(.system(size: 34, weight: .semibold, design: .rounded)).tracking(2)
                .foregroundStyle(HermiPalette.ink)
            }.opacity(reduceMotion ? 1 : frame.logoOpacity)
          }
        }.accessibilityElement(children: .ignore).accessibilityLabel("Hermi. Come out of your shell.")
        VStack { HStack { Spacer(); Button("Skip") { complete() }.frame(minWidth: 44, minHeight: 44) }; Spacer() }
          .padding(20).foregroundStyle(HermiPalette.secondary)
      }
    }.task {
      start = Date()
      guard reviewTime == nil else { return }
      do { try await Task.sleep(for: .seconds(reduceMotion ? 0.8 : CrabIntroFrame.duration)) } catch { return }
      complete()
    }
  }
}

/// Compact loading content; parent owns loading/cancellation. No full-screen hit-testing shield.
struct CrabLoadingView: View {
  var label = "Loading…"
  var cancel: (() -> Void)? = nil
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @Environment(\.scenePhase) private var scenePhase
  var body: some View {
    HStack(spacing: 10) {
      TimelineView(.animation(minimumInterval: 1.0 / 12, paused: reduceMotion || scenePhase != .active)) { timeline in
        let phase = timeline.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 2.8)
        ZStack(alignment: .bottom) {
          HStack(spacing: 4) {
            ForEach(0..<3) { index in
              Rectangle().fill(HermiPalette.ink.opacity(reduceMotion ? 0.1 : (phase > Double(index) * 0.5 ? 0.15 * (1 - phase / 2.8) : 0)))
                .frame(width: 3, height: 1)
            }
          }
          HermitBrandMark(emergence: reduceMotion ? 1 : min(1, phase * 2), stride: reduceMotion ? 0 : Int(phase * 6) % 2)
            .frame(width: 36, height: 42)
        }
      }
      Text(label).font(.caption).foregroundStyle(HermiPalette.ink)
      if let cancel {
        Button(action: cancel) { PixelIcon(name: "close").frame(width: 14, height: 14).frame(width: 44, height: 44) }
          .accessibilityLabel("Dismiss loading indicator")
      }
    }.padding(8).background(HermiPalette.paper, in: PixelPanel(corner: 5)).buttonStyle(.plain)
      .accessibilityElement(children: .contain)
  }
}
