import Foundation

#if canImport(CoreBluetooth)
import CoreBluetooth

public final class CoreBluetoothTransport: NSObject, BluetoothTransport, @unchecked Sendable {
  public let name = "corebluetooth"

  private let queue = DispatchQueue(label: "LanternIC.CoreBluetooth")
  private lazy var central = CBCentralManager(delegate: self, queue: queue)
  private var powerContinuations: [CheckedContinuation<Void, Error>] = []
  private var scanContinuation: CheckedContinuation<[BluetoothCandidate], Error>?
  private var scanCandidates: [String: BluetoothCandidate] = [:]
  private var scanOptions: BluetoothDiscoveryOptions?

  public override init() {
    super.init()
  }

  public func scan(options: BluetoothDiscoveryOptions) async throws -> [BluetoothCandidate] {
    try await waitForPoweredOn()

    return try await withCheckedThrowingContinuation { continuation in
      queue.async {
        if self.scanContinuation != nil {
          continuation.resume(throwing: BluetoothTransportError.failed("A CoreBluetooth scan is already running."))
          return
        }

        self.scanContinuation = continuation
        self.scanCandidates = [:]
        self.scanOptions = options

        // Scan broadly and filter in didDiscover. Many Magic Lantern strips use fff0/fff3
        // after connecting but do not reliably advertise fff0 in the BLE advertisement.
        self.central.scanForPeripherals(
          withServices: nil,
          options: [CBCentralManagerScanOptionAllowDuplicatesKey: true]
        )

        self.queue.asyncAfter(deadline: .now() + .milliseconds(max(0, options.timeoutMs))) {
          self.finishScan()
        }
      }
    }
  }

  public func write(options: BluetoothWriteOptions) async throws {
    throw BluetoothTransportError.unsupported(
      "CoreBluetooth scanning is scaffolded. GATT connect/write is the next macOS step."
    )
  }

  private func waitForPoweredOn() async throws {
    switch central.state {
    case .poweredOn:
      return
    case .unsupported:
      throw BluetoothTransportError.adapterUnavailable("This Mac does not support Bluetooth Low Energy.")
    case .unauthorized:
      throw BluetoothTransportError.adapterUnavailable("Bluetooth permission is not authorized for lanternicd.")
    default:
      try await withCheckedThrowingContinuation { continuation in
        queue.async {
          self.powerContinuations.append(continuation)
        }
      }
    }
  }

  private func finishScan() {
    central.stopScan()
    let candidates = Array(scanCandidates.values).sorted { left, right in
      (left.rssi ?? -127) > (right.rssi ?? -127)
    }
    scanCandidates = [:]
    scanOptions = nil
    let continuation = scanContinuation
    scanContinuation = nil
    continuation?.resume(returning: candidates)
  }

  private func shouldIncludeCandidate(name: String, serviceUUIDs: [String], rssi: Int) -> Bool {
    guard let options = scanOptions else {
      return true
    }

    if let minRSSI = options.minRSSI, rssi < minRSSI {
      return false
    }

    let matchesName = !name.isEmpty
      && options.namePrefixes.contains { name.lowercased().hasPrefix($0.lowercased()) }
    let matchesService = !options.serviceUUIDs.isEmpty
      && serviceUUIDs.contains { options.serviceUUIDs.contains($0.normalizedBluetoothUUID) }

    return matchesName || matchesService || (options.namePrefixes.isEmpty && options.serviceUUIDs.isEmpty)
  }
}

extension CoreBluetoothTransport: CBCentralManagerDelegate {
  public func centralManagerDidUpdateState(_ central: CBCentralManager) {
    switch central.state {
    case .poweredOn:
      let continuations = powerContinuations
      powerContinuations = []
      continuations.forEach { $0.resume() }
    case .unsupported:
      failPowerWaiters("This Mac does not support Bluetooth Low Energy.")
    case .unauthorized:
      failPowerWaiters("Bluetooth permission is not authorized for lanternicd.")
    default:
      break
    }
  }

  public func centralManager(
    _ central: CBCentralManager,
    didDiscover peripheral: CBPeripheral,
    advertisementData: [String: Any],
    rssi RSSI: NSNumber
  ) {
    let name = advertisementData[CBAdvertisementDataLocalNameKey] as? String
      ?? peripheral.name
      ?? ""
    let serviceUUIDs = (advertisementData[CBAdvertisementDataServiceUUIDsKey] as? [CBUUID] ?? [])
      .map { $0.uuidString.normalizedBluetoothUUID }
    let rssi = RSSI.intValue

    guard shouldIncludeCandidate(name: name, serviceUUIDs: serviceUUIDs, rssi: rssi) else {
      return
    }

    let id = peripheral.identifier.uuidString
    scanCandidates[id] = BluetoothCandidate(
      id: id,
      address: nil,
      name: name,
      rssi: rssi,
      serviceUUIDs: serviceUUIDs,
      connectable: advertisementData[CBAdvertisementDataIsConnectable] as? Bool,
      manufacturerData: (advertisementData[CBAdvertisementDataManufacturerDataKey] as? Data)?.map { String(format: "%02x", $0) }.joined()
    )
  }

  private func failPowerWaiters(_ message: String) {
    let continuations = powerContinuations
    powerContinuations = []
    continuations.forEach { $0.resume(throwing: BluetoothTransportError.adapterUnavailable(message)) }
  }
}
#endif
