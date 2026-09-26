import SwiftUI

enum Theme {
    static let ink = Color(hex: 0x243C37), paper = Color(hex: 0xF8FAF3), green = Color(hex: 0x447F65)
    static let lime = Color(hex: 0xD5EB93), blue = Color(hex: 0x86BAC7), coral = Color(hex: 0xE58771)
    static let muted = Color(hex: 0x6C7E72), line = Color(hex: 0xDFE5D8), lavender = Color(hex: 0xB4ADD6)
    static func category(_ cat: String) -> Color {
        switch cat { case "food": return coral; case "nature": return green; case "culture": return lavender; case "music": return Color(hex: 0xD6AD60); case "sports": return blue; default: return green }
    }
    static func icon(_ cat: String) -> String {
        switch cat { case "food": return "fork.knife"; case "nature": return "leaf.fill"; case "culture": return "building.columns.fill"; case "shopping": return "bag.fill"; case "drinks": return "cup.and.saucer.fill"; case "sports": return "basketball.fill"; case "music": return "music.note"; default: return "mappin" }
    }
    static let categories = ["all", "food", "shopping", "nature", "culture", "drinks", "sports", "music"]
}
extension Color { init(hex: UInt32) { self.init(red: Double((hex >> 16) & 255)/255, green: Double((hex >> 8) & 255)/255, blue: Double(hex & 255)/255) } }
struct MainButton: View {
    var title: String; var icon: String = "arrow.up.right"; var action: () -> Void
    var body: some View { Button(action: action) { HStack { Text(title).fontWeight(.semibold); Spacer(); Image(systemName: icon) }.padding(17).foregroundStyle(Theme.paper).background(Theme.ink, in: RoundedRectangle(cornerRadius: 19)) }.buttonStyle(.plain) }
}
struct SmallButton: View {
    var title: String; var icon: String; var action: () -> Void
    var body: some View { Button(action: action) { Label(title, systemImage: icon).font(.system(size: 13, weight: .semibold)).padding(.horizontal, 15).padding(.vertical, 12).background(.white.opacity(0.94), in: Capsule()).overlay(Capsule().stroke(Theme.line, lineWidth: 1)) }.buttonStyle(.plain).foregroundStyle(Theme.ink) }
}
struct EmptyCard: View {
    var title: String; var message: String; var icon = "leaf"
    var body: some View { VStack(spacing: 13) { Image(systemName: icon).font(.system(size: 30)).foregroundStyle(Theme.green); Text(title).font(.title3.bold()); Text(message).font(.subheadline).foregroundStyle(Theme.muted).multilineTextAlignment(.center) }.frame(maxWidth: .infinity).padding(30) }
}
struct SectionLabel: View {
    var text: String
    var body: some View { Text(text.uppercased()).font(.system(size: 10, weight: .bold, design: .monospaced)).tracking(2).foregroundStyle(Theme.muted) }
}
struct CategoryBadge: View {
    var category: String; var size: CGFloat = 40
    var body: some View { Image(systemName: Theme.icon(category)).font(.system(size: size * 0.38, weight: .semibold)).foregroundStyle(Theme.category(category)).frame(width: size, height: size).background(Theme.category(category).opacity(0.13), in: RoundedRectangle(cornerRadius: 13)) }
}
struct Stone: Shape {
    func path(in r: CGRect) -> Path {
        var p = Path(); let points: [(CGFloat, CGFloat)] = [(0.02,0.65),(0.13,0.2),(0.4,0.06),(0.75,0.14),(0.96,0.48),(0.9,0.82),(0.57,0.97),(0.13,0.88)]
        for (i,v) in points.enumerated() { let pt = CGPoint(x:r.minX+v.0*r.width,y:r.minY+v.1*r.height); if i==0 { p.move(to:pt) } else { p.addLine(to:pt) } }; p.closeSubpath(); return p
    }
}
struct CairnStack: View {
    var score: Int; var compact = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var blowing = false
    private let colors = [0x647E70, 0x93AD94, 0xBBC99F, 0xD5DFAC, 0x91B4B6, 0xB4ADD6, 0xDFB594, 0xABC49E]
    var body: some View {
        let count = CairnScale.stones(for: score)
        GeometryReader { g in
            let shown = min(count, 16); let h = min(compact ? 16.0 : 24.0, (g.size.height-20)/CGFloat(max(1,shown)))
            ZStack(alignment: .bottom) {
                Ellipse().fill(Theme.ink.opacity(0.08)).frame(width: g.size.width*0.7, height: 10)
                ForEach(0..<shown, id: \.self) { i in
                    Stone().fill(Color(hex: UInt32(colors[i%colors.count])))
                        .overlay(Stone().stroke(Theme.ink.opacity(0.14), lineWidth: 1))
                        .frame(width: max(24,g.size.width*0.8-CGFloat(i)*4.4), height: h+4)
                        .rotationEffect(.degrees(i%2==0 ? -4 : 5))
                        .offset(x: i%2==0 ? -3:3, y: -CGFloat(i)*h-5)
                        .transition(.asymmetric(insertion: .offset(y:-35).combined(with:.opacity), removal: .offset(x:70,y:-18).combined(with:.opacity)))
                }
                if count == 0 { Stone().stroke(Theme.line, style: StrokeStyle(lineWidth: 2,dash:[4,4])).frame(width: 72,height:25).offset(y:-5) }
                if blowing && !reduceMotion { Image(systemName:"wind").font(.title).foregroundStyle(Theme.blue).offset(x:-35,y:-g.size.height*0.6).transition(.opacity) }
            }.frame(width:g.size.width,height:g.size.height,alignment:.bottom)
        }
        .animation(reduceMotion ? nil : .easeOut(duration:0.8), value: count)
        .onChange(of: score) { old,new in if new < old { blowing = true; Task { try? await Task.sleep(for:.seconds(1.2)); blowing = false } } }
        .accessibilityElement(children:.ignore).accessibilityLabel("Cairn, \(count) stones, \(score) Score")
    }
}
