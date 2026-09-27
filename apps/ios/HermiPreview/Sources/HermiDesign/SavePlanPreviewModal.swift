import SwiftUI

struct SavePlanPreviewModal: View {
  let folders: [SavedFolder]
  let stopCount: Int
  let save: (String, UUID?, String?, SavedVisibility, Set<String>) -> Bool
  @Environment(\.dismiss) private var dismiss
  @State private var name = ""
  @State private var folderID: UUID?
  @State private var newFolder = ""
  @State private var visibility: SavedVisibility = .solo
  @State private var friends: Set<String> = []
  @State private var error = false

  private var canSave: Bool {
    !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && name.count <= 80 && stopCount > 0 &&
      (visibility != .friends || !friends.isEmpty) && newFolder.count <= 40 &&
      (newFolder.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || folderID == nil)
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack {
        CloseButton { dismiss() }
          .accessibilityLabel("Cancel saving plan")
        Text("Save Plan").font(.title2.bold())
        Spacer()
        Button(visibility == .solo ? "Save Plan" : "Save Draft") {
          if save(name, folderID, newFolder, visibility, friends) { dismiss() } else { error = true }
        }.font(.caption.bold()).padding(.horizontal, 12).frame(height: 40)
          .background(HermiPalette.lime, in: PixelPanel(corner: 5))
          .disabled(!canSave).opacity(canSave ? 1 : 0.45)
      }.padding(.horizontal, 18).padding(.top, 28)
      ScrollView {
        VStack(alignment: .leading, spacing: 20) {
          sectionTitle("YOUR PLAN")
          TextField("Name this plan", text: $name)
            .padding(14).background(.white, in: PixelPanel(corner: 6))
            .accessibilityLabel("Plan name")
          Text("\(stopCount) explicit stop\(stopCount == 1 ? "" : "s")").font(.caption)
            .foregroundStyle(HermiPalette.secondary)
          sectionTitle("INSPIRATION BOARD")
          Menu {
            Button("All saved") { folderID = nil }
            ForEach(folders) { folder in Button(folder.name) { folderID = folder.id; newFolder = "" } }
          } label: {
            HStack { PixelIcon(name: "saved").frame(width: 17, height: 20)
              Text(folders.first(where: { $0.id == folderID })?.name ?? "All saved")
              Spacer(); Image(systemName: "chevron.down")
            }.padding(14).background(.white, in: PixelPanel(corner: 6))
          }.disabled(!newFolder.isEmpty).accessibilityLabel("Choose existing folder")
          TextField("Or create a new folder", text: $newFolder)
            .padding(14).background(.white, in: PixelPanel(corner: 6)).disabled(folderID != nil)
          Text("Folders hold places, posts and plans. Standalone images are not supported yet.")
            .font(.caption).foregroundStyle(HermiPalette.secondary)
          sectionTitle("VISIBILITY INTENT")
          HStack(spacing: 8) {
            ForEach(SavedVisibility.allCases, id: \.self) { option in
              Button(option.rawValue) { visibility = option }
                .font(.subheadline.bold()).frame(maxWidth: .infinity, minHeight: 48)
                .background(visibility == option ? HermiPalette.lime : .white, in: PixelPanel(corner: 6))
                .accessibilityAddTraits(visibility == option ? .isSelected : [])
            }
          }
          if visibility == .friends {
            Text(LiveSession.shared.isLive ? "SELECT FRIENDS" : "SELECT FRIENDS · SAMPLE LIST").font(.system(size: 10, design: .monospaced))
            ForEach(FriendDirectory.shared.names, id: \.self) { friend in
              Button {
                if friends.contains(friend) { friends.remove(friend) } else { friends.insert(friend) }
              } label: {
                HStack { Text(friend); Spacer(); PixelIcon(name: friends.contains(friend) ? "check" : "plus").frame(width: 18, height: 18) }
                  .padding(12).background(friends.contains(friend) ? HermiPalette.lime.opacity(0.45) : .white, in: PixelPanel(corner: 5))
              }.accessibilityLabel("\(friends.contains(friend) ? "Deselect" : "Select") \(friend)")
            }
          }
          Text(LiveSession.shared.isLive
            ? (visibility == .solo ? "Saved to your account." : visibility == .friends ? "Selected friends get an invite to join." : "Matched verified students can request to join.")
            : (visibility == .solo ? "Saved on this device." : "Local \(visibility.rawValue.lowercased()) draft only. No invitation or public post is sent."))
            .font(.caption).foregroundStyle(HermiPalette.secondary)
          if error { Text("Check the name, folder and friend selection.").font(.caption).foregroundStyle(.red) }
        }.padding(20)
      }
    }.buttonStyle(.plain).foregroundStyle(HermiPalette.ink).background(HermiPalette.paper)
  }

  private func sectionTitle(_ title: String) -> some View {
    Text(title).font(.system(size: 11, design: .monospaced).bold()).foregroundStyle(HermiPalette.green)
  }
}
