import SwiftUI
import WebKit

struct MapHome: View {
  @EnvironmentObject var store: CairnStore
  var body: some View {
    ZStack {
      if store.preview {
        IllustratedMap()
      } else {
        PixelMap(places: store.places, plan: store.plan)
      }
      VStack {
        HStack(alignment: .top) {
          VStack(alignment: .leading, spacing: 5) {
            Text("cairn").font(.system(size: 36, weight: .heavy, design: .rounded)).tracking(-2)
            HStack(spacing: 5) {
              Circle().fill(Theme.green).frame(width: 5, height: 5)
              Text("A GOOD DAY TO GO OUT").font(
                .system(size: 8, weight: .bold, design: .monospaced)
              ).tracking(1.5)
            }
          }
          Spacer()
          Button {
            store.run { try await store.start() }
          } label: {
            Label("Head out", systemImage: "arrow.up.right").font(
              .system(size: 12, weight: .semibold)
            ).padding(13).background(Theme.paper, in: Capsule())
          }.buttonStyle(.plain)
        }.padding(.horizontal, 25).padding(.top, store.preview ? 43 : 18)
        Spacer()
        if store.socialOn {
          SocialStrip().padding(.horizontal, 20)
        }
        VStack(spacing: 17) {
          HStack(spacing: 12) {
            SmallButton(title: store.socialOn ? "Social on" : "Social", icon: "person.2") {
              store.socialOn.toggle()
            }
            Spacer()
            SmallButton(
              title: store.plan.exists ? "Plan · \(store.plan["stops"].list.count)" : "Plan",
              icon: "point.topleft.down.to.point.bottomright.curvepath"
            ) { store.sheet = "plan" }
          }
          HStack(spacing: 23) {
            let index = Theme.categories.firstIndex(of: store.category) ?? 0
            categoryControl(Theme.categories[(index + 7) % 8], small: true)
            Button {
              store.sheet = "nearby"
            } label: {
              HStack(spacing: 11) {
                Image(systemName: Theme.icon(store.category)).font(.system(size: 19, weight: .bold))
                Text(store.category == "all" ? "Drop a pin" : store.category.capitalized).font(
                  .system(size: 15, weight: .bold))
                Image(systemName: "plus").font(.system(size: 12, weight: .bold))
              }
              .padding(.horizontal, 24).frame(height: 58).background(Theme.lime, in: Capsule())
              .overlay(Capsule().stroke(Theme.ink.opacity(0.13)))
            }.buttonStyle(.plain).accessibilityHint(
              "Choose a nearby place at the center of your map")
            categoryControl(Theme.categories[(index + 1) % 8], small: true)
          }.gesture(
            DragGesture(minimumDistance: 25).onEnded { v in
              let index = Theme.categories.firstIndex(of: store.category) ?? 0
              store.category = Theme.categories[(index + (v.translation.width < 0 ? 1 : 7)) % 8]
            })
          Text("Find your next little adventure.").font(.system(size: 11)).foregroundStyle(
            Theme.muted)
        }.padding(.horizontal, 26).padding(.bottom, 109)
      }
    }.task(id: store.category) { await store.refreshMap() }
  }
  func categoryControl(_ cat: String, small: Bool) -> some View {
    Button {
      store.category = cat
    } label: {
      Image(systemName: Theme.icon(cat)).font(.system(size: 16)).foregroundStyle(Theme.muted).frame(
        width: 34, height: 44)
    }.buttonStyle(.plain).accessibilityLabel(cat.capitalized)
  }
}

/// A deliberately illustrative city board for the labeled offline design preview.
struct IllustratedMap: View {
  @EnvironmentObject var store: CairnStore
  var small = false
  var body: some View {
    GeometryReader { g in
      ZStack {
        Canvas { context, size in
          context.fill(Path(CGRect(origin: .zero, size: size)), with: .color(Color(hex: 0xE9EEDC)))
          var river = Path()
          river.move(to: .zero)
          river.addLine(to: CGPoint(x: size.width * 0.19, y: 0))
          river.addLine(to: CGPoint(x: size.width * 0.25, y: size.height * 0.2))
          river.addLine(to: CGPoint(x: size.width * 0.12, y: size.height * 0.6))
          river.addLine(to: CGPoint(x: 0, y: size.height * 0.8))
          river.closeSubpath()
          context.fill(river, with: .color(Theme.blue.opacity(0.7)))
          for row in 0..<21 {
            for col in 0..<10 {
              let x = CGFloat(col) * 52 - 20 + CGFloat(row) * 8
              let y = CGFloat(row) * 43 - 90
              if x > size.width * 0.19 && x < size.width + 10 {
                let park = (col == 2 && row > 6 && row < 14) || (col == 5 && row > 9 && row < 17)
                let color =
                  park
                  ? Color(hex: 0xB3CC8D)
                  : [Color(hex: 0xD9DFC7), Color(hex: 0xE0DCC6), Color(hex: 0xD6DFCD)][
                    (row + col) % 3]
                let rect = CGRect(x: x, y: y, width: 41, height: 30)
                context.fill(Path(rect), with: .color(color))
                context.stroke(Path(rect), with: .color(.white.opacity(0.35)), lineWidth: 2)
                if park {
                  for t in 0..<4 {
                    context.fill(
                      Path(
                        CGRect(
                          x: x + CGFloat(t % 2) * 20 + 3, y: y + CGFloat(t / 2) * 12 + 3, width: 6,
                          height: 6)), with: .color(Theme.green.opacity(0.45)))
                  }
                }
              }
            }
          }
          var road = Path()
          road.move(to: CGPoint(x: size.width * 0.32, y: 0))
          road.addLine(to: CGPoint(x: size.width * 0.8, y: size.height))
          context.stroke(road, with: .color(Theme.paper), lineWidth: 11)
          for i in 0..<38 {
            let x = CGFloat((i * 79) % Int(max(1, size.width)))
            let y = CGFloat((i * 131) % Int(max(1, size.height)))
            context.fill(
              Path(CGRect(x: x, y: y, width: 2, height: 2)), with: .color(Theme.green.opacity(0.12))
            )
          }
        }
        if !small {
          mapLabel("RIVERSIDE", x: 0.16, y: 0.29, g: g).rotationEffect(.degrees(-73))
          mapLabel("MORNINGSIDE\nHEIGHTS", x: 0.61, y: 0.28, g: g)
          mapLabel("COLUMBIA", x: 0.62, y: 0.45, g: g)
          ForEach(Array(store.places.enumerated()), id: \.element.id) { i, p in
            let positions: [CGPoint] = [
              CGPoint(x: 0.47, y: 0.57), CGPoint(x: 0.22, y: 0.42), CGPoint(x: 0.69, y: 0.61),
              CGPoint(x: 0.44, y: 0.36), CGPoint(x: 0.84, y: 0.48), CGPoint(x: 0.69, y: 0.38),
            ]
            let pos = positions[i % positions.count]
            Button {
              store.openPlace(p)
            } label: {
              VStack(spacing: 4) {
                Image(systemName: Theme.icon(p["category"].text)).font(
                  .system(size: 15, weight: .bold)
                ).foregroundStyle(Theme.paper).frame(width: 36, height: 36).background(
                  Theme.category(p["category"].text), in: RoundedRectangle(cornerRadius: 10)
                ).overlay(RoundedRectangle(cornerRadius: 10).stroke(.white, lineWidth: 3)).shadow(
                  color: Theme.ink.opacity(0.13), radius: 2, y: 3)
                if p.id == "p1" {
                  Text("A pastry pit stop?").font(.system(size: 10, weight: .semibold)).padding(7)
                    .background(Theme.paper, in: Capsule())
                }
              }
            }.buttonStyle(.plain).position(x: g.size.width * pos.x, y: g.size.height * pos.y)
              .accessibilityLabel(p["name"].text)
          }
          ZStack {
            Circle().fill(Theme.green.opacity(0.12)).frame(width: 65, height: 65)
            Image(systemName: "figure.walk").font(.system(size: 23, weight: .bold)).foregroundStyle(
              Theme.ink
            ).frame(width: 37, height: 37).background(Theme.lime, in: Circle()).overlay(
              Circle().stroke(.white, lineWidth: 3))
          }.position(x: g.size.width * 0.54, y: g.size.height * 0.48)
        }
      }
    }.clipped()
  }
  func mapLabel(_ title: String, x: CGFloat, y: CGFloat, g: GeometryProxy) -> some View {
    Text(title).font(.system(size: 9, weight: .medium, design: .monospaced)).tracking(2)
      .multilineTextAlignment(.center).foregroundStyle(Theme.ink.opacity(0.5)).position(
        x: g.size.width * x, y: g.size.height * y)
  }
}

struct SocialStrip: View {
  @EnvironmentObject var store: CairnStore
  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      SectionLabel(text: "Out in the world")
      if store.social["friendsOut"].list.isEmpty {
        Text("No friends checked in nearby.").font(.subheadline).foregroundStyle(Theme.muted)
      }
      ForEach(store.social["friendsOut"].list, id: \.self) { row in
        Text("\(row["user"]["name"].text) · \(row["place"]["name"].text)").font(.subheadline)
      }
      ForEach(store.social["friendPlans"].list + store.social["openPlans"].list, id: \.self) {
        row in
        Button {
          store.plan = row["plan"]
          store.sheet = "plan"
        } label: {
          Label(row["plan"]["name"].text, systemImage: "flag")
        }
      }
    }.padding(18).frame(maxWidth: .infinity, alignment: .leading).background(
      Theme.paper, in: RoundedRectangle(cornerRadius: 20)
    )
    .task {
      while !Task.isCancelled {
        if !store.preview {
          do { store.social = try await store.call("social", query: ["bbox": store.bbox]) } catch {
            store.error = error.localizedDescription
          }
        }
        try? await Task.sleep(for: .seconds(30))
      }
    }
  }
}
extension JSON: Hashable {
  public func hash(into hasher: inout Hasher) {
    switch self {
    case .object(let values):
      hasher.combine(0)
      for key in values.keys.sorted() {
        hasher.combine(key)
        hasher.combine(values[key])
      }
    case .array(let values):
      hasher.combine(1)
      hasher.combine(values)
    case .string(let value):
      hasher.combine(2)
      hasher.combine(value)
    case .number(let value):
      hasher.combine(3)
      hasher.combine(value)
    case .bool(let value):
      hasher.combine(4)
      hasher.combine(value)
    case .null: hasher.combine(5)
    }
  }
}

#if os(macOS)
  struct PixelMap: NSViewRepresentable {
    @EnvironmentObject var store: CairnStore
    var places: [JSON]
    var plan: JSON
    func makeCoordinator() -> MapCoordinator { MapCoordinator(store) }
    func makeNSView(context: Context) -> WKWebView { context.coordinator.makeWebView() }
    func updateNSView(_ view: WKWebView, context: Context) {
      context.coordinator.update(view, places: places, plan: plan)
    }
  }
#else
  struct PixelMap: UIViewRepresentable {
    @EnvironmentObject var store: CairnStore
    var places: [JSON]
    var plan: JSON
    func makeCoordinator() -> MapCoordinator { MapCoordinator(store) }
    func makeUIView(context: Context) -> WKWebView { context.coordinator.makeWebView() }
    func updateUIView(_ view: WKWebView, context: Context) {
      context.coordinator.update(view, places: places, plan: plan)
    }
  }
#endif
@MainActor final class MapCoordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
  let store: CairnStore
  var payload = "{}"
  init(_ store: CairnStore) { self.store = store }
  func makeWebView() -> WKWebView {
    let config = WKWebViewConfiguration()
    config.userContentController.add(self, name: "cairn")
    let web = WKWebView(frame: .zero, configuration: config)
    web.navigationDelegate = self
    if let url = Bundle.module.url(forResource: "map", withExtension: "html") {
      web.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
    }
    return web
  }
  func update(_ web: WKWebView, places: [JSON], plan: JSON) {
    let data: JSON = [
      "places": .array(places), "stops": plan["stops"], "tiles": store.tiles["tiles"],
    ]
    if let bytes = try? JSONEncoder().encode(data), let text = String(data: bytes, encoding: .utf8)
    {
      payload = text
      web.evaluateJavaScript(
        "window.renderCairn && window.renderCairn(\(text))", completionHandler: nil)
    }
  }
  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    webView.evaluateJavaScript(
      "window.renderCairn && window.renderCairn(\(payload))", completionHandler: nil)
  }
  func userContentController(
    _ controller: WKUserContentController, didReceive message: WKScriptMessage
  ) {
    guard let data = try? JSONSerialization.data(withJSONObject: message.body),
      let value = try? JSONDecoder().decode(JSON.self, from: data)
    else { return }
    switch value["type"].text {
    case "move": store.mapChanged(value)
    case "moving": store.mapMoving = true
    case "place":
      if let place = store.places.first(where: { $0.id == value["id"].text }) {
        store.openPlace(place)
      }
    case "drop":
      store.center = value["center"]
      store.sheet = "nearby"
    case "error": store.toast("Map couldn't load. Check your connection.")
    default: break
    }
  }
}
