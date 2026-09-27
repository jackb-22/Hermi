import SwiftUI

public struct HermiGallery: View {
  private static let storageKey = "hermi.preview.foundation.v1"
  @State private var state: GalleryState
  @State private var resetID = 0

  public init() {
    _state = State(initialValue: GalleryState.restore(UserDefaults.standard.data(forKey: Self.storageKey)))
  }

  private var textSize: DynamicTypeSize {
    switch state.textSize {
    case .standard: return .large
    case .large: return .xxxLarge
    case .accessible: return .accessibility2
    }
  }

  public var body: some View {
    VStack(spacing: 0) {
      reviewToolbar
      ScrollView {
        VStack(alignment: .leading, spacing: 26) {
          brand
          specimenPicker
          switch state.specimen {
          case .places: placeSpecimen
          case .controls: controlSpecimen
          case .score: ScoreSpecimen(score: $state.score, forcedReduceMotion: state.reduceMotion)
          }
          HStack(spacing: 8) {
            Rectangle().fill(HermiPalette.green).frame(width: 6, height: 6)
            Text("A small step outside.").font(.footnote).foregroundStyle(HermiPalette.secondary)
          }.padding(.top, 4).accessibilityHidden(true)
        }.padding(.horizontal, 24).padding(.top, 24).padding(.bottom, 32)
      }
      .id("\(state.specimen.rawValue)-\(resetID)")
      .dynamicTypeSize(textSize)
      .scrollIndicators(.hidden)
    }
    .foregroundStyle(HermiPalette.ink)
    .background(HermiPalette.paper)
    .preferredColorScheme(.light)
    .onChange(of: state) { _, value in
      if let data = try? JSONEncoder().encode(value) { UserDefaults.standard.set(data, forKey: Self.storageKey) }
    }
  }

  private var reviewToolbar: some View {
    HStack(spacing: 14) {
      VStack(alignment: .leading, spacing: 3) {
        Text("REVIEW 01").font(.system(size: 10, weight: .bold, design: .monospaced)).tracking(1.4)
        Text("Sample data · saved locally").font(.system(size: 10)).foregroundStyle(HermiPalette.secondary)
      }
      Spacer(minLength: 0)
      Menu {
        Picker("Place state", selection: $state.scenario) {
          ForEach(SampleState.allCases, id: \.self) { Text($0.rawValue).tag($0) }
        }
        Picker("Text size", selection: $state.textSize) {
          ForEach(PreviewTextSize.allCases, id: \.self) { Text($0.rawValue).tag($0) }
        }
        Toggle("Reduce motion", isOn: $state.reduceMotion)
      } label: {
        Label("Preview", systemImage: "slider.horizontal.3").font(.system(size: 12, weight: .medium)).frame(minHeight: 44)
      }.accessibilityIdentifier("preview.options")
      Button("Reset") { state.reset(); resetID += 1 }
        .font(.system(size: 12, weight: .semibold)).frame(minHeight: 44)
        .accessibilityIdentifier("preview.reset")
    }
    .buttonStyle(.plain)
    .padding(.horizontal, 20).padding(.vertical, 4)
    .background(HermiPalette.line.opacity(0.35))
    .overlay(alignment: .bottom) { Rectangle().fill(HermiPalette.line).frame(height: 1) }
  }

  private var brand: some View {
    HStack(alignment: .center) {
      VStack(alignment: .leading, spacing: 12) {
        PixelText(text: "hermi", unit: 4)
        Eyebrow(text: "Come out of your shell")
      }
      Spacer(minLength: 8)
      HermitSprite().frame(width: 76, height: 60)
    }
  }

  private var specimenPicker: some View {
    ViewThatFits(in: .horizontal) {
      HStack(spacing: 4) { specimenButtons }
      VStack(spacing: 6) { specimenButtons }
    }
    .padding(5).background(PixelPanel(corner: 5).fill(HermiPalette.line.opacity(0.45)))
  }
  @ViewBuilder private var specimenButtons: some View {
    ForEach(Specimen.allCases, id: \.self) { specimen in
      Button { state.specimen = specimen } label: {
        Text(specimen.rawValue).font(.subheadline.weight(.semibold))
          .frame(maxWidth: .infinity, minHeight: 44).padding(.horizontal, 10)
          .background(PixelPanel(corner: 3).fill(state.specimen == specimen ? HermiPalette.ink : .clear))
          .foregroundStyle(state.specimen == specimen ? HermiPalette.paper : HermiPalette.ink)
      }.buttonStyle(.plain)
        .accessibilityAddTraits(state.specimen == specimen ? .isSelected : [])
        .accessibilityIdentifier("specimen.\(specimen.rawValue.lowercased())")
    }
  }

  private var placeSpecimen: some View {
    VStack(alignment: .leading, spacing: 22) {
      VStack(alignment: .leading, spacing: 10) {
        PixelText(text: "A LITTLE", unit: 3.4)
        PixelText(text: "FURTHER.", unit: 3.4, color: HermiPalette.green)
        Text("New places. Familiar faces.\nA reason to head outside.")
          .font(.subheadline).lineSpacing(4).foregroundStyle(HermiPalette.secondary).padding(.top, 4)
      }.accessibilityElement(children: .combine).accessibilityAddTraits(.isHeader)
      categoryPicker
      HStack {
        Eyebrow(text: "A place to begin")
        Spacer()
        Text("SAMPLE").font(.system(.caption2, design: .monospaced)).foregroundStyle(HermiPalette.secondary)
      }
      switch state.scenario {
      case .ready: placeCard
      case .loading:
        statePanel(title: "Finding a little adventure", message: "Loading nearby places…", action: "Finish sample loading", icon: "hourglass")
      case .empty:
        statePanel(title: "A quiet corner", message: "No places found here. Try a different area.", action: "Try sample area", icon: "map")
      case .error:
        statePanel(title: "Couldn't load places", message: "Your selection is still here. Give it another try.", action: "Retry", icon: "exclamationmark.triangle")
      }
      if !state.planItems.isEmpty {
        HStack(alignment: .top, spacing: 12) {
          Image(systemName: "checkmark").accessibilityHidden(true)
          VStack(alignment: .leading, spacing: 4) {
            Text("\(state.planItems.count) \(state.planItems.count == 1 ? "place" : "places") in your sample plan").font(.subheadline.weight(.semibold))
            Text("Only places you explicitly add appear here.").font(.footnote).foregroundStyle(HermiPalette.secondary)
          }
        }.padding(16).frame(maxWidth: .infinity, alignment: .leading)
          .background(PixelPanel(corner: 4).fill(HermiPalette.lime.opacity(0.4)))
      }
    }
  }

  private var categoryPicker: some View {
    ScrollView(.horizontal) {
      HStack(spacing: 10) {
        ForEach(HermiCategory.allCases, id: \.self) { category in
          Button { state.category = category } label: {
            VStack(spacing: 9) {
              CategorySprite(category: category).frame(width: 30, height: 30)
                .frame(width: 54, height: 50)
                .background(PixelPanel(corner: 5).fill(state.category == category ? HermiPalette.category(category) : .white))
                .overlay(PixelPanel(corner: 5).stroke(state.category == category ? HermiPalette.ink : HermiPalette.line, lineWidth: state.category == category ? 2 : 1))
              Text(category.rawValue).font(.caption.weight(state.category == category ? .bold : .regular))
            }.padding(2)
          }.buttonStyle(.plain).accessibilityLabel(category.rawValue)
            .accessibilityAddTraits(state.category == category ? .isSelected : [])
        }
      }
    }.scrollIndicators(.hidden)
  }

  private var placeCard: some View {
    VStack(alignment: .leading, spacing: 0) {
      ZStack(alignment: .bottomLeading) {
        ParkPlacement()
        Text("PHOTO PLACEMENT · 4:3").font(.system(.caption2, design: .monospaced).weight(.semibold))
          .padding(9).background(HermiPalette.paper).padding(12)
      }
      VStack(alignment: .leading, spacing: 14) {
        HStack(alignment: .top, spacing: 12) {
          VStack(alignment: .leading, spacing: 6) {
            Text(state.category.placeName).font(.title3.weight(.semibold)).fixedSize(horizontal: false, vertical: true)
            Text("\(state.category.rawValue) · Sample place").font(.footnote).foregroundStyle(HermiPalette.secondary)
          }
          Spacer(minLength: 0)
          Button { state.toggleSave() } label: {
            Image(systemName: state.saved.contains(state.category) ? "bookmark.fill" : "bookmark")
              .font(.title3).frame(width: 44, height: 44)
              .background(PixelPanel(corner: 4).fill(HermiPalette.lime.opacity(0.6)))
          }.buttonStyle(.plain)
            .accessibilityLabel(state.saved.contains(state.category) ? "Unsave sample place" : "Save sample place")
            .accessibilityValue(state.saved.contains(state.category) ? "Saved" : "Not saved")
        }
        Text(state.category.detail).font(.subheadline).foregroundStyle(HermiPalette.secondary).lineSpacing(3)
        Button { state.addSelectedPlace() } label: {
          HStack {
            Text(state.planItems.contains(state.category) ? "Added to sample plan" : "Add to sample plan")
            Spacer(minLength: 8)
            Image(systemName: state.planItems.contains(state.category) ? "checkmark" : "plus")
          }
        }.buttonStyle(HermiButtonStyle()).disabled(state.planItems.contains(state.category))
          .accessibilityIdentifier("place.add")
        if state.planItems.contains(state.category) {
          Button("Remove from sample plan") { state.planItems.remove(state.category) }
            .font(.footnote.weight(.semibold)).frame(minHeight: 44)
            .buttonStyle(.plain).frame(maxWidth: .infinity)
        }
      }.padding(18)
    }
    .background(.white).clipShape(PixelPanel(corner: 8))
    .overlay(PixelPanel(corner: 8).stroke(HermiPalette.line, lineWidth: 1))
  }

  private func statePanel(title: String, message: String, action: String, icon: String) -> some View {
    VStack(alignment: .leading, spacing: 18) {
      Image(systemName: icon).font(.title).foregroundStyle(state.scenario == .error ? HermiPalette.error : HermiPalette.green)
      Text(title).font(.title3.bold())
      Text(message).font(.subheadline).foregroundStyle(HermiPalette.secondary)
      Button(action) { state.recover() }.buttonStyle(HermiButtonStyle())
    }.padding(24).frame(maxWidth: .infinity, alignment: .leading)
      .background(PixelPanel().fill(.white))
      .overlay(PixelPanel().stroke(HermiPalette.line, lineWidth: 1))
  }

  private var controlSpecimen: some View {
    VStack(alignment: .leading, spacing: 24) {
      PixelText(text: "SMALL DETAILS", unit: 2.5)
      Text("A few things to touch, try and make your own.").font(.subheadline).foregroundStyle(HermiPalette.secondary)
      VStack(alignment: .leading, spacing: 16) {
        Eyebrow(text: "Your name")
        TextField("Name", text: $state.name)
          .textFieldStyle(.plain).font(.body).padding(16)
          .background(PixelPanel(corner: 4).fill(HermiPalette.paper))
          .overlay(PixelPanel(corner: 4).stroke(HermiPalette.line, lineWidth: 1))
          .accessibilityLabel("Sample name")
          .onChange(of: state.name) { _, name in
            if name.count > 80 { state.name = String(name.prefix(80)) }
            state.controlConfirmed = false
          }
        Button { state.controlConfirmed = true } label: {
          Label("Try primary action", systemImage: "arrow.up.right")
        }.buttonStyle(HermiButtonStyle()).disabled(state.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        Button("Try secondary action") { state.controlConfirmed = false }
          .buttonStyle(HermiButtonStyle(secondary: true))
        Button("Unavailable action") {}.buttonStyle(HermiButtonStyle()).disabled(true)
        if state.controlConfirmed {
          Label("Looking good, \(state.name).", systemImage: "checkmark.circle.fill")
            .font(.subheadline).foregroundStyle(HermiPalette.green)
        }
      }.padding(20).background(PixelPanel().fill(.white))
      VStack(alignment: .leading, spacing: 14) {
        Eyebrow(text: "A little color")
        HStack(spacing: 8) {
          ForEach(Array([HermiPalette.ink, HermiPalette.green, HermiPalette.lime, HermiPalette.lake, HermiPalette.coral, HermiPalette.lavender].enumerated()), id: \.offset) { _, color in
            PixelPanel(corner: 4).fill(color).frame(height: 40)
          }
        }.accessibilityLabel("Forest ink, green, lime, lake blue, coral and lavender")
        Text("One accent at a time. Room for the place to do the talking.").font(.footnote).foregroundStyle(HermiPalette.secondary)
      }
      VStack(alignment: .leading, spacing: 12) {
        Eyebrow(text: "Video placement")
        ZStack {
          Rectangle().fill(HermiPalette.ink)
          VStack(spacing: 12) {
            Image(systemName: "play.rectangle").font(.largeTitle)
            Text("VIDEO POSTER · 9:16").font(.system(.caption, design: .monospaced))
            Text("Playback arrives in the media increment.").font(.footnote).multilineTextAlignment(.center)
          }.foregroundStyle(HermiPalette.paper).padding(16)
        }.aspectRatio(9/16, contentMode: .fit).frame(maxWidth: 210)
          .clipShape(PixelPanel()).accessibilityElement(children: .combine)
      }
    }
  }
}

private struct ScoreSpecimen: View {
  @Binding var score: Int
  var forcedReduceMotion: Bool
  @Environment(\.accessibilityReduceMotion) private var systemReduceMotion
  private var reduceMotion: Bool { forcedReduceMotion || systemReduceMotion }
  @State private var windGeneration = 0
  @State private var windVisible = false
  private var stones: Int { HermiStoneScale.count(score) }

  var body: some View {
    VStack(alignment: .leading, spacing: 22) {
      PixelText(text: "BUILT OUTSIDE", unit: 2.5)
      Text("Every little outing adds up.").font(.subheadline).foregroundStyle(HermiPalette.secondary)
      VStack(spacing: 22) {
        Eyebrow(text: "Your rolling score · sample")
        PixelText(text: String(score), unit: 6)
        ScrollView(.vertical) {
          VStack(spacing: 2) {
            if stones == 0 {
              PixelPanel(corner: 7).stroke(HermiPalette.secondary, style: StrokeStyle(lineWidth: 1, dash: [4,4]))
                .frame(width: 110, height: 28).padding(.top, 136)
            }
            ForEach(Array((0..<stones).reversed()), id: \.self) { index in
              PixelPanel(corner: 6)
                .fill([HermiPalette.green, HermiPalette.lake, HermiPalette.lime, HermiPalette.lavender, HermiPalette.coral][index % 5])
                .overlay(alignment: .top) {
                  Rectangle().fill(.white.opacity(0.35)).frame(width: max(12, 76-CGFloat(index)*2), height: 3).padding(.top, 4)
                }
                .frame(width: max(28, 130-CGFloat(index)*5), height: 25)
                .offset(x: index % 2 == 0 ? -3 : 3)
                .transition(reduceMotion ? .opacity : .asymmetric(insertion: .offset(y: -24).combined(with: .opacity), removal: .offset(x: 90, y: -20).combined(with: .opacity)))
            }
            Rectangle().fill(HermiPalette.line).frame(width: 170, height: 4).padding(.top, 5)
          }.frame(maxWidth: .infinity).frame(minHeight: 176, alignment: .bottom).padding(.vertical, 8)
        }.frame(height: 200).defaultScrollAnchor(.bottom)
          .overlay(alignment: .topLeading) {
            if windVisible && !reduceMotion {
              Image(systemName: "wind").font(.title).foregroundStyle(HermiPalette.lake).padding(20)
            }
          }
          .animation(reduceMotion ? nil : .easeOut(duration: 0.65), value: stones)
          .accessibilityElement(children: .ignore)
          .accessibilityLabel("\(stones) stones. Score \(score).")
        Text("\(stones) \(stones == 1 ? "stone" : "stones") · \(HermiStoneScale.threshold(stones+1)-score) XP to the next")
          .font(.subheadline.weight(.semibold)).multilineTextAlignment(.center)
        GeometryReader { geo in
          ZStack(alignment: .leading) {
            Rectangle().fill(HermiPalette.line)
            Rectangle().fill(HermiPalette.green).frame(width: geo.size.width * HermiStoneScale.progress(score))
          }
        }.frame(height: 6).accessibilityLabel("Progress to next stone")
          .accessibilityValue("\(Int(HermiStoneScale.progress(score)*100)) percent")
        Text("Score reflects the last 30 days.\nPlaces you've explored stay with you.")
          .font(.footnote).foregroundStyle(HermiPalette.secondary).multilineTextAlignment(.center).lineSpacing(3)
      }.padding(24).frame(maxWidth: .infinity).background(PixelPanel().fill(.white))
      Eyebrow(text: "Try sample values")
      LazyVGrid(columns: [GridItem(.adaptive(minimum: 64))], spacing: 10) {
        ForEach([0,24,25,74,75,250,5000], id: \.self) { value in
          Button(String(value)) { score = value }
            .font(.subheadline.monospacedDigit().weight(.semibold)).frame(maxWidth: .infinity, minHeight: 44)
            .background(PixelPanel(corner: 3).fill(score == value ? HermiPalette.lime : .white))
            .overlay(PixelPanel(corner: 3).stroke(score == value ? HermiPalette.ink : HermiPalette.line, lineWidth: 1))
            .buttonStyle(.plain).accessibilityLabel("Set sample Score to \(value)")
            .accessibilityAddTraits(score == value ? .isSelected : [])
        }
      }
      Button("Expire top stone") { score = max(0, HermiStoneScale.threshold(stones)-1) }
        .buttonStyle(HermiButtonStyle(secondary: true)).disabled(stones == 0)
      Text("Preview controls only. No XP is earned here.").font(.footnote).foregroundStyle(HermiPalette.secondary)
    }
    .onChange(of: score) { old, new in
      if HermiStoneScale.losesStone(from: old, to: new) { windGeneration += 1 }
    }
    .task(id: windGeneration) {
      guard windGeneration > 0, !reduceMotion else { windVisible = false; return }
      windVisible = true
      do { try await Task.sleep(for: .seconds(1)) } catch { return }
      windVisible = false
    }
  }
}

#Preview("Hermi · foundations") { HermiGallery() }
