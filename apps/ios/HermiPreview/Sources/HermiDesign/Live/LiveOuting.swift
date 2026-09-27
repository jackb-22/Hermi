import CoreLocation
import CryptoKit
import Foundation
import Observation

/// A real outing (Action mode) against `/v1/sessions`: start or resume, stream location fixes, check in at
/// stops with the tag stand-in, end, then wait for the server's recap.
@Observable
final class LiveOuting {
  static let shared = LiveOuting()

  enum Phase: Equatable { case idle, starting, active, ending, recap, failed(String) }

  private(set) var phase: Phase = .idle
  private(set) var sessionID: String?
  private(set) var planID: String?
  private(set) var startedAt: Date?
  /// Check-ins this outing, by place ID.
  private(set) var checkins: [String: CheckinResultDTO] = [:]
  private(set) var checkingIn: String?
  private(set) var notice: String?
  private(set) var recap: RecapDTO?
  private(set) var lastFix: CLLocation?
  private(set) var locationDenied = false
  /// Photos taken this outing, newest last.
  private(set) var captures: [OutingCapture] = []

  @ObservationIgnored private var pending: [PointBody] = []
  @ObservationIgnored private var flushTask: Task<Void, Never>?
  @ObservationIgnored private var tags: [String: String] = [:]
  @ObservationIgnored private var recorder: LocationRecorder?

  var isRunning: Bool { phase == .active || phase == .ending }

  // MARK: Start / resume

  /// Starts a session for a server plan (nil = Head out). A session already running is resumed.
  @MainActor
  func start(planID: String?) async {
    guard let api = LiveSession.shared.api, phase == .idle || phase.isFailure else { return }
    phase = .starting; notice = nil
    do {
      let response: StartSessionResponseDTO = try await api.send("POST", "/sessions", body: StartSessionBody(planId: planID))
      begin(response.session)
    } catch let error as HermiAPIError where error.status == 409 {
      // Another session is active: resume it rather than failing the outing.
      if let active = try? await api.send("GET", "/sessions/active", as: ActiveSessionDTO.self), let session = active.session {
        begin(session)
      } else {
        phase = .failed(error.localizedDescription)
      }
    } catch {
      phase = .failed(error.localizedDescription)
    }
  }

  /// On launch: pick up a session the server still has open.
  @MainActor
  func restore() async {
    guard phase == .idle, let api = LiveSession.shared.api,
          let active = try? await api.send("GET", "/sessions/active", as: ActiveSessionDTO.self),
          let session = active.session, session.status == "active" else { return }
    begin(session)
  }

  @MainActor
  private func begin(_ session: SessionDTO) {
    sessionID = session.id
    planID = session.planId
    startedAt = session.startedAt.flatMap(HermiDates.parse) ?? Date()
    phase = .active
    if recorder == nil { recorder = LocationRecorder { [weak self] location in self?.record(location) } }
    recorder?.start()
    locationDenied = recorder?.denied ?? false
    flushTask?.cancel()
    flushTask = Task { @MainActor in
      while !Task.isCancelled {
        do { try await Task.sleep(for: .seconds(15)) } catch { return }
        await flush()
      }
    }
  }

  // MARK: Location

  private func record(_ location: CLLocation) {
    lastFix = location
    guard phase == .active, location.horizontalAccuracy >= 0, location.horizontalAccuracy <= 100 else { return }
    pending.append(PointBody(lat: location.coordinate.latitude, lng: location.coordinate.longitude,
                             accuracy: location.horizontalAccuracy,
                             speed: location.speed >= 0 ? location.speed : nil, time: location.timestamp))
  }

  /// Sends buffered fixes in time order, at most 500 at a time. Failed batches stay queued.
  @MainActor
  func flush() async {
    guard let api = LiveSession.shared.api, let sessionID, !pending.isEmpty else { return }
    pending.sort { $0.time < $1.time }
    let batch = Array(pending.prefix(500))
    do {
      let _: OKResponse = try await api.send("POST", "/sessions/\(sessionID)/points", body: PointsBody(points: batch))
      pending.removeFirst(min(batch.count, pending.count))
    } catch {
      notice = "Location upload paused: \(error.localizedDescription)"
    }
  }

  // MARK: Check-in (NFC stand-in)

  /// "Tap tag": the in-app stand-in for an NFC venue tag. Mints a dev venue tag for the stop (once per outing)
  /// and checks in with the phone's location, or the stop's own coordinates when there's no fix (Simulator).
  /// The server still enforces 150 m proximity, cooldowns and XP.
  @MainActor
  func checkIn(at place: MapSamplePlace) async {
    guard let api = LiveSession.shared.api, checkingIn == nil, checkins[place.id] == nil else { return }
    if place.name.localizedCaseInsensitiveContains("demo hall") {
      notice = "Demo Hall has a real NFC tag: tap it with the phone. (The in-app stand-in would replace it.)"
      return
    }
    checkingIn = place.id; notice = nil
    defer { checkingIn = nil }
    let fix = lastFix.flatMap { $0.horizontalAccuracy >= 0 && $0.horizontalAccuracy <= 100 ? $0 : nil }
    let simulated = fix == nil
    let lat = fix?.coordinate.latitude ?? place.latitude
    let lng = fix?.coordinate.longitude ?? place.longitude
    do {
      let url: String
      if let cached = tags[place.id] { url = cached } else {
        let tag: DevTagDTO = try await api.send("POST", "/dev/tags", body: DevTagBody(placeId: place.id))
        tags[place.id] = tag.url; url = tag.url
      }
      let result: CheckinResultDTO = try await api.send("POST", "/checkins", body: TagCheckinBody(
        tagUrl: url, sessionId: sessionID, lat: lat, lng: lng, accuracy: fix?.horizontalAccuracy ?? 10))
      checkins[place.id] = result
      var message = "Checked in at \(place.name) · +\(result.xp.total) XP"
      if let hangout = result.hangouts?.first {
        let name = FriendDirectory.shared.friends.first { $0.id == hangout.friendId }?.name ?? "a friend"
        message += " · Hangout with \(name) (\(hangout.streakWeeks)-week streak)"
      }
      if simulated { message += " · simulated location" }
      notice = message
    } catch {
      notice = "Check-in failed: \(error.localizedDescription)"
    }
  }

  func checkinID(for placeID: String) -> String? { checkins[placeID]?.checkin.id }
  /// The latest check-in this outing (captures attach to it).
  var latestCheckinID: String? { checkins.values.map(\.checkin.id).max() }

  // MARK: End

  @MainActor
  func end() async {
    guard let api = LiveSession.shared.api, let sessionID, phase == .active else { return }
    phase = .ending
    await flush()
    recorder?.stop()
    flushTask?.cancel()
    do {
      let _: StartSessionResponseDTO = try await api.send("POST", "/sessions/\(sessionID)/end", body: EndSessionBody(steps: nil))
    } catch {
      phase = .failed("Couldn’t end the outing: \(error.localizedDescription)")
      return
    }
    for _ in 0..<45 {
      if let response = try? await api.send("GET", "/sessions/\(sessionID)/recap", as: RecapResponseDTO.self),
         response.status == "ready", let recap = response.recap {
        self.recap = recap
        phase = .recap
        return
      }
      do { try await Task.sleep(for: .seconds(2)) } catch { return }
    }
    phase = .failed("The recap is still processing. Check Profile in a minute.")
  }

  // MARK: Capture (Step 11)

  /// Uploads an in-app photo tied to the latest check-in: SHA-256 of the exact bytes → presign → PUT with the
  /// returned headers → commit. The server checks hash, time window and distance, then verifies.
  @MainActor
  func capture(jpeg original: Data, simulated: Bool) async {
    guard let api = LiveSession.shared.api else { return }
    guard let checkinID = latestCheckinID,
          let placeID = checkins.first(where: { $0.value.checkin.id == checkinID })?.key,
          let place = MapSamplePlace.find(placeID) else {
      notice = "Check in at a stop first. Every photo is tied to a verified check-in."
      return
    }
    // A sample photo is re-stamped so each capture has its own hash.
    let bytes = simulated ? LiveOuting.stamped(original) : original
    let item = OutingCapture(imageData: bytes, placeID: placeID, status: "Uploading…", simulated: simulated)
    captures.append(item)
    // Updates look the capture up again: the outing may have been reset while uploading.
    func update(_ change: (inout OutingCapture) -> Void) {
      if let index = captures.firstIndex(where: { $0.id == item.id }) { change(&captures[index]) }
    }
    let fix = lastFix.flatMap { $0.horizontalAccuracy >= 0 && $0.horizontalAccuracy <= 100 ? $0 : nil }
    let hash = SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
    do {
      let presign: PresignResponseDTO = try await api.send("POST", "/media/presign", body: PresignBody(
        checkinId: checkinID, sha256: hash, bytes: bytes.count, capturedAt: Date(),
        lat: fix?.coordinate.latitude ?? place.latitude, lng: fix?.coordinate.longitude ?? place.longitude))
      guard let uploadURL = URL(string: presign.upload.url) else { throw HermiAPIError(status: 0, code: "BAD_URL", message: "Bad upload URL") }
      var request = URLRequest(url: uploadURL, timeoutInterval: 60)
      request.httpMethod = presign.upload.method ?? "PUT"
      for (name, value) in presign.upload.headers { request.setValue(value, forHTTPHeaderField: name) }
      let (_, response) = try await URLSession.shared.upload(for: request, from: bytes)
      let code = (response as? HTTPURLResponse)?.statusCode ?? 0
      guard (200..<300).contains(code) else { throw HermiAPIError(status: code, code: "UPLOAD", message: "Upload failed (HTTP \(code))") }
      var media: MediaDTO = try await api.send("POST", "/media/\(presign.media.id)/commit")
      let committed = media
      update { $0.mediaID = committed.id; $0.status = committed.status.capitalized }
      // Verification finishes on the worker; poll briefly.
      var attempts = 0
      while media.status == "pending", attempts < 10 {
        attempts += 1
        do { try await Task.sleep(for: .seconds(2)) } catch { break }
        if let list = try? await api.send("GET", "/media", query: ["checkinId": checkinID], as: MediaListDTO.self),
           let updated = list.items.first(where: { $0.id == media.id }) { media = updated }
        let status = media.status.capitalized
        update { $0.status = status }
      }
      let reason = media.rejectReason
      update { $0.detail = reason }
    } catch {
      let message = error.localizedDescription
      update { $0.status = "Failed"; $0.detail = message }
    }
  }

  /// Media IDs of verified (or still verifying) captures, for posting.
  var postableMediaIDs: [String] { captures.filter { $0.status != "Failed" && $0.status != "Rejected" }.compactMap(\.mediaID) }

  /// Inserts a JPEG comment segment with random bytes right after SOI (still a valid JPEG, new hash).
  static func stamped(_ jpeg: Data) -> Data {
    guard jpeg.count > 2, jpeg[jpeg.startIndex] == 0xFF, jpeg[jpeg.startIndex + 1] == 0xD8 else { return jpeg }
    var comment = Data([0xFF, 0xFE, 0x00, 0x12])
    comment.append(contentsOf: (0..<16).map { _ in UInt8.random(in: 0...255) })
    var result = Data(jpeg.prefix(2))
    result.append(comment)
    result.append(jpeg.dropFirst(2))
    return result
  }

  func reset() {
    recorder?.stop(); flushTask?.cancel(); captures = []
    phase = .idle; sessionID = nil; planID = nil; startedAt = nil; checkins = [:]; notice = nil
    recap = nil; pending = []; tags = [:]
  }
}

extension LiveOuting.Phase {
  var isFailure: Bool { if case .failed = self { return true } else { return false } }
}

/// When-in-use location updates for an outing. Foreground only; the app must stay open (D15).
final class LocationRecorder: NSObject, CLLocationManagerDelegate {
  private let manager = CLLocationManager()
  private let onFix: (CLLocation) -> Void
  private(set) var denied = false

  init(onFix: @escaping (CLLocation) -> Void) {
    self.onFix = onFix
    super.init()
    manager.delegate = self
    manager.desiredAccuracy = kCLLocationAccuracyBest
    manager.distanceFilter = 5
  }

  func start() {
    switch manager.authorizationStatus {
    case .notDetermined: manager.requestWhenInUseAuthorization()
    case .denied, .restricted: denied = true
    default: break
    }
    manager.startUpdatingLocation()
  }

  func stop() { manager.stopUpdatingLocation() }

  func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    for location in locations { onFix(location) }
  }
  func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    denied = manager.authorizationStatus == .denied || manager.authorizationStatus == .restricted
  }
  func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {}
}

/// A photo taken during an outing and its upload/verification state.
struct OutingCapture: Identifiable, Equatable {
  let id = UUID()
  let imageData: Data
  let placeID: String
  var status: String
  var simulated: Bool
  var mediaID: String?
  var detail: String?
}

