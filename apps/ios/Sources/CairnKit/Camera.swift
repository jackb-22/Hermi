import AVFoundation
import CryptoKit
import SwiftUI

final class CameraService: NSObject, ObservableObject, AVCapturePhotoCaptureDelegate,
  AVCaptureMetadataOutputObjectsDelegate, AVCaptureFileOutputRecordingDelegate
{
  let session = AVCaptureSession()
  let photos = AVCapturePhotoOutput()
  let movies = AVCaptureMovieFileOutput()
  @Published var ready = false
  @Published var error: String?
  @Published var recording = false
  var onPhoto: ((Data) -> Void)?
  var onVideo: ((Data) -> Void)?
  var onQR: ((String) -> Void)?
  private let queue = DispatchQueue(label: "cairn.camera")
  private var started = false
  func start() {
    guard !started else { return }
    started = true
    AVCaptureDevice.requestAccess(for: .video) { allowed in
      guard allowed else {
        DispatchQueue.main.async {
          self.error = "Camera access is off. Enable it in system settings to capture your visit."
        }
        return
      }
      self.queue.async {
        do {
          self.session.beginConfiguration()
          self.session.sessionPreset = .high
          guard let device = AVCaptureDevice.default(for: .video) else {
            throw APIError(code: "CAMERA", message: "No camera is available.")
          }
          let input = try AVCaptureDeviceInput(device: device)
          guard self.session.canAddInput(input), self.session.canAddOutput(self.photos) else {
            throw APIError(code: "CAMERA", message: "The camera is not available right now.")
          }
          self.session.addInput(input)
          self.session.addOutput(self.photos)
          if self.session.canAddOutput(self.movies) {
            self.session.addOutput(self.movies)
            self.movies.maxRecordedDuration = CMTime(seconds: 15, preferredTimescale: 600)
          }
          let codes = AVCaptureMetadataOutput()
          if self.session.canAddOutput(codes) {
            self.session.addOutput(codes)
            codes.setMetadataObjectsDelegate(self, queue: .main)
            if codes.availableMetadataObjectTypes.contains(.qr) {
              codes.metadataObjectTypes = [.qr]
            }
          }
          self.session.commitConfiguration()
          self.session.startRunning()
          DispatchQueue.main.async { self.ready = true }
        } catch { DispatchQueue.main.async { self.error = error.localizedDescription } }
      }
    }
  }
  func takePhoto() {
    guard ready else { return }
    photos.capturePhoto(with: AVCapturePhotoSettings(), delegate: self)
  }
  func photoOutput(
    _ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?
  ) {
    DispatchQueue.main.async {
      if let error { self.error = error.localizedDescription }
      if let data = photo.fileDataRepresentation() { self.onPhoto?(data) }
    }
  }
  func metadataOutput(
    _ output: AVCaptureMetadataOutput, didOutput objects: [AVMetadataObject],
    from connection: AVCaptureConnection
  ) {
    if let code = objects.first as? AVMetadataMachineReadableCodeObject, let url = code.stringValue
    {
      onQR?(url)
    }
  }
  func record() {
    guard ready, !recording else { return }
    recording = true
    let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
      .appendingPathExtension("mov")
    movies.startRecording(to: url, recordingDelegate: self)
  }
  func stopRecording() { movies.stopRecording() }
  func fileOutput(
    _ output: AVCaptureFileOutput, didFinishRecordingTo outputFileURL: URL,
    from connections: [AVCaptureConnection], error: Error?
  ) {
    let data = try? Data(contentsOf: outputFileURL)
    try? FileManager.default.removeItem(at: outputFileURL)
    DispatchQueue.main.async {
      self.recording = false
      if let data {
        self.onVideo?(data)
      } else {
        self.error = error?.localizedDescription ?? "Could not save the video."
      }
    }
  }
  func stop() { queue.async { self.session.stopRunning() } }
}
#if os(macOS)
  struct CameraSurface: NSViewRepresentable {
    let camera: CameraService
    func makeNSView(context: Context) -> CameraHost { CameraHost(session: camera.session) }
    func updateNSView(_ view: CameraHost, context: Context) {}
  }
  final class CameraHost: NSView {
    let preview: AVCaptureVideoPreviewLayer
    init(session: AVCaptureSession) {
      preview = AVCaptureVideoPreviewLayer(session: session)
      super.init(frame: .zero)
      wantsLayer = true
      preview.videoGravity = .resizeAspectFill
      layer?.addSublayer(preview)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func layout() {
      super.layout()
      preview.frame = bounds
    }
  }
#else
  struct CameraSurface: UIViewRepresentable {
    let camera: CameraService
    func makeUIView(context: Context) -> CameraHost { CameraHost(session: camera.session) }
    func updateUIView(_ view: CameraHost, context: Context) {}
  }
  final class CameraHost: UIView {
    let preview: AVCaptureVideoPreviewLayer
    init(session: AVCaptureSession) {
      preview = AVCaptureVideoPreviewLayer(session: session)
      super.init(frame: .zero)
      preview.videoGravity = .resizeAspectFill
      layer.addSublayer(preview)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func layoutSubviews() {
      super.layoutSubviews()
      preview.frame = bounds
    }
  }
#endif
struct CaptureView: View {
  @ObservedObject var location: LocationService
  @EnvironmentObject var store: CairnStore
  @StateObject var camera = CameraService()
  @State var captureMetadata: JSON = .null
  @State var qr = ""
  @State var uploading = false
  var body: some View {
    VStack(spacing: 18) {
      ZStack(alignment: .bottom) {
        CameraSurface(camera: camera).frame(minHeight: 320).clipShape(
          RoundedRectangle(cornerRadius: 25))
        Text(store.checkin.exists ? "Only here. Only now." : "Check in to capture this place.")
          .font(.subheadline.bold()).padding(15).foregroundStyle(.white).shadow(radius: 4)
      }
      if let error = camera.error { Text(error).font(.caption).foregroundStyle(.red) }
      HStack(spacing: 30) {
        Button {
          capture(video: true)
        } label: {
          Image(systemName: camera.recording ? "stop.fill" : "video").font(.title2).foregroundStyle(
            camera.recording ? .red : Theme.ink)
        }.buttonStyle(.plain).accessibilityLabel(
          camera.recording ? "Stop video" : "Record video, up to 15 seconds")
        Button {
          capture(video: false)
        } label: {
          Circle().fill(Theme.paper).frame(width: 65, height: 65).overlay(
            Circle().stroke(Theme.ink, lineWidth: 4)
          ).overlay(Circle().stroke(Theme.line, lineWidth: 1).padding(7))
        }.buttonStyle(.plain).accessibilityLabel("Take photo")
        if uploading {
          ProgressView()
        } else {
          Image(systemName: "checkmark.seal").font(.title2).foregroundStyle(Theme.green)
        }
      }.disabled(!store.checkin.exists || uploading)
      Text("Photos and clips stay private until you choose to post.").font(.caption)
        .foregroundStyle(Theme.muted)
    }.onAppear {
      camera.onPhoto = { data in
        Task { await upload(data, kind: "photo", contentType: "image/jpeg") }
      }
      camera.onVideo = { data in
        Task { await upload(data, kind: "video", contentType: "video/quicktime") }
      }
      camera.onQR = { value in
        guard qr != value, let url = URL(string: value),
          ["c", "t"].contains(url.pathComponents.dropFirst().first ?? "")
        else { return }
        qr = value
        store.pendingTag = value
        store.sheet = "tag"
        store.toast("Tag scanned. Confirm the link to continue.")
      }
      camera.start()
    }.onDisappear { camera.stop() }
  }
  func capture(video: Bool) {
    if video && camera.recording {
      camera.stopRecording()
      return
    }
    do {
      captureMetadata = try location.body().setting("capturedAt", iso(Date())).setting(
        "checkinId", store.checkin["id"])
      if video { camera.record() } else { camera.takePhoto() }
    } catch { store.error = error.localizedDescription }
  }
  func upload(_ data: Data, kind: String, contentType: String) async {
    uploading = true
    defer { uploading = false }
    do {
      let hash = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
      var body = captureMetadata.setting("kind", .string(kind)).setting(
        "contentType", .string(contentType)
      ).setting("sha256", .string(hash)).setting("bytes", .number(Double(data.count)))
      if kind == "video" {
        body = body.setting(
          "durationS",
          .number(
            min(
              15, Date().timeIntervalSince(parseDate(captureMetadata["capturedAt"].text) ?? Date()))
          ))
      }
      let r = try await store.call("media/presign", "POST", body)
      guard let url = URL(string: r["upload"]["url"].text),
        ["https", "http"].contains(url.scheme ?? "")
      else { throw APIError(code: "UPLOAD", message: "The upload address is invalid.") }
      var request = URLRequest(url: url)
      request.httpMethod = "PUT"
      if case .object(let headers) = r["upload"]["headers"] {
        for (key, value) in headers { request.setValue(value.text, forHTTPHeaderField: key) }
      }
      let (_, response) = try await URLSession.shared.upload(for: request, from: data)
      guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
        throw APIError(code: "UPLOAD", message: "Upload failed. Please try another capture.")
      }
      _ = try await store.call("media/\(r["media"].id)/commit", "POST", [:])
      store.toast("Capture saved privately.")
    } catch { store.error = error.localizedDescription }
  }
}
