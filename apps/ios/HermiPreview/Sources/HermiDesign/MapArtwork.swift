import SwiftUI

/// Original illustrative pixel terrain for composition review. Live geographic tiles are a later gate.
struct MapArtwork: View {
  var body: some View {
    Canvas { context, size in
      let sx = size.width / 128, sy = size.height / 240
      context.scaleBy(x: sx, y: sy)
      func box(_ x: Double, _ y: Double, _ w: Double, _ h: Double, _ color: Color) {
        context.fill(Path(CGRect(x: x, y: y, width: w, height: h)), with: .color(color), style: FillStyle(antialiased: false))
      }
      let water = HermiPalette.color(0x91B8C1)
      let land = HermiPalette.color(0xE8E9D5)
      let block = HermiPalette.color(0xD1D4BE)
      let blockLight = HermiPalette.color(0xDDE0CC)
      let park = HermiPalette.color(0xAFC498)
      box(0,0,128,240,water)
      // Stepped shoreline with a slim riverside park and a clear street grid.
      for y in stride(from: 0, to: 240, by: 4) {
        let left = 31 - Double(y)/24
        let right = 109 - Double(y)/38
        box(left.rounded(),Double(y),(right-left).rounded(),4,land)
        box(left.rounded(),Double(y),5,4,park)
      }
      // Opposite shore remains quiet and secondary.
      box(0,0,5,56,park); box(0,56,9,72,park); box(0,128,5,112,park)
      for row in 0..<25 {
        let y = Double(row*9+7)
        for column in 0..<6 {
          let x = Double(column*11+37) - Double(row/6)*2
          box(x,y,8,6,(row+column)%3 == 0 ? blockLight : block)
          box(x+1,y+1,2,1,HermiPalette.paper.opacity(0.45))
        }
      }
      box(64,59,22,77,park)
      box(66,68,18,59,HermiPalette.color(0xBCD0A4))
      box(73,59,2,77,HermiPalette.paper.opacity(0.75))
      box(64,94,22,2,HermiPalette.paper.opacity(0.75))
      box(76,109,7,10,water); box(74,112,2,6,water)
      box(31,167,15,19,park)
      box(38,171,6,11,HermiPalette.color(0xC98067))
      box(39,172,4,9,HermiPalette.color(0xDDAA84))
      // A diagonal avenue in stepped segments.
      for y in stride(from: 0, to: 232, by: 4) {
        let x = 57-Double(y)/22
        box(x.rounded(),Double(y),3,5,HermiPalette.paper)
      }
      func tree(_ x: Double, _ y: Double) {
        box(x+2,y+5,1,2,HermiPalette.ink.opacity(0.65))
        box(x+1,y,3,1,HermiPalette.green)
        box(x,y+1,5,4,HermiPalette.green)
        box(x+1,y+1,2,2,HermiPalette.color(0x86AC7E))
      }
      for (x,y) in [(66,65),(77,71),(67,80),(78,87),(67,102),(66,117),(77,127),(27,145),(29,121),(25,178),(32,50),(34,22),(23,202)] {
        tree(Double(x),Double(y))
      }
      for row in 0..<17 {
        let y=Double(row*15+5), x=Double((row%3)*5+12)
        box(x,y,6,0.5,HermiPalette.paper.opacity(0.42))
        box(x+6,y-0.5,2,0.5,HermiPalette.paper.opacity(0.42))
        box(116,y+7,7,0.5,HermiPalette.paper.opacity(0.35))
      }
      // A small ferry and restrained flowers, with no decorative labels over streets.
      box(13,103,4,7,HermiPalette.paper); box(14,104,2,3,HermiPalette.coral)
      for (x,y) in [(31,84),(68,92),(80,121),(26,163),(36,29)] {
        box(Double(x),Double(y),1,1,HermiPalette.coral)
      }
    }.accessibilityHidden(true)
  }
}

struct NavigationSprite: View {
  let panel: HomePanel
  var selected: Bool
  private var rows: [String] {
    switch panel {
    case .feed: return [" IIIIIII "," I     I "," I  I  I "," I III I "," I  I  I "," I     I "," IIIIIII ","         ","  IIIII  "]
    case .map: return ["  II  II "," I  II  I"," I  II  I"," I  II  I"," I  II  I"," I  II  I"," I  II  I","  II  II ","         "]
    case .profile: return ["   III   ","  I   I  ","  I   I  ","   III   ","         ","  IIIII  "," I     I "," I     I "," IIIIIII "]
    }
  }
  var body: some View {
    if panel == .map {
      GeoNodeMapIcon(color: selected ? HermiPalette.paper : HermiPalette.ink)
    } else {
      PixelSprite(rows: rows, colors: ["I": selected ? HermiPalette.paper : HermiPalette.ink])
    }
  }
}

/// Folded street map with a location node and a short dotted route.
struct GeoNodeMapIcon: View {
  var color: Color
  var body: some View {
    Canvas { context, size in
      let unit = min(size.width, size.height) / 24
      context.scaleBy(x: unit, y: unit)
      func box(_ x: Double, _ y: Double, _ w: Double, _ h: Double) {
        context.fill(Path(CGRect(x: x, y: y, width: w, height: h)), with: .color(color), style: FillStyle(antialiased: false))
      }
      // Three folded panels; an open top right leaves room for the locator.
      box(1,9,2,13); box(3,8,4,2); box(7,9,2,13)
      box(3,20,4,2); box(9,21,5,2); box(14,12,2,11)
      box(16,20,5,2); box(21,12,2,10); box(9,10,3,2)
      // Hollow geographic node, tapering to a precise map point.
      box(15,1,5,2); box(13,3,2,5); box(20,3,2,5)
      box(15,8,2,2); box(18,8,2,2); box(16,10,3,2)
      box(16,4,3,3)
      box(11,14,2,2); box(8,16,2,2); box(4,15,2,2)
    }.accessibilityHidden(true)
  }
}
