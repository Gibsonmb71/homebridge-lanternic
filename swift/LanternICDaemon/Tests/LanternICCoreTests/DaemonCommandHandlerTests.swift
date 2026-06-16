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

  @Test("Async scan returns transport candidates")
  func asyncScanResponse() async {
    let response = await DaemonCommandHandler.handle(
      DaemonRequest(id: "scan-2", cmd: "scan", timeoutMs: 100, serviceUuids: ["fff0"]),
      transport: FakeBluetoothTransport()
    )

    #expect(response.id == "scan-2")
    #expect(response.ok == true)
    #expect(response.event == "scanResult")
    #expect(response.backend == "fake")
    #expect(response.candidates?.first?.id == "fake-device")
  }

  @Test("Async write passes frames to transport")
  func asyncWriteResponse() async {
    let response = await DaemonCommandHandler.handle(
      DaemonRequest(
        id: "write-1",
        cmd: "write",
        device: "fake-device",
        frames: ["7e0404f00001ff00ef"]
      ),
      transport: FakeBluetoothTransport()
    )

    #expect(response.id == "write-1")
    #expect(response.ok == true)
    #expect(response.event == "writeComplete")
  }
}

private struct FakeBluetoothTransport: BluetoothTransport {
  let name = "fake"

  func scan(options: BluetoothDiscoveryOptions) async throws -> [BluetoothCandidate] {
    [
      BluetoothCandidate(
        id: "fake-device",
        address: "BE:16:70:00:08:2A",
        name: "LED Strip",
        rssi: -55,
        serviceUUIDs: options.serviceUUIDs,
        connectable: true
      )
    ]
  }

  func write(options: BluetoothWriteOptions) async throws {}
}
