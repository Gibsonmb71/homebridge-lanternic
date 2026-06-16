import XCTest
@testable import LanternICCore

final class DaemonCommandHandlerTests: XCTestCase {
  func testPingResponse() {
    let response = DaemonCommandHandler.handle(DaemonRequest(id: "1", cmd: "ping"))

    XCTAssertEqual(response.id, "1")
    XCTAssertTrue(response.ok)
    XCTAssertEqual(response.event, "pong")
  }

  func testBuildColorResponse() {
    let response = DaemonCommandHandler.handle(
      DaemonRequest(
        id: "color-1",
        cmd: "buildColor",
        red: 255,
        green: 120,
        blue: 40
      )
    )

    XCTAssertEqual(response.id, "color-1")
    XCTAssertTrue(response.ok)
    XCTAssertEqual(response.event, "frame")
    XCTAssertEqual(response.frame, "7e070503ff782810ef")
  }

  func testBluetoothCommandsArePlaceholders() {
    let response = DaemonCommandHandler.handle(DaemonRequest(id: "scan-1", cmd: "scan"))

    XCTAssertEqual(response.id, "scan-1")
    XCTAssertFalse(response.ok)
    XCTAssertEqual(response.event, "notImplemented")
  }
}
