import SwiftUI

/// Shared pin geometry is sent to the geographic renderer as well as drawn natively.
enum PinArtwork {
  static func rows(for category: HermiCategory) -> [String] {
    var pixels = (["    IIIIIII    ", "  IIFFFFFFFII  ", " IFFFFFFFFFFFI "]
      + Array(repeating: "IFFFFFFFFFFFFFI", count: 8)
      + [" IFFFFFFFFFFFI ", "  IIFFFFFFFII  ", "    IIIIIII    "]
      + Array(repeating: "       I       ", count: 5)).map(Array.init)
    for (y, row) in CategorySprite.rows(for: category).enumerated() {
      for (x, pixel) in row.enumerated() where pixel == "I" { pixels[y + 3][x + 3] = "I" }
    }
    return pixels.map { String($0) }
  }
  static func hex(_ category: HermiCategory) -> String {
    HermiPalette.hex(HermiPalette.categoryRGB(category))
  }
}
struct BallpointPin: View {
  let category: HermiCategory
  var body: some View {
    PixelSprite(rows: PinArtwork.rows(for: category), colors: ["I": HermiPalette.ink, "F": HermiPalette.category(category), "H": HermiPalette.paper.opacity(0.8)])
  }
}
struct PixelIcon: View {
  let name: String
  private var rows: [String] {
    switch name {
    case "info": return ["   III   ","         ","   III   ","    II   ","    II   ","    II   ","  IIIIII "]
    case "social": return ["  III  III ","  III  III ","           "," IIIII IIII"," IIIII IIII"," IIIII IIII","  I I  I I ","  I I  I I "]
    case "plan": return ["   IIIIIIIIII", "  I         I", " I          I", "I           I", " I          I", "  I         I", "   IIIIIIIIII"]
    case "settings": return ["    III    "," II III II "," IIIIIIIII ","  II   II  ","III I I III","III I I III","  II   II  "," IIIIIIIII "," II III II ","    III    "]
    case "clock": return ["   IIIII   "," II     II "," I   I   I ","I    I    I","I    III  I","I         I"," I       I "," II     II ","   IIIII   "]
    case "camera": return ["   IIIII   ","IIIIIIIIIII","I         I","I   III   I","I  I   I  I","I   III   I","I         I","IIIIIIIIIII"]
    case "route": return ["III        ","I I IIIIII ","III I    I ","    I    I ","    I    I ","    IIII I ","       I   ","       I III","       I I I","       I III"]
    case "grid": return ["III III III","III III III","III III III","           ","III III III","III III III","III III III","           ","III III III","III III III","III III III"]
    case "close": return ["II     II"," II   II ","  II II  ","   III   ","  II II  "," II   II ","II     II"]
    case "back": return ["   II    ","  II     "," II      ","IIIIIIIII"," II      ","  II     ","   II    "]
    case "plus": return ["   II   ","   II   ","   II   ","IIIIIIII","IIIIIIII","   II   ","   II   ","   II   "]
    case "minus": return ["        ","        ","IIIIIIII","IIIIIIII","        ","        "]
    case "check": return ["        I","       II","      II ","II   II  "," II II   ","  III    ","   I     "]
    case "saved": return ["IIIIIII","IIIIIII","IIIIIII","IIIIIII","IIIIIII","III III","II   II","I     I"]
    case "save": return ["IIIIIII","I     I","I     I","I     I","I     I","I  I  I","I I I I","II   II"]
    case "play": return ["II      ","IIII    ","IIIIII  ","IIIIIIII","IIIIII  ","IIII    ","II      "]
    case "photo": return ["IIIIIIIIIII","I         I","I  II     I","I  II  I  I","I     III I","I II IIIII I","IIIIIIIIIII"]
    case "locate": return ["    I    ","   III   ","  IIIII  "," IIIIIII ","IIIIIIIII"," III III "," II   II "," I     I "]
    default: return ["         ","II II II ","II II II ","         "]
    }
  }
  var body: some View { PixelSprite(rows: rows, colors: ["I": HermiPalette.ink]) }
}

struct CategoryPinControl: View {
  @Binding var category: HermiCategory
  var onFilter: () -> Void
  var onDrop: (CGPoint) -> Void
  var onDragBegan: () -> Void = {}
  @State private var showing = false
  @State private var originCategory: HermiCategory = .food
  @State private var dragging = CGSize.zero
  @State private var feedback = 0
  @State private var dropping = false
  @GestureState private var touching = false
  private let categories = HermiCategory.allCases
  var body: some View {
    let hold = LongPressGesture(minimumDuration: 0.3, maximumDistance: 24)
      .sequenced(before: DragGesture(minimumDistance: 0, coordinateSpace: .named("mapPreview")))
      .onChanged { value in
        if case .second(true, let drag) = value {
          if !showing { originCategory = category; showing = true; feedback += 1 }
          if let drag {
            dragging = drag.translation
            if !dropping && abs(drag.translation.width) > 40 {
              dropping = true; onDragBegan()
            }
            if !dropping {
              let start = categories.firstIndex(of: originCategory) ?? 0
              let delta = Int((-drag.translation.height / 48).rounded())
              let index = (start + delta % categories.count + categories.count) % categories.count
              if category != categories[index] { category = categories[index]; feedback += 1 }
            }
          }
        }
      }
    BallpointPin(category: category).frame(width: 33, height: 42)
      .opacity(dropping ? 0.35 : 1)
      .frame(width: 52, height: 52).contentShape(Rectangle())
      // Keep the gesture's source stationary; only the noninteractive ghost moves.
      .overlay {
        if dropping {
          BallpointPin(category: category).frame(width: 33, height: 42)
            .offset(dragging).allowsHitTesting(false)
        }
      }
      .gesture(hold.exclusively(before: TapGesture())
        .updating($touching) { _, active, _ in active = true }
        .onEnded { value in
          switch value {
          case .second: onFilter()
          case .first(.second(true, let drag?)):
            if dropping { onDrop(drag.location) }
          default: break
          }
          showing = false; dropping = false; dragging = .zero
        })
      .onChange(of: touching) { _, active in
        if !active { showing = false; dropping = false; dragging = .zero }
      }
      .overlay(alignment: .topTrailing) {
        if showing && !dropping {
          VStack(spacing: 4) {
            ForEach(-1...1, id: \.self) { offset in
              let index = ((categories.firstIndex(of: category) ?? 0) + offset + categories.count) % categories.count
              HStack(spacing: 8) {
                Text(categories[index].rawValue).font(.caption.weight(offset == 0 ? .bold : .regular))
                CategorySprite(category: categories[index]).frame(width: 20, height: 20)
              }.frame(height: 36).opacity(offset == 0 ? 1 : 0.45)
            }
          }.frame(width: 150).fixedSize(horizontal: true, vertical: true).padding(10).background(HermiPalette.paper, in: PixelPanel(corner: 6)).offset(x: -62)
            .allowsHitTesting(false)
        }
      }
      .sensoryFeedback(.selection, trigger: feedback)
      .accessibilityElement(children: .ignore).accessibilityLabel("Activity pin")
      .accessibilityValue(category.rawValue)
      .accessibilityHint("Hold, slide vertically to choose, release to keep. Hold and drag left onto map to discover.")
      .accessibilityAdjustableAction { direction in
        let current = categories.firstIndex(of: category) ?? 0
        category = categories[(current + (direction == .increment ? 1 : categories.count-1)) % categories.count]
      }
      .accessibilityAction(named: "Filter this category", onFilter)
  }
}
