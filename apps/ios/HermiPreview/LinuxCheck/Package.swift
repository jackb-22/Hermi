// swift-tools-version: 6.0
// Linux-only mirror of the Foundation-only part of HermiDesign (DTOs, API client, the AI assistant's logic), so
// those compile and test on Arch without a Mac. Sources and tests are symlinks into ../Sources and ../Tests;
// Shims.swift stands in for the few app types those files mention that live in SwiftUI/CoreLocation files.
//   swift test --package-path apps/ios/HermiPreview/LinuxCheck      (scripts/linux-swift.sh wraps it)
// macOS CI builds and tests the real package; this is the fast local loop.
import PackageDescription

let package = Package(
  name: "HermiLinuxCheck",
  targets: [
    .target(name: "HermiDesign", resources: [.copy("Resources")]),
    .testTarget(name: "HermiDesignTests", dependencies: ["HermiDesign"]),
  ],
  swiftLanguageModes: [.v5]
)
