// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "HermiPreview",
  platforms: [.iOS(.v17), .macOS(.v14)],
  products: [
    .library(name: "HermiDesign", targets: ["HermiDesign"]),
    .executable(name: "HermiDesktop", targets: ["HermiDesktop"]),
  ],
  targets: [
    .target(name: "HermiDesign"),
    .executableTarget(name: "HermiDesktop", dependencies: ["HermiDesign"]),
    .testTarget(name: "HermiDesignTests", dependencies: ["HermiDesign"]),
  ],
  swiftLanguageModes: [.v5]
)
