import SwiftUI

enum ProfileDetail: String, Identifiable {
  case friends = "Friends", score = "Score", rank = "Rank", stats = "Stats"
  var id: String { rawValue }
}
struct ProfileDetailSheet: View {
  let detail: ProfileDetail
  @Environment(\.dismiss) private var dismiss
  private let live = LiveProfile.shared
  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 20) {
          if LiveSession.shared.isLive {
            liveContent
          } else {
            sampleContent
            Text("Preview · account data not connected").font(.caption).foregroundStyle(HermiPalette.secondary)
          }
        }.padding(20)
      }.background(HermiPalette.paper)
        .refreshable { await live.load(force: true) }
        .navigationTitle(detail.rawValue)
        .toolbar { ToolbarItem(placement: .cancellationAction) { CloseButton { dismiss() } } }
    }.presentationDetents([.medium, .large])
      .task { await live.load() }
  }

  // MARK: Live

  @ViewBuilder
  private var liveContent: some View {
    switch detail {
    case .score: scoreContent
    case .rank: rankContent
    case .friends: friendsContent
    case .stats: statsContent
    }
    if let error = live.error { Text(error).font(.caption).foregroundStyle(HermiPalette.error) }
  }

  @ViewBuilder
  private var scoreContent: some View {
    if let score = live.score {
      HStack(alignment: .bottom) {
        Spacer()
        VStack(spacing: 3) {
          CairnStack(stones: live.stones)
          PixelText(text: "\(score.score)", unit: 4).padding(.top, 16)
        }.accessibilityElement(children: .ignore)
          .accessibilityLabel("Score \(score.score), \(live.stones) stones")
        Spacer()
      }
      if let delta = score.delta7d { Text("\(delta >= 0 ? "+" : "")\(delta) XP in the last 7 days").font(.headline) }
      Sparkline(days: score.sparkline.map(\.xp))
      if let expiring = score.expiring, expiring.xp > 0 {
        Text("\(expiring.xp) XP expires\(expiring.by.map { " by \($0)" } ?? "") unless you get back outside.").font(.subheadline)
      }
      Text("Score is XP from the last 30 days. Exploration stays with you.").font(.caption).foregroundStyle(HermiPalette.secondary)
    } else {
      loadingRow
    }
  }

  @ViewBuilder
  private var rankContent: some View {
    let ranks = live.score?.ranks
    HStack { Text("Friends").font(.headline); Spacer(); Text(ranks?.friends.map { "#\($0.rank) of \($0.of)" } ?? "—") }
    board(live.friendsBoard)
    HStack { Text(ranks?.campus?.campus ?? "Campus").font(.headline); Spacer(); Text(ranks?.campus.map { "#\($0.rank) of \($0.of)" } ?? "—") }
    board(live.campusBoard, limit: 10)
  }

  @ViewBuilder
  private func board(_ board: LeaderboardDTO?, limit: Int = 20) -> some View {
    if let board {
      ForEach(board.items.prefix(limit), id: \.user.id) { entry in
        HStack {
          Text("\(entry.rank)").font(.system(.subheadline, design: .monospaced)).frame(width: 28, alignment: .leading)
          Text(entry.isMe == true ? "You" : entry.user.name).font(.subheadline.weight(entry.isMe == true ? .bold : .regular))
          Spacer()
          Text("\(entry.score)").font(.system(.subheadline, design: .monospaced))
        }.padding(.vertical, 4).padding(.horizontal, 8)
          .background(entry.isMe == true ? HermiPalette.lime.opacity(0.5) : .clear, in: PixelPanel(corner: 4))
      }
    } else {
      loadingRow
    }
  }

  @ViewBuilder
  private var friendsContent: some View {
    if live.friends.isEmpty {
      Text(live.loading ? "Loading friends…" : "No friends yet. Friends are added by tapping tags in person.").font(.subheadline)
    }
    ForEach(live.friends, id: \.user.id) { friend in
      HStack(alignment: .top, spacing: 12) {
        HermitSprite().frame(width: 34, height: 30)
        VStack(alignment: .leading, spacing: 3) {
          Text(friend.user.name).font(.headline)
          Text("@\(friend.user.username)").font(.caption).foregroundStyle(HermiPalette.secondary)
          if let last = friend.lastCheckin {
            Text("Last out: \(last.placeName) · \(last.at.formatted(.relative(presentation: .named)))").font(.caption)
          }
        }
        Spacer()
        VStack(alignment: .trailing, spacing: 3) {
          if let score = friend.score { Text("\(score)").font(.system(.subheadline, design: .monospaced)) }
          if let streak = friend.streak, streak.weeks > 0 { Text("\(streak.weeks)-week streak").font(.caption2) }
        }
      }
      Divider()
    }
  }

  @ViewBuilder
  private var statsContent: some View {
    if let stats = live.stats {
      if let pct = live.tiles?.manhattanPct {
        stat("Manhattan explored", String(format: "%.1f%%", pct))
      }
      stat("Places visited", live.profile?.counts?.placesVisited.map(String.init) ?? "—")
      if let foot = stats.onFoot {
        stat("On foot this month", foot.monthKm.map { String(format: "%.1f km", $0) } ?? "—")
        stat("Steps this month", foot.monthSteps.map { $0.formatted() } ?? "—")
      }
      if let hours = stats.hoursOut { stat("Hours outside this month", hours.month.map { String(format: "%.1f", $0) } ?? "—") }
      Text("Boroughs").font(.headline).padding(.top, 6)
      ForEach(stats.boroughs, id: \.name) { borough in
        VStack(alignment: .leading, spacing: 4) {
          HStack { Text(borough.name).font(.subheadline); Spacer(); Text(String(format: "%.1f%%", borough.pct)).font(.caption) }
          GeometryReader { geometry in
            ZStack(alignment: .leading) {
              Rectangle().fill(HermiPalette.line)
              Rectangle().fill(HermiPalette.green).frame(width: geometry.size.width * min(1, borough.pct / 100))
            }
          }.frame(height: 8)
        }
      }
      Text("Most visited").font(.headline).padding(.top, 6)
      if stats.topPlaces.isEmpty { Text("No visits yet.").font(.subheadline) }
      ForEach(stats.topPlaces, id: \.placeId) { place in
        stat(place.name, "\(place.visits) visit\(place.visits == 1 ? "" : "s")")
      }
      Text("Out with most").font(.headline).padding(.top, 6)
      ForEach(stats.peopleMost, id: \.user.id) { person in
        stat(person.user.name, "\(person.hangouts ?? 0) hangouts")
      }
    } else {
      loadingRow
    }
  }

  private func stat(_ label: String, _ value: String) -> some View {
    VStack(spacing: 6) {
      HStack { Text(label).font(.subheadline).lineLimit(1); Spacer(); Text(value).font(.system(.subheadline, design: .monospaced)) }
      Divider()
    }
  }

  private var loadingRow: some View {
    HStack { ProgressView(); Text(live.loading ? "Loading…" : "Not available").font(.subheadline) }
  }

  // MARK: Sample (not connected)

  @ViewBuilder
  private var sampleContent: some View {
    switch detail {
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
          CairnStack(stones: 4)
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
  }
}

/// The rock-stack Score: one stone per threshold crossed (narrow on top). Large counts show a number.
struct CairnStack: View {
  let stones: Int
  var body: some View {
    VStack(spacing: 3) {
      if stones > 12 { Text("×\(stones)").font(.caption.bold()) }
      ForEach(0..<min(stones, 12), id: \.self) { index in
        PixelPanel(corner: 6).fill(index % 2 == 0 ? HermiPalette.green : HermiPalette.lake)
          .frame(width: CGFloat(32 + index * 10), height: 18)
      }
      if stones == 0 { Text("No stones yet").font(.caption) }
    }
  }
}

/// Thirty daily XP bars, oldest first.
struct Sparkline: View {
  let days: [Int]
  var body: some View {
    let top = max(1, days.max() ?? 1)
    HStack(alignment: .bottom, spacing: 2) {
      ForEach(Array(days.enumerated()), id: \.offset) { _, xp in
        Rectangle().fill(xp > 0 ? HermiPalette.green : HermiPalette.line)
          .frame(height: max(3, CGFloat(xp) / CGFloat(top) * 70))
      }
    }.frame(height: 72).accessibilityLabel("XP per day for the last \(days.count) days")
  }
}
