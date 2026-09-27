import Foundation

enum PreviewData {
  static let places: [JSON] = [
    place("p1", "Hungarian Pastry Shop", "food", 40.8030, -73.9635, 94, 128),
    place("p2", "Riverside Park", "nature", 40.8075, -73.9700, 98, 342),
    place("p3", "Cathedral of St. John", "culture", 40.8038, -73.9619, 91, 207),
    place("p4", "Book Culture", "shopping", 40.8067, -73.9657, 96, 186),
    place("p5", "Morningside Park", "nature", 40.8057, -73.9583, 95, 264),
    place("p6", "Miller Theatre", "music", 40.8083, -73.9636, 93, 98),
  ]
  static func place(
    _ id: String, _ name: String, _ cat: String, _ lat: Double, _ lng: Double, _ pct: Int,
    _ been: Int
  ) -> JSON {
    [
      "id": .string(id), "name": .string(name), "category": .string(cat),
      "loc": ["lat": .number(lat), "lng": .number(lng)], "tags": [], "been": .number(Double(been)),
      "wouldGoAgainPct": .number(Double(pct)), "address": "Morningside Heights, New York",
      "walkMin": 5, "hereNow": 4, "friendsBeen": 3, "going": 7, "hours": .null,
      "reviewSummary": .null,
    ]
  }
  static let me: JSON = [
    "id": "preview-me", "name": "Alex Chen", "username": "alexoutside", "verified": true,
    "campus": "Columbia", "studentStatus": "current", "ghostMode": false, "openToPlans": true,
    "tasteDone": true, "is21": false,
  ]
  static var score: JSON {
    let values = [
      15, 0, 32, 44, 0, 10, 86, 25, 0, 52, 18, 0, 60, 34, 0, 25, 12, 40, 0, 56, 22, 35, 0, 48, 16,
      0, 30, 75, 0, 45,
    ]
    return [
      "score": 875, "delta7d": 145,
      "sparkline": .array(
        values.enumerated().map {
          ["day": .string("2026-09-\($0.offset+1)"), "xp": .number(Double($0.element))]
        }), "expiring": ["xp": 40, "by": "2026-09-27"],
      "ranks": [
        "friends": ["rank": 3, "of": 12], "campus": ["rank": 41, "of": 280, "campus": "Columbia"],
      ],
    ]
  }
  static var profile: JSON {
    [
      "user": me, "isMe": true, "isFriend": false, "friendCount": 12, "score": score,
      "counts": ["placesVisited": 28, "posts": 0, "plans": 4],
    ]
  }
  static var plan: JSON { makePlan([places[0], places[2], places[1]]) }
  static func makePlan(_ chosen: [JSON]) -> JSON {
    let now = Date()
    let stops: [JSON] = chosen.enumerated().map { i, p in
      [
        "id": .string("preview-stop-\(i)"), "index": .number(Double(i + 1)), "place": p,
        "label": p["name"], "stayMin": 30, "staySource": "default", "legMode": "walk",
        "legMin": .number(Double(i == 0 ? 0 : 6)),
        "arriveAt": iso(now.addingTimeInterval(Double(i) * 2160)),
        "departAt": iso(now.addingTimeInterval(Double(i) * 2160 + 1800)), "done": false,
      ]
    }
    return [
      "id": "preview-plan", "name": "A little afternoon out", "hostId": "preview-me",
      "isHost": true, "startAt": iso(now), "mode": "walk", "visibility": "just_me",
      "status": "draft", "stops": .array(stops), "members": [],
      "totals": ["km": 1.8, "footKm": 1.8, "legMin": 12, "xpPreview": 115], "issues": [],
      "ghostChanges": [], "shareUrl": "",
    ]
  }
}
