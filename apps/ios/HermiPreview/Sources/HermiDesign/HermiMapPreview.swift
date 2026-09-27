import SwiftUI

/// Product fixtures stay local; the geographic basemap fetches public tiles.
public struct HermiMapPreview: View {
  @State private var state = MapPreviewState()
  @State private var pan = CGSize.zero
  @GestureState private var drag = CGSize.zero
  @State private var zoom: CGFloat = 1
  @GestureState private var pinch: CGFloat = 1
  @State private var moving = false
  @State private var restorePill: Task<Void, Never>?
  @State private var lab = false
  @State private var expanded = false
  @State private var reduceMotionOverride = false
  @State private var profileTab = "Adventures"
  @State private var mapCommand: MapCommand?
  @State private var postPlace: String?
  @State private var profileDetail: ProfileDetail?
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  private let storageKey = "hermi.preview.map-composition.v1"

  public init() {}

  public var body: some View {
    GeometryReader { safeGeometry in
      GeometryReader { geometry in
      ZStack {
        switch state.panel {
        case .map: map(in: geometry.size).ignoresSafeArea()
        case .feed: feed(in: geometry.size).ignoresSafeArea()
        case .profile: profile
        }
        VStack {
          topBar(in: geometry.size)
          Spacer()
        }.padding(.horizontal, 20).padding(.top, safeGeometry.safeAreaInsets.top + 8)

        if let sheet = state.sheet {
          VStack {
            Spacer()
            bottomSheet(sheet, height: geometry.size.height)
          }.transition(.move(edge: .bottom))
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
      if let data = UserDefaults.standard.data(forKey: storageKey),
        let saved = try? JSONDecoder().decode(MapPreviewState.self, from: data) {
        state = saved
        // Map remains the launch panel, as required by the unified truth.
        state.switchPanel(.map)
        state.planIDs = state.planIDs.filter { MapSamplePlace.find($0) != nil }
      }
    }
    .onChange(of: state) { _, value in
      if let data = try? JSONEncoder().encode(value) { UserDefaults.standard.set(data, forKey: storageKey) }
    }
    .onDisappear { restorePill?.cancel() }
  }

  private func topBar(in size: CGSize) -> some View {
    HStack(alignment: .top) {
      Menu {
        Text("Real geography · sample places")
        Text("Composition review 01c")
        Divider()
        Button("Component lab") { lab = true }
        Toggle("Reduce motion", isOn: $reduceMotionOverride)
        Button("Reset preview") {
          UserDefaults.standard.removeObject(forKey: "hermi.preview.routeAudience")
          state.reset(); mapCommand = MapCommand(action: "recenter"); expanded = false
          reduceMotionOverride = false; profileTab = "Adventures"
          restorePill?.cancel(); moving = false
        }
      } label: {
        HStack(spacing: 8) {
          #if os(macOS)
          Text("hermi").font(.system(.caption, design: .monospaced).bold())
          #else
          PixelText(text: "hermi", unit: 2)
          #endif
          PixelIcon(name: "menu").frame(width: 16, height: 16)
        }.padding(.horizontal, 13).frame(height: 44)
          .background(HermiPalette.paper.opacity(0.96), in: Capsule())
      }.fixedSize().accessibilityLabel("Hermi preview options")
      Spacer()
      mapTools(in: size)
    }
  }

  private func mapTools(in size: CGSize) -> some View {
    VStack(spacing: 12) {
      if state.panel == .map {
        CategoryPinControl(category: $state.category, onFilter: { state.filterEnabled.toggle() }, onDrop: { point in
          mapCommand = MapCommand(action: "drop", point: point)
          expanded = false
        })
      }
      Button { state.social.toggle(); state.switchPanel(.map) } label: {
        PixelIcon(name: "social").frame(width: 26, height: 26).frame(width: 52, height: 52)
          .background(state.social ? HermiPalette.lime : HermiPalette.paper, in: PixelPanel(corner: 8))
      }.accessibilityLabel(state.social ? "Social map. Switch to Solo" : "Solo map. Switch to Social")
      Button { state.sheet = .plan; expanded = true } label: {
        PixelIcon(name: "plan").frame(width: 26, height: 26).frame(width: 52, height: 52)
          .background(HermiPalette.paper, in: PixelPanel(corner: 8))
      }.accessibilityLabel("Plan and Saved, \(state.planIDs.count) places")
    }.buttonStyle(.plain)
  }

  private func map(in size: CGSize) -> some View {
    GeographicMap(state: state, command: mapCommand) { event in
      switch event["type"] as? String {
      case "moving": beginMapGesture()
      case "stopped", "error": endMapGesture()
      case "place": if let id = event["id"] as? String { state.selectPlace(id); expanded = false }
      case "discovery": state.sheet = .nearby; expanded = false
      case "drop":
        if let latitude = event["latitude"] as? Double, let longitude = event["longitude"] as? Double {
          state.dropGeographicPin(at: GeoPoint(latitude: latitude, longitude: longitude))
        }
      default: break
      }
    }
    .overlay(alignment: .bottomTrailing) {
      VStack(spacing: 8) {
        mapButton("plus", label: "Zoom in", action: "in")
        mapButton("minus", label: "Zoom out", action: "out")
        mapButton("locate", label: "Recenter on Columbia", action: "recenter")
      }.padding(.trailing, 18).padding(.bottom, 170)
    }
  }
  private func mapButton(_ icon: String, label: String, action: String) -> some View {
    Button { mapCommand = MapCommand(action: action) } label: {
      PixelIcon(name: icon).frame(width: 20, height: 20).frame(width: 44, height: 44)
        .background(HermiPalette.paper, in: PixelPanel(corner: 6))
    }.buttonStyle(.plain).accessibilityLabel(label)
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
    HStack(spacing: 8) {
      ForEach(HomePanel.allCases, id: \.self) { panel in
        Button { state.switchPanel(panel); expanded = false } label: {
          VStack(spacing: 3) {
            NavigationSprite(panel: panel, selected: state.panel == panel).frame(width: 23, height: 23)
            Text(panel.rawValue).font(.system(size: 10, weight: state.panel == panel ? .bold : .medium))
          }.frame(width: 64, height: 48)
            .foregroundStyle(state.panel == panel ? HermiPalette.paper : HermiPalette.ink)
            .background(state.panel == panel ? HermiPalette.ink : .clear, in: Capsule())
        }.buttonStyle(.plain).accessibilityLabel(panel.rawValue)
          .accessibilityAddTraits(state.panel == panel ? .isSelected : [])
          .accessibilityIdentifier("home.\(panel.rawValue.lowercased())")
      }
    }.padding(6).background(HermiPalette.paper, in: Capsule())
      .overlay(Capsule().stroke(HermiPalette.ink.opacity(0.15), lineWidth: 1))
      .shadow(color: HermiPalette.ink.opacity(0.12), radius: 12, y: 4)
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
          case .plan: planContent
          }
        }.padding(.horizontal, 20).padding(.bottom, 10)
      }.scrollIndicators(.hidden)
      Spacer(minLength: 70)
    }
    .frame(height: expanded ? height*0.65 : min(300, height*0.39))
    .frame(maxWidth: .infinity)
    .background(HermiPalette.paper, in: UnevenRoundedRectangle(topLeadingRadius: 24, topTrailingRadius: 24))
    .overlay(alignment: .topTrailing) {
      Button { state.sheet = nil; expanded = false } label: {
        PixelIcon(name: "close").frame(width: 14, height: 14).frame(width: 44, height: 36)
      }.buttonStyle(.plain).accessibilityLabel("Close details").padding(.trailing, 8)
    }
  }

  private var nearbyContent: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack { Text("Nearby").font(.headline); Spacer(); Text(state.category.rawValue).font(.caption).foregroundStyle(HermiPalette.secondary) }
      if state.nearby.isEmpty { Text("No sample places within 1.5 km here.").font(.subheadline) }
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
          PixelIcon(name: "back").frame(width: 20, height: 20).frame(width: 44, height: 44)
        }.buttonStyle(.plain).accessibilityLabel(state.returnSheet == .plan ? "Back to My plan" : "Back to nearby")
        Text(place.name).font(.headline).lineLimit(1)
        Spacer(minLength: 4)
        Button { state.toggleSave(place.id) } label: {
          PixelIcon(name: state.savedIDs.contains(place.id) ? "saved" : "save").frame(width: 20, height: 24).frame(width: 44, height: 44)
        }.buttonStyle(.plain).accessibilityLabel(state.savedIDs.contains(place.id) ? "Unsave place" : "Save place")
      }
      HStack(spacing: 8) {
        ForEach(0..<3) { index in mediaTile(place.category, variant: index).frame(height: expanded ? 110 : 68) }
      }
      HStack {
        Text(place.category.rawValue).font(.caption).foregroundStyle(HermiPalette.secondary)
        Spacer()
        Button { state.addPlace(place.id) } label: {
          HStack { PixelIcon(name: state.planIDs.contains(place.id) ? "check" : "plus").frame(width: 14, height: 14); Text(state.planIDs.contains(place.id) ? "Added" : "Add") }
            .font(.subheadline.weight(.semibold)).padding(.horizontal, 20).frame(height: 44)
            .background(HermiPalette.lime, in: Capsule())
        }.buttonStyle(.plain).disabled(state.planIDs.contains(place.id))
      }
      if expanded {
        Divider()
        Text("Photos and verified reviews appear here.").font(.footnote).foregroundStyle(HermiPalette.secondary)
        Text("Sample place · no live hours or reviews loaded").font(.caption).foregroundStyle(HermiPalette.secondary)
      }
    }
  }

  private var planContent: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text("My plan").font(.headline)
      if state.planIDs.isEmpty {
        Text("Choose a nearby place to add.").font(.subheadline).foregroundStyle(HermiPalette.secondary)
      }
      ForEach(Array(state.planIDs.enumerated()), id: \.element) { index, id in
        if let place = MapSamplePlace.find(id) {
          HStack(spacing: 10) {
            Text("\(index+1)").font(.caption.bold()).frame(width: 24, height: 24).background(HermiPalette.lime, in: Circle())
            Button(place.name) { state.selectPlace(id) }.buttonStyle(.plain).font(.subheadline)
            Spacer()
            Button { state.removePlace(id) } label: { PixelIcon(name: "minus").frame(width: 18, height: 18).frame(width: 44, height: 44) }
              .buttonStyle(.plain).accessibilityLabel("Remove \(place.name)")
          }
        }
      }
      Divider()
      Text("Saved").font(.headline)
      if state.savedIDs.isEmpty { Text("Saved places appear here.").font(.caption).foregroundStyle(HermiPalette.secondary) }
      ForEach(MapSamplePlace.all.filter { state.savedIDs.contains($0.id) }) { place in
        Button { state.selectPlace(place.id) } label: {
          HStack { BallpointPin(category: place.category).frame(width: 20, height: 28); Text(place.name); Spacer(); PixelIcon(name: "plus").frame(width: 14, height: 14) }.frame(minHeight: 44)
        }.buttonStyle(.plain).accessibilityLabel("Open saved place \(place.name)")
      }
      if expanded {
        Text("Timing and Start will be tested in the plan increment.").font(.footnote).foregroundStyle(HermiPalette.secondary)
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

  private func feed(in size: CGSize) -> some View {
    ZStack {
      HermiPalette.green
      // Size the 4:3 artwork before cropping; nested aspectRatio modifiers leave bands.
      ParkPlacement()
        .frame(width: max(size.width, size.height * 4 / 3),
               height: max(size.height, size.width * 3 / 4))
        .frame(width: size.width, height: size.height).clipped().opacity(0.9)
      LinearGradient(colors: [.clear, .black.opacity(0.65)], startPoint: .center, endPoint: .bottom)
      PixelIcon(name: "play").frame(width: 38, height: 38)
        .accessibilityLabel("Video placement; playback is not integrated yet")
      VStack(alignment: .leading, spacing: 12) {
        Spacer()
        HStack(alignment: .bottom) {
          VStack(alignment: .leading, spacing: 6) {
            Text("@alex").font(.subheadline.bold())
            Text("A little detour.").font(.title3.weight(.medium))
          }
          Spacer()
          Button { state.toggleSave("garden") } label: {
            PixelIcon(name: state.savedIDs.contains("garden") ? "saved" : "save").frame(width: 22, height: 26).frame(width: 44, height: 44)
          }.buttonStyle(.plain).accessibilityLabel("Save sample feed place")
        }
        Button { state.switchPanel(.map); state.selectPlace("garden") } label: {
          HStack { BallpointPin(category: .nature).frame(width: 16, height: 22); Text("Riverside gardens") }.font(.subheadline).padding(12)
            .background(.white.opacity(0.15), in: Capsule())
        }.buttonStyle(.plain)
        Text("SAMPLE MEDIA PLACEMENT").font(.system(size: 9, design: .monospaced)).opacity(0.8)
      }.foregroundStyle(.white).padding(.horizontal, 24).padding(.bottom, 100)
    }.clipped()
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
            }.buttonStyle(.plain).accessibilityLabel(detail.rawValue)
          }
        }.padding(.horizontal, 24)
        HStack(spacing: 40) {
          ForEach(["Adventures", "Posts"], id: \.self) { tab in
            Button { profileTab = tab } label: {
              PixelIcon(name: tab == "Adventures" ? "route" : "grid").frame(width: 25, height: 25)
                .frame(width: 64, height: 48)
                .background(profileTab == tab ? HermiPalette.lime : .clear, in: PixelPanel(corner: 6))
            }.buttonStyle(.plain).accessibilityLabel(tab).accessibilityAddTraits(profileTab == tab ? .isSelected : [])
          }
        }
        if profileTab == "Adventures" {
          GeographicMap(state: MapPreviewState(), adventure: true).frame(height: 520)
            .overlay(alignment: .topLeading) {
              Button { profileDetail = .sharing } label: {
                PixelIcon(name: "social").frame(width: 23, height: 23).frame(width: 44, height: 44)
                  .background(HermiPalette.paper, in: PixelPanel(corner: 6))
              }.buttonStyle(.plain).accessibilityLabel("Adventure sharing settings").padding(12)
            }
            .overlay(alignment: .topTrailing) {
              Button { profileDetail = .stats } label: {
                PixelIcon(name: "info").frame(width: 23, height: 23).frame(width: 44, height: 44)
                  .background(HermiPalette.paper, in: PixelPanel(corner: 6))
              }.buttonStyle(.plain).accessibilityLabel("Adventure statistics").padding(12)
            }
        } else {
          LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 3), count: 3), spacing: 3) {
            ForEach(0..<12) { index in
              let place = MapSamplePlace.all[index % MapSamplePlace.all.count]
              Button { postPlace = place.id } label: {
                mediaTile(place.category, variant: index % 3).aspectRatio(0.8, contentMode: .fit)
              }.buttonStyle(.plain).accessibilityLabel("Sample post at \(place.name)")
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
            HStack { Text(place.name).font(.title2.bold()); Spacer(); Button { postPlace = nil } label: { PixelIcon(name: "close").frame(width: 20, height: 20).frame(width: 44, height: 44) }.accessibilityLabel("Close post") }
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
