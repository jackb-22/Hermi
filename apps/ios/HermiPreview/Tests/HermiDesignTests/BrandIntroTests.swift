import XCTest
@testable import HermiDesign

final class BrandIntroTests: XCTestCase {
  func testFirstOpenDemoAndRecoveryPolicy() {
    XCTAssertTrue(BrandIntroPolicy.shouldShow(seen: false, demo: false, fixture: false))
    XCTAssertFalse(BrandIntroPolicy.shouldShow(seen: false, demo: false, fixture: false, existingPreview: true))
    XCTAssertFalse(BrandIntroPolicy.shouldShow(seen: true, demo: false, fixture: false))
    XCTAssertTrue(BrandIntroPolicy.shouldShow(seen: true, demo: true, fixture: false))
    XCTAssertFalse(BrandIntroPolicy.shouldShow(seen: false, demo: false, fixture: true))
    XCTAssertFalse(BrandIntroPolicy.shouldShow(seen: false, demo: true, fixture: false, recoveringAction: true))
  }
  func testCrabClearsBeforeLogoAppears() {
    XCTAssertEqual(CrabIntroFrame(elapsed: 0).emergence, 0)
    XCTAssertEqual(CrabIntroFrame(elapsed: 0.8).emergence, 1, accuracy: 0.001)
    XCTAssertEqual(CrabIntroFrame(elapsed: 1.4).travel, CrabIntroFrame(elapsed: 1.6).travel)
    XCTAssertEqual(CrabIntroFrame(elapsed: 4).travel, 1)
    XCTAssertFalse(CrabIntroFrame(elapsed: 4).crabVisible)
    XCTAssertEqual(CrabIntroFrame(elapsed: 4).logoOpacity, 0)
    XCTAssertEqual(CrabIntroFrame(elapsed: 5).logoOpacity, 1)
    XCTAssertGreaterThan(CrabIntroFrame.duration, 5)
  }
  func testCautiousSecondStepAccelerationAndSteadyCrawl() {
    XCTAssertEqual(CrabIntroFrame(elapsed: 2).travel, CrabIntroFrame(elapsed: 2.1).travel)
    let early = CrabIntroFrame(elapsed: 2.4).travel - CrabIntroFrame(elapsed: 2.3).travel
    let later = CrabIntroFrame(elapsed: 2.7).travel - CrabIntroFrame(elapsed: 2.6).travel
    XCTAssertGreaterThan(later, early)
    XCTAssertEqual(CrabIntroFrame(elapsed: 3.2).travel - CrabIntroFrame(elapsed: 3.1).travel,
                   CrabIntroFrame(elapsed: 3.7).travel - CrabIntroFrame(elapsed: 3.6).travel, accuracy: 0.0001)
  }

}
