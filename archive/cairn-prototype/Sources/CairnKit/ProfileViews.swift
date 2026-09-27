import SwiftUI

struct ProfileView: View {
  @EnvironmentObject var store: CairnStore
  @State var tab = "Plans"
  @State var items: [JSON] = []
  @State var folders: [JSON] = []
  @State var selectedFolder = ""
  @State var folderName = ""
  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 25) {
        HStack(alignment: .top) {
          ZStack {
            RoundedRectangle(cornerRadius: 22).fill(Theme.lime)
            Image(systemName: "figure.walk").font(.system(size: 28, weight: .bold)).foregroundStyle(
              Theme.ink)
          }.frame(width: 62, height: 62)
          VStack(alignment: .leading, spacing: 5) {
            Text(store.profile["user"]["name"].text).font(
              .system(size: 23, weight: .bold, design: .rounded))
            Text("@" + store.profile["user"]["username"].text).font(.caption).foregroundStyle(
              Theme.muted)
            if store.profile["user"]["verified"].flag {
              Label(
                store.profile["user"]["campus"].text + " · "
                  + store.profile["user"]["studentStatus"].text.capitalized,
                systemImage: "checkmark.seal.fill"
              ).font(.system(size: 10, weight: .medium)).foregroundStyle(Theme.green)
            }
          }
          Spacer()
          Button {
            store.sheet = "settings"
          } label: {
            Image(systemName: "gearshape").font(.title3)
          }.buttonStyle(.plain).accessibilityLabel("Settings")
        }
        scoreCard
        VStack(alignment: .leading, spacing: 12) {
          HStack {
            SectionLabel(text: "Your corner of the world")
            Spacer()
            Button {
              store.sheet = "stats"
            } label: {
              Image(systemName: "info.circle")
            }.buttonStyle(.plain).accessibilityLabel("Exploration stats")
          }
          ZStack(alignment: .bottomLeading) {
            if store.preview {
              IllustratedMap(small: true)
            } else {
              ExplorationMap(tiles: store.tiles)
            }
            VStack(alignment: .leading, spacing: 3) {
              Text(String(format: "%.1f%%", store.tiles["manhattanPct"].number)).font(
                .system(size: 26, weight: .bold, design: .monospaced))
              Text("of Manhattan, made yours").font(.system(size: 11))
            }.padding(17).background(
              Theme.paper.opacity(0.9), in: RoundedRectangle(cornerRadius: 15)
            ).padding(14)
          }.frame(height: 205).clipShape(RoundedRectangle(cornerRadius: 23))
          Text("Every new block stays. Even when your Score changes.").font(.system(size: 11))
            .foregroundStyle(Theme.muted)
        }
        HStack {
          ForEach(["Posts", "Plans", "Saved"], id: \.self) { title in
            Button {
              tab = title
            } label: {
              VStack(spacing: 10) {
                Text(title).font(.system(size: 14, weight: tab == title ? .bold : .regular))
                Rectangle().fill(tab == title ? Theme.green : Theme.line).frame(height: 2)
              }
            }.buttonStyle(.plain)
          }
        }
        if tab == "Saved" {
          ScrollView(.horizontal, showsIndicators: false) {
            HStack {
              Button("All saved") { selectedFolder = "" }
              ForEach(folders) { folder in
                Button(folder["name"].text) { selectedFolder = folder.id }
              }
            }
          }.buttonStyle(.bordered)
          HStack {
            TextField("New folder", text: $folderName).textFieldStyle(.roundedBorder)
            Button("Create") {
              store.run {
                _ = try await store.call("folders", "POST", ["name": .string(folderName)])
                folderName = ""
                await loadItems()
              }
            }.disabled(folderName.isEmpty || folderName.count > 40)
          }
        }
        if store.preview && tab == "Plans" {
          Button {
            store.plan = PreviewData.plan
            store.sheet = "plan"
          } label: {
            HStack {
              CategoryBadge(category: "nature", size: 48)
              VStack(alignment: .leading, spacing: 5) {
                Text("A little afternoon out").font(.system(size: 14, weight: .semibold))
                Text("3 stops · a pastry, a park, a detour").font(.system(size: 11))
                  .foregroundStyle(Theme.muted)
              }
              Spacer()
              Image(systemName: "arrow.up.right")
            }.padding(17).background(.white, in: RoundedRectangle(cornerRadius: 20))
          }.buttonStyle(.plain)
        } else if items.isEmpty {
          EmptyCard(
            title: tab == "Saved"
              ? "Keep a little inspiration."
              : tab == "Posts"
                ? "Your stories start outside." : "Leave a little room for adventure.",
            message: tab == "Saved"
              ? "Bookmark a place, post, or plan to find it here."
              : "Your real-world outings will appear here.", icon: "sparkles")
        }
        ForEach(items, id: \.self) { item in
          if tab == "Plans" {
            Button {
              store.plan = item
              store.sheet = "plan"
            } label: {
              HStack {
                VStack(alignment: .leading, spacing: 5) {
                  Text(item["name"].text).fontWeight(.semibold)
                  Text("\(item["stops"].list.count) stops · \(item["status"].text)").font(.caption)
                    .foregroundStyle(Theme.muted)
                }
                Spacer()
                Image(systemName: "chevron.right")
              }.padding(16).background(.white, in: RoundedRectangle(cornerRadius: 16))
            }.buttonStyle(.plain)
          } else if tab == "Saved" {
            savedRow(item)
          } else {
            PostCard(post: item)
          }
        }
      }.padding(.horizontal, 25).padding(.top, store.preview ? 50 : 20).padding(.bottom, 110)
    }.task { await store.loadProfile() }.task(id: tab + selectedFolder) { await loadItems() }
  }
  var scoreCard: some View {
    let score = store.profile["score"]
    let value = score["score"].int
    let rocks = CairnScale.stones(for: value)
    return VStack(alignment: .leading, spacing: 17) {
      HStack(alignment: .center) {
        VStack(alignment: .leading, spacing: 9) {
          SectionLabel(text: "Your cairn · 30-day score")
          Text(value.formatted()).font(.system(size: 54, weight: .heavy, design: .rounded))
            .tracking(-2)
          Label(
            "\(abs(score["delta7d"].int)) this week",
            systemImage: score["delta7d"].int >= 0 ? "arrow.up.right" : "arrow.down.right"
          ).font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.green)
          Button {
            store.sheet = "friends"
          } label: {
            Label("\(store.profile["friendCount"].int) friends", systemImage: "person.2")
          }.buttonStyle(.plain).font(.caption).padding(.top, 8)
        }
        Spacer()
        CairnStack(score: value).frame(width: 125, height: 180)
      }
      HStack(alignment: .bottom, spacing: 3) {
        ForEach(Array(score["sparkline"].list.enumerated()), id: \.offset) { i, bar in
          RoundedRectangle(cornerRadius: 1).fill(
            i < 7 ? Theme.green.opacity(0.22) : Theme.green.opacity(0.7)
          ).frame(
            height: max(
              3,
              CGFloat(bar["xp"].number)
                / max(1, score["sparkline"].list.map { $0["xp"].number }.max() ?? 1) * 30))
        }
      }.frame(height: 32).accessibilityLabel("30 days of daily earned XP")
      HStack {
        Text("\(rocks) stones")
        Spacer()
        Text("\(max(0,CairnScale.threshold(for:rocks+1)-value)) XP to the next")
      }.font(.system(size: 10, weight: .medium, design: .monospaced)).foregroundStyle(Theme.muted)
      ProgressView(value: CairnScale.progress(for: value)).tint(Theme.green)
      if score["expiring"]["xp"].int > 0 {
        Text(
          "\(score["expiring"]["xp"].int) XP drifts away by \(score["expiring"]["by"].text). A new day, a new reason to go."
        ).font(.system(size: 11)).foregroundStyle(Theme.muted)
      }
      Button {
        store.sheet = "leaderboard"
      } label: {
        Text(
          "#\(score["ranks"]["friends"]["rank"].int) among friends"
            + (score["ranks"]["campus"].exists
              ? "  ·  #\(score["ranks"]["campus"]["rank"].int) at \(score["ranks"]["campus"]["campus"].text)"
              : "")
        ).font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.green)
      }.buttonStyle(.plain)
    }.padding(22).background(Color.white, in: RoundedRectangle(cornerRadius: 25))
  }
  @ViewBuilder func savedRow(_ item: JSON) -> some View {
    VStack(alignment: .leading) {
      Button {
        if item["type"].text == "place" {
          store.openPlace(item["place"])
        } else if item["type"].text == "plan" {
          store.plan = item["plan"]
          store.sheet = "plan"
        }
      } label: {
        Text(
          item[item["type"].text]["name"].text.isEmpty
            ? "Saved \(item["type"].text)" : item[item["type"].text]["name"].text
        ).fontWeight(.semibold)
      }.buttonStyle(.plain)
      if item["type"].text == "post" { PostCard(post: item["post"]) }
      HStack {
        SectionLabel(text: item["type"].text)
        Spacer()
        Menu("Organize") {
          ForEach(folders) { folder in
            Button("Add to \(folder["name"].text)") {
              store.save(item["type"].text, item["refId"].text, folderId: folder.id)
            }
          }
          Button("Unsave") {
            store.run {
              _ = try await store.call(
                "saves", "DELETE", ["type": item["type"], "refId": item["refId"]])
              await loadItems()
            }
          }
        }
      }.font(.caption)
    }.padding(15).background(.white, in: RoundedRectangle(cornerRadius: 16))
  }
  func loadItems() async {
    guard !store.preview else { return }
    do {
      let result = try await store.call(
        tab == "Plans" ? "plans" : tab == "Posts" ? "posts" : "saves",
        query: tab == "Posts"
          ? ["authorId": store.me.id]
          : tab == "Saved" && !selectedFolder.isEmpty ? ["folderId": selectedFolder] : [:])
      items = result["items"].list
      if tab == "Saved" { folders = try await store.call("folders")["items"].list }
    } catch { store.error = error.localizedDescription }
  }
}
struct ExplorationMap: View {
  var tiles: JSON
  var body: some View {
    GeometryReader { g in
      Canvas { ctx, size in
        ctx.fill(Path(CGRect(origin: .zero, size: size)), with: .color(Theme.line))
        let list = tiles["tiles"].list
        let b = tiles["bounds"]
        let cols = max(1, b["maxX"].int - b["minX"].int + 1)
        let rows = max(1, b["maxY"].int - b["minY"].int + 1)
        let scale = min(size.width / CGFloat(cols), size.height / CGFloat(rows))
        for tile in list {
          let x =
            CGFloat(tile["x"].int - b["minX"].int) * scale + (size.width - CGFloat(cols) * scale)
            / 2
          let y = CGFloat(tile["y"].int - b["minY"].int) * scale
          ctx.fill(
            Path(CGRect(x: x, y: y, width: max(1, scale - 0.5), height: max(1, scale - 0.5))),
            with: .color(Theme.green))
        }
      }
    }.accessibilityLabel("\(tiles["count"].int) explored city blocks")
  }
}
struct CollectionSheet: View {
  var kind: String
  @EnvironmentObject var store: CairnStore
  @State var response: JSON = .null
  @State var scope = "friends"
  @State var friend: JSON = .null
  var body: some View {
    VStack(alignment: .leading, spacing: 18) {
      SectionLabel(text: "Your world")
      Text(kind.capitalized).font(.system(size: 28, weight: .bold, design: .rounded))
      if kind == "leaderboard" {
        Picker("Leaderboard", selection: $scope) {
          Text("Friends").tag("friends")
          Text("Campus").tag("campus")
        }.pickerStyle(.segmented)
      }
      if kind == "stats" {
        stat(
          "Kilometers on foot this month",
          String(format: "%.1f", response["onFoot"]["monthKm"].number))
        stat("Steps this month", response["onFoot"]["monthSteps"].int.formatted())
        stat("Hours out this month", String(format: "%.1f", response["hoursOut"]["month"].number))
        ForEach(response["boroughs"].list, id: \.self) { b in
          stat(b["name"].text, String(format: "%.1f%% explored", b["pct"].number))
        }
        ForEach(response["topPlaces"].list, id: \.self) { p in
          stat(p["name"].text, "\(p["visits"].int) visits")
        }
      } else {
        if response["items"].list.isEmpty {
          EmptyCard(
            title: kind == "friends" ? "Better together." : "A fresh start.",
            message: kind == "friends"
              ? "Meet in person and tap each other's tags to become friends."
              : "Your first outing gets you on the board.", icon: "person.2")
        }
        ForEach(response["items"].list, id: \.self) { row in
          Button {
            if kind == "friends" {
              store.run { friend = try await store.call("profile/\(row["user"].id)") }
            }
          } label: {
            HStack {
              Image(systemName: "person.crop.circle.fill").font(.title).foregroundStyle(Theme.green)
              VStack(alignment: .leading, spacing: 4) {
                Text(row["user"]["name"].text).fontWeight(.semibold)
                if row["streak"].exists {
                  Label("\(row["streak"]["weeks"].int)w together", systemImage: "flame.fill").font(
                    .caption
                  ).foregroundStyle(row["streak"]["lit"].flag ? Theme.coral : Theme.muted)
                }
              }
              Spacer()
              Text("\(row["score"].int)").font(.system(.body, design: .monospaced))
            }.padding(.vertical, 8)
          }.buttonStyle(.plain)
        }
        if friend.exists {
          Divider()
          Text(friend["user"]["name"].text).font(.title2.bold())
          Text(
            "\(friend["score"]["score"].int) Score · \(friend["streak"]["hangouts"].int) hangouts together"
          ).font(.subheadline)
          Button("Report profile") {
            store.run {
              _ = try await store.call(
                "reports", "POST",
                ["userId": friend["user"]["id"], "reason": "Profile reported by user"])
              store.toast("Report received.")
            }
          }
          Button("Block", role: .destructive) {
            store.run {
              _ = try await store.call("blocks", "POST", ["userId": friend["user"]["id"]])
              friend = .null
              store.toast("Blocked.")
            }
          }
        }
      }
    }.task(id: scope) {
      guard !store.preview else { return }
      do {
        response = try await store.call(kind, query: kind == "leaderboard" ? ["scope": scope] : [:])
      } catch { store.error = error.localizedDescription }
    }
  }
  func stat(_ label: String, _ value: String) -> some View {
    HStack {
      Text(label).font(.subheadline)
      Spacer()
      Text(value).font(.system(.body, design: .monospaced).bold())
    }.padding(.vertical, 10)
  }
}
