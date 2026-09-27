import SwiftUI

public struct CairnRoot: View {
  @StateObject private var store: CairnStore
  public init(preview: Bool = false) {
    _store = StateObject(wrappedValue: CairnStore(preview: preview))
  }
  public var body: some View {
    ZStack(alignment: .bottom) {
      Theme.paper.ignoresSafeArea()
      if !store.preview && (!store.signedIn || !store.onboardingComplete) {
        OnboardingView()
      } else {
        Group {
          switch store.panel {
          case "Profile": ProfileView()
          case "Feed": FeedView()
          case "Directions", "Camera": ActionView()
          default: MapHome()
          }
        }.padding(.bottom, store.sheet == nil ? 0 : 0)
        if store.sheet == nil && !store.mapMoving {
          HStack(spacing: 5) {
            ForEach(
              store.session.exists ? ["Directions", "Camera"] : ["Feed", "Map", "Profile"],
              id: \.self
            ) { item in
              Button {
                store.panel = item
              } label: {
                HStack(spacing: 7) {
                  Image(systemName: icon(item))
                  if store.panel == item { Text(item).fontWeight(.semibold) }
                }
                .font(.system(size: 14)).padding(.horizontal, 20).frame(height: 46)
                .foregroundStyle(store.panel == item ? Theme.paper : Theme.muted)
                .background(store.panel == item ? Theme.ink : Color.clear, in: Capsule())
              }.buttonStyle(.plain).accessibilityLabel(item)
            }
          }.padding(6).background(Theme.paper, in: Capsule()).overlay(Capsule().stroke(Theme.line))
            .shadow(color: Theme.ink.opacity(0.1), radius: 18, y: 6).padding(.bottom, 23)
            .transition(.move(edge: .bottom))
        }
      }
      if store.preview {
        VStack {
          HStack {
            Text("DESIGN PREVIEW · SAMPLE DATA").font(
              .system(size: 8, weight: .bold, design: .monospaced)
            ).tracking(1)
            Spacer()
            Button("Connect") { store.sheet = "connection" }.font(
              .system(size: 10, weight: .semibold))
          }.foregroundStyle(Theme.muted).padding(.horizontal, 22).padding(.top, 8)
          Spacer()
        }.allowsHitTesting(true)
      }
      if let sheet = store.sheet { SheetHost(kind: sheet) }
      if let notice = store.notice {
        Text(notice).font(.subheadline).padding(16).background(Theme.ink, in: Capsule())
          .foregroundStyle(.white).padding(.bottom, 90).onTapGesture { store.notice = nil }
      }
      if store.busy {
        VStack {
          ProgressView().padding(12).background(Theme.paper, in: Capsule())
          Spacer()
        }.padding(.top, 50).allowsHitTesting(false)
      }
    }.environmentObject(store).foregroundStyle(Theme.ink).tint(Theme.green)
      .font(.system(size: 15)).preferredColorScheme(.light)
      .task { await store.bootstrap() }
      .task(id: store.session.id + store.session["status"].text) {
        if store.session["status"].text == "active" {
          store.tracker.start(store)
        } else {
          store.tracker.stop()
        }
      }
      .alert(
        "Couldn't complete that",
        isPresented: Binding(get: { store.error != nil }, set: { if !$0 { store.error = nil } })
      ) {
        Button("OK") { store.error = nil }
      } message: {
        Text(store.error ?? "")
      }
      .onOpenURL { url in
        store.sheet = "tag"
        pendingURL = url.absoluteString
        store.pendingTag = url.absoluteString
      }
      .environment(\.pendingTagURL, pendingURL)
  }
  @State private var pendingURL = ""
  func icon(_ panel: String) -> String {
    [
      "Map": "map", "Feed": "rectangle.stack", "Profile": "person.crop.circle",
      "Directions": "arrow.triangle.turn.up.right.diamond", "Camera": "camera",
    ][panel] ?? "map"
  }
}
private struct PendingTagKey: EnvironmentKey { static let defaultValue = "" }
extension EnvironmentValues {
  var pendingTagURL: String {
    get { self[PendingTagKey.self] }
    set { self[PendingTagKey.self] = newValue }
  }
}

struct SheetHost: View {
  var kind: String
  @EnvironmentObject private var store: CairnStore
  @State private var expanded = false
  var body: some View {
    GeometryReader { geo in
      VStack(spacing: 0) {
        Spacer(minLength: 30)
        VStack(spacing: 0) {
          HStack {
            Button {
              expanded.toggle()
            } label: {
              Capsule().fill(Theme.line).frame(width: 38, height: 5).frame(maxWidth: .infinity)
                .padding(12)
            }.buttonStyle(.plain)
          }
          HStack {
            if kind == "place" && store.plan.exists {
              Button("‹ Plan") { store.sheet = "plan" }.font(.subheadline.bold())
            }
            Spacer()
            Button {
              store.sheet = nil
            } label: {
              Image(systemName: "xmark").font(.system(size: 12, weight: .bold)).frame(
                width: 30, height: 30
              ).background(Theme.line.opacity(0.5), in: Circle())
            }.buttonStyle(.plain).accessibilityLabel("Close sheet")
          }.padding(.horizontal, 22).padding(.bottom, 6)
          ScrollView {
            Group {
              switch kind {
              case "place": PlaceSheet()
              case "plan": PlanSheet()
              case "savePlan": SavePlanSheet()
              case "nearby": NearbySheet()
              case "settings": SettingsSheet()
              case "connection": ConnectionSheet()
              case "recap": RecapSheet()
              case "tag": TagSheet()
              case "friends": CollectionSheet(kind: "friends")
              case "leaderboard": CollectionSheet(kind: "leaderboard")
              case "stats": CollectionSheet(kind: "stats")
              case "edit": EditProfileSheet()
              default:
                EmptyCard(title: "Nothing here yet", message: "Come back after your first outing.")
              }
            }.padding(.horizontal, 24).padding(.bottom, 30)
          }
        }.frame(
          maxHeight: geo.size.height
            * (expanded
              || ["plan", "recap", "connection", "savePlan", "settings", "edit"].contains(kind)
              ? 0.88 : 0.60)
        )
        .background(
          Theme.paper, in: UnevenRoundedRectangle(topLeadingRadius: 30, topTrailingRadius: 30)
        )
        .overlay(alignment: .top) {
          UnevenRoundedRectangle(topLeadingRadius: 30, topTrailingRadius: 30).stroke(
            Theme.line, lineWidth: 1
          ).allowsHitTesting(false)
        }
        .shadow(color: Theme.ink.opacity(0.12), radius: 30, y: -5)
        .gesture(
          DragGesture(minimumDistance: 30).onEnded { v in
            if v.translation.height > 100 {
              store.sheet = nil
            } else if v.translation.height < -50 {
              expanded = true
            }
          })
      }.ignoresSafeArea(edges: .bottom)
    }
  }
}
