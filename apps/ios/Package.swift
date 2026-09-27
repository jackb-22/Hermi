// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "Cairn", platforms: [.iOS(.v17), .macOS(.v14)],
  products: [
    .library(name: "CairnKit", targets: ["CairnKit"]),
    .executable(name: "CairnPreview", targets: ["CairnPreview"]),
    .executable(name: "CairnChecks", targets: ["CairnChecks"]),
  ],
  targets: [
    .target(name: "CairnKit", resources: [.process("Resources")]),
    .executableTarget(name: "CairnPreview", dependencies: ["CairnKit"]),
    .executableTarget(name: "CairnChecks", dependencies: ["CairnKit"], path: "Checks"),
    .testTarget(name: "CairnKitTests", dependencies: ["CairnKit"]),
  ], swiftLanguageModes: [.v5]
)
