import Foundation

#if os(Linux)
public struct BlueZTransport: BluetoothTransport {
  public let name = "bluez-busctl"

  public init() {}

  public func scan(options: BluetoothDiscoveryOptions) async throws -> [BluetoothCandidate] {
    let seconds = max(1, Int(ceil(Double(options.timeoutMs) / 1000.0)))
    let output = try Command.run("bluetoothctl", ["--timeout", String(seconds), "scan", "on"])
    return parse(output: output, options: options)
  }

  public func write(options: BluetoothWriteOptions) async throws {
    let devicePath = path(forDevice: options.device)
    _ = try? Command.run("busctl", ["call", "org.bluez", devicePath, "org.bluez.Device1", "Connect"])
    try waitForServices(devicePath: devicePath)
    let characteristicPath = try findCharacteristicPath(devicePath: devicePath, uuid: options.characteristicUUID)

    for frame in options.frames {
      try write(frame: frame, characteristicPath: characteristicPath, withoutResponse: options.writeWithoutResponse)
    }

    _ = try? Command.run("busctl", ["call", "org.bluez", devicePath, "org.bluez.Device1", "Disconnect"])
  }

  private func waitForServices(devicePath: String) throws {
    for _ in 0..<30 {
      let output = try Command.run("busctl", ["get-property", "org.bluez", devicePath, "org.bluez.Device1", "ServicesResolved"])
      if output.contains("true") {
        return
      }
      Thread.sleep(forTimeInterval: 0.2)
    }

    throw BluetoothTransportError.failed("Timed out waiting for BlueZ services to resolve.")
  }

  private func findCharacteristicPath(devicePath: String, uuid: String) throws -> String {
    let tree = try Command.run("busctl", ["tree", "org.bluez"])
    let target = uuid.normalizedBluetoothUUID

    for line in tree.components(separatedBy: .newlines) where line.contains(devicePath) && line.contains("/char") {
      let path = line.split(separator: " ").last.map(String.init) ?? line.trimmingCharacters(in: .whitespaces)
      let props = try? Command.run("busctl", ["get-property", "org.bluez", path, "org.bluez.GattCharacteristic1", "UUID"])
      if props?.normalizedBluetoothUUID.contains(target) == true {
        return path
      }
    }

    throw BluetoothTransportError.characteristicNotFound("Could not find BlueZ characteristic \(uuid).")
  }

  private func write(frame: [UInt8], characteristicPath: String, withoutResponse: Bool) throws {
    let type = withoutResponse ? "command" : "request"
    var args = [
      "call",
      "org.bluez",
      characteristicPath,
      "org.bluez.GattCharacteristic1",
      "WriteValue",
      "aya{sv}",
      String(frame.count),
    ]
    args += frame.map { String($0) }
    args += ["1", "type", "s", type]
    _ = try Command.run("busctl", args)
  }

  private func path(forDevice address: String) -> String {
    "/org/bluez/hci0/dev_" + address.uppercased().replacingOccurrences(of: ":", with: "_")
  }

  private func parse(output: String, options: BluetoothDiscoveryOptions) -> [BluetoothCandidate] {
    var candidates: [String: BluetoothCandidate] = [:]

    for rawLine in output.components(separatedBy: .newlines) {
      let line = rawLine.trimmingCharacters(in: .whitespacesAndNewlines)

      guard let parsed = parseDevice(line) else {
        continue
      }

      var candidate = candidates[parsed.address] ?? BluetoothCandidate(
        id: parsed.address,
        address: parsed.address,
        name: parsed.name,
        serviceUUIDs: [],
        connectable: true
      )

      if !parsed.name.isEmpty {
        candidate.name = parsed.name
      }

      if let rssi = parsed.rssi {
        candidate.rssi = rssi
      }

      candidates[parsed.address] = candidate
    }

    return candidates.values
      .filter { matches($0, options: options) }
      .sorted { ($0.rssi ?? -127) > ($1.rssi ?? -127) }
  }

  private func parseDevice(_ line: String) -> (address: String, name: String, rssi: Int?)? {
    guard let range = line.range(of: "Device ") else {
      return nil
    }

    let tail = String(line[range.upperBound...])
    let parts = tail.split(separator: " ").map(String.init)

    guard let address = parts.first, address.split(separator: ":").count == 6 else {
      return nil
    }

    if line.contains("RSSI:"), let rssi = parts.last.flatMap(Int.init) {
      return (address.uppercased(), "", rssi)
    }

    let name = parts.dropFirst().joined(separator: " ")
    return (address.uppercased(), name, nil)
  }

  private func matches(_ candidate: BluetoothCandidate, options: BluetoothDiscoveryOptions) -> Bool {
    if let minRSSI = options.minRSSI, let rssi = candidate.rssi, rssi < minRSSI {
      return false
    }

    let matchesName = !candidate.name.isEmpty
      && options.namePrefixes.contains { candidate.name.lowercased().hasPrefix($0.lowercased()) }
    let matchesService = !options.serviceUUIDs.isEmpty
      && candidate.serviceUUIDs.contains { options.serviceUUIDs.contains($0.normalizedBluetoothUUID) }

    return matchesName || matchesService || (options.namePrefixes.isEmpty && options.serviceUUIDs.isEmpty)
  }
}

private enum Command {
  static func run(_ executable: String, _ arguments: [String]) throws -> String {
    let process = Process()
    let output = Pipe()
    let errors = Pipe()

    process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
    process.arguments = [executable] + arguments
    process.standardOutput = output
    process.standardError = errors

    do {
      try process.run()
    } catch {
      throw BluetoothTransportError.adapterUnavailable("Could not run \(executable).")
    }

    process.waitUntilExit()

    let stdout = String(data: output.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
    let stderr = String(data: errors.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
    let combined = stdout + stderr

    if process.terminationStatus != 0 {
      throw BluetoothTransportError.failed(combined)
    }

    return combined
  }
}
#endif
