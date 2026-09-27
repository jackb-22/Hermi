import SwiftUI
#if os(iOS)
import UIKit
#endif

/// Signed-in Action mode: a real outing. Directions (route, next stop, Tap tag per stop), Camera (verified
/// captures), End → Recap with XP, then Post and "would go again" reviews.
struct LiveActionView: View {
  let session: ActionPreviewSession
  var selectMode: (ActionPreviewSession.Mode) -> Void
  var done: () -> Void
  private let outing = LiveOuting.shared
  @State private var confirmingEnd = false
  @State private var showingCamera = false
  @Environment(\.openURL) private var openURL

  private var places: [MapSamplePlace] { session.stopIDs.compactMap(MapSamplePlace.find) }
  private var nextStop: MapSamplePlace? { places.first { outing.checkins[$0.id] == nil } }

  var body: some View {
    Group {
      switch outing.phase {
      case .recap: RecapView(done: done)
      case .ending: status("Building your recap…", spinner: true)
      case .starting: status("Starting your outing…", spinner: true)
      case .idle: notRunning
      case .failed(let message): failure(message)
      case .active: active
      }
    }
    .foregroundStyle(HermiPalette.ink).buttonStyle(.plain)
    .task { if outing.phase == .idle { await outing.restore() } }
    .confirmationDialog("End this outing?", isPresented: $confirmingEnd, titleVisibility: .visible) {
      Button("End outing") { Task { await outing.end() } }
      Button("Keep exploring", role: .cancel) {}
    } message: { Text("Location stops now. Your recap and XP come from the server.") }
  }

  // MARK: Active

  private var active: some View {
    ZStack {
      if session.mode == .camera { camera } else { directions }
      VStack {
        HStack {
          TimelineView(.periodic(from: .now, by: 1)) { context in
            Text("OUTING · \(elapsed(at: context.date))").font(.system(.caption, design: .monospaced))
          }.padding(10).background(HermiPalette.paper, in: PixelPanel(corner: 5))
          Spacer()
          Button("End") { confirmingEnd = true }.frame(minWidth: 44, minHeight: 44)
            .padding(.horizontal, 8).background(HermiPalette.paper, in: PixelPanel(corner: 5))
            .accessibilityLabel("End outing")
        }.padding(.horizontal, 18).padding(.top, 8)
        Spacer()
        HStack(spacing: 12) {
          modeButton("Directions", icon: "route", mode: .directions)
          modeButton("Camera", icon: "camera", mode: .camera)
        }.padding(8).background(HermiPalette.paper, in: Capsule()).padding(.bottom, 16)
      }
    }
  }

  private var directions: some View {
    ZStack(alignment: .bottom) {
      GeographicMap(state: MapPreviewState(), showsPlaces: false, routeLine: places.map(\.coordinate), routeStops: places)
        .ignoresSafeArea()
      VStack(alignment: .leading, spacing: 10) {
        if let next = nextStop {
          HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 3) {
              Text("NEXT STOP").font(.system(size: 10, design: .monospaced))
              Text(next.name).font(.headline)
              Text(distanceText(to: next)).font(.caption)
            }
            Spacer()
            Button("Open in Maps") {
              if let url = URL(string: "http://maps.apple.com/?daddr=\(next.latitude),\(next.longitude)&dirflg=w") { openURL(url) }
            }.font(.caption.bold()).padding(.horizontal, 10).frame(minHeight: 36)
              .background(.white, in: PixelPanel(corner: 5))
          }
        } else {
          Text("Every stop checked in. End the outing for your recap.").font(.headline)
        }
        ScrollView {
          VStack(spacing: 8) {
            ForEach(Array(places.enumerated()), id: \.element.id) { index, place in stopRow(place, number: index + 1) }
          }
        }.frame(maxHeight: 200)
        if let notice = outing.notice { Text(notice).font(.caption.bold()).foregroundStyle(HermiPalette.green) }
        if outing.locationDenied { Text("Location is off: check-ins use the stop’s position (simulated).").font(.caption2) }
      }
      .padding(16).background(HermiPalette.paper, in: PixelPanel(corner: 10))
      .padding(.horizontal, 14).padding(.bottom, 92)
    }
  }

  private func stopRow(_ place: MapSamplePlace, number: Int) -> some View {
    HStack(spacing: 10) {
      Text("\(number)").font(.caption.bold()).frame(width: 22, height: 22)
        .background(HermiPalette.category(place.category), in: PixelPanel(corner: 3))
      Text(place.name).font(.subheadline).lineLimit(1)
      Spacer()
      if let result = outing.checkins[place.id] {
        Text("✓ +\(result.xp.total) XP").font(.caption.bold()).foregroundStyle(HermiPalette.green)
      } else {
        Button {
          Task { await outing.checkIn(at: place) }
        } label: {
          HStack(spacing: 4) {
            if outing.checkingIn == place.id { ProgressView().controlSize(.small) }
            Text("Tap tag").font(.caption.bold())
          }.padding(.horizontal, 10).frame(minHeight: 34).background(HermiPalette.lime, in: PixelPanel(corner: 5))
        }.disabled(outing.checkingIn != nil)
          .accessibilityLabel("Check in at \(place.name) with the tag stand-in")
      }
    }
  }

  // MARK: Camera

  private var camera: some View {
    ZStack {
      HermiPalette.ink.ignoresSafeArea()
      VStack(spacing: 18) {
        Spacer()
        Text(outing.latestCheckinID == nil ? "Check in at a stop to capture" : "Photos attach to your latest check-in")
          .font(.subheadline).foregroundStyle(HermiPalette.paper)
        Button { shutter() } label: {
          Circle().fill(HermiPalette.paper).frame(width: 82, height: 82)
            .overlay(Circle().stroke(HermiPalette.lime, lineWidth: 6).padding(-8))
        }.disabled(outing.latestCheckinID == nil).opacity(outing.latestCheckinID == nil ? 0.4 : 1)
          .accessibilityLabel("Take photo")
        if !cameraAvailable {
          Text("Simulator: uses a labelled sample photo").font(.caption2).foregroundStyle(HermiPalette.paper.opacity(0.7))
        }
        if let notice = outing.notice { Text(notice).font(.caption).foregroundStyle(HermiPalette.lime).padding(.horizontal, 24) }
        ScrollView(.horizontal) {
          HStack(spacing: 10) {
            ForEach(outing.captures) { capture in
              VStack(spacing: 4) {
                captureImage(capture).frame(width: 84, height: 104).clipShape(PixelPanel(corner: 6))
                Text(capture.status).font(.caption2.bold())
                  .foregroundStyle(capture.status == "Verified" ? HermiPalette.lime : HermiPalette.paper)
              }
            }
          }.padding(.horizontal, 20)
        }.frame(height: 130)
        Spacer().frame(height: 90)
      }
    }
    #if os(iOS)
    .fullScreenCover(isPresented: $showingCamera) {
      CameraPicker { image in
        if let data = image.jpegData(compressionQuality: 0.85) {
          Task { await outing.capture(jpeg: data, simulated: false) }
        }
      }.ignoresSafeArea()
    }
    #endif
  }

  private var cameraAvailable: Bool {
    #if os(iOS)
    UIImagePickerController.isSourceTypeAvailable(.camera)
    #else
    false
    #endif
  }

  private func shutter() {
    if cameraAvailable { showingCamera = true; return }
    guard let url = Bundle.module.url(forResource: "sample-capture", withExtension: "jpg", subdirectory: "Resources"),
          let data = try? Data(contentsOf: url) else { return }
    Task { await outing.capture(jpeg: data, simulated: true) }
  }

  // MARK: Helpers

  private func captureImage(_ capture: OutingCapture) -> some View {
    Group {
      if let image = PlatformImage(data: capture.imageData) { Image(platform: image).resizable().scaledToFill() }
      else { HermiPalette.secondary }
    }
  }

  private func distanceText(to place: MapSamplePlace) -> String {
    guard let fix = outing.lastFix else { return "Waiting for location…" }
    let meters = GeoPoint(latitude: fix.coordinate.latitude, longitude: fix.coordinate.longitude).distance(to: place.coordinate)
    let minutes = max(1, Int((meters / 80).rounded()))
    return meters < 1000 ? "\(Int(meters)) m · about \(minutes) min walk" : String(format: "%.1f km · about %d min walk", meters / 1000, minutes)
  }

  private func elapsed(at now: Date) -> String {
    let seconds = max(0, Int(now.timeIntervalSince(outing.startedAt ?? session.startedAt)))
    return String(format: "%02d:%02d", seconds / 60, seconds % 60)
  }

  private func status(_ text: String, spinner: Bool) -> some View {
    VStack(spacing: 16) {
      HermitBrandMark().frame(width: 60, height: 68)
      if spinner { ProgressView() }
      Text(text).font(.headline)
    }.frame(maxWidth: .infinity, maxHeight: .infinity).background(HermiPalette.paper.ignoresSafeArea())
  }

  /// Local Action with no server session (e.g. the session ended elsewhere): start fresh or leave.
  private var notRunning: some View {
    VStack(spacing: 16) {
      Text("This outing isn’t running").font(.title2.bold())
      Text("Start it again to check in and capture, or go back to the map.").font(.subheadline)
        .multilineTextAlignment(.center).padding(.horizontal, 30)
      Button("Start outing") { Task { await outing.start(planID: nil) } }
        .padding(12).background(HermiPalette.lime, in: PixelPanel(corner: 6))
      Button("Back to Map") { done() }.padding(12)
    }.frame(maxWidth: .infinity, maxHeight: .infinity).background(HermiPalette.paper.ignoresSafeArea())
  }

  private func failure(_ message: String) -> some View {
    VStack(spacing: 16) {
      Text("Outing problem").font(.title2.bold())
      Text(message).font(.subheadline).multilineTextAlignment(.center).padding(.horizontal, 30)
      if outing.sessionID != nil {
        Button("Try ending again") { Task { await outing.end() } }.padding(12).background(HermiPalette.lime, in: PixelPanel(corner: 6))
      }
      Button("Back to Map") { done() }.padding(12)
    }.frame(maxWidth: .infinity, maxHeight: .infinity).background(HermiPalette.paper.ignoresSafeArea())
  }

  private func modeButton(_ label: String, icon: String, mode: ActionPreviewSession.Mode) -> some View {
    Button { selectMode(mode) } label: {
      VStack(spacing: 4) { PixelIcon(name: icon).frame(width: 24, height: 24); Text(label).font(.caption) }
        .frame(width: 95, height: 48).background(session.mode == mode ? HermiPalette.lime : .clear, in: Capsule())
        .contentShape(Rectangle())
    }.accessibilityLabel(label).accessibilityAddTraits(session.mode == mode ? .isSelected : [])
  }
}

/// The server's recap: stops, XP breakdown, distance and new tiles; then Post and reviews (Step 12).
private struct RecapView: View {
  var done: () -> Void
  private let outing = LiveOuting.shared
  @State private var selected: Set<String> = []
  @State private var includeRoute = true
  @State private var caption = ""
  @State private var posting = false
  @State private var postMessage: String?
  @State private var reviewed: [String: Bool] = [:]

  var body: some View {
    ScrollView {
      if let recap = outing.recap {
        VStack(alignment: .leading, spacing: 18) {
          Text(recap.planName ?? "Outing recap").font(.largeTitle.bold())
          HStack(spacing: 18) {
            fact("\(recap.durationMin ?? 0) min", "out")
            fact(String(format: "%.1f km", recap.footKm ?? 0), "on foot")
            fact("\(recap.newTiles.count)", "new tiles")
          }
          if recap.fullParty == true { Text("Full party bonus: everyone checked in together").font(.subheadline.bold()).foregroundStyle(HermiPalette.green) }

          Text("+\(recap.xp.total) XP").font(.system(size: 40, weight: .bold, design: .monospaced))
          ForEach(Array(recap.xp.items.enumerated()), id: \.offset) { _, item in
            HStack { Text(item.label).font(.subheadline); Spacer(); Text("+\(item.xp)").font(.system(.subheadline, design: .monospaced)) }
          }

          Text("Stops").font(.headline)
          if recap.stops.isEmpty { Text("No verified check-ins this time.").font(.subheadline) }
          ForEach(recap.stops, id: \.checkinId) { stop in reviewRow(stop) }

          postComposer(recap)
          Button("Done") { done() }.font(.headline).padding(16).frame(maxWidth: .infinity)
            .background(HermiPalette.paper, in: PixelPanel(corner: 8))
            .overlay(PixelPanel(corner: 8).stroke(HermiPalette.ink, lineWidth: 2))
        }.padding(24)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity).background(HermiPalette.paper.ignoresSafeArea())
    .onAppear { selected = Set(outing.postableMediaIDs) }
  }

  private func fact(_ value: String, _ label: String) -> some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(value).font(.system(.title3, design: .monospaced).bold())
      Text(label).font(.caption2).foregroundStyle(HermiPalette.secondary)
    }
  }

  private func reviewRow(_ stop: RecapDTO.Stop) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack {
        Text(stop.placeName).font(.subheadline.bold())
        Spacer()
        Text(stop.tier == "tag" ? "TAG" : "GPS").font(.system(size: 10, design: .monospaced))
        if stop.firstVisit == true { Text("FIRST").font(.system(size: 10, design: .monospaced)).foregroundStyle(HermiPalette.green) }
      }
      if let answer = reviewed[stop.checkinId] {
        Text(answer ? "You’d go again ✓" : "Not again ✓").font(.caption)
      } else if stop.reviewed != true {
        HStack {
          Text("Would you go again?").font(.caption)
          Spacer()
          Button("Yes") { review(stop, again: true) }.font(.caption.bold()).padding(.horizontal, 12).frame(minHeight: 32)
            .background(HermiPalette.lime, in: PixelPanel(corner: 5))
          Button("No") { review(stop, again: false) }.font(.caption.bold()).padding(.horizontal, 12).frame(minHeight: 32)
            .background(.white, in: PixelPanel(corner: 5))
        }
      }
    }.padding(10).background(.white.opacity(0.6), in: PixelPanel(corner: 6))
  }

  @ViewBuilder
  private func postComposer(_ recap: RecapDTO) -> some View {
    Text("Post this outing").font(.headline)
    if outing.captures.isEmpty {
      Text("No photos this time: you can still post the route card.").font(.caption)
    } else {
      ScrollView(.horizontal) {
        HStack(spacing: 8) {
          ForEach(outing.captures) { capture in
            if let id = capture.mediaID {
              Button {
                if selected.contains(id) { selected.remove(id) } else { selected.insert(id) }
              } label: {
                Group {
                  if let image = PlatformImage(data: capture.imageData) { Image(platform: image).resizable().scaledToFill() }
                  else { HermiPalette.secondary }
                }.frame(width: 84, height: 104).clipShape(PixelPanel(corner: 6))
                  .overlay(PixelPanel(corner: 6).stroke(selected.contains(id) ? HermiPalette.green : .clear, lineWidth: 4))
                  .opacity(selected.contains(id) ? 1 : 0.5)
              }.accessibilityLabel(selected.contains(id) ? "Photo selected" : "Photo not selected")
            }
          }
        }
      }
    }
    Toggle("Include route card", isOn: $includeRoute).tint(HermiPalette.green)
    TextField("Caption (optional)", text: $caption).padding(10).background(.white, in: PixelPanel(corner: 5))
    if let postMessage { Text(postMessage).font(.caption.bold()).foregroundStyle(HermiPalette.green) }
    Button {
      Task { await post(recap) }
    } label: {
      HStack { if posting { ProgressView() }; Text(recap.posted == true || postMessage?.hasPrefix("Posted") == true ? "Posted ✓" : "Post") }
        .font(.headline).frame(maxWidth: .infinity, minHeight: 50).background(HermiPalette.lime, in: PixelPanel(corner: 8))
    }.disabled(posting || postMessage?.hasPrefix("Posted") == true || (selected.isEmpty && !includeRoute))
  }

  private func post(_ recap: RecapDTO) async {
    guard let api = LiveSession.shared.api else { return }
    posting = true
    defer { posting = false }
    let trimmed = caption.trimmingCharacters(in: .whitespacesAndNewlines)
    do {
      let post: PostDTO = try await api.send("POST", "/posts", body: CreatePostBody(
        sessionId: recap.sessionId, mediaIds: Array(selected), includeRoute: includeRoute,
        caption: trimmed.isEmpty ? nil : String(trimmed.prefix(280))))
      postMessage = post.status == "live" ? "Posted. It’s in your friends’ Feed." : "Posted. It appears once moderation clears it."
    } catch {
      postMessage = "Couldn’t post: \(error.localizedDescription)"
    }
  }

  private func review(_ stop: RecapDTO.Stop, again: Bool) {
    Task {
      guard let api = LiveSession.shared.api else { return }
      if (try? await api.send("POST", "/reviews", body: ReviewBody(checkinId: stop.checkinId, again: again, text: nil), as: OKResponse.self)) != nil {
        reviewed[stop.checkinId] = again
      }
    }
  }
}

#if os(iOS)
/// The system camera (in-app capture only; no camera-roll import).
struct CameraPicker: UIViewControllerRepresentable {
  var onImage: (UIImage) -> Void
  @Environment(\.dismiss) private var dismiss

  func makeUIViewController(context: Context) -> UIImagePickerController {
    let picker = UIImagePickerController()
    picker.sourceType = .camera
    picker.delegate = context.coordinator
    return picker
  }
  func updateUIViewController(_ controller: UIImagePickerController, context: Context) {}
  func makeCoordinator() -> Coordinator { Coordinator(self) }

  final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
    let parent: CameraPicker
    init(_ parent: CameraPicker) { self.parent = parent }
    func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
      if let image = info[.originalImage] as? UIImage { parent.onImage(image) }
      parent.dismiss()
    }
    func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { parent.dismiss() }
  }
}
#endif
