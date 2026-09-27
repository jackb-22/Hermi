import SwiftUI

/// Product fixtures stay local; the geographic basemap fetches public tiles.
public struct HermiMapPreview: View {
  @State private var state = MapPreviewState()
  @State private var moving = false
  @State private var mapFrame = CGRect.zero
  @State private var editingPinID: UUID?
  @State private var mapRevision = 0
  @State private var pinNotice: String?
  @State private var settings = false
  @State private var actionPreview = false
  @State private var restorePill: Task<Void, Never>?
  @State private var lab = false
  @State private var panelLevel: DiscoveryPanelLevel = .compact
  @State private var reduceMotionOverride = false
  @State private var profileTab = "Adventures"
  @State private var mapCommand: MapCommand?
  @State private var postPlace: String?
  @State private var profileDetail: ProfileDetail?
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  private var pinReviewFixture: Bool {
    #if DEBUG
    ProcessInfo.processInfo.arguments.contains("--hermi-pin-review") || ProcessInfo.processInfo.arguments.contains("--hermi-multipin-review") || ProcessInfo.processInfo.arguments.contains("--hermi-plan-review") || ProcessInfo.processInfo.arguments.contains("--hermi-saved-review") || ProcessInfo.processInfo.arguments.contains("--hermi-feed-review")
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
        Group {
        switch state.panel {
        case .map: map(in: geometry.size).ignoresSafeArea()
        case .feed: FeedPager(state: $state, size: geometry.size, onMoving: beginMapGesture, onStopped: endMapGesture).ignoresSafeArea()
        case .profile: profile
        }
        }.accessibilityHidden(mapCovered).allowsHitTesting(!mapCovered)
        if let pinNotice, state.panel == .map {
          VStack { Text(pinNotice).font(.caption).padding(12)
              .background(HermiPalette.paper, in: PixelPanel(corner: 6))
              .padding(.top, safeGeometry.safeAreaInsets.top + 8)
            Spacer()
          }.padding(.leading, 16).padding(.trailing, 100).allowsHitTesting(false)
        }
        VStack {
          if !mapCovered { topBar(in: geometry.size) }
          Spacer()
        }.padding(.horizontal, 20).padding(.top, safeGeometry.safeAreaInsets.top + 8)

        if let sheet = state.sheet {
          if sheet == .plan || sheet == .saved {
            PlanPreviewPage(state: $state, saved: sheet == .saved, close: { state.sheet = nil }, go: { if state.canStartPlan { actionPreview = true } })
              .padding(.top, safeGeometry.safeAreaInsets.top)
          } else {
            VStack { Spacer(); bottomSheet(sheet, height: geometry.size.height, safeTop: safeGeometry.safeAreaInsets.top) }.transition(.move(edge: .bottom))
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
        if ProcessInfo.processInfo.arguments.contains("--hermi-feed-review") {
          state.switchPanel(.feed)
          state.addPlace("cafe")
          state.planUndoHistory = []
          return
        }
        state.dropGeographicPin(at: .init(latitude: 40.8073, longitude: -73.9666))
        if ProcessInfo.processInfo.arguments.contains("--hermi-multipin-review") {
          state.dropGeographicPin(at: .init(latitude: 40.808, longitude: -73.963))
          state.category = .nature
          state.dropGeographicPin(at: .init(latitude: 40.805, longitude: -73.965))
          state.category = .food
        }
        editingPinID = state.discoveryPins.first?.id
        if ProcessInfo.processInfo.arguments.contains("--hermi-plan-review") || ProcessInfo.processInfo.arguments.contains("--hermi-saved-review") {
          state.planIDs = ["cafe", "gallery", "garden"]
          state.stopTimes = [:]; state.stopInviteDrafts = [:]
          let start = Calendar.current.startOfDay(for: Date()).addingTimeInterval(12 * 3600)
          state.setStopTime(.init(arrival: start, reminderMinutes: 15), for: "cafe")
          state.setStopTime(.init(arrival: start.addingTimeInterval(1800)), for: "gallery")
          state.setStopTime(.init(arrival: start.addingTimeInterval(7200), durationMinutes: 30), for: "garden")
          if ProcessInfo.processInfo.arguments.contains("--hermi-saved-review") {
            state.toggleSave("books"); state.toggleSave("tea")
            var library = SavedLibrary()
            _ = library.savePost("cafe-alex")
            _ = library.savePlan(name: "Saturday loop", folderID: nil, newFolder: "Weekend ideas",
                                 visibility: .solo, friends: [], stops: ["cafe", "garden"],
                                 times: state.stopTimes ?? [:])
            if let index = library.folders.indices.first {
              library.folders[index].items.append(.init(kind: .post, refID: "cafe-alex"))
            }
            state.library = library
          }
          state.planUndoHistory = [] // Fixture setup is not a user edit.
          state.sheet = .plan
        }
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
      if state.storedPrivacyPreferences == nil {
        state.storedPrivacyPreferences = .migrated(routeAudience: UserDefaults.standard.string(forKey: "hermi.preview.routeAudience"))
      }
    }
    .onChange(of: state.sheet) { _, sheet in
      if case .place = sheet { editingPinID = nil }
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
          state.reset(); mapCommand = MapCommand(action: "recenter"); panelLevel = .compact
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
        CategoryPinControl(category: $state.category, filterActive: state.activeCitywideCategory == state.category, onFilter: { state.toggleCategoryFilter(); state.sheet = .nearby; panelLevel = .compact }, onDrop: { point in
          // The geographic view can have an origin different from the root/safe area.
          let overlapsTools = point.x > size.width - 84 && (point.y < 280 || point.y > size.height - 250)
          guard !overlapsTools, point.y > 100, point.y < size.height - 110,
                let normalized = MapDropProjection.normalized(point, in: mapFrame) else {
            pinNotice = "Drop on the map, away from the controls."; return
          }
          mapCommand = MapCommand(action: "drop", point: normalized)
          panelLevel = .compact
        }, onDragBegan: { state.sheet = nil; editingPinID = nil; pinNotice = nil })
      }
      if state.panel == .profile {
        Button { settings = true } label: {
          PixelIcon(name: "settings").frame(width: 26, height: 26).frame(width: 34, height: 34)
            .background(HermiPalette.paper, in: PixelPanel(corner: 8)).frame(width: 44, height: 44)
        }.accessibilityLabel("Settings").controlHelp("Open privacy and adventure sharing preferences")
        Button { state.sheet = .saved } label: {
          PixelIcon(name: "save").frame(width: 26, height: 26).frame(width: 34, height: 34)
            .background(HermiPalette.paper, in: PixelPanel(corner: 8)).frame(width: 44, height: 44)
        }.accessibilityLabel("Open Saved folders").controlHelp("Browse saved places, posts and plans")
      } else {
      Button {
        if state.panel == .feed { state.toggleFeedAudience() }
        else { state.social.toggle() }
      } label: {
        PixelIcon(name: "social").frame(width: 26, height: 26).frame(width: 34, height: 34)
          .background((state.panel == .feed ? state.feedOptions.audience == .friends : state.social) ? HermiPalette.lime : HermiPalette.paper, in: PixelPanel(corner: 8))
        .frame(width: 44, height: 44).contentShape(Rectangle())
      }.accessibilityLabel(state.panel == .feed ? (state.feedOptions.audience == .friends ? "Friends feed. Show public" : "Public feed. Show friends") : (state.social ? "Social map. Switch to Solo" : "Solo map. Switch to Social"))
        .controlHelp(state.panel == .feed ? "Toggle sample Feed between friends and public" : "Toggle Solo and Social map")
      Button {
        if state.panel == .feed { state.toggleFeedContent() }
        else { state.sheet = .plan; panelLevel = .full }
      } label: {
        PixelIcon(name: "plan").frame(width: 26, height: 26).frame(width: 34, height: 34)
          .background(state.panel == .feed && state.feedOptions.content == .plans ? HermiPalette.lime : HermiPalette.paper, in: PixelPanel(corner: 8))
        .frame(width: 44, height: 44).contentShape(Rectangle())
      }.accessibilityLabel(state.panel == .feed ? (state.feedOptions.content == .plans ? "Show posts" : "Show plans and adventures") : "My Plan, \(state.planIDs.count) places")
        .controlHelp(state.panel == .feed ? "Filter this audience’s feed between posts and sample plans" : "Open My Plan. Saved is inside its bookmark button")
      }
    }.buttonStyle(.plain)
  }

  private func map(in size: CGSize) -> some View {
    GeographicMap(state: state, command: mapCommand, editingPinID: mapCovered ? nil : editingPinID,
      revision: mapRevision, bottomInset: mapControlsBottom(in: size)) { event in
      switch event["type"] as? String {
      case "mapTap": editingPinID = nil
      case "moving": beginMapGesture()
      case "stopped", "error": endMapGesture()
      case "place": if let id = event["id"] as? String { editingPinID = nil; state.selectPlace(id); panelLevel = .compact }
      case "discovery":
        guard let raw = event["id"] as? String, let id = UUID(uuidString: raw), state.pin(id: id) != nil else { return }
        editingPinID = id; state.sheet = .nearby; panelLevel = .compact
      case "drop":
        guard event["requestID"] as? String == mapCommand?.id.uuidString,
              let latitude = event["latitude"] as? Double, let longitude = event["longitude"] as? Double else { return }
        let valid = state.dropGeographicPin(at: GeoPoint(latitude: latitude, longitude: longitude))
        if valid { editingPinID = state.discoveryPins.last?.id }
        pinNotice = valid ? nil : "Choose land within NYC. Water and outside areas aren’t available."
        mapRevision += 1
      case "pinDragStart":
        guard let raw = event["id"] as? String, let id = UUID(uuidString: raw), state.pin(id: id) != nil else { return }
        editingPinID = id; state.sheet = nil
      case "pinDragCancelled":
        guard let raw = event["id"] as? String, let id = UUID(uuidString: raw), state.pin(id: id) != nil else { return }
        editingPinID = id; state.sheet = .nearby; panelLevel = .compact; mapRevision += 1
      case "pinMove":
        guard let raw = event["id"] as? String, let id = UUID(uuidString: raw),
              let latitude = event["latitude"] as? Double, let longitude = event["longitude"] as? Double else { return }
        guard state.pin(id: id) != nil else { return }
        let valid = state.moveDiscovery(id: id, to: GeoPoint(latitude: latitude, longitude: longitude))
        pinNotice = valid ? nil : "Keep this pin on NYC land. Its previous position is restored."
        editingPinID = id; state.sheet = .nearby; panelLevel = .compact; mapRevision += 1
      case "pinRadius":
        guard let raw = event["id"] as? String, let id = UUID(uuidString: raw), let miles = event["miles"] as? Double else { return }
        state.setDiscoveryRadius(id: id, miles: miles)
      case "pinRemove":
        guard let raw = event["id"] as? String, let id = UUID(uuidString: raw), state.pin(id: id) != nil else { return }
        state.removeDiscovery(id: id); editingPinID = nil; pinNotice = nil
      case "dropRejected":
        guard event["requestID"] as? String == mapCommand?.id.uuidString else { return }
        pinNotice = "Wait for the map to finish loading, then try again."
      default: break
      }
    }
    .accessibilityHidden(mapCovered)
    .background(GeometryReader { geometry in
      Color.clear.onAppear { mapFrame = geometry.frame(in: .named("mapPreview")) }
        .onChange(of: geometry.frame(in: .named("mapPreview"))) { _, frame in mapFrame = frame }
    })
    .overlay(alignment: .bottomTrailing) {
      VStack(spacing: 0) {
        if !mapCovered {
        mapButton("plus", label: "Zoom in", action: "in")
        mapButton("minus", label: "Zoom out", action: "out")
        mapButton("locate", label: "Recenter on Columbia", action: "recenter")
        }
      }.padding(.trailing, 20).padding(.bottom, mapControlsBottom(in: size))
        .opacity(mapCovered ? 0 : 1).allowsHitTesting(!mapCovered).accessibilityHidden(mapCovered)
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
    return panelLevel == .compact ? compact : max(compact, min(height * 0.65, height - 460))
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
      state.switchPanel(panel); panelLevel = .compact; moving = false
    }
  }

  private var mapCovered: Bool { contextPanelFull || state.sheet == .plan || state.sheet == .saved }

  private var contextPanelFull: Bool {
    guard let sheet = state.sheet, sheet != .plan, sheet != .saved else { return false }
    return panelLevel == .full
  }

  private func bottomSheet(_ sheet: MapPreviewSheet, height: CGFloat, safeTop: CGFloat) -> some View {
    VStack(spacing: 8) {
      Capsule().fill(HermiPalette.ink.opacity(0.35)).frame(width: 38, height: 4)
        .frame(maxWidth: .infinity).frame(height: 36).contentShape(Rectangle())
        .gesture(DragGesture(minimumDistance: 12).exclusively(before: TapGesture()).onEnded { gesture in
          switch gesture {
          case .first(let value):
            if let level = panelLevel.afterDrag(value.translation.height, predicted: value.predictedEndTranslation.height) { panelLevel = level }
            else { state.sheet = nil; panelLevel = .compact }
          case .second: panelLevel = panelLevel.next
          }
        })
        .accessibilityElement().accessibilityAddTraits(.isButton)
        .accessibilityLabel(panelLevel == .full ? "Collapse details" : "Expand details")
        .accessibilityValue(String(describing: panelLevel))
        .accessibilityAction { panelLevel = panelLevel.next }
        .accessibilityAction(named: "Expand panel") { panelLevel = panelLevel == .compact ? .medium : .full }
        .accessibilityAction(named: "Collapse panel") { panelLevel = panelLevel == .full ? .medium : .compact }
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 12) {
          switch sheet {
          case .nearby: nearbyContent
          case .place(let id): if let place = MapSamplePlace.find(id) { placeContent(place) }
          case .plan, .saved: EmptyView()
          }
        }.padding(.horizontal, 20).padding(.bottom, 10)
      }.scrollIndicators(.hidden).id(sheet)
      Color.clear.frame(height: 82)
    }
    .frame(height: panelLevel.height(viewport: height, safeTop: safeTop))
    .animation(reduceMotion ? nil : .interactiveSpring(response: 0.3, dampingFraction: 0.9), value: panelLevel)
    .frame(maxWidth: .infinity)
    .background(HermiPalette.paper, in: UnevenRoundedRectangle(topLeadingRadius: 24, topTrailingRadius: 24))
    .overlay(alignment: .topTrailing) {
      Button {
        if state.returnSheet == .plan || state.returnSheet == .saved { state.goBack() }
        else { state.sheet = nil; state.returnSheet = nil }
        panelLevel = .compact
      } label: {
        PixelIcon(name: "close").frame(width: 14, height: 14).frame(width: 44, height: 36)
      }.buttonStyle(.plain).accessibilityLabel("Close details").controlHelp("Close this place or discovery panel").padding(.trailing, 8)
    }
  }

  private var discoverySummary: String {
    let pins = state.discoveryPins.count
    let city = state.activeCitywideCategory.map { "\($0.rawValue) citywide" }
    return [pins > 0 ? "\(pins) pin\(pins == 1 ? "" : "s")" : nil, city].compactMap { $0 }.joined(separator: " · ")
  }

  private var nearbyContent: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack { Text("Nearby").font(.headline); Spacer(); Text(discoverySummary).font(.caption).foregroundStyle(HermiPalette.secondary) }
      if state.nearby.isEmpty {
        Text("No sample places match these filters.").font(.subheadline)
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
        Text(place.name).font(.headline).lineLimit(1)
        Spacer(minLength: 4)
        Button { state.toggleSave(place.id) } label: {
          PixelIcon(name: state.savedIDs.contains(place.id) ? "saved" : "save").frame(width: 20, height: 24).frame(width: 44, height: 44)
        }.buttonStyle(.plain).accessibilityLabel(state.savedIDs.contains(place.id) ? "Unsave place" : "Save place").controlHelp("Toggle this place in Saved, independently of My Plan")
        Button { state.togglePlan(place.id) } label: {
          PixelIcon(name: state.planIDs.contains(place.id) ? "minus" : "plus")
            .frame(width: 20, height: 20).frame(width: 32, height: 32)
            .background(HermiPalette.lime, in: PixelPanel(corner: 6))
            .frame(width: 44, height: 44).contentShape(Rectangle())
        }.buttonStyle(.plain)
          .accessibilityLabel(state.planIDs.contains(place.id) ? "Remove from plan" : "Add to plan")
          .controlHelp("Toggle this place in My Plan without changing Saved")
      }
      PlaceFeedContent(place: place, savedPostIDs: Set(state.library.posts.map(\.refID))) { state.togglePostBookmark($0) }
        .id(place.id)

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
      .sheet(isPresented: $settings) {
        ProfileSettingsPage(preferences: state.privacyOptions) { state.privacyOptions = $0 }
      }
      .sheet(item: Binding(get: { postPlace.flatMap(MapSamplePlace.find) }, set: { postPlace = $0?.id })) { place in
        ScrollView {
          VStack(alignment: .leading, spacing: 20) {
            HStack { Text(place.name).font(.title2.bold()); Spacer(); Button { postPlace = nil } label: { PixelIcon(name: "close").frame(width: 20, height: 20).frame(width: 30, height: 30) }.accessibilityLabel("Close post").controlHelp("Return to the posts grid") }
            Text("Your posts").font(.headline)
            HStack(spacing: 6) { ForEach(0..<3) { mediaTile(place.category, variant: $0).frame(height: 150) } }
            Text("Your review").font(.headline)
            Text("No verified review loaded.").font(.subheadline)
            Text("Sample place · media and reviews await backend integration").font(.caption).foregroundStyle(HermiPalette.secondary)
          }.padding(20)
        }.background(HermiPalette.paper).presentationDetents([.medium, .large])
      }
  }
}

#Preview("Hermi · board composition") { HermiMapPreview() }
