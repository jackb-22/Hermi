import SwiftUI

/// Board-based composition review. All content stays local; live feature acceptance is separate.
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
  @State private var profileTab = "Posts"
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  private let storageKey = "hermi.preview.map-composition.v1"

  public init() {}

  public var body: some View {
    GeometryReader { geometry in
      ZStack {
        switch state.panel {
        case .map: map(in: geometry.size)
        case .feed: feed(in: geometry.size)
        case .profile: profile
        }
        VStack {
          topBar(in: geometry.size)
          Spacer()
        }.padding(.horizontal, 20).padding(.top, 8)

        if let sheet = state.sheet, state.panel == .map {
          VStack {
            Spacer()
            bottomSheet(sheet, height: geometry.size.height)
          }.transition(.move(edge: .bottom))
        }
        VStack {
          Spacer()
          navigationPill.opacity(moving ? 0 : 1).allowsHitTesting(!moving)
            .accessibilityHidden(moving)
        }.padding(.bottom, 16)
      }
      .coordinateSpace(name: "mapPreview")
      .clipped()
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
        Text("Illustrated map · sample data")
        Text("Composition review 01b")
        Divider()
        Button("Component lab") { lab = true }
        Toggle("Reduce motion", isOn: $reduceMotionOverride)
        Button("Reset preview") {
          state.reset(); pan = .zero; zoom = 1; expanded = false
          reduceMotionOverride = false; profileTab = "Posts"
          restorePill?.cancel(); moving = false
        }
      } label: {
        HStack(spacing: 8) {
          #if os(macOS)
          Text("hermi").font(.system(.caption, design: .monospaced).bold())
          #else
          PixelText(text: "hermi", unit: 2)
          #endif
          Image(systemName: "ellipsis").font(.caption)
        }.padding(.horizontal, 13).frame(height: 44)
          .background(HermiPalette.paper.opacity(0.96), in: Capsule())
      }.fixedSize().accessibilityLabel("Hermi preview options")
      Spacer()
      if state.panel == .map { mapTools(in: size) }
    }
  }

  private func mapTools(in size: CGSize) -> some View {
    VStack(spacing: 12) {
      VStack(spacing: 0) {
        Button { state.cycleCategory(-1) } label: {
          Image(systemName: "chevron.up").font(.caption.weight(.bold)).frame(width: 56, height: 36)
        }.accessibilityLabel("Previous activity category")
        Button { state.filterEnabled.toggle() } label: {
          VStack(spacing: 4) {
            CategorySprite(category: state.category).frame(width: 28, height: 28)
            Image(systemName: "arrowtriangle.down.fill").font(.system(size: 8))
          }.frame(width: 56, height: 52)
            .background(state.filterEnabled ? HermiPalette.category(state.category) : HermiPalette.paper)
        }
        .accessibilityLabel("\(state.category.rawValue) pin. Tap to filter or drag onto map")
        .accessibilityValue(state.filterEnabled ? "Filtered" : "All activities")
        .highPriorityGesture(DragGesture(minimumDistance: 12, coordinateSpace: .named("mapPreview"))
          .onEnded { value in
            let point = value.location
            let worldX = ((point.x-pan.width-size.width/2)/zoom+size.width/2)/size.width
            let worldY = ((point.y-pan.height-size.height/2)/zoom+size.height/2)/size.height
            state.dropPin(at: CGPoint(x: worldX, y: worldY)); expanded = false
          })
        Button { state.cycleCategory(1) } label: {
          Image(systemName: "chevron.down").font(.caption.weight(.bold)).frame(width: 56, height: 36)
        }.accessibilityLabel("Next activity category")
      }.background(HermiPalette.paper, in: Capsule())
        .overlay(Capsule().stroke(HermiPalette.ink.opacity(0.15), lineWidth: 1))
      Button { state.social.toggle() } label: {
        Image(systemName: state.social ? "person.2.fill" : "person.fill")
          .font(.system(size: 19)).frame(width: 52, height: 52)
          .background(state.social ? HermiPalette.lime : HermiPalette.paper, in: Circle())
      }.accessibilityLabel(state.social ? "Social map. Switch to Solo" : "Solo map. Switch to Social")
      if state.showsPlan {
        Button { state.sheet = .plan; expanded = false } label: {
          VStack(spacing: 4) {
            Image(systemName: "point.topleft.down.curvedto.point.bottomright.up").font(.title3)
            Text("My plan").font(.system(size: 10, weight: .medium))
            if !state.planIDs.isEmpty { Text("\(state.planIDs.count)").font(.caption.bold()) }
          }.padding(8).background(HermiPalette.paper, in: RoundedRectangle(cornerRadius: 16))
        }.accessibilityLabel("My plan, \(state.planIDs.count) places")
      }
    }.buttonStyle(.plain)
  }

  private func map(in size: CGSize) -> some View {
    ZStack {
      MapArtwork()
      route(in: size)
      ForEach(state.nearby) { place in
        Button { state.selectPlace(place.id); expanded = false } label: {
          ZStack(alignment: .topTrailing) {
            CategorySprite(category: place.category).frame(width: 22, height: 22)
              .frame(width: 42, height: 42)
              .background(PixelPanel(corner: 5).fill(HermiPalette.category(place.category)))
              .overlay(PixelPanel(corner: 5).stroke(HermiPalette.ink.opacity(0.7), lineWidth: 1.5))
            if let index = state.planIDs.firstIndex(of: place.id) {
              Text("\(index+1)").font(.system(size: 10, weight: .bold)).foregroundStyle(.white)
                .frame(width: 16, height: 16).background(HermiPalette.ink, in: Circle()).offset(x: 5, y: -5)
            }
          }
        }.buttonStyle(.plain).accessibilityLabel("\(place.name), \(place.category.rawValue)")
          .position(x: size.width*place.x, y: size.height*place.y)
      }
      HermitSprite().frame(width: 42, height: 38)
        .position(x: size.width*0.51, y: size.height*0.56).accessibilityHidden(true)
      if let discovery = state.discovery {
        Button { state.sheet = .nearby; expanded = false } label: {
          Image(systemName: "mappin.circle.fill").font(.system(size: 34))
            .foregroundStyle(HermiPalette.ink).background(HermiPalette.paper, in: Circle())
        }.buttonStyle(.plain).accessibilityLabel("Discovery pin. Show nearby places")
          .position(x: size.width*discovery.x, y: size.height*discovery.y)
      }
      if state.social {
        ForEach(0..<3) { index in
          Image(systemName: "person.2.fill").font(.system(size: 14))
            .frame(width: 36, height: 36).background(HermiPalette.coral, in: Circle())
            .overlay(Circle().stroke(HermiPalette.paper, lineWidth: 3))
            .position(x: size.width*(0.40+Double(index)*0.13), y: size.height*(0.34+Double(index)*0.14))
            .accessibilityLabel("Sample friend check-in marker. Detail not integrated yet")
        }
      }
    }
    .scaleEffect(min(1.8, max(1, zoom*pinch)))
    .offset(x: pan.width+drag.width, y: pan.height+drag.height)
    .contentShape(Rectangle())
    .gesture(DragGesture(minimumDistance: 10)
      .updating($drag) { value, state, _ in state = value.translation }
      .onChanged { _ in beginMapGesture() }
      .onEnded { value in
        pan.width = min(size.width*0.2, max(-size.width*0.2, pan.width+value.translation.width))
        pan.height = min(size.height*0.2, max(-size.height*0.2, pan.height+value.translation.height))
        endMapGesture()
      })
    .simultaneousGesture(MagnificationGesture()
      .updating($pinch) { value, state, _ in state = value }
      .onChanged { _ in beginMapGesture() }
      .onEnded { value in zoom = min(1.8, max(1, zoom*value)); endMapGesture() })
    .overlay(alignment: .bottomLeading) {
      Text("ILLUSTRATED PREVIEW").font(.system(size: 8, weight: .medium, design: .monospaced)).tracking(1)
        .foregroundStyle(HermiPalette.ink.opacity(0.8)).padding(.leading, 14).padding(.bottom, 88)
        .allowsHitTesting(false)
    }
    .overlay(alignment: .bottomTrailing) {
      Button { pan = .zero; zoom = 1 } label: {
        Image(systemName: "location.north.fill").frame(width: 42, height: 42)
          .background(HermiPalette.paper, in: Circle())
      }.buttonStyle(.plain).accessibilityLabel("Recenter sample map")
        .padding(.trailing, 18).padding(.bottom, 88)
    }
  }

  private func beginMapGesture() { restorePill?.cancel(); moving = true }
  private func endMapGesture() {
    restorePill?.cancel()
    restorePill = Task { @MainActor in
      do { try await Task.sleep(for: .milliseconds(300)) } catch { return }
      moving = false
    }
  }

  private func route(in size: CGSize) -> some View {
    Path { path in
      for (index, id) in state.planIDs.enumerated() {
        guard let place = MapSamplePlace.find(id) else { continue }
        let point = CGPoint(x: size.width*place.x, y: size.height*place.y)
        if index == 0 { path.move(to: point) } else { path.addLine(to: point) }
      }
    }.stroke(HermiPalette.ink.opacity(0.65), style: StrokeStyle(lineWidth: 2, dash: [3,5]))
      .accessibilityHidden(true)
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
        Image(systemName: "xmark").font(.caption.weight(.semibold)).frame(width: 44, height: 36)
      }.buttonStyle(.plain).accessibilityLabel("Close details").padding(.trailing, 8)
    }
  }

  private var nearbyContent: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack { Text("Nearby").font(.headline); Spacer(); Text(state.category.rawValue).font(.caption).foregroundStyle(HermiPalette.secondary) }
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
          Image(systemName: "chevron.left").frame(width: 24, height: 30)
        }.buttonStyle(.plain).accessibilityLabel(state.returnSheet == .plan ? "Back to My plan" : "Back to nearby")
        Text(place.name).font(.headline).lineLimit(1)
        Spacer(minLength: 4)
        Button { state.toggleSave(place.id) } label: {
          Image(systemName: state.savedIDs.contains(place.id) ? "bookmark.fill" : "bookmark").frame(width: 36, height: 36)
        }.buttonStyle(.plain).accessibilityLabel(state.savedIDs.contains(place.id) ? "Unsave place" : "Save place")
      }
      HStack(spacing: 8) {
        ForEach(0..<3) { index in mediaTile(place.category, variant: index).frame(height: expanded ? 110 : 68) }
      }
      HStack {
        Text(place.category.rawValue).font(.caption).foregroundStyle(HermiPalette.secondary)
        Spacer()
        Button { state.addPlace(place.id) } label: {
          Label(state.planIDs.contains(place.id) ? "Added" : "Add", systemImage: state.planIDs.contains(place.id) ? "checkmark" : "plus")
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
            Button { state.removePlace(id) } label: { Image(systemName: "minus.circle").frame(width: 44, height: 44) }
              .buttonStyle(.plain).accessibilityLabel("Remove \(place.name)")
          }
        }
      }
      if expanded {
        Text("Timing and Start will be tested in the plan increment.").font(.footnote).foregroundStyle(HermiPalette.secondary)
      }
    }
  }

  private func mediaTile(_ category: HermiCategory, variant: Int = 0) -> some View {
    ZStack {
      HermiPalette.category(category).opacity(variant == 1 ? 0.55 : 0.8)
      Image(systemName: variant == 2 ? "play.rectangle" : "photo")
        .font(.title3).foregroundStyle(HermiPalette.ink.opacity(0.55))
    }.clipShape(RoundedRectangle(cornerRadius: 6))
      .accessibilityLabel(variant == 2 ? "Video placement" : "Photo placement")
  }

  private func feed(in size: CGSize) -> some View {
    ZStack {
      HermiPalette.green
      ParkPlacement().scaledToFill()
        .frame(width: size.width, height: size.height).clipped().opacity(0.9)
      LinearGradient(colors: [.clear, .black.opacity(0.65)], startPoint: .center, endPoint: .bottom)
      Image(systemName: "play.fill").font(.system(size: 38)).foregroundStyle(.white.opacity(0.85))
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
            Image(systemName: state.savedIDs.contains("garden") ? "bookmark.fill" : "bookmark").font(.title2).frame(width: 44, height: 44)
          }.buttonStyle(.plain).accessibilityLabel("Save sample feed place")
        }
        Button { state.switchPanel(.map); state.selectPlace("garden") } label: {
          Label("Riverside gardens", systemImage: "mappin").font(.subheadline).padding(12)
            .background(.white.opacity(0.15), in: Capsule())
        }.buttonStyle(.plain)
        Text("SAMPLE MEDIA PLACEMENT").font(.system(size: 9, design: .monospaced)).opacity(0.8)
      }.foregroundStyle(.white).padding(.horizontal, 24).padding(.bottom, 100)
    }.clipped()
  }

  private var profile: some View {
    ZStack {
      MapArtwork().overlay(HermiPalette.paper.opacity(0.3))
      VStack(spacing: 18) {
        HStack(spacing: 16) {
          HermitSprite().frame(width: 55, height: 48)
          VStack(alignment: .leading, spacing: 5) {
            Text("Alex").font(.title2.bold())
            Text("@alex · Sample profile").font(.caption).foregroundStyle(HermiPalette.secondary)
          }
          Spacer()
          VStack(spacing: 6) {
            PixelText(text: "250", unit: 2.5)
            Text("Score").font(.caption)
          }
        }
        HStack(spacing: 24) {
          ForEach(["Posts", "Plans", "Saved"], id: \.self) { tab in
            Button { profileTab = tab } label: {
              Text(tab).font(.subheadline.weight(profileTab == tab ? .bold : .regular))
                .padding(.bottom, 8).overlay(alignment: .bottom) {
                  if profileTab == tab { Rectangle().fill(HermiPalette.green).frame(height: 2) }
                }
            }.buttonStyle(.plain)
          }
        }
      }.padding(20).background(HermiPalette.paper, in: RoundedRectangle(cornerRadius: 22))
        .frame(maxHeight: .infinity, alignment: .top).padding(.top, 66).padding(.horizontal, 18)
      VStack { Spacer(); Text("\(profileTab) · sample layout").font(.caption).padding(10).background(HermiPalette.paper, in: Capsule()) }
        .padding(.bottom, 100)
    }
  }
}

#Preview("Hermi · board composition") { HermiMapPreview() }
