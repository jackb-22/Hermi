import XCTest
@testable import HermiDesign

final class PreviewReviewArgumentsTests: XCTestCase {
  func testValueBearingReviewScenariosStayInsideFixtureMode() {
    for scenario in ["--hermi-saved-review=empty", "--hermi-saved-review=populated",
                     "--hermi-plan-review=one", "--hermi-type-review=long",
                     "--hermi-place-review=long"] {
      XCTAssertTrue(PreviewReviewArguments.isFixture([scenario]), scenario)
    }
    XCTAssertTrue(PreviewReviewArguments.isFixture(["--hermi-plan-review", "--hermi-ai-review=asking"]))
  }

  func testDemoAndLayoutFlagsDoNotBecomeReviewFixtures() {
    XCTAssertFalse(PreviewReviewArguments.isFixture(["--hermi-demo"]))
    XCTAssertFalse(PreviewReviewArguments.isFixture(["--hermi-review-compact"]))
    XCTAssertFalse(PreviewReviewArguments.isFixture(["--other-app-review=empty"]))
  }
}
