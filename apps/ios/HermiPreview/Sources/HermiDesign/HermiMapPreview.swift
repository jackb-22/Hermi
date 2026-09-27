import SwiftUI

/// Product fixtures stay local; the geographic basemap fetches public tiles.
public struct HermiMapPreview: View {
  @State private var state = MapPreviewState()
  @State private var moving = false
  @State private var mapFrame = CGRect.zero
  @State private var editingDiscovery = false
  @State private var mapRevision = 0
  @State private var pinNotice: String?
  @State private var friendsFeed = false
  @State private var actionPreview = false
  @State private var restorePill: Task<Void, Never>?
  @State private var lab = false
  @State private var expanded = false
  @State private var reduceMotionOverride = false
  @State private var profileTab = "Adventures"
  @State private var mapCommand: MapCommand?
  @State private var postPlace: String?
  @State private var profileDetail: ProfileDetail?
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  private var pinReviewFixture: Bool {
    #if DEBUG
    ProcessInfo.processInfo.arguments.contains("--hermi-pin-review")
    #else
    false
    #endif
  }
  private var showsPreviewTools: Bool {
    #if DEBUG
    ProcessInfo.processInfo.arguments.contains("--hermi-lab")
    #else
    false
    #endif
  }
  private let storageKey = "hermi.preview.map-composition.v1"

  public init() {}

  public var body: some View {
    GeometryReader { safeGeometry in
      GeometryReader { geometry in
      ZStack {
        switch state.panel {
        case .map: map(in: geometry.size).ignoresSafeArea()
        case .feed: FeedPager(state: $state, size: geometry.size, friendsOnly: friendsFeed, onMoving: beginMapGesture, onStopped: endMapGesture).ignoresSafeArea()
        case .profile: profile
        }
        if let pinNotice, state.panel == .map {
          VStack { Text(pinNotice).font(.caption).padding(12)
              .background(HermiPalette.paper, in: PixelPanel(corner: 6))
              .padding(.top, safeGeometry.safeAreaInsets.top + 8)
            Spacer()
          }.padding(.leading, 16).padding(.trailing, 100).allowsHitTesting(false)
        }
        VStack {
          topBar(in: geometry.size)
          Spacer()
        }.padding(.horizontal, 20).padding(.top, safeGeometry.safeAreaInsets.top + 8)

        if let sheet = state.sheet {
          if sheet == .plan || sheet == .saved {
            PlanPreviewPage(state: $state, saved: sheet == .saved, close: { state.sheet = nil }, go: { actionPreview = true })
              .padding(.top, safeGeometry.safeAreaInsets.top)
          } else {
            VStack { Spacer(); bottomSheet(sheet, height: geometry.size.height) }.transition(.move(edge: .bottom))
          }
        }
        VStack {
          Spacer()
          navigationPill.opacity(moving ? 0 : 1).allowsHitTesting(!moving)
            .accessibilityHidden(moving)
        }.padding(.bottom, max(16, safeGeometry.safeAreaInsets.bottom))
      }
      .coordinateSpace(name: "mapPreview")

      }.ignoresSafeArea()
    }
    .background(HermiPalette.paper).foregroundStyle(HermiPalette.ink)
    .preferredColorScheme(.light)
    .accessibilityHidden(actionPreview)
    .overlay {
      if actionPreview {
        ActionModePreview(plan: state.planIDs) { actionPreview = false; state.sheet = .plan }
      }
    }
    .animation(reduceMotion || reduceMotionOverride ? nil : .easeOut(duration: 0.2), value: state.sheet)
    .animation(reduceMotion || reduceMotionOverride ? nil : .easeOut(duration: 0.15), value: moving)
    .sheet(isPresented: $lab) {
      VStack(spacing: 0) {
        HStack {
          Text("Component lab").font(.headline)
          Spacer()
          Button("Done") { lab = false }.frame(minHeight: 44)
        }.padding(.horizontal, 20)
        HermiGallery()
      }.frame(minWidth: 340, minHeight: 600)
    }
    .onAppear {
      if pinReviewFixture {
        state = MapPreviewState()
        state.dropGeographicPin(at: .init(latitude: 40.8073, longitude: -73.9666))
        editingDiscovery = true
        return
      }
      if let data = UserDefaults.standard.data(forKey: storageKey),
        let saved = try? JSONDecoder().decode(MapPreviewState.self, from: data) {
        state = saved
        state.restoreDiscovery()
        // Map remains the launch panel, as required by the unified truth.
        state.switchPanel(.map)
        state.planIDs = state.planIDs.filter { MapSamplePlace.find($0) != nil }
      }
    }
    .onChange(of: state) { _, value in
      guard !pinReviewFixture else { return }
      if let data = try? JSONEncoder().encode(value) { UserDefaults.standard.set(data, forKey: storageKey) }
    }
    .task { _ = await Task.detached { NYCLandMask.shared.available }.value }
    .task(id: pinNotice) {
      guard pinNotice != nil else { return }
      do { try await Task.sleep(for: .seconds(4)) } catch { return }
      pinNotice = nil
    }
    .onDisappear { restorePill?.cancel() }
  }

  private func topBar(in size: CGSize) -> some View {
    HStack(alignment: .top) {
      if showsPreviewTools {
      Menu {
        Text("Real geography · sample places")
        Text("Visual review Step 2")
        Divider()
        Button("Component lab") { lab = true }
        Toggle("Reduce motion", isOn: $reduceMotionOverride)
        Button("Reset preview") {
          UserDefaults.standard.removeObject(forKey: "hermi.preview.routeAudience")
          UserDefaults.standard.removeObject(forKey: "hermi.preview.stopTimes")
          for place in MapSamplePlace.all { UserDefaults.standard.removeObject(forKey: "hermi.preview.invites.\(place.id)") }
          friendsFeed = false
          state.reset(); mapCommand = MapCommand(action: "recenter"); expanded = false
          reduceMotionOverride = false; profileTab = "Adventures"
          restorePill?.cancel(); moving = false
        }
      } label: {
        PixelIcon(name: "menu").frame(width: 20, height: 20).frame(width: 30, height: 30)
          .background(HermiPalette.paper.opacity(0.96), in: PixelPanel(corner: 6))
      }.fixedSize().accessibilityLabel("Hermi preview options")
      }
      Spacer()
      mapTools(in: size)
        .frame(width: 44)
    }
  }

  private func mapTools(in size: CGSize) -> some View {
    VStack(spacing: 6) {
      if state.panel == .map {
        CategoryPinControl(category: $state.category, onFilter: { state.filterEnabled.toggle() }, onDrop: { point in
          // The geographic view can have an origin different from the root/safe area.
          let overlapsTools = point.x > size.width - 84 && (point.y < 280 || point.y > size.height - 250)
          guard !overlapsTools, point.y > 100, point.y < size.height - 110,
                let normalized = MapDropProjection.normalized(point, in: mapFrame) else {
            pinNotice = "Drop on the map, away from the controls."; return
          }
          mapCommand = MapCommand(action: "drop", point: normalized)
          expanded = false
        }, onDragBegan: { state.sheet = nil; editingDiscovery = false; pinNotice = nil })
      }
      Button {
        if state.panel == .feed { friendsFeed.toggle() }
        else { state.social.toggle(); state.switchPanel(.map) }
      } label: {
        PixelIcon(name: "social").frame(width: 26, height: 26).frame(width: 34, height: 34)
          .background((state.panel == .feed ? friendsFeed : state.social) ? HermiPalette.lime : HermiPalette.paper, in: PixelPanel(corner: 8))
        .frame(width: 44, height: 44).contentShape(Rectangle())
      }.accessibilityLabel(state.panel == .feed ? (friendsFeed ? "Friends feed. Show public" : "Public feed. Show friends") : (state.social ? "Social map. Switch to Solo" : "Solo map. Switch to Social"))
        .controlHelp(state.panel == .feed ? "Toggle sample Feed between friends and public" : "Toggle Solo and Social map")
      Button { state.sheet = .plan; expanded = true } label: {
        PixelIcon(name: "plan").frame(width: 26, height: 26).frame(width: 34, height: 34)
          .background(HermiPalette.paper, in: PixelPanel(corner: 8))
        .frame(width: 44, height: 44).contentShape(Rectangle())
      }.accessibilityLabel("My Plan, \(state.planIDs.count) places").controlHelp("Open My Plan. Saved is inside its bookmark button")
    }.buttonStyle(.plain)
  }

  private func map(in size: CGSize) -> some View {
    GeographicMap(state: state, command: mapCommand, editingDiscovery: editingDiscovery,
      revision: mapRevision, bottomInset: mapControlsBottom(in: size)) { event in
      switch event["type"] as? String {
      case "mapTap": editingDiscovery = false
      case "moving": beginMapGesture()
      case "stopped", "error": endMapGesture()
      case "place": if let id = event["id"] as? String { editingDiscovery = false; state.selectPlace(id); expanded = false }
      case "discovery":
        guard event["id"] as? String == state.discoveryPin?.id.uuidString else { return }
        editingDiscovery = true; state.sheet = .nearby; expanded = false
      case "drop":
        guard event["requestID"] as? String == mapCommand?.id.uuidString,
              let latitude = event["latitude"] as? Double, let longitude = event["longitude"] as? Double else { return }
        let valid = state.dropGeographicPin(at: GeoPoint(latitude: latitude, longitude: longitude))
        editingDiscovery = valid
        pinNotice = valid ? nil : "Choose land within NYC. Water and outside areas aren’t available."
        mapRevision += 1
      case "pinDragStart":
        guard event["id"] as? String == state.discoveryPin?.id.uuidString else { return }
        editingDiscovery = true; state.sheet = nil
      case "pinDragCancelled":
        guard event["id"] as? String == state.discoveryPin?.id.uuidString else { return }
        editingDiscovery = true; state.sheet = .nearby; expanded = false; mapRevision += 1
      case "pinMove":
        guard let raw = event["id"] as? String, let id = UUID(uuidString: raw),
              let latitude = event["latitude"] as? Double, let longitude = event["longitude"] as? Double else { return }
        guard state.discoveryPin?.id == id else { return }
        let valid = state.moveDiscovery(id: id, to: GeoPoint(latitude: latitude, longitude: longitude))
        pinNotice = valid ? nil : "Keep this pin on NYC land. Its previous position is restored."
        editingDiscovery = true; state.sheet = .nearby; expanded = false; mapRevision += 1
      case "pinRadius":
        guard let raw = event["id"] as? String, let id = UUID(uuidString: raw), let miles = event["miles"] as? Double else { return }
        state.setDiscoveryRadius(id: id, miles: miles)
      case "pinRemove":
        guard let raw = event["id"] as? String, let id = UUID(uuidString: raw), state.discoveryPin?.id == id else { return }
        state.removeDiscovery(id: id); editingDiscovery = false; pinNotice = nil
      case "dropRejected":
        guard event["requestID"] as? String == mapCommand?.id.uuidString else { return }
        pinNotice = "Wait for the map to finish loading, then try again."
      default: break
      }
    }
    .background(GeometryReader { geometry in
      Color.clear.onAppear { mapFrame = geometry.frame(in: .named("mapPreview")) }
        .onChange(of: geometry.frame(in: .named("mapPreview"))) { _, frame in mapFrame = frame }
    })
    .overlay(alignment: .bottomTrailing) {
      VStack(spacing: 0) {
        mapButton("plus", label: "Zoom in", action: "in")
        mapButton("minus", label: "Zoom out", action: "out")
        mapButton("locate", label: "Recenter on Columbia", action: "recenter")
      }.padding(.trailing, 20).padding(.bottom, mapControlsBottom(in: size))
        .animation(reduceMotion ? nil : .easeOut(duration: 0.2), value: mapControlsBottom(in: size))
    }
  }
  private func mapControlsBottom(in size: CGSize) -> CGFloat {
    guard let sheet = state.sheet, sheet != .plan, sheet != .saved else { return 110 }
    return discoveryPanelHeight(in: size.height) + 8
  }

  // Reserve one vertical rail: category/social/plan, radius, then zoom/home.
  // Contextual panels grow only into the remaining space; My Plan stays full-page.
  private func discoveryPanelHeight(in height: CGFloat) -> CGFloat {
    let compact = min(300, height * 0.39)
    return expanded ? max(compact, min(height * 0.65, height - 460)) : compact
  }

  private func mapButton(_ icon: String, label: String, action: String) -> some View {
    Button { mapCommand = MapCommand(action: action) } label: {
      PixelIcon(name: icon).frame(width: 20, height: 20).frame(width: 30, height: 30)
        .background(HermiPalette.paper, in: PixelPanel(corner: 6))
      .frame(width: 44, height: 44).contentShape(Rectangle())
    }.buttonStyle(.plain).accessibilityLabel(label).controlHelp(label)
  }

  private func beginMapGesture() { restorePill?.cancel(); moving = true }
  private func endMapGesture() {
    restorePill?.cancel()
    restorePill = Task { @MainActor in
      do { try await Task.sleep(for: .milliseconds(300)) } catch { return }
      moving = false
    }
  }

  private var navigationPill: some View {
    HomeNavigationPill(selected: state.panel) { panel in
      state.switchPanel(panel); expanded = false; moving = false
    }
  }

  private func bottomSheet(_ sheet: MapPreviewSheet, height: CGFloat) -> some View {
    VStack(spacing: 10) {
      Button { expanded.toggle() } label: {
        Capsule().fill(HermiPalette.ink.opacity(0.35)).frame(width: 38, height: 4).frame(maxWidth: .infinity).frame(height: 26)
      }.buttonStyle(.plain).accessibilityLabel(expanded ? "Collapse details" : "Expand details")
        .gesture(DragGesture(minimumDistance: 8).onEnded { value in
          if value.translation.height < -15 { expanded = true }
          else if expanded { expanded = false }
          else { state.sheet = nil }
        })
      ScrollView {
        VStack(alignment: .leading, spacing: 12) {
          switch sheet {
          case .nearby: nearbyContent
          case .place(let id): if let place = MapSamplePlace.find(id) { placeContent(place) }
          case .plan, .saved: EmptyView()
          }
        }.padding(.horizontal, 20).padding(.bottom, 10)
      }.scrollIndicators(.hidden)
      Spacer(minLength: 70)
    }
    .frame(height: discoveryPanelHeight(in: height))
    .frame(maxWidth: .infinity)
    .background(HermiPalette.paper, in: UnevenRoundedRectangle(topLeadingRadius: 24, topTrailingRadius: 24))
    .overlay(alignment: .topTrailing) {
      Button { state.sheet = nil; expanded = false } label: {
        PixelIcon(name: "close").frame(width: 14, height: 14).frame(width: 44, height: 36)
      }.buttonStyle(.plain).accessibilityLabel("Close details").controlHelp("Close this place or discovery panel").padding(.trailing, 8)
    }
  }

  private var nearbyContent: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack { Text("Nearby").font(.headline); Spacer(); Text((state.discoveryPin?.category ?? state.category).rawValue).font(.caption).foregroundStyle(HermiPalette.secondary) }
      if state.nearby.isEmpty {
        Text(state.discoveryPin.map { "No sample places within \(String(format: "%.2g", $0.radiusMiles)) mi here." } ?? "No sample places in this category.").font(.subheadline)
      }
      ScrollView(.horizontal) {
        HStack(spacing: 12) {
          ForEach(state.nearby) { place in
            Button { state.selectPlace(place.id) } label: {
              VStack(alignment: .leading, spacing: 6) {
                mediaTile(place.category).frame(width: 124, height: 76)
                Text(place.name).font(.caption.weight(.medium)).lineLimit(1)
              }.frame(width: 124, alignment: .leading)
            }.buttonStyle(.plain)
          }
        }
      }.scrollIndicators(.hidden)
    }
  }

  private func placeContent(_ place: MapSamplePlace) -> some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack {
        Button { state.goBack() } label: {
          PixelIcon(name: "back").frame(width: 20, height: 20).frame(width: 30, height: 30)
        }.buttonStyle(.plain).accessibilityLabel(state.returnSheet == .plan ? "Back to My plan" : (state.returnSheet == .saved ? "Back to Saved" : "Back")).controlHelp("Return to the previous panel")
        Text(place.name).font(.headline).lineLimit(1)
        Spacer(minLength: 4)
        Button { state.toggleSave(place.id) } label: {
          PixelIcon(name: state.savedIDs.contains(place.id) ? "saved" : "save").frame(width: 20, height: 24).frame(width: 44, height: 44)
        }.buttonStyle(.plain).accessibilityLabel(state.savedIDs.contains(place.id) ? "Unsave place" : "Save place").controlHelp("Toggle this place in Saved, independently of My Plan")
      }
      HStack(spacing: 8) {
        ForEach(0..<3) { index in mediaTile(place.category, variant: index).frame(height: expanded ? 110 : 68) }
      }
      HStack {
        Text(place.category.rawValue).font(.caption).foregroundStyle(HermiPalette.secondary)
        Spacer()
        Button { state.togglePlan(place.id) } label: {
          HStack { PixelIcon(name: state.planIDs.contains(place.id) ? "check" : "plus").frame(width: 14, height: 14); Text(state.planIDs.contains(place.id) ? "Remove" : "Add") }
            .font(.subheadline.weight(.semibold)).padding(.horizontal, 20).frame(height: 44)
            .background(HermiPalette.lime, in: Capsule())
        }.buttonStyle(.plain).controlHelp("Toggle this place in My Plan without changing Saved")
      }
      if expanded {
        Divider()
        Text("Photos and verified reviews appear here.").font(.footnote).foregroundStyle(HermiPalette.secondary)
        Text("Sample place · no live hours or reviews loaded").font(.caption).foregroundStyle(HermiPalette.secondary)
      }
    }
  }

  private func mediaTile(_ category: HermiCategory, variant: Int = 0) -> some View {
    ZStack {
      HermiPalette.category(category).opacity(variant == 1 ? 0.55 : 0.8)
      PixelIcon(name: variant == 2 ? "play" : "photo").frame(width: 23, height: 23).opacity(0.55)
    }.clipShape(RoundedRectangle(cornerRadius: 6))
      .accessibilityLabel(variant == 2 ? "Video placement" : "Photo placement")
  }

  private var profile: some View {
    ScrollView {
      VStack(spacing: 14) {
        HStack(spacing: 12) {
          HermitSprite().frame(width: 48, height: 42)
          VStack(alignment: .leading, spacing: 4) {
            Text("Alex").font(.title2.bold())
            Text("@alex · Sample profile").font(.caption)
          }
          Spacer()

        }.padding(.trailing, 64).padding(.horizontal, 18)
        HStack(spacing: 0) {
          ForEach([ProfileDetail.friends, .score, .rank]) { detail in
            Button { profileDetail = detail } label: {
              VStack(spacing: 5) {
                Text(detail == .score ? "250" : "—").font(.system(.headline, design: .monospaced))
                Text(detail.rawValue).font(.caption)
              }.frame(maxWidth: .infinity).frame(minHeight: 48)
            }.buttonStyle(.plain).accessibilityLabel(detail.rawValue).controlHelp("Open \(detail.rawValue)")
          }
        }.padding(.horizontal, 24)
        HStack(spacing: 40) {
          ForEach(["Adventures", "Posts"], id: \.self) { tab in
            Button { profileTab = tab } label: {
              PixelIcon(name: tab == "Adventures" ? "route" : "grid").frame(width: 25, height: 25)
                .frame(width: 64, height: 48)
                .background(profileTab == tab ? HermiPalette.lime : .clear, in: PixelPanel(corner: 6))
            }.buttonStyle(.plain).accessibilityLabel(tab).controlHelp("Show your \(tab.lowercased())").accessibilityAddTraits(profileTab == tab ? .isSelected : [])
          }
        }
        if profileTab == "Adventures" {
          GeographicMap(state: MapPreviewState(), adventure: true).frame(height: 520)
            .overlay(alignment: .topLeading) {
              Button { profileDetail = .sharing } label: {
                PixelIcon(name: "social").frame(width: 23, height: 23).frame(width: 44, height: 44)
                  .background(HermiPalette.paper, in: PixelPanel(corner: 6))
              }.buttonStyle(.plain).accessibilityLabel("Adventure sharing settings").controlHelp("Choose Private, Friends or Everyone for your adventures").padding(12)
            }
            .overlay(alignment: .topTrailing) {
              Button { profileDetail = .stats } label: {
                PixelIcon(name: "info").frame(width: 23, height: 23).frame(width: 44, height: 44)
                  .background(HermiPalette.paper, in: PixelPanel(corner: 6))
              }.buttonStyle(.plain).accessibilityLabel("Adventure statistics").controlHelp("View your visits, coverage, steps and neighborhood statistics").padding(12)
            }
        } else {
          LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 3), count: 3), spacing: 3) {
            ForEach(0..<12) { index in
              let place = MapSamplePlace.all[index % MapSamplePlace.all.count]
              Button { postPlace = place.id } label: {
                mediaTile(place.category, variant: index % 3).aspectRatio(0.8, contentMode: .fit)
              }.buttonStyle(.plain).accessibilityLabel("Sample post at \(place.name)").controlHelp("Open posts and reviews for \(place.name)")
            }
          }
          Text("Sample media placements").font(.caption)
        }
      }.padding(.top, 135).padding(.bottom, 130)
    }.background(HermiPalette.paper).ignoresSafeArea()
      .sheet(item: $profileDetail) { detail in ProfileDetailSheet(detail: detail) }
      .sheet(item: Binding(get: { postPlace.flatMap(MapSamplePlace.find) }, set: { postPlace = $0?.id })) { place in
        ScrollView {
          VStack(alignment: .leading, spacing: 20) {
            HStack { Text(place.name).font(.title2.bold()); Spacer(); Button { postPlace = nil } label: { PixelIcon(name: "close").frame(width: 20, height: 20).frame(width: 30, height: 30) }.accessibilityLabel("Close post").controlHelp("Return to the posts grid") }
            Text("Your posts").font(.headline)
            HStack(spacing: 6) { ForEach(0..<3) { mediaTile(place.category, variant: $0).frame(height: 150) } }
            Text("Your review").font(.headline)
            Text("No verified review loaded.").font(.subheadline)
            Text("Friends’ posts & reviews").font(.headline)
            Text("No shared friend posts loaded for this place.").font(.subheadline)
            Text("Sample place · media and reviews await backend integration").font(.caption).foregroundStyle(HermiPalette.secondary)
          }.padding(20)
        }.background(HermiPalette.paper).presentationDetents([.medium, .large])
      }
  }
}

#Preview("Hermi · board composition") { HermiMapPreview() }
