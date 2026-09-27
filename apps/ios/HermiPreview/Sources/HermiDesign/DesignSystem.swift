import SwiftUI

enum HermiPalette {
  // One RGB source for SwiftUI sprites, the map renderer and map UI chrome.
  static let inkRGB: UInt32 = 0x203D39
  static let paperRGB: UInt32 = 0xF8FAF3
  static let greenRGB: UInt32 = 0x23856B
  static let limeRGB: UInt32 = 0xBFDE59
  static let lakeRGB: UInt32 = 0x69B7CC
  static let coralRGB: UInt32 = 0xEF8067
  static let lavenderRGB: UInt32 = 0xA596DD
  static let ink = color(inkRGB)
  static let paper = color(paperRGB)
  static let green = color(greenRGB)
  static let lime = color(limeRGB)
  static let lake = color(lakeRGB)
  static let coral = color(coralRGB)
  static let lavender = color(lavenderRGB)
  static let secondary = color(0x52675E)
  static let line = color(0xCED9CB)
  static let error = color(0x974C3B)
  static func color(_ value: UInt32) -> Color {
    Color(red: Double((value >> 16) & 255) / 255, green: Double((value >> 8) & 255) / 255, blue: Double(value & 255) / 255)
  }
  static func hex(_ value: UInt32) -> String { String(format: "#%06X", value) }
  static func categoryRGB(_ category: HermiCategory) -> UInt32 {
    switch category {
    case .food: return coralRGB
    case .shopping: return 0xE2B652
    case .nature: return limeRGB
    case .culture: return lavenderRGB
    case .drinks: return 0xD7A27D
    case .sports: return lakeRGB
    case .music: return 0xCE87BA
    }
  }
  static func category(_ category: HermiCategory) -> Color { color(categoryRGB(category)) }
  static var mapColors: [String: String] {
    ["ink": hex(inkRGB), "paper": hex(paperRGB), "green": hex(greenRGB),
     "lime": hex(limeRGB), "lake": hex(lakeRGB), "coral": hex(coralRGB),
     "land": "#ECEDD9", "cover": "#C4DAB0", "parks": "#AED095",
     "buildings": "#D2D9BE", "paths": "#739D69"]
  }
}

struct PixelPanel: Shape {
  var corner: CGFloat = 8
  func path(in rect: CGRect) -> Path {
    let c = min(corner, min(rect.width, rect.height) / 4)
    let x = rect.minX, y = rect.minY, w = rect.width, h = rect.height
    return Path { p in
      p.move(to: CGPoint(x: x+c, y: y)); p.addLine(to: CGPoint(x: x+w-c, y: y))
      p.addLine(to: CGPoint(x: x+w-c, y: y+c)); p.addLine(to: CGPoint(x: x+w, y: y+c))
      p.addLine(to: CGPoint(x: x+w, y: y+h-c)); p.addLine(to: CGPoint(x: x+w-c, y: y+h-c))
      p.addLine(to: CGPoint(x: x+w-c, y: y+h)); p.addLine(to: CGPoint(x: x+c, y: y+h))
      p.addLine(to: CGPoint(x: x+c, y: y+h-c)); p.addLine(to: CGPoint(x: x, y: y+h-c))
      p.addLine(to: CGPoint(x: x, y: y+c)); p.addLine(to: CGPoint(x: x+c, y: y+c)); p.closeSubpath()
    }
  }
}

struct HermiButtonStyle: ButtonStyle {
  var secondary = false
  @Environment(\.isEnabled) private var enabled
  func makeBody(configuration: Configuration) -> some View {
    configuration.label.font(.body.weight(.semibold))
      .frame(maxWidth: .infinity, minHeight: 48).padding(.horizontal, 16)
      .foregroundStyle(enabled ? (secondary ? HermiPalette.ink : HermiPalette.paper) : HermiPalette.secondary)
      .background(PixelPanel(corner: 5).fill(enabled ? (secondary ? Color.white : HermiPalette.ink) : HermiPalette.line))
      .overlay(PixelPanel(corner: 5).strokeBorderEquivalent(secondary ? HermiPalette.line : .clear))
      .offset(y: configuration.isPressed && enabled ? 2 : 0)
      .opacity(configuration.isPressed ? 0.85 : 1)
  }
}

extension Shape {
  func strokeBorderEquivalent(_ color: Color) -> some View { stroke(color, lineWidth: 1) }
}

struct Eyebrow: View {
  let text: String
  var body: some View {
    Text(text.uppercased()).font(.system(.caption2, design: .monospaced).weight(.semibold))
      .tracking(1.5).foregroundStyle(HermiPalette.secondary)
  }
}

/// Small original bitmap alphabet: no downloaded font or platform font substitution.
struct PixelText: View {
  let text: String
  var unit: CGFloat = 3
  var color: Color = HermiPalette.ink
  @ScaledMetric(relativeTo: .title2) private var scale = 1.0
  private var width: CGFloat { CGFloat(max(1, text.count * 6 - 1)) * unit }
  var body: some View {
    Canvas { context, size in
      let cell = min(size.width / CGFloat(max(1, text.count * 6 - 1)), size.height / 7)
      for (index, character) in text.enumerated() {
        let pattern = Self.glyphs[character] ?? Self.glyphs[Character(String(character).uppercased())] ?? Self.glyphs[" "]!
        for (row, mask) in pattern.enumerated() {
          for column in 0..<5 where (mask & (1 << (4-column))) != 0 {
            let rect = CGRect(x: CGFloat(index * 6 + column) * cell, y: CGFloat(row) * cell, width: cell, height: cell)
            context.fill(Path(rect), with: .color(color))
          }
        }
      }
    }
    .frame(width: width * min(scale, 1.6), height: 7 * unit * min(scale, 1.6))
    .accessibilityLabel(text)
  }
  private static let glyphs: [Character: [Int]] = [
    "A":[14,17,17,31,17,17,17], "B":[30,17,17,30,17,17,30], "C":[14,17,16,16,16,17,14],
    "D":[30,17,17,17,17,17,30], "E":[31,16,16,30,16,16,31], "F":[31,16,16,30,16,16,16],
    "G":[14,17,16,23,17,17,15], "H":[17,17,17,31,17,17,17], "I":[31,4,4,4,4,4,31],
    "J":[7,2,2,2,18,18,12], "K":[17,18,20,24,20,18,17], "L":[16,16,16,16,16,16,31],
    "M":[17,27,21,21,17,17,17], "N":[17,25,25,21,19,19,17], "O":[14,17,17,17,17,17,14],
    "P":[30,17,17,30,16,16,16], "Q":[14,17,17,17,21,18,13], "R":[30,17,17,30,20,18,17],
    "S":[15,16,16,14,1,1,30], "T":[31,4,4,4,4,4,4], "U":[17,17,17,17,17,17,14],
    "V":[17,17,17,17,17,10,4], "W":[17,17,17,21,21,21,10], "X":[17,17,10,4,10,17,17],
    "Y":[17,17,10,4,4,4,4], "Z":[31,1,2,4,8,16,31],
    "0":[14,17,19,21,25,17,14], "1":[4,12,4,4,4,4,14], "2":[14,17,1,2,4,8,31],
    "3":[30,1,1,14,1,1,30], "4":[2,6,10,18,31,2,2], "5":[31,16,16,30,1,1,30],
    "6":[14,16,16,30,17,17,14], "7":[31,1,2,4,8,8,8], "8":[14,17,17,14,17,17,14],
    "9":[14,17,17,15,1,1,14], " ":[0,0,0,0,0,0,0], ".":[0,0,0,0,0,6,6],
    "h":[16,16,22,25,17,17,17], "e":[0,0,14,17,31,16,14], "r":[0,0,22,25,16,16,16],
    "m":[0,0,26,21,21,21,21], "i":[4,0,12,4,4,4,14],
  ]
}

struct PixelSprite: View {
  let rows: [String]
  let colors: [Character: Color]
  var body: some View {
    Canvas { context, size in
      let columns = rows.map(\.count).max() ?? 1
      let cell = floor(min(size.width / CGFloat(columns), size.height / CGFloat(rows.count)))
      let origin = CGPoint(x: (size.width - CGFloat(columns)*cell)/2, y: (size.height - CGFloat(rows.count)*cell)/2)
      for (y, row) in rows.enumerated() {
        for (x, symbol) in row.enumerated() {
          if let color = colors[symbol] {
            context.fill(Path(CGRect(x: origin.x + CGFloat(x)*cell, y: origin.y + CGFloat(y)*cell, width: cell, height: cell)), with: .color(color))
          }
        }
      }
    }.accessibilityHidden(true)
  }
}

struct HermitSprite: View {
  var body: some View {
    PixelSprite(rows: [
      "       IIIII      ", "     IICCCCCII    ", "    ICCLLLLCCI    ",
      "   ICCLIIILLCCI   ", "   ICLICCLILCI    ", "   ICLICLLILCI    ",
      "   ICCLIIILLCCI   ", "    ICCCCCCCI  I I", " II  IIRRRII   I I",
      "IRRIIRRRRRRRRRIRRI", " IRRRRRRRRRRRRRRI ", "  IIIRIRIRIRRII   ",
      "    I  I I  I     ",
    ], colors: ["I": HermiPalette.ink, "C": HermiPalette.coral, "L": HermiPalette.color(0xF0BE91), "R": HermiPalette.color(0xC67459)])
  }
}

struct CategorySprite: View {
  let category: HermiCategory
  private var rows: [String] {
    switch category {
    case .food: return [" I I   I "," I I  II "," III  II ","  I   II ","  I    I ","  I    I ","  I    I ","  I    I "]
    case .shopping: return ["   III   ","  I   I  ","  I   I  "," IIIIIII "," I I I I "," I     I "," I     I "," IIIIIII "]
    case .nature: return ["    I    ","   III   ","  IIIII  "," IIIIIII ","  IIIII  "," IIIIIII ","    I    ","   III   "]
    case .culture: return ["    I    ","  IIIII  "," IIIIIII ","         "," I I I I "," I I I I "," I I I I "," IIIIIII "]
    case .drinks: return ["  I I    ","   I I   ","         "," IIIIII  "," I    III"," I    I I","  IIIIIII"," IIIIIII "]
    case .sports: return ["   III   ","  IIIII  "," IIIIIII "," I III I "," IIIIIII ","  IIIII  ","   III   ","         "]
    case .music: return ["   IIIII ","   I   I ","   I   I ","   I   I ","   I III "," III III "," III     ","         "]
    }
  }
  var body: some View { PixelSprite(rows: rows, colors: ["I": HermiPalette.ink]) }
}

struct ParkPlacement: View {
  var body: some View {
    Canvas { context, size in
      let unit = size.width/120
      context.scaleBy(x: unit, y: unit)
      func rect(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat, _ color: Color) {
        context.fill(Path(CGRect(x: x, y: y, width: w, height: h)), with: .color(color))
      }
      rect(0,0,120,90,HermiPalette.lake)
      rect(0,3,74,87,HermiPalette.color(0xC4D8AF))
      rect(74,17,6,73,HermiPalette.color(0xC4D8AF)); rect(80,38,6,52,HermiPalette.color(0xC4D8AF))
      rect(86,66,5,24,HermiPalette.color(0xC4D8AF))
      for (x,y) in [(8,16),(29,8),(49,23),(12,50),(48,63),(66,52)] {
        rect(CGFloat(x),CGFloat(y),14,12,HermiPalette.color(0xACC996))
      }
      rect(24,0,8,32,HermiPalette.paper); rect(24,28,28,7,HermiPalette.paper)
      rect(45,28,7,62,HermiPalette.paper); rect(45,66,39,7,HermiPalette.paper)
      for (x,y) in [(8,7),(43,7),(57,23),(7,33),(25,45),(59,47),(13,69),(62,76)] {
        let x = CGFloat(x), y = CGFloat(y)
        rect(x+5,y+14,3,7,HermiPalette.ink)
        rect(x+3,y,7,3,HermiPalette.green); rect(x,y+3,13,10,HermiPalette.green)
        rect(x+2,y+13,9,3,HermiPalette.green); rect(x+3,y+3,5,5,HermiPalette.color(0x78A579))
      }
      for (x,y) in [(94,11),(103,25),(93,49),(107,69),(99,83)] {
        rect(CGFloat(x),CGFloat(y),9,1,HermiPalette.paper.opacity(0.65)); rect(CGFloat(x)+7,CGFloat(y)-1,4,1,HermiPalette.paper.opacity(0.65))
      }
      rect(29,69,9,2,HermiPalette.coral); rect(30,72,7,2,HermiPalette.ink)
      rect(65,7,3,3,HermiPalette.coral); rect(15,60,2,2,HermiPalette.coral)
    }.aspectRatio(4/3, contentMode: .fit).accessibilityLabel("Illustrated park. Sample photo placement, four by three.")
  }
}
