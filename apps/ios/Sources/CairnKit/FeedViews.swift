import AVKit
import SwiftUI

struct FeedView: View {
  @EnvironmentObject var store: CairnStore
  var body: some View {
    ScrollView {
      LazyVStack(spacing: 24) {
        HStack {
          Text("Out there.").font(.system(size: 32, weight: .bold, design: .rounded))
          Spacer()
          Image(systemName: "sparkle").foregroundStyle(Theme.green)
        }.padding(.top, store.preview ? 48 : 20)
        ForEach(Array(store.feed["cards"].list.enumerated()), id: \.offset) { _, card in
          switch card["kind"].text {
          case "post": PostCard(post: card["post"])
          case "plan":
            VStack(alignment: .leading, spacing: 14) {
              SectionLabel(text: "An open invitation")
              Text(card["plan"]["name"].text).font(.title2.bold())
              Text(
                "\(card["plan"]["stops"].list.count) stops · \(formattedTime(card["plan"]["startAt"].text))"
              ).font(.caption)
              MainButton(
                title: card["action"].text == "join" ? "Join this plan" : "Request to join"
              ) {
                store.plan = card["plan"]
                store.sheet = "plan"
              }
            }.padding(22).background(
              Theme.lime.opacity(0.3), in: RoundedRectangle(cornerRadius: 25))
          default:
            VStack(spacing: 22) {
              CairnStack(score: 150).frame(width: 120, height: 120)
              SectionLabel(text: "You're caught up")
              Text("A little less scrolling.\nA little more outside.").font(
                .system(size: 29, weight: .bold, design: .rounded)
              ).multilineTextAlignment(.center)
              Text("The best part of your day\nisn't on this screen.").font(.subheadline)
                .foregroundStyle(Theme.muted).multilineTextAlignment(.center)
              MainButton(title: "Make a plan from saved") {
                store.run {
                  store.plan = try await store.call("plans/from-saved", "POST", store.center)
                  store.panel = "Map"
                  store.sheet = "plan"
                }
              }
            }.padding(.vertical, 40)
          }
        }
        if !store.feed.exists { ProgressView().padding(50) }
      }.padding(.horizontal, 24).padding(.bottom, 110)
    }.task { await store.loadFeed() }
  }
}
struct PostCard: View {
  var post: JSON
  @EnvironmentObject var store: CairnStore
  @State var selected = 0
  @State var player: AVPlayer?
  @State var showReport = false
  @State var reason = ""
  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      HStack {
        Label(post["author"]["name"].text, systemImage: "person.crop.circle").font(
          .subheadline.bold())
        Spacer()
        Menu {
          Button("Report") { showReport = true }
          Button("Block author", role: .destructive) {
            store.run {
              _ = try await store.call("blocks", "POST", ["userId": post["author"]["id"]])
              await store.loadFeed()
            }
          }
        } label: {
          Image(systemName: "ellipsis")
        }.cairnMenuStyle().fixedSize()
      }
      if let media = post["media"].list.first {
        if media["kind"].text == "video" {
          VideoPlayer(player: player).frame(height: 300).clipShape(
            RoundedRectangle(cornerRadius: 20)
          ).onAppear { if let url = URL(string: media["url"].text) { player = AVPlayer(url: url) } }
            .onDisappear {
              player?.pause()
              player = nil
            }
        } else {
          TabView(selection: $selected) {
            ForEach(Array(post["media"].list.enumerated()), id: \.offset) { i, m in
              AsyncImage(url: URL(string: m["url"].text)) { image in
                image.resizable().scaledToFit()
              } placeholder: {
                ProgressView()
              }.tag(i)
            }
          }.frame(height: 300)
        }
        if let url = URL(string: media["verifyUrl"].text) {
          Link(destination: url) {
            Label(
              "Verified IRL · \(post["stamp"]["placeName"].text)",
              systemImage: "checkmark.seal.fill")
          }.font(.caption).foregroundStyle(Theme.green)
        }
      } else {
        Label(
          "\(post["stamp"]["placeName"].text) · \(formattedTime(post["stamp"]["time"].text))",
          systemImage: "checkmark.seal"
        ).font(.caption).foregroundStyle(Theme.green)
      }
      if post["text"].exists { Text(post["text"].text).font(.subheadline) }
      HStack {
        Text("\(post["counts"]["been"].int) been · \(post["counts"]["going"].int) going").font(
          .caption
        ).foregroundStyle(Theme.muted)
        Spacer()
        Button {
          store.save("post", post.id)
        } label: {
          Image(systemName: "bookmark")
        }.buttonStyle(.plain).accessibilityLabel("Save post")
      }
      if post["place"].exists {
        Button {
          store.openPlace(post["place"])
        } label: {
          Label("Open place", systemImage: "mappin")
        }.buttonStyle(.bordered)
      }
    }.padding(18).background(.white, in: RoundedRectangle(cornerRadius: 24))
      .alert("Report post", isPresented: $showReport) {
        TextField("Reason", text: $reason)
        Button("Send report") {
          store.run {
            _ = try await store.call(
              "reports", "POST", ["postId": post["id"], "reason": .string(reason)])
            await store.loadFeed()
          }
        }
        Button("Cancel", role: .cancel) {}
      }
  }
}
