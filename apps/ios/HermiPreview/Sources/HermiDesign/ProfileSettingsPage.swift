import SwiftUI

struct ProfileSettingsPage: View {
  var save: (PrivacyPreferences) -> Void
  @State private var draft: PrivacyPreferences
  @Environment(\.dismiss) private var dismiss
  init(preferences: PrivacyPreferences, save: @escaping (PrivacyPreferences) -> Void) {
    self.save = save; _draft = State(initialValue: preferences)
  }
  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      HStack {
        Button { dismiss() } label: { PixelIcon(name: "close").frame(width: 20, height: 20).frame(width: 44, height: 44) }
          .accessibilityLabel("Cancel settings changes")
        Text("Settings").font(.title2.bold())
        Spacer()
      }
      ScrollView {
        VStack(alignment: .leading, spacing: 20) {
          ServerSettingsSection()
          Divider()
          Text("PRIVACY · LOCAL PREFERENCES").font(.system(size: 10, design: .monospaced))
          Text("Adventure sharing").font(.headline)
          HStack {
            ForEach(RouteAudience.allCases, id: \.self) { audience in
              Button(audience.rawValue) { draft.routes = audience }
                .frame(maxWidth: .infinity, minHeight: 44)
                .background(draft.routes == audience ? HermiPalette.lime : .white, in: PixelPanel(corner: 5))
                .accessibilityAddTraits(draft.routes == audience ? .isSelected : [])
            }
          }
          Toggle("Location sharing", isOn: $draft.locationSharing).tint(HermiPalette.green)
          Text("Live place visibility").font(.headline)
          HStack {
            ForEach(PresenceAudience.allCases, id: \.self) { audience in
              Button(audience.rawValue) { draft.presence = audience }
                .frame(maxWidth: .infinity, minHeight: 44)
                .background(draft.presence == audience ? HermiPalette.lime : .white, in: PixelPanel(corner: 5))
                .accessibilityAddTraits(draft.presence == audience ? .isSelected : [])
            }
          }.disabled(!draft.locationSharing).opacity(draft.locationSharing ? 1 : 0.45)
          Text("Live sharing is unavailable in this preview. These choices stay on this device; they do not publish routes, share your location or change anyone’s access.")
            .font(.caption).foregroundStyle(HermiPalette.secondary)
          Button("Save preview preferences") {
            if !draft.locationSharing { draft.presence = .nobody }
            save(draft); dismiss()
          }.font(.subheadline.bold()).padding(14)
            .background(HermiPalette.lime, in: PixelPanel(corner: 6))
        }
      }
    }.padding(20).padding(.top, 12).background(HermiPalette.paper)
      .foregroundStyle(HermiPalette.ink).buttonStyle(.plain)
  }
}
