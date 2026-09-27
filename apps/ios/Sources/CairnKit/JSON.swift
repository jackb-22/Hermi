import Foundation

/// Lossless JSON for the evolving server contract. Views never recalculate server-owned rewards.
public enum JSON: Codable, Sendable, Equatable, Identifiable {
  case object([String: JSON])
  case array([JSON])
  case string(String)
  case number(Double)
  case bool(Bool)
  case null
  public init(from decoder: Decoder) throws {
    let c = try decoder.singleValueContainer()
    if c.decodeNil() {
      self = .null
    } else if let v = try? c.decode(Bool.self) {
      self = .bool(v)
    } else if let v = try? c.decode(Double.self) {
      self = .number(v)
    } else if let v = try? c.decode(String.self) {
      self = .string(v)
    } else if let v = try? c.decode([JSON].self) {
      self = .array(v)
    } else {
      self = .object(try c.decode([String: JSON].self))
    }
  }
  public func encode(to encoder: Encoder) throws {
    var c = encoder.singleValueContainer()
    switch self {
    case .object(let v): try c.encode(v)
    case .array(let v): try c.encode(v)
    case .string(let v): try c.encode(v)
    case .number(let v): try c.encode(v)
    case .bool(let v): try c.encode(v)
    case .null: try c.encodeNil()
    }
  }
  public subscript(_ key: String) -> JSON {
    if case .object(let o) = self { return o[key] ?? .null }
    return .null
  }
  public var text: String {
    if case .string(let v) = self { return v }
    return ""
  }
  public var number: Double {
    if case .number(let v) = self { return v }
    return 0
  }
  public var int: Int { Int(number) }
  public var flag: Bool {
    if case .bool(let v) = self { return v }
    return false
  }
  public var list: [JSON] {
    if case .array(let v) = self { return v }
    return []
  }
  public var exists: Bool { self != .null }
  public var id: String { self["id"].text.isEmpty ? self["userId"].text : self["id"].text }
  public func setting(_ key: String, _ value: JSON) -> JSON {
    var d: [String: JSON] = [:]
    if case .object(let o) = self { d = o }
    d[key] = value
    return .object(d)
  }
  static func parse(_ text: String) -> JSON {
    (try? JSONDecoder().decode(JSON.self, from: Data(text.utf8))) ?? .null
  }
}
extension JSON: ExpressibleByStringLiteral {
  public init(stringLiteral value: String) { self = .string(value) }
}
extension JSON: ExpressibleByIntegerLiteral {
  public init(integerLiteral value: Int) { self = .number(Double(value)) }
}
extension JSON: ExpressibleByBooleanLiteral {
  public init(booleanLiteral value: Bool) { self = .bool(value) }
}
extension JSON: ExpressibleByDictionaryLiteral {
  public init(dictionaryLiteral elements: (String, JSON)...) {
    self = .object(Dictionary(uniqueKeysWithValues: elements))
  }
}
extension JSON: ExpressibleByArrayLiteral {
  public init(arrayLiteral elements: JSON...) { self = .array(elements) }
}

public enum CairnScale {
  /// First stone = a new tag visit. Each subsequent stone costs 25 XP more.
  public static func threshold(for stones: Int) -> Int {
    let n = max(0, stones)
    return 25 * n * (n + 1) / 2
  }
  public static func stones(for score: Int) -> Int {
    let scaled: Double = 1.0 + 8.0 * Double(max(0, score)) / 25.0
    let root = sqrt(scaled)
    return max(0, Int((root - 1.0) / 2.0))
  }
  public static func progress(for score: Int) -> Double {
    let n = stones(for: score)
    return Double(max(0, score) - threshold(for: n))
      / Double(threshold(for: n + 1) - threshold(for: n))
  }
}
func formattedTime(_ value: String) -> String {
  guard let date = parseDate(value) else { return "—" }
  return date.formatted(date: .omitted, time: .shortened)
}
func parseDate(_ value: String) -> Date? {
  let f = ISO8601DateFormatter()
  f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
  return f.date(from: value) ?? ISO8601DateFormatter().date(from: value)
}
func iso(_ date: Date) -> JSON { .string(ISO8601DateFormatter().string(from: date)) }
extension JSON: ExpressibleByFloatLiteral {
  public init(floatLiteral value: Double) { self = .number(value) }
}
