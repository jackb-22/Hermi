import SwiftUI

struct ActionModePreview: View {
  let plan: [String]
  var end: () -> Void
  @State private var camera = false
  var body: some View {
    ZStack {
      if camera {
        HermiPalette.ink.ignoresSafeArea()
        VStack(spacing: 20) {
          PixelIcon(name: "camera").frame(width: 60, height: 48).padding(30).background(HermiPalette.paper, in: PixelPanel(corner: 10))
          Text("Camera preview").font(.title2.bold())
          Text("Capture is not connected yet. No photos, microphone or location are being recorded.")
            .font(.subheadline).multilineTextAlignment(.center).frame(maxWidth: 280)
          Text("In Action: tap for photo · hold for video").font(.caption)
        }.foregroundStyle(HermiPalette.paper)
      } else {
        GeographicMap(state: MapPreviewState(), showsPlaces: false).ignoresSafeArea()
        VStack {
          Spacer()
          VStack(alignment: .leading, spacing: 8) {
            Text("Directions").font(.headline)
            ForEach(Array(plan.enumerated()), id: \.element) { index,id in
              if let place = MapSamplePlace.find(id) { Text("\(index+1). \(place.name)").font(.subheadline) }
            }
            Text("No turn-by-turn route loaded.").font(.caption)
          }.padding(18).frame(maxWidth: .infinity, alignment: .leading)
            .background(HermiPalette.paper, in: PixelPanel(corner: 10)).padding(.horizontal, 18).padding(.bottom, 100)
        }
      }
      VStack {
        HStack {
          Text("ACTION PREVIEW").font(.system(.caption, design: .monospaced)).padding(10).background(HermiPalette.paper, in: PixelPanel(corner: 5))
          Spacer()
          Button("End preview") { end() }.padding(12).background(HermiPalette.paper, in: PixelPanel(corner: 5))
            .controlHelp("Exit this layout preview and return to My Plan. No trip was started")
        }.padding(.horizontal, 18).padding(.top, 8)
        Spacer()
        HStack(spacing: 12) {
          modeButton("Directions", icon: "route", selected: !camera) { camera = false }
          modeButton("Camera", icon: "camera", selected: camera) { camera = true }
        }.padding(8).background(HermiPalette.paper, in: Capsule()).padding(.bottom, 16)
      }
    }.foregroundStyle(HermiPalette.ink).buttonStyle(.plain)
  }
  private func modeButton(_ label: String, icon: String, selected: Bool, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      VStack(spacing: 4) { PixelIcon(name: icon).frame(width: 24, height: 24); Text(label).font(.caption) }
        .frame(width: 95, height: 48).background(selected ? HermiPalette.lime : .clear, in: Capsule())
    }.controlHelp("Show \(label) in Action mode")
      .accessibilityAddTraits(selected ? .isSelected : [])
  }
}
