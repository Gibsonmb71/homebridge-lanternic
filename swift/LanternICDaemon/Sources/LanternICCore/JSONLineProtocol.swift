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
    effectCode: Int? = nil
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
  }
}

public struct DaemonResponse: Codable, Equatable {
  public var id: String?
  public var ok: Bool
  public var event: String?
  public var message: String?
  public var frame: String?
  public var frames: [String]?

  public init(
    id: String? = nil,
    ok: Bool,
    event: String? = nil,
    message: String? = nil,
    frame: String? = nil,
    frames: [String]? = nil
  ) {
    self.id = id
    self.ok = ok
    self.event = event
    self.message = message
    self.frame = frame
    self.frames = frames
  }
}

public enum DaemonCommandHandler {
  public static func handle(_ request: DaemonRequest) -> DaemonResponse {
    switch request.cmd {
    case "ping":
      return DaemonResponse(
        id: request.id,
        ok: true,
        event: "pong",
        message: "LanternIC Swift daemon is running"
      )

    case "capabilities":
      return DaemonResponse(
        id: request.id,
        ok: true,
        event: "capabilities",
        message: "frame-builders; bluetooth-transport-pending",
        frames: [
          "buildPower",
          "buildColor",
          "buildBrightness",
          "buildEffectSpeed",
          "buildBasicEffect"
        ]
      )

    case "buildPower":
      guard let value = request.value else {
        return missingValue(request, "value")
      }

      return frameResponse(
        request,
        MagicLanternCommands.power(value)
      )

    case "buildColor":
      guard let red = request.red, let green = request.green, let blue = request.blue else {
        return missingValue(request, "red, green, and blue")
      }

      return frameResponse(
        request,
        MagicLanternCommands.color(red: red, green: green, blue: blue)
      )

    case "buildBrightness":
      guard let brightness = request.brightness else {
        return missingValue(request, "brightness")
      }

      return frameResponse(
        request,
        MagicLanternCommands.brightness(brightness)
      )

    case "buildEffectSpeed":
      guard let speed = request.speed else {
        return missingValue(request, "speed")
      }

      return frameResponse(
        request,
        MagicLanternCommands.effectSpeed(speed)
      )

    case "buildBasicEffect":
      guard let effectCode = request.effectCode else {
        return missingValue(request, "effectCode")
      }

      return frameResponse(
        request,
        MagicLanternCommands.basicEffect(effectCode)
      )

    case "scan", "write", "connect", "disconnect":
      return DaemonResponse(
        id: request.id,
        ok: false,
        event: "notImplemented",
        message: "Bluetooth transport is not implemented yet. This scaffold only builds Magic Lantern frames."
      )

    default:
      return DaemonResponse(
        id: request.id,
        ok: false,
        event: "unknownCommand",
        message: "Unknown command: \(request.cmd)"
      )
    }
  }

  private static func frameResponse(_ request: DaemonRequest, _ bytes: [UInt8]) -> DaemonResponse {
    DaemonResponse(
      id: request.id,
      ok: true,
      event: "frame",
      frame: MagicLanternCommands.hexString(for: bytes)
    )
  }

  private static func missingValue(_ request: DaemonRequest, _ name: String) -> DaemonResponse {
    DaemonResponse(
      id: request.id,
      ok: false,
      event: "invalidRequest",
      message: "Missing required field: \(name)"
    )
  }
}
