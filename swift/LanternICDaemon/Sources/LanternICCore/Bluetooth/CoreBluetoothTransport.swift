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
  private var writeContinuation: CheckedContinuation<Void, Error>?
  private var writeOptions: BluetoothWriteOptions?
  private var writePeripheral: CBPeripheral?
  private var writeCharacteristic: CBCharacteristic?
  private var pendingWriteFrames: [Data] = []
  private var characteristicWriteType: CBCharacteristicWriteType = .withoutResponse

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
    try await waitForPoweredOn()

    return try await withCheckedThrowingContinuation { continuation in
      queue.async {
        guard self.writeContinuation == nil else {
          continuation.resume(throwing: BluetoothTransportError.failed("A CoreBluetooth write is already running."))
          return
        }

        guard let identifier = UUID(uuidString: options.device) else {
          continuation.resume(
            throwing: BluetoothTransportError.deviceNotFound(
              "CoreBluetooth on macOS requires the peripheral UUID from scan, not the BLE MAC address."
            )
          )
          return
        }

        guard let peripheral = self.central.retrievePeripherals(withIdentifiers: [identifier]).first else {
          continuation.resume(
            throwing: BluetoothTransportError.deviceNotFound(
              "Could not retrieve CoreBluetooth peripheral \(options.device). Run a scan first and use the returned id."
            )
          )
          return
        }

        self.writeContinuation = continuation
        self.writeOptions = options
        self.writePeripheral = peripheral
        self.writeCharacteristic = nil
        self.pendingWriteFrames = options.frames.map { Data($0) }
        peripheral.delegate = self

        if peripheral.state == .connected {
          self.discoverWriteService(on: peripheral, options: options)
        } else {
          self.central.connect(peripheral, options: nil)
        }
      }
    }
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

  private func discoverWriteService(on peripheral: CBPeripheral, options: BluetoothWriteOptions) {
    peripheral.discoverServices([CBUUID(string: options.serviceUUID)])
  }

  private func chooseWriteType(for characteristic: CBCharacteristic, preferredWithoutResponse: Bool) throws -> CBCharacteristicWriteType {
    if preferredWithoutResponse && characteristic.properties.contains(.writeWithoutResponse) {
      return .withoutResponse
    }

    if characteristic.properties.contains(.write) {
      return .withResponse
    }

    if characteristic.properties.contains(.writeWithoutResponse) {
      return .withoutResponse
    }

    throw BluetoothTransportError.characteristicNotFound("Characteristic does not support write or writeWithoutResponse.")
  }

  private func writeNextFrame() {
    guard let peripheral = writePeripheral, let characteristic = writeCharacteristic else {
      failWrite(BluetoothTransportError.characteristicNotFound("Write characteristic is not ready."))
      return
    }

    guard !pendingWriteFrames.isEmpty else {
      completeWrite()
      return
    }

    let frame = pendingWriteFrames.removeFirst()
    peripheral.writeValue(frame, for: characteristic, type: characteristicWriteType)

    if characteristicWriteType == .withoutResponse {
      queue.asyncAfter(deadline: .now() + .milliseconds(20)) {
        self.writeNextFrame()
      }
    }
  }

  private func completeWrite() {
    let continuation = writeContinuation
    let peripheral = writePeripheral
    clearWriteState()
    continuation?.resume()

    if let peripheral, peripheral.state == .connected {
      central.cancelPeripheralConnection(peripheral)
    }
  }

  private func failWrite(_ error: Error) {
    let continuation = writeContinuation
    let peripheral = writePeripheral
    clearWriteState()
    continuation?.resume(throwing: error)

    if let peripheral, peripheral.state == .connected {
      central.cancelPeripheralConnection(peripheral)
    }
  }

  private func clearWriteState() {
    writeContinuation = nil
    writeOptions = nil
    writePeripheral = nil
    writeCharacteristic = nil
    pendingWriteFrames = []
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

  public func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
    guard let options = writeOptions, peripheral.identifier == writePeripheral?.identifier else {
      return
    }

    discoverWriteService(on: peripheral, options: options)
  }

  public func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
    guard peripheral.identifier == writePeripheral?.identifier else {
      return
    }

    failWrite(error ?? BluetoothTransportError.failed("CoreBluetooth failed to connect to peripheral."))
  }

  public func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
    guard peripheral.identifier == writePeripheral?.identifier else {
      return
    }

    if let error {
      failWrite(error)
    }
  }

  private func failPowerWaiters(_ message: String) {
    let continuations = powerContinuations
    powerContinuations = []
    continuations.forEach { $0.resume(throwing: BluetoothTransportError.adapterUnavailable(message)) }
  }
}

extension CoreBluetoothTransport: CBPeripheralDelegate {
  public func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
    if let error {
      failWrite(error)
      return
    }

    guard let options = writeOptions else {
      failWrite(BluetoothTransportError.failed("Missing write options after service discovery."))
      return
    }

    guard let service = peripheral.services?.first(where: { service in
      service.uuid.uuidString.normalizedBluetoothUUID == options.serviceUUID.normalizedBluetoothUUID
    }) else {
      failWrite(BluetoothTransportError.serviceNotFound("Missing Magic Lantern service \(options.serviceUUID)."))
      return
    }

    peripheral.discoverCharacteristics([CBUUID(string: options.characteristicUUID)], for: service)
  }

  public func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
    if let error {
      failWrite(error)
      return
    }

    guard let options = writeOptions else {
      failWrite(BluetoothTransportError.failed("Missing write options after characteristic discovery."))
      return
    }

    guard let characteristic = service.characteristics?.first(where: { characteristic in
      characteristic.uuid.uuidString.normalizedBluetoothUUID == options.characteristicUUID.normalizedBluetoothUUID
    }) else {
      failWrite(BluetoothTransportError.characteristicNotFound("Missing Magic Lantern characteristic \(options.characteristicUUID)."))
      return
    }

    do {
      characteristicWriteType = try chooseWriteType(
        for: characteristic,
        preferredWithoutResponse: options.writeWithoutResponse
      )
      writeCharacteristic = characteristic
      writeNextFrame()
    } catch {
      failWrite(error)
    }
  }

  public func peripheral(_ peripheral: CBPeripheral, didWriteValueFor characteristic: CBCharacteristic, error: Error?) {
    if let error {
      failWrite(error)
      return
    }

    writeNextFrame()
  }
}
#endif
