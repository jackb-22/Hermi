import SwiftUI

/// My Plan: friends' plans I'm invited to (Join / Can't) and plans I've joined (Go! runs the host's plan).
struct InvitationsSection: View {
  var goJoined: (String, [String]) -> Void
  private let social = LiveSocial.shared
  @State private var message: String?

  var body: some View {
    let invites = social.invitations, joined = social.joined
    VStack(alignment: .leading, spacing: 8) {
      if !invites.isEmpty || !joined.isEmpty {
        Text("FROM FRIENDS").font(.system(size: 10, design: .monospaced)).foregroundStyle(HermiPalette.secondary)
      }
      ForEach(invites, id: \.plan.id) { item in
        row(item.plan, caption: "\(host(item.plan)) invited you") {
          Button("Join") { respond(item.plan.id, join: true) }
            .font(.caption.bold()).padding(.horizontal, 12).frame(minHeight: 36).background(HermiPalette.lime, in: PixelPanel(corner: 5))
          Button("Can’t") { respond(item.plan.id, join: false) }
            .font(.caption).padding(.horizontal, 10).frame(minHeight: 36).background(.white, in: PixelPanel(corner: 5))
        }
      }
      ForEach(joined, id: \.plan.id) { item in
        row(item.plan, caption: "Joined · \(host(item.plan))’s plan") {
          Button("Go!") { goJoined(item.plan.id, item.plan.stops.compactMap { $0.place?.id }) }
            .font(.caption.bold()).padding(.horizontal, 14).frame(minHeight: 36).background(HermiPalette.lime, in: PixelPanel(corner: 5))
            .accessibilityLabel("Start \(item.plan.name) together")
        }
      }
      if let message { Text(message).font(.caption).foregroundStyle(HermiPalette.error) }
    }
    .padding(.horizontal, 18)
    .task { await social.load() }
  }

  private func row<Actions: View>(_ plan: PlanDTO, caption: String, @ViewBuilder actions: () -> Actions) -> some View {
    HStack(spacing: 10) {
      PlanRouteSketch(places: plan.stops.compactMap { $0.place?.place }).frame(width: 54, height: 54).clipShape(PixelPanel(corner: 6))
      VStack(alignment: .leading, spacing: 2) {
        Text(plan.name).font(.subheadline.bold()).lineLimit(1)
        Text(caption).font(.caption2).foregroundStyle(HermiPalette.secondary)
        Text(plan.stops.compactMap { $0.place?.name }.joined(separator: " → ")).font(.caption2).lineLimit(1)
      }
      Spacer(minLength: 4)
      actions()
    }.padding(8).background(HermiPalette.lime.opacity(0.18), in: PixelPanel(corner: 6))
  }

  private func host(_ plan: PlanDTO) -> String {
    plan.hostId.flatMap { id in FriendDirectory.shared.friends.first { $0.id == id }?.name } ?? "A friend"
  }

  private func respond(_ planID: String, join: Bool) {
    Task { message = await social.respond(to: planID, join: join) }
  }
}
