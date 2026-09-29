import Foundation

// The AI button's server shapes (packages/shared/src/api/plans.ts: AskBody, AskResponse, GhostChange).

/// One suggested edit. Nothing is applied until `POST /plans/:id/changes/apply`.
struct GhostChangeDTO: Decodable, Equatable, Identifiable, Sendable {
  struct StopRef: Decodable, Equatable, Sendable { var placeId: String? }
  var id: String
  /// swap, move, add_stop, remove_stop, set_mode, set_start or set_stay.
  var kind: String
  var label: String
  var fromIndex: Int?
  var toIndex: Int?
  var stop: StopRef?
  var stopId: String?
  var mode: String?
  var startAt: Date?
  var stayMin: Int?
  var legMin: Int?
  var legSource: String?
  var sources: [SourceDTO]?
}

/// A Google Maps source link; shown right under the text it supports.
struct SourceDTO: Decodable, Equatable, Hashable, Sendable {
  var title: String
  var uri: String
}

struct AskResponseDTO: Decodable, Sendable {
  var plan: PlanDTO
  /// The plan once every change is applied (nil when nothing changes): what the preview draws.
  var preview: PlanDTO?
  var message: String
  var sources: [SourceDTO]
  /// gemini or code.
  var via: String
}

/// One earlier chat turn; `role` is user or model.
struct AskTurn: Codable, Equatable, Sendable {
  var role: String
  var text: String
}

/// Exactly one of `chip` and `prompt`; `category` only with suggest_activity; `history` only with a prompt.
struct AskBody: Encodable, Equatable {
  var chip: String?
  var category: String?
  var prompt: String?
  var history: [AskTurn]?

  static func chip(_ chip: String, category: String? = nil) -> AskBody { AskBody(chip: chip, category: category) }
  static func chat(_ prompt: String, history: [AskTurn]) -> AskBody {
    AskBody(prompt: prompt, history: history.isEmpty ? nil : history)
  }
}

struct ApplyChangesBody: Encodable {
  var ids: [String]?
}
