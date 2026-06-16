import Foundation

public enum BluetoothTransportFactory {
  public static func makeDefaultTransport() -> any BluetoothTransport {
    #if canImport(CoreBluetooth)
    return CoreBluetoothTransport()
    #elseif os(Linux)
    return BlueZTransport()
    #else
    return UnsupportedBluetoothTransport(reason: "No native Bluetooth transport is available for this platform.")
    #endif
  }
}

public struct UnsupportedBluetoothTransport: BluetoothTransport {
  public let name: String
  private let reason: String

  public init(reason: String) {
    self.name = "unsupported"
    self.reason = reason
  }

  public func scan(options: BluetoothDiscoveryOptions) async throws -> [BluetoothCandidate] {
    throw BluetoothTransportError.unsupported(reason)
  }

  public func write(options: BluetoothWriteOptions) async throws {
    throw BluetoothTransportError.unsupported(reason)
  }
}
