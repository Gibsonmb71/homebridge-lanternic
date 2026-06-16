import Foundation

public struct BluetoothDiscoveryOptions: Sendable, Equatable {
  public var timeoutMs: Int
  public var namePrefixes: [String]
  public var serviceUUIDs: [String]
  public var minRSSI: Int?

  public init(timeoutMs: Int, namePrefixes: [String] = [], serviceUUIDs: [String] = [], minRSSI: Int? = nil) {
    self.timeoutMs = timeoutMs
    self.namePrefixes = namePrefixes
    self.serviceUUIDs = serviceUUIDs.map { $0.normalizedBluetoothUUID }
    self.minRSSI = minRSSI
  }
}

public struct BluetoothWriteOptions: Sendable, Equatable {
  public var device: String
  public var serviceUUID: String
  public var characteristicUUID: String
  public var frames: [[UInt8]]
  public var writeWithoutResponse: Bool

  public init(device: String, serviceUUID: String = MagicLanternCommands.defaultServiceUUID, characteristicUUID: String = MagicLanternCommands.defaultCharacteristicUUID, frames: [[UInt8]], writeWithoutResponse: Bool = true) {
    self.device = device
    self.serviceUUID = serviceUUID.normalizedBluetoothUUID
    self.characteristicUUID = characteristicUUID.normalizedBluetoothUUID
    self.frames = frames
    self.writeWithoutResponse = writeWithoutResponse
  }
}

public struct BluetoothCandidate: Codable, Equatable, Sendable {
  public var id: String
  public var address: String?
  public var name: String
  public var rssi: Int?
  public var serviceUUIDs: [String]
  public var connectable: Bool?
  public var manufacturerData: String?

  public init(id: String, address: String? = nil, name: String, rssi: Int? = nil, serviceUUIDs: [String] = [], connectable: Bool? = nil, manufacturerData: String? = nil) {
    self.id = id
    self.address = address
    self.name = name
    self.rssi = rssi
    self.serviceUUIDs = serviceUUIDs
    self.connectable = connectable
    self.manufacturerData = manufacturerData
  }
}

public protocol BluetoothTransport: Sendable {
  var name: String { get }

  func scan(options: BluetoothDiscoveryOptions) async throws -> [BluetoothCandidate]
  func write(options: BluetoothWriteOptions) async throws
}

public enum BluetoothTransportError: Error, Equatable, CustomStringConvertible {
  case unsupported(String)
  case adapterUnavailable(String)
  case deviceNotFound(String)
  case serviceNotFound(String)
  case characteristicNotFound(String)
  case failed(String)

  public var description: String {
    switch self {
    case .unsupported(let message), .adapterUnavailable(let message), .deviceNotFound(let message), .serviceNotFound(let message), .characteristicNotFound(let message), .failed(let message):
      return message
    }
  }
}

public extension String {
  var normalizedBluetoothUUID: String {
    lowercased().replacingOccurrences(of: "-", with: "")
  }

  var normalizedBluetoothIdentifier: String {
    lowercased()
      .replacingOccurrences(of: ":", with: "")
      .replacingOccurrences(of: "-", with: "")
  }
}
