import CairnKit
import Foundation

@main struct Checks {
  static func main() throws {
    var checks = 0
    func check(_ condition: Bool, _ message: String) {
      precondition(condition, message)
      checks += 1
    }
    check(CairnScale.threshold(for: 1) == 25, "First new-venue tag check-in earns a stone")
    check(CairnScale.threshold(for: 8) == 900, "Eight stones take 900 XP")
    check(CairnScale.stones(for: 899) == 7, "Expiry removes the eighth stone")
    check(CairnScale.stones(for: -1) == 0, "Negative scores render no stones")
    for score in 0...10000 {
      let stones = CairnScale.stones(for: score)
      check(CairnScale.threshold(for: stones) <= score, "Lower boundary")
      check(CairnScale.threshold(for: stones + 1) > score, "Upper boundary")
      check((0..<1).contains(CairnScale.progress(for: score)), "Progress is bounded")
    }
    let data = Data(
      #"{"id":"p1","score":875,"delta7d":-40,"campus":null,"stops":[],"isHost":true}"#.utf8)
    let json = try JSONDecoder().decode(JSON.self, from: data)
    check(json["delta7d"].int == -40, "Negative deltas survive decoding")
    check(!json["campus"].exists, "Null is not converted to zero or empty text")
    check(json["isHost"].flag, "Booleans remain booleans")
    check(
      try JSONDecoder().decode(JSON.self, from: JSONEncoder().encode(json)) == json,
      "Contract round trip")
    let first: JSON = ["a": 1, "b": 2]
    let second: JSON = ["b": 2, "a": 1]
    check(Set([first, second]).count == 1, "Dictionary order must not affect identity")
    print("Passed \(checks) Cairn score and JSON contract checks.")
  }
}
