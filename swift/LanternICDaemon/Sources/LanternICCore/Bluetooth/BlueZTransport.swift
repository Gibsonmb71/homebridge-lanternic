import Foundation

#if os(Linux)
public struct BlueZTransport: BluetoothTransport {
  public let name = "bluez-bluetoothctl"

  public init() {}

  public func scan(options: BluetoothDiscoveryOptions) async throws -> [BluetoothCandidate] {
    let seconds = max(1, Int(ceil(Double(options.timeoutMs) / 1000.0)))
    let output = try Bluetoothctl.run(["--timeout", String(seconds), "scan", "on"])
    return parse(output: output, options: options)
  }

  public func write(options: BluetoothWriteOptions) async throws {
    throw BluetoothTransportError.unsupported("BlueZ discovery is implemented; GATT write is next.")
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

private enum Bluetoothctl {
  static func run(_ arguments: [String]) throws -> String {
    let process = Process()
    let output = Pipe()
    let errors = Pipe()

    process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
    process.arguments = ["bluetoothctl"] + arguments
    process.standardOutput = output
    process.standardError = errors

    do {
      try process.run()
    } catch {
      throw BluetoothTransportError.adapterUnavailable("Could not run bluetoothctl. Install BlueZ first.")
    }

    process.waitUntilExit()

    let stdout = String(data: output.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
    let stderr = String(data: errors.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""

    if process.terminationStatus != 0 {
      throw BluetoothTransportError.failed(stderr.isEmpty ? stdout : stderr)
    }

    return stdout
  }
}
#endif
