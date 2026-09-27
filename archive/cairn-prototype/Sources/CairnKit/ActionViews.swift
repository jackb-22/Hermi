import AVFoundation
import CoreLocation
import CryptoKit
import SwiftUI

@MainActor
final class LocationService: NSObject, ObservableObject, @preconcurrency CLLocationManagerDelegate {
  private let manager = CLLocationManager()
  @Published var fix: CLLocation?
  @Published var message: String?
  var onFix: ((CLLocation) -> Void)?
  override init() {
    super.init()
    manager.delegate = self
    manager.desiredAccuracy = kCLLocationAccuracyBest
    manager.distanceFilter = 20
  }
  func start() {
    manager.requestWhenInUseAuthorization()
    manager.startUpdatingLocation()
  }
  func startOuting() {
    #if os(iOS)
      manager.allowsBackgroundLocationUpdates = true
      manager.showsBackgroundLocationIndicator = true
      manager.pausesLocationUpdatesAutomatically = false
      if manager.authorizationStatus == .authorizedWhenInUse {
        manager.requestAlwaysAuthorization()
      }
    #endif
    start()
  }
  func stop() {
    manager.stopUpdatingLocation()
    onFix = nil
  }
  func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    for location in locations
    where location.horizontalAccuracy >= 0 && abs(location.timestamp.timeIntervalSinceNow) < 60 {
      fix = location
      onFix?(location)
    }
  }
  func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
    message = error.localizedDescription
  }
  func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    if manager.authorizationStatus == .denied || manager.authorizationStatus == .restricted {
      message = "Location is off. Enable it in system settings to check in."
    }
  }
  func body() throws -> JSON {
    guard let fix, fix.horizontalAccuracy >= 0, abs(fix.timestamp.timeIntervalSinceNow) < 30 else {
      throw APIError(
        code: "LOCATION",
        message: "Waiting for a fresh location. Step outside or check location access.")
    }
    return [
      "lat": .number(fix.coordinate.latitude), "lng": .number(fix.coordinate.longitude),
      "accuracy": .number(fix.horizontalAccuracy),
    ]
  }
}
struct ActionView: View {
  @EnvironmentObject var store: CairnStore
  var location: LocationService { store.tracker.location }
  @State var showEnd = false
  var next: JSON { store.plan["stops"].list.first(where: { !$0["done"].flag }) ?? .null }
  var body: some View {
    VStack(alignment: .leading, spacing: 22) {
      HStack {
        SectionLabel(text: "Out in the world")
        Spacer()
        Button("End") { showEnd = true }.font(.subheadline.bold())
      }
      if store.panel == "Camera" {
        CaptureView(location: location)
      } else {
        Text(next.exists ? next["label"].text : "Follow your feet.").font(
          .system(size: 32, weight: .bold, design: .rounded))
        Text(
          next.exists
            ? "Stop \(next["index"].int) of \(store.plan["stops"].list.count) · \(next["legMin"].int) min \(next["legMode"].text)"
            : "No plan needed. See where the day takes you."
        ).font(.subheadline).foregroundStyle(Theme.muted)
        PixelMap(places: next["place"].exists ? [next["place"]] : [], plan: store.plan).frame(
          height: 280
        ).clipShape(RoundedRectangle(cornerRadius: 24))
        if next["place"].exists {
          let p = next["place"]["loc"]
          if let url = URL(
            string:
              "https://maps.apple.com/?daddr=\(p["lat"].number),\(p["lng"].number)&dirflg=\(store.plan["mode"].text == "car" ? "d":store.plan["mode"].text == "transit" ? "r":"w")"
          ) {
            Link(destination: url) {
              Label("Go in Apple Maps", systemImage: "arrow.triangle.turn.up.right.diamond.fill")
                .frame(maxWidth: .infinity).padding(17).background(
                  Theme.ink, in: RoundedRectangle(cornerRadius: 19)
                ).foregroundStyle(.white)
            }
          }
          MainButton(title: "Check in", icon: "checkmark.seal") {
            store.run {
              try await flush()
              let body = try location.body().setting("tier", "gps").setting(
                "placeId", next["place"]["id"]
              ).setting("sessionId", store.session["id"])
              let r = try await store.call("checkins", "POST", body)
              store.checkin = r["checkin"]
              store.toast("Checked in · +\(r["xp"]["total"].int) XP")
              if store.plan.exists { store.plan = try await store.call("plans/\(store.plan.id)") }
            }
          }
          Text(
            "GPS check-in unlocks after 5 minutes at your stop. A venue tag checks you in sooner."
          ).font(.caption).foregroundStyle(Theme.muted)
        }
        SmallButton(title: "Scan or tap a tag", icon: "qrcode") { store.sheet = "tag" }
        if let message = location.message { Text(message).font(.caption).foregroundStyle(.red) }
      }
      Spacer()
    }.padding(24).padding(.top, 20).padding(.bottom, 95)
      .alert("Finish this outing?", isPresented: $showEnd) {
        Button("End & see recap") {
          store.run {
            try await flush()
            location.stop()
            _ = try await store.call(
              "sessions/\(store.session.id)/end", "POST", store.tracker.endBody())
            store.tracker.clearFinishedOutbox()
            store.session = store.session.setting("status", "ending")
            store.sheet = "recap"
            try await store.pollRecap(store.session.id)
          }
        }
        Button("Keep going", role: .cancel) {}
      }
  }
  func flush() async throws { try await store.tracker.flush() }
}
struct TagSheet: View {
  @EnvironmentObject var store: CairnStore
  @Environment(\.pendingTagURL) var incoming
  @StateObject var location = LocationService()
  @State var url = ""
  @State var bind = false
  var body: some View {
    VStack(alignment: .leading, spacing: 20) {
      SectionLabel(text: "Better in person")
      Text("A small tap.\nA real connection.").font(
        .system(size: 29, weight: .bold, design: .rounded))
      Text(
        "Tap the NFC sticker with your phone. Its link opens here. You can also scan the printed QR in Camera."
      ).font(.subheadline).foregroundStyle(Theme.muted)
      TextField("Tag link", text: $url).textFieldStyle(.roundedBorder)
      Toggle("Bind this as my personal tag", isOn: $bind).font(.subheadline)
      MainButton(title: bind ? "Bind my tag" : "Read tag", icon: "wave.3.right") {
        store.run {
          if bind {
            _ = try await store.call("me/tag", "POST", ["url": .string(url)])
            store.toast("Your tag is ready.")
            return
          }
          store.tap = try await store.call(
            "taps", "POST", try location.body().setting("url", .string(url)))
          if store.tap["checkin"].exists {
            store.checkin = store.tap["checkin"]["checkin"]
            store.toast("Checked in.")
          }
        }
      }.disabled(url.isEmpty)
      if store.tap["status"].text == "waiting" {
        Text("Now \(store.tap["friend"]["name"].text) taps yours.").font(.headline)
        if let expiry = parseDate(store.tap["expiresAt"].text) {
          Text(expiry, style: .timer).font(.system(size: 32, weight: .bold, design: .monospaced))
        }
      } else if store.tap.exists {
        Text(store.tap["status"].text.replacingOccurrences(of: "_", with: " ").capitalized).font(
          .headline
        ).foregroundStyle(Theme.green)
      }
    }.onAppear {
      url = store.pendingTag.isEmpty ? incoming : store.pendingTag
      location.start()
    }.onDisappear { location.stop() }
      .task(id: store.tap["expiresAt"].text) {
        while store.tap["status"].text == "waiting",
          let expiry = parseDate(store.tap["expiresAt"].text), expiry > Date(), !Task.isCancelled
        {
          try? await Task.sleep(for: .seconds(2))
          do {
            store.tap = try await store.call(
              "taps/pending", query: ["friendId": store.tap["friend"].id])
          } catch {
            store.error = error.localizedDescription
            break
          }
        }
      }
  }
}
struct RecapSheet: View {
  @EnvironmentObject var store: CairnStore
  @State var selected: Set<String> = []
  @State var includeRoute = true
  @State var caption = ""
  var body: some View {
    VStack(alignment: .leading, spacing: 22) {
      SectionLabel(text: "You went. It counts.")
      if store.recap.exists {
        Text(
          store.recap["planName"].text.isEmpty ? "A day well spent." : store.recap["planName"].text
        ).font(.system(size: 29, weight: .bold, design: .rounded))
        Text("+\(store.recap["xp"]["total"].int) XP").font(
          .system(size: 49, weight: .bold, design: .rounded)
        ).foregroundStyle(Theme.green)
        ForEach(store.recap["xp"]["items"].list, id: \.self) { item in
          HStack {
            Text(item["label"].text)
            Spacer()
            Text("+\(item["xp"].int)")
          }.font(.subheadline)
        }
        Text(
          "\(store.recap["newTiles"].list.count) new blocks · \(String(format:"%.1f",store.recap["footKm"].number)) km on foot"
        ).font(.caption).foregroundStyle(Theme.muted)
        Toggle("Include my route in the post", isOn: $includeRoute)
        Text(
          "Your route can reveal where you started and ended. Turn this off to share captures only."
        ).font(.caption).foregroundStyle(Theme.muted)
        ForEach(store.captured.filter { $0["kind"].text != "audio" }) { m in
          Toggle(
            "\(m["kind"].text.capitalized) · \(formattedTime(m["capturedAt"].text))",
            isOn: Binding(
              get: { selected.contains(m.id) },
              set: { if $0 { selected.insert(m.id) } else { selected.remove(m.id) } }))
        }
        TextField("A few words, if you'd like", text: $caption).textFieldStyle(.roundedBorder)
        MainButton(title: "Post recap", icon: "arrow.up") {
          store.run {
            let post = try await store.call(
              "posts", "POST",
              [
                "sessionId": store.recap["sessionId"],
                "mediaIds": .array(selected.map { .string($0) }),
                "includeRoute": .bool(includeRoute), "caption": .string(caption),
              ])
            store.finishRecap()
            store.toast(
              post["status"].text == "pending"
                ? "Submitted. Your post is being reviewed." : "Posted.")
          }
        }.disabled(
          selected.count > 10 || caption.count > 280 || (!includeRoute && selected.isEmpty)
            || store.recap["stops"].list.isEmpty)
        Button("Later") { store.finishRecap() }.frame(maxWidth: .infinity)
        ForEach(store.recap["stops"].list, id: \.self) { stop in ReviewCard(stop: stop) }
      } else {
        EmptyCard(
          title: "Gathering your day.",
          message: "Your route, new blocks, and XP are being prepared.", icon: "sparkles")
        ProgressView()
        Button("Refresh") { store.run { try await store.pollRecap(store.session.id) } }
      }
    }.onChange(of: store.captured) { _, media in
      selected = Set(media.filter { $0["kind"].text != "audio" }.prefix(10).map(\.id))
    }
  }
}
struct ReviewCard: View {
  var stop: JSON
  @EnvironmentObject var store: CairnStore
  @State var text = ""
  @State var done = false
  var body: some View {
    if !done && !stop["reviewed"].flag {
      VStack(alignment: .leading, spacing: 12) {
        Text(stop["placeName"].text).fontWeight(.semibold)
        Text("Would go again?").font(.subheadline)
        TextField("Optional note", text: $text).textFieldStyle(.roundedBorder)
        HStack {
          Button("Yes") { review(true) }
          Button("No") { review(false) }
        }
      }.padding(17).background(.white, in: RoundedRectangle(cornerRadius: 18))
    }
  }
  func review(_ again: Bool) {
    store.run {
      _ = try await store.call(
        "reviews", "POST",
        ["checkinId": stop["checkinId"], "again": .bool(again), "text": .string(text)])
      done = true
    }
  }
}
