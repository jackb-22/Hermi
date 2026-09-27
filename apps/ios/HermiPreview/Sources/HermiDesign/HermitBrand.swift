import SwiftUI

/// Original native pixel artwork guided by App logo.jpg. Fine limestone ribs,
/// stepped crown and antenna distinguish the Empire State shell at larger sizes.
struct HermitBrandMark: View {
  var emergence: Double = 1
  var stride: Int = 0
  var body: some View {
    Canvas { context, size in
      let unit = min(size.width / 64, size.height / 72)
      let origin = CGPoint(x: (size.width - 64 * unit) / 2, y: (size.height - 72 * unit) / 2)
      func box(_ x: Double, _ y: Double, _ w: Double, _ h: Double, _ color: Color) {
        context.fill(Path(CGRect(x: origin.x + x * unit, y: origin.y + y * unit, width: w * unit, height: h * unit)), with: .color(color), style: FillStyle(antialiased: false))
      }
      let ink = HermiPalette.color(0x292C32)
      let stone = HermiPalette.color(0xE4D4B2), light = HermiPalette.color(0xFFF0CF)
      let shade = HermiPalette.color(0xA49E92), window = HermiPalette.color(0x747C86)
      let coral = HermiPalette.color(0xFF796D), red = HermiPalette.color(0xD9515C)
      let blush = HermiPalette.color(0xED586B), shine = HermiPalette.color(0xFFC3A0)
      // Asymmetric tiered shell: a tall Art Deco tower carried on the crab's back.
      box(40, 0, 2, 9, ink); box(40, 2, 1, 6, light)
      for (x, y, w, h) in [(38.0,8.0,6.0,7.0),(35,14,12,8),(31,21,20,10),(27,29,27,18),(18,38,12,14),(48,37,10,17),(12,48,48,10)] {
        box(x,y,w,h,ink); box(x+1,y+1,w-3,h-2,stone)
        box(x+w-4,y+2,3,h-3,shade); box(x+1,y+1,w-3,1,light)
      }
      box(39,10,2,4,window); box(37,16,2,5,window); box(42,16,2,5,window)
      for x in [33.0,38,43,48] {
        box(x,24,2,22,window); box(x-1,24,1,22,light)
        for y in [29.0,35,41] { box(x,y,2,1,stone) }
      }
      for x in [20.0,24,51,55] { box(x,41,1,10,window) }
      box(14,49,42,2,light); box(15,53,42,3,shade)
      // The shell opening remains visible while the crab cautiously peeks out.
      box(17,51,28,13,ink); box(21,49,20,3,ink)
      let peek = max(0, min(1, emergence))
      if peek > 0 {
        var crab = context
        crab.clip(to: Path(CGRect(x: origin.x, y: origin.y + 30 * unit, width: 64 * unit, height: 42 * unit)))
        // Translate the complete face/limbs together; no detached eyes during reveal.
        crab.translateBy(x: 0, y: (1 - peek) * 22 * unit)
        func pixel(_ x: Double, _ y: Double, _ w: Double, _ h: Double, _ color: Color) {
          crab.fill(Path(CGRect(x: origin.x+x*unit,y: origin.y+y*unit,width:w*unit,height:h*unit)), with: .color(color), style: FillStyle(antialiased: false))
        }
        let foot = Double(stride % 2)
        for (x, y) in [(16.0,60.0),(22,63),(40,63),(47,60)] {
          pixel(x+foot,y,4,7,ink); pixel(x+foot+1,y,2,6,red)
          pixel(x+foot-1,y+6,4,2,ink)
        }
        pixel(18,50,24,15,ink); pixel(21,47,18,3,ink)
        pixel(16,54,28,8,ink); pixel(21,64,18,3,ink)
        pixel(19,51,22,12,coral); pixel(22,49,16,3,coral)
        pixel(18,55,25,6,coral); pixel(22,63,16,2,red)
        pixel(21,50,16,1,shine)
        // Bright eye catches, tiny lower glints, cheek pixels and a friendly smile.
        pixel(22,53,5,6,ink); pixel(34,53,5,6,ink)
        pixel(22,53,2,2,.white); pixel(34,53,2,2,.white)
        pixel(25,57,1,1,window); pixel(37,57,1,1,window)
        pixel(20,59,5,2,blush); pixel(36,59,5,2,blush)
        pixel(29,59,1,1,ink); pixel(32,59,1,1,ink); pixel(30,60,2,1,ink)
        // Liberty torch moves with the crab; the claw wraps around its stem.
        let copper = HermiPalette.color(0x70B5A4)
        let copperShade = HermiPalette.color(0x397F79)
        pixel(8,44,4,17,ink); pixel(9,45,2,15,copperShade)
        pixel(9,46,1,12,copper)
        pixel(5,43,10,4,ink); pixel(6,43,8,2,copper)
        pixel(3,39,14,4,ink); pixel(4,40,12,2,copper)
        pixel(5,38,2,2,copperShade); pixel(9,37,2,3,copper); pixel(13,38,2,2,copperShade)
        pixel(6,33,8,5,ink); pixel(8,31,5,3,ink)
        pixel(7,34,6,3,HermiPalette.color(0xF4AC38))
        pixel(9,32,3,4,HermiPalette.color(0xFFD66B))
        pixel(9,35,2,2,HermiPalette.color(0xFFF2B0))
        // Left raised pincer, right oversized pincer: separated jaws read as claws.
        pixel(10,56,7,4,ink); pixel(7,50,8,8,ink)
        pixel(8,51,3,5,coral); pixel(12,51,2,5,coral)
        pixel(11,49,2,5,ink); pixel(11,56,5,2,red)
        pixel(43,59,8,4,ink); pixel(46,61,13,8,ink)
        pixel(48,58,8,4,ink); pixel(47,62,11,5,coral)
        pixel(49,60,6,3,coral); pixel(45,67,11,4,ink)
        pixel(46,67,9,2,red); pixel(45,63,6,2,ink)
        pixel(48,61,4,1,shine); pixel(53,62,3,1,shine)
        pixel(48,65,2,2,ink)
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
    if elapsed < 1.95 { return 0.04 + (elapsed - 1.65) / 0.3 * 0.06 }
    if elapsed < 2.15 { return 0.10 } // Second cautious step, then gather pace.
    if elapsed < 2.85 {
      let t = (elapsed - 2.15) / 0.7
      return 0.10 + 0.24 * t * t
    }
    return min(1, 0.34 + (elapsed - 2.85) * (0.66 / 1.15))
  }
  var crabVisible: Bool { elapsed < 4 }
  var logoOpacity: Double { min(1, max(0, (elapsed - 4.05) / 0.6)) }
  var stride: Int { travel > 0 && elapsed < 3.9 ? Int(travel * 32) % 2 : 0 }
}

enum BrandIntroPolicy {
  static let key = "hermi.brand.introSeen.v1"
  static func shouldShow(seen: Bool, demo: Bool, fixture: Bool, recoveringAction: Bool = false, existingPreview: Bool = false) -> Bool {
    !recoveringAction && (demo || (!seen && !fixture && !existingPreview))
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
                  Rectangle().fill(HermiPalette.color(0xBAA17A).opacity(0.45 * (1 - frame.travel * 0.5)))
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
