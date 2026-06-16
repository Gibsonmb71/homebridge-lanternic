import Foundation

public enum MagicLanternHexError: Error, Equatable {
  case oddLength
  case invalidByte(String)
}

public enum MagicLanternCommands {
  public static let defaultServiceUUID = "fff0"
  public static let defaultCharacteristicUUID = "fff3"

  public static func power(_ isOn: Bool) -> [UInt8] {
    isOn
      ? [0x7e, 0x04, 0x04, 0xf0, 0x00, 0x01, 0xff, 0x00, 0xef]
      : [0x7e, 0x04, 0x04, 0x00, 0x00, 0x00, 0xff, 0x00, 0xef]
  }

  public static func color(red: Int, green: Int, blue: Int) -> [UInt8] {
    frame([0x7e, 0x07, 0x05, 0x03, red, green, blue, 0x10, 0xef])
  }

  public static func brightness(_ brightness: Int) -> [UInt8] {
    frame([0x7e, 0x04, 0x01, Int(clampPercent(brightness)), 0x01, 0xff, 0xff, 0x00, 0xef])
  }

  public static func effectSpeed(_ speed: Int) -> [UInt8] {
    frame([0x7e, 0x04, 0x02, Int(clampPercent(speed)), 0xff, 0xff, 0xff, 0x00, 0xef])
  }

  public static func basicEffect(_ effectCode: Int) -> [UInt8] {
    frame([0x7e, 0x05, 0x03, effectCode, 0x06, 0xff, 0xff, 0x00, 0xef])
  }

  public static func rgbBlackOff() -> [UInt8] {
    color(red: 0, green: 0, blue: 0)
  }

  public static func clampByte(_ value: Int) -> UInt8 {
    UInt8(max(0, min(255, value)))
  }

  public static func clampPercent(_ value: Int) -> UInt8 {
    UInt8(max(0, min(100, value)))
  }

  public static func hexString(for bytes: [UInt8]) -> String {
    bytes.map { String(format: "%02x", $0) }.joined()
  }

  public static func bytes(fromHex hex: String) throws -> [UInt8] {
    let cleaned = hex.trimmingCharacters(in: .whitespacesAndNewlines)
    guard cleaned.count.isMultiple(of: 2) else {
      throw MagicLanternHexError.oddLength
    }

    var bytes: [UInt8] = []
    var index = cleaned.startIndex

    while index < cleaned.endIndex {
      let nextIndex = cleaned.index(index, offsetBy: 2)
      let byteString = String(cleaned[index..<nextIndex])

      guard let byte = UInt8(byteString, radix: 16) else {
        throw MagicLanternHexError.invalidByte(byteString)
      }

      bytes.append(byte)
      index = nextIndex
    }

    return bytes
  }

  private static func frame(_ bytes: [Int]) -> [UInt8] {
    bytes.map(clampByte)
  }
}
