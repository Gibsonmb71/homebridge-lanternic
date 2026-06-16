import Foundation

public struct DaemonRequest: Codable, Equatable {
  public var id: String?
  public var cmd: String
  public var device: String?
  public var frame: String?
  public var frames: [String]?
  public var value: Bool?
  public var red: Int?
  public var green: Int?
  public var blue: Int?
  public var brightness: Int?
  public var speed: Int?
  public var effectCode: Int?
  public var timeoutMs: Int?
  public var namePrefixes: [String]?
  public var serviceUuids: [String]?
  public var minRssi: Int?
  public var serviceUuid: String?
  public var characteristicUuid: String?
  public var writeWithoutResponse: Bool?

  public init(
    id: String? = nil,
    cmd: String,
    device: String? = nil,
    frame: String? = nil,
    frames: [String]? = nil,
    value: Bool? = nil,
    red: Int? = nil,
    green: Int? = nil,
    blue: Int? = nil,
    brightness: Int? = nil,
    speed: Int? = nil,
    effectCode: Int? = nil,
    timeoutMs: Int? = nil,
    namePrefixes: [String]? = nil,
    serviceUuids: [String]? = nil,
    minRssi: Int? = nil,
    serviceUuid: String? = nil,
    characteristicUuid: String? = nil,
    writeWithoutResponse: Bool? = nil
  ) {
    self.id = id
    self.cmd = cmd
    self.device = device
    self.frame = frame
    self.frames = frames
    self.value = value
    self.red = red
    self.green = green
    self.blue = blue
    self.brightness = brightness
    self.speed = speed
    self.effectCode = effectCode
    self.timeoutMs = timeoutMs
    self.namePrefixes = namePrefixes
    self.serviceUuids = serviceUuids
    self.minRssi = minRssi
    self.serviceUuid = serviceUuid
    self.characteristicUuid = characteristicUuid
    self.writeWithoutResponse = writeWithoutResponse
  }
}

public struct DaemonResponse: Codable, Equatable {
  public var id: String?
  public var ok: Bool
  public var event: String?
  public var message: String?
  public var frame: String?
  public var frames: [String]?
  public var candidates: [BluetoothCandidate]?
  public var backend: String?

  public init(
    id: String? = nil,
    ok: Bool,
    event: String? = nil,
    message: String? = nil,
    frame: String? = nil,
    frames: [String]? = nil,
    candidates: [BluetoothCandidate]? = nil,
    backend: String? = nil
  ) {
    self.id = id
    self.ok = ok
    self.event = event
    self.message = message
    self.frame = frame
    self.frames = frames
    self.candidates = candidates
    self.backend = backend
  }
}

public enum DaemonCommandHandler {
  public static func handle(_ request: DaemonRequest) -> DaemonResponse {
    switch request.cmd {
    case "ping":
      return DaemonResponse(id: request.id, ok: true, event: "pong", message: "LanternIC Swift daemon is running")

    case "capabilities":
      return DaemonResponse(
        id: request.id,
        ok: true,
        event: "capabilities",
        message: "frame-builders; native-bluetooth-transport",
        frames: [
          "buildPower",
          "buildColor",
          "buildBrightness",
          "buildEffectSpeed",
          "buildBasicEffect",
          "scan",
          "write"
        ]
      )

    case "buildPower":
      guard let value = request.value else {
        return missingValue(request, "value")
      }
      return frameResponse(request, MagicLanternCommands.power(value))

    case "buildColor":
      guard let red = request.red, let green = request.green, let blue = request.blue else {
        return missingValue(request, "red, green, and blue")
      }
      return frameResponse(request, MagicLanternCommands.color(red: red, green: green, blue: blue))

    case "buildBrightness":
      guard let brightness = request.brightness else {
        return missingValue(request, "brightness")
      }
      return frameResponse(request, MagicLanternCommands.brightness(brightness))

    case "buildEffectSpeed":
      guard let speed = request.speed else {
        return missingValue(request, "speed")
      }
      return frameResponse(request, MagicLanternCommands.effectSpeed(speed))

    case "buildBasicEffect":
      guard let effectCode = request.effectCode else {
        return missingValue(request, "effectCode")
      }
      return frameResponse(request, MagicLanternCommands.basicEffect(effectCode))

    case "scan", "write", "connect", "disconnect":
      return blockingBluetoothResponse(request)

    default:
      return DaemonResponse(id: request.id, ok: false, event: "unknownCommand", message: "Unknown command: \(request.cmd)")
    }
  }

  public static func handle(_ request: DaemonRequest, transport: any BluetoothTransport) async -> DaemonResponse {
    switch request.cmd {
    case "scan":
      do {
        let candidates = try await transport.scan(
          options: BluetoothDiscoveryOptions(
            timeoutMs: request.timeoutMs ?? 15_000,
            namePrefixes: request.namePrefixes ?? [],
            serviceUUIDs: request.serviceUuids ?? [],
            minRSSI: request.minRssi
          )
        )
        return DaemonResponse(id: request.id, ok: true, event: "scanResult", candidates: candidates, backend: transport.name)
      } catch {
        return errorResponse(request, event: "scanFailed", error: error, backend: transport.name)
      }

    case "write":
      guard let device = request.device, !device.isEmpty else {
        return missingValue(request, "device")
      }

      let frameStrings = request.frames ?? request.frame.map { [$0] } ?? []

      guard !frameStrings.isEmpty else {
        return missingValue(request, "frame or frames")
      }

      do {
        let frameBytes = try frameStrings.map { try MagicLanternCommands.bytes(fromHex: $0) }
        try await transport.write(
          options: BluetoothWriteOptions(
            device: device,
            serviceUUID: request.serviceUuid ?? MagicLanternCommands.defaultServiceUUID,
            characteristicUUID: request.characteristicUuid ?? MagicLanternCommands.defaultCharacteristicUUID,
            frames: frameBytes,
            writeWithoutResponse: request.writeWithoutResponse ?? true
          )
        )
        return DaemonResponse(id: request.id, ok: true, event: "writeComplete", backend: transport.name)
      } catch {
        return errorResponse(request, event: "writeFailed", error: error, backend: transport.name)
      }

    default:
      return handle(request)
    }
  }

  private static func blockingBluetoothResponse(_ request: DaemonRequest) -> DaemonResponse {
    let transport = BluetoothTransportFactory.makeDefaultTransport()
    let semaphore = DispatchSemaphore(value: 0)
    var response: DaemonResponse?

    Task {
      response = await handle(request, transport: transport)
      semaphore.signal()
    }

    semaphore.wait()
    return response ?? DaemonResponse(id: request.id, ok: false, event: "transportFailed", message: "Bluetooth transport did not return a response", backend: transport.name)
  }

  private static func frameResponse(_ request: DaemonRequest, _ bytes: [UInt8]) -> DaemonResponse {
    DaemonResponse(id: request.id, ok: true, event: "frame", frame: MagicLanternCommands.hexString(for: bytes))
  }

  private static func missingValue(_ request: DaemonRequest, _ name: String) -> DaemonResponse {
    DaemonResponse(id: request.id, ok: false, event: "invalidRequest", message: "Missing required field: \(name)")
  }

  private static func errorResponse(_ request: DaemonRequest, event: String, error: Error, backend: String) -> DaemonResponse {
    DaemonResponse(id: request.id, ok: false, event: event, message: String(describing: error), backend: backend)
  }
}
