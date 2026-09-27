import SwiftUI

struct PlaceSheet: View {
  @EnvironmentObject var store: CairnStore
  var body: some View {
    let p = store.selectedPlace
    VStack(alignment: .leading, spacing: 20) {
      HStack {
        CategoryBadge(category: p["category"].text, size: 50)
        Spacer()
        Button {
          store.save("place", p.id)
        } label: {
          Image(systemName: "bookmark").font(.title3)
        }.buttonStyle(.plain).accessibilityLabel("Save place")
      }
      VStack(alignment: .leading, spacing: 7) {
        SectionLabel(text: p["category"].text)
        Text(p["name"].text).font(.system(size: 29, weight: .bold, design: .rounded))
        Text(p["address"].text).font(.subheadline).foregroundStyle(Theme.muted)
      }
      HStack(spacing: 20) {
        if p["wouldGoAgainPct"].exists { stat("\(p["wouldGoAgainPct"].int)%", "would go again") }
        if p["hereNow"].exists { stat("\(p["hereNow"].int)", "here now") }
        if p["friendsBeen"].exists { stat("\(p["friendsBeen"].int)", "friends been") }
      }.padding(.vertical, 10)
      MainButton(title: "Add to plan", icon: "plus") { store.addPlace(p) }.disabled(store.busy)
      if p["walkMin"].exists {
        Label(
          "About \(p["walkMin"].int) min walk from your dropped pin", systemImage: "figure.walk"
        ).font(.caption).foregroundStyle(Theme.muted)
      }
      Divider()
      SectionLabel(text: "Good to know")
      Text(
        p["reviewSummary"].exists
          ? p["reviewSummary"].text : "Every review comes from someone who was here."
      ).font(.subheadline)
      if !p["hours"].list.isEmpty {
        ForEach(p["hours"].list, id: \.self) { h in
          Text(
            "\(["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][min(6,max(0,h["day"].int))])  \(h["open"].text)–\(h["close"].text)"
          ).font(.caption)
        }
      }
    }
  }
  func stat(_ number: String, _ label: String) -> some View {
    VStack(alignment: .leading, spacing: 4) {
      Text(number).font(.system(size: 23, weight: .bold, design: .rounded))
      Text(label).font(.system(size: 10)).foregroundStyle(Theme.muted)
    }
  }
}
struct NearbySheet: View {
  @EnvironmentObject var store: CairnStore
  @State var results: [JSON] = []
  @State var loading = true
  var body: some View {
    VStack(alignment: .leading, spacing: 18) {
      SectionLabel(text: "Around your pin")
      Text("Something \(store.category == "all" ? "good":store.category).\nSomewhere close.").font(
        .system(size: 27, weight: .bold, design: .rounded))
      if loading { ProgressView() }
      ForEach(results) { p in
        Button {
          store.openPlace(p)
        } label: {
          PlaceRow(place: p)
        }.buttonStyle(.plain)
      }
      if !loading && results.isEmpty {
        EmptyCard(
          title: "A little further?",
          message: "Try another category or move your map to search somewhere else.")
      }
    }.task(id: store.category) {
      defer { loading = false }
      if store.preview {
        results = store.places
        return
      }
      do {
        results = try await store.call(
          "places/near",
          query: [
            "lat": "\(store.center["lat"].number)", "lng": "\(store.center["lng"].number)",
            "cat": store.category, "r": "\(Int(store.radius))",
          ])["items"].list
      } catch { store.error = error.localizedDescription }
    }
  }
}
struct PlaceRow: View {
  var place: JSON
  var body: some View {
    HStack(spacing: 13) {
      CategoryBadge(category: place["category"].text)
      VStack(alignment: .leading, spacing: 4) {
        Text(place["name"].text).font(.system(size: 14, weight: .semibold))
        Text(
          place["category"].text.capitalized
            + (place["walkMin"].exists ? " · \(place["walkMin"].int) min walk" : "")
        ).font(.caption).foregroundStyle(Theme.muted)
      }
      Spacer()
      Image(systemName: "chevron.right").font(.caption).foregroundStyle(Theme.muted)
    }.padding(.vertical, 9)
  }
}
struct PlanSheet: View {
  @EnvironmentObject var store: CairnStore
  @State var startAt = Date()
  var body: some View {
    if !store.plan.exists || store.plan["stops"].list.isEmpty {
      VStack(spacing: 18) {
        EmptyCard(
          title: "An afternoon starts\nwith one pin.",
          message: "Pick a place on the map, then add a stop or two. We'll take it from there.",
          icon: "mappin.and.ellipse")
        MainButton(title: "Find a first stop") { store.sheet = "nearby" }
      }
    } else {
      let p = store.plan
      VStack(alignment: .leading, spacing: 20) {
        HStack {
          SectionLabel(text: p["status"].text == "draft" ? "Your next adventure" : p["status"].text)
          Spacer()
          Button {
            store.sheet = "savePlan"
          } label: {
            Label("Save", systemImage: "bookmark")
          }.buttonStyle(.plain).disabled(!p["isHost"].flag)
        }
        Text(p["name"].text).font(.system(size: 29, weight: .bold, design: .rounded))
        if p["isHost"].flag {
          DatePicker("Start", selection: $startAt, displayedComponents: [.date, .hourAndMinute])
            .font(.subheadline)
            .onChange(of: startAt) { old, new in
              if abs(new.timeIntervalSince(old)) > 1 { store.updatePlan(["startAt": iso(new)]) }
            }
          HStack(spacing: 7) {
            ForEach(["walk", "transit", "bike", "car"], id: \.self) { mode in
              Button {
                store.updatePlan(["mode": .string(mode)])
              } label: {
                Text(mode.capitalized).font(.system(size: 12, weight: .semibold)).padding(
                  .horizontal, 13
                ).padding(.vertical, 9).background(
                  p["mode"].text == mode ? Theme.lime : Theme.line.opacity(0.35), in: Capsule())
              }.buttonStyle(.plain)
            }
          }
        }
        ForEach(Array(p["stops"].list.enumerated()), id: \.element.id) { i, stop in
          VStack(alignment: .leading, spacing: 10) {
            if i > 0 {
              Label(
                "\(stop["legMin"].int) min \(stop["legMode"].text)\(stop["legSource"].text == "estimate" ? " · estimate":"")",
                systemImage: "ellipsis"
              ).font(.caption).foregroundStyle(Theme.muted).padding(.leading, 18)
            }
            HStack(alignment: .top, spacing: 12) {
              Text("\(i+1)").font(.system(size: 16, weight: .bold, design: .monospaced)).frame(
                width: 34, height: 34
              ).background(Theme.lime, in: RoundedRectangle(cornerRadius: 10))
              VStack(alignment: .leading, spacing: 5) {
                Text(formattedTime(stop["arriveAt"].text)).font(
                  .system(size: 10, weight: .bold, design: .monospaced)
                ).foregroundStyle(Theme.green)
                Button(stop["label"].text) {
                  if stop["place"].exists {
                    store.openPlace(stop["place"])
                  } else {
                    store.center = stop["slot"]["near"]
                    store.category = stop["slot"]["category"].text
                    store.sheet = "nearby"
                  }
                }.buttonStyle(.plain).font(.system(size: 15, weight: .semibold))
                Text("\(stop["stayMin"].int) min here").font(.caption).foregroundStyle(Theme.muted)
                if stop["done"].flag {
                  Label("Checked in", systemImage: "checkmark.seal.fill").font(.caption)
                    .foregroundStyle(Theme.green)
                }
              }
              Spacer()
              if p["isHost"].flag {
                Menu {
                  Button("Move earlier") {
                    var stops = p["stops"].list
                    if i > 0 {
                      stops.swapAt(i, i - 1)
                      store.replaceStops(stops)
                    }
                  }.disabled(i == 0)
                  Button("Move later") {
                    var stops = p["stops"].list
                    if i < stops.count - 1 {
                      stops.swapAt(i, i + 1)
                      store.replaceStops(stops)
                    }
                  }.disabled(i == p["stops"].list.count - 1)
                  Menu("Stay length") {
                    ForEach([15, 30, 45, 60, 90, 120], id: \.self) { minutes in
                      Button("\(minutes) minutes") {
                        var stops = p["stops"].list
                        stops[i] = stop.setting("stayMin", .number(Double(minutes))).setting(
                          "staySource", "user")
                        store.replaceStops(stops)
                      }
                    }
                  }
                  if i > 0 {
                    Menu("Travel to this stop") {
                      ForEach(["walk", "transit", "bike", "car"], id: \.self) { mode in
                        Button(mode.capitalized) {
                          var stops = p["stops"].list
                          stops[i] = stop.setting("legMode", .string(mode))
                          store.replaceStops(stops)
                        }
                      }
                    }
                  }
                  Button("Remove stop", role: .destructive) {
                    var stops = p["stops"].list
                    stops.remove(at: i)
                    store.replaceStops(stops)
                  }
                } label: {
                  Image(systemName: "ellipsis").frame(width: 30, height: 30)
                }.cairnMenuStyle().fixedSize().accessibilityLabel("Edit \(stop["label"].text)")
              }
            }.padding(14).background(.white, in: RoundedRectangle(cornerRadius: 17))
            ForEach(p["issues"].list.filter { $0["stopId"].text == stop.id }, id: \.self) { issue in
              Label(issue["message"].text, systemImage: "exclamationmark.circle").font(.caption)
                .foregroundStyle(.red)
            }
          }
        }
        ForEach(p["ghostChanges"].list) { ghost in
          VStack(alignment: .leading, spacing: 10) {
            Label(ghost["label"].text, systemImage: "sparkles").font(.subheadline)
            ForEach(ghost["sources"].list, id: \.self) { source in
              if let url = URL(string: source["uri"].text) {
                Link(source["title"].text, destination: url).font(.caption)
              }
            }
            HStack {
              Button("Accept") { store.planAction("changes/apply", body: ["ids": [ghost["id"]]]) }
              Button("Dismiss") {
                store.planAction("changes/dismiss", body: ["ids": [ghost["id"]]])
              }
            }
          }.padding(16).background(Theme.lime.opacity(0.15)).overlay(
            RoundedRectangle(cornerRadius: 15).stroke(
              Theme.green, style: StrokeStyle(lineWidth: 1, dash: [4, 4])))
        }
        if p["isHost"].flag {
          HStack {
            SmallButton(title: "Add a stop", icon: "plus") { store.sheet = "nearby" }
            Spacer()
            SmallButton(title: "Schedule", icon: "sparkles") { store.planAction("schedule") }
          }
          HStack {
            Text("+\(p["totals"]["xpPreview"].int) XP").font(
              .system(size: 19, weight: .bold, design: .monospaced))
            Spacer()
            Text(String(format: "%.1f km on foot", p["totals"]["footKm"].number)).font(.caption)
              .foregroundStyle(Theme.muted)
          }
          Text("Preview only. Earned when you go.").font(.caption2).foregroundStyle(Theme.muted)
          MainButton(title: "Let's go", icon: "arrow.up.right") {
            store.run { try await store.start() }
          }.disabled(!p["issues"].list.isEmpty || p["status"].text == "completed")
        } else {
          MainButton(
            title: p["visibility"].text == "find" ? "Request to join" : "Join this plan",
            icon: "person.badge.plus"
          ) { store.planAction(p["visibility"].text == "find" ? "request" : "join") }
          Button("Can't make it") { store.planAction("decline") }
          Button("Save a copy") { store.save("plan", p.id) }
        }
        if let url = URL(string: p["shareUrl"].text), url.scheme == "https" {
          ShareLink(item: url) { Label("Share this plan", systemImage: "square.and.arrow.up") }
            .font(.subheadline)
        }
        ForEach(p["members"].list, id: \.self) { member in
          HStack {
            Text(member["name"].text.isEmpty ? member["username"].text : member["name"].text)
            Spacer()
            Text(member["status"].text).foregroundStyle(Theme.muted)
            if member["status"].text == "requested" && p["isHost"].flag {
              Button("Approve") { store.planAction("requests/\(member["userId"].text)/approve") }
              Button("Deny") { store.planAction("requests/\(member["userId"].text)/deny") }
            }
          }.font(.caption)
        }
      }.onAppear { startAt = parseDate(p["startAt"].text) ?? Date() }.disabled(store.busy)
    }
  }
}
struct SavePlanSheet: View {
  @EnvironmentObject var store: CairnStore
  @State var name = ""
  @State var visibility = "just_me"
  @State var friends: [JSON] = []
  @State var selected: Set<String> = []
  var body: some View {
    VStack(alignment: .leading, spacing: 21) {
      SectionLabel(text: "Make a plan")
      Text("Who's coming?").font(.system(size: 29, weight: .bold, design: .rounded))
      TextField("Give it a name", text: $name).textFieldStyle(.roundedBorder)
      ForEach(
        [
          ("just_me", "Just me", "A little time for yourself."),
          ("invite", "Invite friends", "Pick your people."),
          ("friends", "All friends", "Leave the door open."),
          ("find", "Find someone", "Meet verified students nearby."),
        ], id: \.0
      ) { key, title, detail in
        Button {
          visibility = key
        } label: {
          HStack {
            VStack(alignment: .leading, spacing: 4) {
              Text(title).fontWeight(.semibold)
              Text(detail).font(.caption).foregroundStyle(Theme.muted)
            }
            Spacer()
            Image(systemName: visibility == key ? "largecircle.fill.circle" : "circle")
              .foregroundStyle(Theme.green)
          }.padding(16).background(
            visibility == key ? Theme.lime.opacity(0.3) : .white,
            in: RoundedRectangle(cornerRadius: 16))
        }.buttonStyle(.plain).disabled(key == "find" && !store.me["verified"].flag)
      }
      if visibility == "invite" {
        ForEach(friends, id: \.self) { row in
          let u = row["user"]
          Toggle(
            u["name"].text,
            isOn: Binding(
              get: { selected.contains(u.id) },
              set: { if $0 { selected.insert(u.id) } else { selected.remove(u.id) } }))
        }
      }
      MainButton(title: "Save plan", icon: "bookmark") {
        store.run {
          store.plan = try await store.call(
            "plans/\(store.plan.id)/save", "POST",
            [
              "name": .string(name), "visibility": .string(visibility),
              "inviteeIds": .array(selected.map { .string($0) }),
            ])
          store.sheet = "plan"
        }
      }.disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || name.count > 80)
    }.task {
      name = store.plan["name"].text
      visibility = store.plan["visibility"].text
      if !store.preview {
        do {
          friends = try await store.call("friends")["items"].list
          let suggestion = try await store.call("plans/\(store.plan.id)/name-suggestion")
          if name == store.plan["name"].text { name = suggestion["name"].text }
        } catch { store.error = error.localizedDescription }
      }
    }
  }
}
