import Foundation

/// Server error from the `{"error":{"code","message"}}` envelope, or a transport failure.
struct HermiAPIError: Error, LocalizedError, Equatable {
  var status: Int
  var code: String
  var message: String
  var errorDescription: String? { "\(message) (\(code))" }

  static func transport(_ error: Error) -> HermiAPIError {
    HermiAPIError(status: 0, code: "NETWORK", message: error.localizedDescription)
  }
}

private struct ErrorEnvelope: Decodable {
  struct Body: Decodable { var code: String; var message: String }
  var error: Body
}

/// `{"ok":true}` responses.
struct OKResponse: Decodable, Sendable { var ok: Bool? }

/// Thin async client for the Hermi `/v1` API. Foundation only, so it builds for iOS and the Mac preview.
struct HermiAPI {
  var baseURL: URL
  var token: String?
  var devToken: String?

  static let decoder: JSONDecoder = {
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .custom { decoder in
      let container = try decoder.singleValueContainer()
      let text = try container.decode(String.self)
      if let date = HermiDates.parse(text) { return date }
      throw DecodingError.dataCorruptedError(in: container, debugDescription: "Unrecognised date \(text)")
    }
    return decoder
  }()

  static let encoder: JSONEncoder = {
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .custom { date, encoder in
      var container = encoder.singleValueContainer()
      try container.encode(HermiDates.format(date))
    }
    return encoder
  }()

  /// Builds `<base>/v1<path>?query`. `path` starts with "/".
  func url(_ path: String, query: [String: String] = [:]) -> URL? {
    var text = baseURL.absoluteString
    while text.hasSuffix("/") { text.removeLast() }
    guard var components = URLComponents(string: text + "/v1" + path) else { return nil }
    if !query.isEmpty {
      components.queryItems = query.keys.sorted().map { URLQueryItem(name: $0, value: query[$0]) }
    }
    return components.url
  }

  func send<T: Decodable>(_ method: String, _ path: String, query: [String: String] = [:],
                          body: (any Encodable)? = nil, as type: T.Type = T.self) async throws -> T {
    guard let url = url(path, query: query) else {
      throw HermiAPIError(status: 0, code: "BAD_URL", message: "Invalid server URL")
    }
    var request = URLRequest(url: url, timeoutInterval: 25)
    request.httpMethod = method
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    // ngrok's free tier can show a browser warning page; this header skips it for API calls.
    request.setValue("1", forHTTPHeaderField: "ngrok-skip-browser-warning")
    if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
    if let devToken, !devToken.isEmpty { request.setValue(devToken, forHTTPHeaderField: "x-dev-token") }
    if let body {
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
      request.httpBody = try HermiAPI.encoder.encode(body)
    }
    let result: (Data, URLResponse)
    do { result = try await URLSession.shared.data(for: request) }
    catch { throw HermiAPIError.transport(error) }
    let (data, response) = result
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    guard (200..<300).contains(status) else {
      if let envelope = try? HermiAPI.decoder.decode(ErrorEnvelope.self, from: data) {
        throw HermiAPIError(status: status, code: envelope.error.code, message: envelope.error.message)
      }
      throw HermiAPIError(status: status, code: "HTTP_\(status)", message: HTTPURLResponse.localizedString(forStatusCode: status))
    }
    do { return try HermiAPI.decoder.decode(T.self, from: data) }
    catch { throw HermiAPIError(status: status, code: "DECODE", message: "Unexpected response from \(path): \(error)") }
  }
}

/// ISO-8601 dates as the server writes them (with milliseconds) and accepts them (with an offset).
enum HermiDates {
  private static let fractional: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter
  }()
  private static let whole: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    return formatter
  }()
  static func parse(_ text: String) -> Date? { fractional.date(from: text) ?? whole.date(from: text) }
  static func format(_ date: Date) -> String { fractional.string(from: date) }
}
