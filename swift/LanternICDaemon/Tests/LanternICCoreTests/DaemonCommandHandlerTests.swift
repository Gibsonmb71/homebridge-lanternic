import Testing
@testable import LanternICCore

@Suite("Daemon command handler")
struct DaemonCommandHandlerTests {
  @Test("Ping returns pong")
  func pingResponse() {
    let response = DaemonCommandHandler.handle(DaemonRequest(id: "1", cmd: "ping"))

    #expect(response.id == "1")
    #expect(response.ok == true)
    #expect(response.event == "pong")
  }

  @Test("Build color returns expected frame")
  func buildColorResponse() {
    let response = DaemonCommandHandler.handle(
      DaemonRequest(
        id: "color-1",
        cmd: "buildColor",
        red: 255,
        green: 120,
        blue: 40
      )
    )

    #expect(response.id == "color-1")
    #expect(response.ok == true)
    #expect(response.event == "frame")
    #expect(response.frame == "7e070503ff782810ef")
  }

  @Test("Bluetooth commands are placeholders")
  func bluetoothCommandsArePlaceholders() {
    let response = DaemonCommandHandler.handle(DaemonRequest(id: "scan-1", cmd: "scan"))

    #expect(response.id == "scan-1")
    #expect(response.ok == false)
    #expect(response.event == "notImplemented")
  }
}
