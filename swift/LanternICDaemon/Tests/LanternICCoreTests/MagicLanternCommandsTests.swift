import Testing
@testable import LanternICCore

@Suite("Magic Lantern command builders")
struct MagicLanternCommandsTests {
  @Test("Power commands match the TypeScript frames")
  func powerCommandsMatchTypeScriptFrames() {
    #expect(
      MagicLanternCommands.hexString(for: MagicLanternCommands.power(true)) ==
        "7e0404f00001ff00ef"
    )

    #expect(
      MagicLanternCommands.hexString(for: MagicLanternCommands.power(false)) ==
        "7e0404000000ff00ef"
    )
  }

  @Test("RGB command matches the Magic Lantern frame")
  func colorCommandMatchesMagicLanternRgbFrame() {
    #expect(
      MagicLanternCommands.hexString(
        for: MagicLanternCommands.color(red: 255, green: 120, blue: 40)
      ) == "7e070503ff782810ef"
    )
  }

  @Test("Brightness clamps to the valid percent range")
  func brightnessCommandClampsToPercentRange() {
    #expect(
      MagicLanternCommands.hexString(for: MagicLanternCommands.brightness(75)) ==
        "7e04014b01ffff00ef"
    )

    #expect(
      MagicLanternCommands.hexString(for: MagicLanternCommands.brightness(200)) ==
        "7e04016401ffff00ef"
    )

    #expect(
      MagicLanternCommands.hexString(for: MagicLanternCommands.brightness(-20)) ==
        "7e04010001ffff00ef"
    )
  }

  @Test("Effect commands match documented frames")
  func effectCommandsMatchDocumentedFrames() {
    #expect(
      MagicLanternCommands.hexString(for: MagicLanternCommands.effectSpeed(50)) ==
        "7e040232ffffff00ef"
    )

    #expect(
      MagicLanternCommands.hexString(for: MagicLanternCommands.basicEffect(7)) ==
        "7e05030706ffff00ef"
    )
  }

  @Test("Hex strings parse back to bytes")
  func hexStringParsing() throws {
    #expect(
      try MagicLanternCommands.bytes(fromHex: "7e0404000000ff00ef") ==
        MagicLanternCommands.power(false)
    )
  }
}
