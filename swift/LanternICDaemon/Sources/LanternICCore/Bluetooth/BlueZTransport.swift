import Foundation

#if os(Linux)
public struct BlueZTransport: BluetoothTransport {
  public let name = "bluez-dbus"

  public init() {}

  public func scan(options: BluetoothDiscoveryOptions) async throws -> [BluetoothCandidate] {
    throw BluetoothTransportError.unsupported(
      "BlueZ transport is scaffolded but does not talk to D-Bus yet."
    )
  }

  public func write(options: BluetoothWriteOptions) async throws {
    throw BluetoothTransportError.unsupported(
      "BlueZ transport is scaffolded but does not write GATT characteristics yet."
    )
  }
}
#endif
