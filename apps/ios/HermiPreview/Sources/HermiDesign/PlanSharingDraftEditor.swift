import SwiftUI

struct PlanSharingDraftEditor: View {
  let plan: SavedPlanDraft
  var keep: (SavedVisibility, Set<String>) -> Void
  @Environment(\.dismiss) private var dismiss
  @State private var visibility: SavedVisibility
  @State private var friends: Set<String>

  init(plan: SavedPlanDraft, keep: @escaping (SavedVisibility, Set<String>) -> Void) {
    self.plan = plan; self.keep = keep
    _visibility = State(initialValue: plan.visibility)
    _friends = State(initialValue: Set(plan.friendNames))
  }
  var body: some View {
    VStack(alignment: .leading, spacing: 20) {
      HStack {
        CloseButton { dismiss() }
          .accessibilityLabel("Cancel sharing edits")
        Text("Sharing draft").font(.title2.bold())
        Spacer()
      }
      ScrollView {
        VStack(alignment: .leading, spacing: 16) {
          Text(plan.name).font(.headline)
          HStack {
            ForEach(SavedVisibility.allCases, id: \.self) { option in
              Button(option.rawValue) { visibility = option }
                .frame(maxWidth: .infinity, minHeight: 44)
                .background(visibility == option ? HermiPalette.lime : .white, in: PixelPanel(corner: 5))
                .accessibilityAddTraits(visibility == option ? .isSelected : [])
            }
          }
          if visibility == .friends {
            Text("Choose existing friends · sample list").font(.caption)
            ForEach(FriendDirectory.shared.names, id: \.self) { name in
              Button {
                if friends.contains(name) { friends.remove(name) } else { friends.insert(name) }
              } label: {
                HStack { Text(name); Spacer(); PixelIcon(name: friends.contains(name) ? "check" : "plus").frame(width: 18, height: 18) }
                  .padding(12).background(.white, in: PixelPanel(corner: 5))
              }.accessibilityLabel("\(friends.contains(name) ? "Deselect" : "Select") \(name)")
            }
            Text("Selected: \(friends.sorted().joined(separator: ", "))").font(.caption)
            Button("Save & invite — unavailable") { }.disabled(true).font(.subheadline.bold())
          }
          Text("This preview cannot send invitations or publish. Keep these preferences on this device; no friends are notified.")
            .font(.caption).foregroundStyle(HermiPalette.secondary)
          Button("Keep draft preferences") {
            keep(visibility, friends); dismiss()
          }.font(.subheadline.bold()).padding(14)
            .background(HermiPalette.lime, in: PixelPanel(corner: 6))
            .disabled(visibility == .friends && friends.isEmpty)
        }
      }
    }.padding(20).padding(.top, 12).background(HermiPalette.paper)
      .foregroundStyle(HermiPalette.ink).buttonStyle(.plain)
  }
}
