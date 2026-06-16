import XCTest
@testable import LanternICCore

final class MagicLanternCommandsTests: XCTestCase {
  func testPowerCommandsMatchTypeScriptFrames() {
    XCTAssertEqual(
      MagicLanternCommands.hexString(for: MagicLanternCommands.power(true)),
      "7e0404f00001ff00ef"
    )

    XCTAssertEqual(
      MagicLanternCommands.hexString(for: MagicLanternCommands.power(false)),
      "7e0404000000ff00ef"
    )
  }

  func testColorCommandMatchesMagicLanternRgbFrame() {
    XCTAssertEqual(
      MagicLanternCommands.hexString(
        for: MagicLanternCommands.color(red: 255, green: 120, blue: 40)
      ),
      "7e070503ff782810ef"
    )
  }

  func testBrightnessCommandClampsToPercentRange() {
    XCTAssertEqual(
      MagicLanternCommands.hexString(for: MagicLanternCommands.brightness(75)),
      "7e04014b01ffff00ef"
    )

    XCTAssertEqual(
      MagicLanternCommands.hexString(for: MagicLanternCommands.brightness(200)),
      "7e04016401ffff00ef"
    )

    XCTAssertEqual(
      MagicLanternCommands.hexString(for: MagicLanternCommands.brightness(-20)),
      "7e04010001ffff00ef"
    )
  }

  func testEffectCommandsMatchDocumentedFrames() {
    XCTAssertEqual(
      MagicLanternCommands.hexString(for: MagicLanternCommands.effectSpeed(50)),
      "7e040232ffffff00ef"
    )

    XCTAssertEqual(
      MagicLanternCommands.hexString(for: MagicLanternCommands.basicEffect(7)),
      "7e05030706ffff00ef"
    )
  }

  func testHexStringParsing() throws {
    XCTAssertEqual(
      try MagicLanternCommands.bytes(fromHex: "7e0404000000ff00ef"),
      MagicLanternCommands.power(false)
    )
  }
}
