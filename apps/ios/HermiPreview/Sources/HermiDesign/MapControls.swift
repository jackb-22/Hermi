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
    case "left": return ["   II", "  II ", " II  ", "II   ", " II  ", "  II ", "   II"]
    case "right": return ["II   ", " II  ", "  II ", "   II", "  II ", " II  ", "II   "]
    case "back": return ["   II    ","  II     "," II      ","IIIIIIIII"," II      ","  II     ","   II    "]
    case "plus": return ["   II   ","   II   ","   II   ","IIIIIIII","IIIIIIII","   II   ","   II   ","   II   "]
    case "minus": return ["        ","        ","IIIIIIII","IIIIIIII","        ","        "]
    case "check": return ["        I","       II","      II ","II   II  "," II II   ","  III    ","   I     "]
    case "saved": return ["IIIIIII","IIIIIII","IIIIIII","IIIIIII","IIIIIII","III III","II   II","I     I"]
    case "save": return ["IIIIIII","I     I","I     I","I     I","I     I","I  I  I","I I I I","II   II"]
    case "play": return ["II      ","IIII    ","IIIIII  ","IIIIIIII","IIIIII  ","IIII    ","II      "]
    case "photo": return ["IIIIIIIIIII","I         I","I  II     I","I  II  I  I","I     III I","I II IIIII I","IIIIIIIIIII"]
    case "locate": return ["    I    ","   III   ","  IIIII  "," IIIIIII ","IIIIIIIII"," III III "," II   II "," I     I "]
    case "spark": return ["    I      ","    I      ","   III     ","IIIIIIIII I","   III   III","    I     I ","    I      "]
    case "walk": return ["  II  ","  II  ","      "," IIII ","I II I","  II  "," I  I ","I    I"]
    case "transit": return [" IIIIIII "," I  I  I "," I  I  I "," IIIIIII "," IIIIIII "," I     I ","  I   I  "," I     I "]
    case "bike": return ["     II  ","  IIII   ","   I  I  "," III III ","I I I I I","I I   I I"," I     I "]
    case "car": return ["  IIIII  "," I     I ","IIIIIIIII","IIIIIIIII","I       I"," II   II "]
    case "send": return ["I        ","III      ","IIIII    ","IIIIIII  ","IIIII    ","III      ","I        "]
    default: return ["         ","II II II ","II II II ","         "]
    }
  }
  var body: some View { PixelSprite(rows: rows, colors: ["I": HermiPalette.ink]) }
}

struct CategoryPinControl: View {
  @Binding var category: HermiCategory
  var filterActive = false
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
    let hold = LongPressGesture(minimumDuration: 0.3, maximumDistance: 8)
      .sequenced(before: DragGesture(minimumDistance: 0, coordinateSpace: .named("mapPreview")))
      .onChanged { value in
        if case .second(true, let drag?) = value {
          dragging = drag.translation
          if !dropping && hypot(drag.translation.width, drag.translation.height) > 8 {
            dropping = true; feedback += 1; onDragBegan()
          }
        }
      }
    let swipe = DragGesture(minimumDistance: 8)
      .onChanged { drag in
        if !showing { originCategory = category; showing = true }
        guard abs(drag.translation.width) > abs(drag.translation.height) else { return }
        let start = categories.firstIndex(of: originCategory) ?? 0
        let delta = Int((-drag.translation.width / 36).rounded())
        let index = (start + delta % categories.count + categories.count) % categories.count
        if category != categories[index] { category = categories[index]; feedback += 1 }
      }
    VStack(spacing: 2) {
      HStack(spacing: 6) {
        PixelIcon(name: "left").frame(width: 8, height: 12).allowsHitTesting(false)
        BallpointPin(category: category).frame(width: 33, height: 42)
          .opacity(dropping ? 0.35 : 1)
          .frame(width: 44, height: 44).contentShape(Rectangle())
          .overlay {
            if dropping {
              BallpointPin(category: category).frame(width: 33, height: 42)
                .offset(dragging).allowsHitTesting(false)
            }
          }
          .gesture(hold.exclusively(before: swipe)
            .updating($touching) { _, active, _ in active = true }
            .onEnded { value in
              switch value {
              case .first(.second(true, let drag?)): if dropping { onDrop(drag.location) }
              default: break
              }
              showing = false; dropping = false; dragging = .zero
            })
          .simultaneousGesture(TapGesture().onEnded { if !dropping { onFilter() } })
        PixelIcon(name: "right").frame(width: 8, height: 12).allowsHitTesting(false)
      }
      Text(category.rawValue).font(.caption2.weight(.semibold)).fixedSize()
        .underline(filterActive, color: HermiPalette.green)
    }
      .onChange(of: touching) { _, active in
        if !active { showing = false; dropping = false; dragging = .zero }
      }
      .sensoryFeedback(.selection, trigger: feedback)
      .accessibilityElement(children: .ignore).accessibilityLabel("Activity pin")
      .accessibilityValue(category.rawValue + (filterActive ? ", citywide filter active" : ""))
      .accessibilityHint("Swipe left or right to choose a category. Hold briefly, then drag onto the map to discover.")
      .accessibilityAdjustableAction { direction in
        let current = categories.firstIndex(of: category) ?? 0
        category = categories[(current + (direction == .increment ? 1 : categories.count-1)) % categories.count]
      }
      .accessibilityAction(named: "Filter this category", onFilter)
  }
}
