import SwiftUI

struct ActionModePreview: View {
  let session: ActionPreviewSession
  var selectMode: (ActionPreviewSession.Mode) -> Void
  var end: () -> Void
  var done: () -> Void
  @State private var confirmingEnd = false

  var body: some View {
    Group {
      if session.endedAt != nil { recap }
      else { active }
    }.foregroundStyle(HermiPalette.ink).buttonStyle(.plain)
      .confirmationDialog("End this Action preview?", isPresented: $confirmingEnd, titleVisibility: .visible) {
        Button("End preview") { end() }
        Button("Keep exploring", role: .cancel) { }
      } message: { Text("Your plan stays saved. This preview has not recorded a trip.") }
  }

  private var active: some View {
    ZStack {
      if session.mode == .camera {
        HermiPalette.ink.ignoresSafeArea()
        VStack(spacing: 20) {
          PixelIcon(name: "camera").frame(width: 60, height: 48).padding(30).background(HermiPalette.controlSurface, in: PixelPanel(corner: 10))
            .foregroundStyle(HermiPalette.ink)
          Text("Camera").font(.title2.bold())
          Text("Capture needs a verified check-in. This layout preview cannot check in or record media.")
            .font(.subheadline).multilineTextAlignment(.center).frame(maxWidth: 280)
          Text("Photo + ambient audio · video up to 15 seconds").font(.caption).multilineTextAlignment(.center)
        }.padding(24).foregroundStyle(HermiPalette.paper)
      } else {
        GeographicMap(state: MapPreviewState(), showsPlaces: false).ignoresSafeArea()
        VStack {
          Spacer()
          VStack(alignment: .leading, spacing: 8) {
            Text("Planned stops").font(.headline)
            stops.frame(height: min(240, CGFloat(session.stopIDs.count) * 36))
            Text("No route or location tracking connected.").font(.caption)
          }.padding(18).frame(maxWidth: .infinity, alignment: .leading)
            .background(HermiPalette.controlSurface, in: PixelPanel(corner: 10)).padding(.horizontal, 18).padding(.bottom, 100)
        }
      }
      VStack {
        HStack {
          Text("ACTION PREVIEW").font(.system(.caption, design: .monospaced)).padding(10).background(HermiPalette.controlSurface, in: PixelPanel(corner: 5))
          Spacer()
          Button("End") { confirmingEnd = true }.frame(minWidth: 44, minHeight: 44)
            .padding(.horizontal, 8).background(HermiPalette.controlSurface, in: PixelPanel(corner: 5))
            .accessibilityLabel("End Action preview")
        }.padding(.horizontal, 18).padding(.top, 8)
        Spacer()
        HStack(spacing: 12) {
          modeButton("Directions", icon: "route", mode: .directions)
          modeButton("Camera", icon: "camera", mode: .camera)
        }.padding(8).background(HermiPalette.controlSurface, in: Capsule()).padding(.bottom, 16)
      }
    }
  }

  private var recap: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 24) {
        Text("Preview complete").font(.largeTitle.bold())
        Text("Your plan is unchanged.").font(.title3)
        Text("No trip was recorded. Verified visits, route, steps and XP will appear here after a real outing is processed.")
          .foregroundStyle(HermiPalette.secondary)
        Text("Planned stops").font(.headline)
        ForEach(Array(session.stopIDs.enumerated()), id: \.element) { index, id in
          if let place = MapSamplePlace.find(id) { Text("\(index + 1). \(place.name)") }
        }
        Button("Back to Map") { done() }.font(.headline).padding(16)
          .frame(maxWidth: .infinity).background(HermiPalette.lime, in: PixelPanel(corner: 8))
      }.padding(24)
    }.frame(maxWidth: .infinity, maxHeight: .infinity).background(HermiPalette.paper.ignoresSafeArea())
  }

  private var stops: some View {
    ScrollView {
      LazyVStack(alignment: .leading, spacing: 10) {
        ForEach(Array(session.stopIDs.enumerated()), id: \.element) { index, id in
          if let place = MapSamplePlace.find(id) { Text("\(index + 1). \(place.name)").font(.subheadline) }
        }
      }.frame(maxWidth: .infinity, alignment: .leading)
    }
  }
  private func modeButton(_ label: String, icon: String, mode: ActionPreviewSession.Mode) -> some View {
    Button { selectMode(mode) } label: {
      VStack(spacing: 4) { PixelIcon(name: icon).frame(width: 24, height: 24); Text(label).font(.caption) }
        .frame(width: 95, height: 48).background(session.mode == mode ? HermiPalette.lime : .clear, in: Capsule())
        .contentShape(Rectangle())
    }.accessibilityLabel(label).accessibilityAddTraits(session.mode == mode ? .isSelected : [])
  }
}
