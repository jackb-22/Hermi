import Foundation

// Server shapes (packages/shared/src/api). Only fields the app reads; anything nullable is optional.

struct MeDTO: Decodable, Equatable, Sendable {
  var id: String
  var name: String
  var username: String
  var photoUrl: String?
  var verified: Bool?
  var campus: String?
  var is21: Bool?
  var ghostMode: Bool?
  var openToPlans: Bool?
}

struct AuthResponseDTO: Decodable, Sendable {
  var token: String
  var isNew: Bool?
  var user: MeDTO
}

struct DevAuthBody: Encodable {
  var username: String
}
