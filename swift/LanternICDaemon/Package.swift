// swift-tools-version: 5.10
import PackageDescription

let package = Package(
  name: "LanternICDaemon",
  platforms: [
    .macOS(.v13)
  ],
  products: [
    .executable(name: "lanternicd", targets: ["LanternICDaemon"])
  ],
  targets: [
    .target(name: "LanternICCore"),
    .executableTarget(
      name: "LanternICDaemon",
      dependencies: ["LanternICCore"]
    ),
    .testTarget(
      name: "LanternICCoreTests",
      dependencies: ["LanternICCore"]
    )
  ]
)
