import XCTest
@testable import HermiDesign

final class TextHermiTests: XCTestCase {
  func testServerShapesDecode() throws {
    let status = try HermiAPI.decoder.decode(ImessageStatusDTO.self, from: Data(#"{"linked":true,"handles":["+1••••••0142"],"agentAddress":"+15550001234"}"#.utf8))
    XCTAssertEqual(status, ImessageStatusDTO(linked: true, handles: ["+1••••••0142"], agentAddress: "+15550001234"))
    let code = try HermiAPI.decoder.decode(ImessageLinkCodeDTO.self, from: Data(#"{"code":"AB3DEF","expiresAt":"2026-10-01T14:10:00.000Z","agentAddress":"+15550001234","smsUrl":"sms:+15550001234&body=link%20AB3DEF"}"#.utf8))
    XCTAssertEqual(URL(string: try XCTUnwrap(code.smsUrl))?.absoluteString, "sms:+15550001234&body=link%20AB3DEF")
  }

  @MainActor
  func testMessagesOpensToTheAgent() {
    let model = TextHermi()
    model.showFixture(ImessageStatusDTO(linked: true, handles: [], agentAddress: "+15550001234"))
    XCTAssertEqual(model.messagesURL?.absoluteString, "sms:+15550001234")
  }
}
