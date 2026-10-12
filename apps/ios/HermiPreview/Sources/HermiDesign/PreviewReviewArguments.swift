import Foundation

/// Command-line review scenarios are local-only fixtures. Keep value-bearing flags
/// such as `--hermi-saved-review=empty` inside the same isolation boundary.
enum PreviewReviewArguments {
  static func isFixture(_ arguments: [String]) -> Bool {
    arguments.contains { argument in
      let flag = argument.split(separator: "=", maxSplits: 1).first.map(String.init) ?? argument
      return flag.hasPrefix("--hermi-") && flag.hasSuffix("-review")
    }
  }
}
