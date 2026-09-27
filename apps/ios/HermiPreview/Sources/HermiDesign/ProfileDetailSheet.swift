import SwiftUI

enum ProfileDetail: String, Identifiable {
  case friends = "Friends", score = "Score", rank = "Rank", stats = "Stats", sharing = "Route sharing"
  var id: String { rawValue }
}
struct ProfileDetailSheet: View {
  let detail: ProfileDetail
  @AppStorage("hermi.preview.routeAudience") private var savedAudience = "Private"
  @State private var draftAudience = "Private"
  @Environment(\.dismiss) private var dismiss
  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 20) {
          switch detail {
          case .sharing:
            Text("Choose who can see your adventures.").font(.headline)
            ForEach(["Private", "Friends", "Everyone"], id: \.self) { audience in
              Button { draftAudience = audience } label: {
                HStack {
                  Text(audience == "Everyone" ? "Everyone · public" : audience)
                  Spacer()
                  if draftAudience == audience { PixelIcon(name: "check").frame(width: 20, height: 20) }
                }.padding(14).frame(minHeight: 48)
                  .background(draftAudience == audience ? HermiPalette.lime : HermiPalette.paper, in: PixelPanel(corner: 6))
              }.buttonStyle(.plain).controlHelp("Select \(audience) as the draft visibility. Save to apply the preview setting").accessibilityAddTraits(draftAudience == audience ? .isSelected : [])
            }
            Button("Save preview setting") { savedAudience = draftAudience; dismiss() }
              .buttonStyle(.borderedProminent).tint(HermiPalette.green).controlHelp("Save only this local preview preference; no route will be published")
            Text("This saves only the preview choice. No routes will be published.").font(.caption)
          case .stats:
            Text("Most visited places · ascending by visit count").font(.headline)
            Text("No visit history loaded.").font(.subheadline)
            ForEach(["New York covered", "Steps taken", "Most visited borough", "Least visited borough", "Most visited neighborhood", "Least visited neighborhood"], id: \.self) { label in
              HStack { Text(label); Spacer(); Text("—").foregroundStyle(HermiPalette.secondary) }
              Divider()
            }
          case .friends:
            Text("No friends loaded.").font(.headline)
            Text("Friends’ profiles and permitted routes will appear here.").font(.subheadline)
          case .score:
            HStack {
              Spacer()
              VStack(spacing: 3) {
                ForEach(0..<4) { index in
                  PixelPanel(corner: 6).fill(index % 2 == 0 ? HermiPalette.green : HermiPalette.lake)
                    .frame(width: CGFloat(32 + index*14), height: 22)
                }
                PixelText(text: "250", unit: 4).padding(.top, 16)
              }.accessibilityLabel("Sample score 250, four stones")
              Spacer()
            }
            Text("Score reflects the last 30 days. Exploration stays with you.").font(.subheadline)
          case .rank:
            HStack { Text("Friends"); Spacer(); Text("—") }
            HStack { Text("Campus"); Spacer(); Text("—") }
            Text("No ranking loaded.").font(.subheadline)
          }
          Text("Preview · account data not connected").font(.caption).foregroundStyle(HermiPalette.secondary)
        }.padding(20)
      }.background(HermiPalette.paper)
        .navigationTitle(detail.rawValue)
        .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() }.controlHelp("Close this account panel") } }
    }.presentationDetents([.medium, .large])
      .onAppear { draftAudience = ["Private", "Friends", "Everyone"].contains(savedAudience) ? savedAudience : "Private" }
  }
}
