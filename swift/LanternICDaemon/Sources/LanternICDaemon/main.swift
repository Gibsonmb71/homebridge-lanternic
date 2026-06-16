import Foundation
import LanternICCore

@main
struct LanternICDaemon {
  static func main() {
    let arguments = Array(CommandLine.arguments.dropFirst())

    if arguments.contains("--help") || arguments.contains("-h") {
      printHelp()
      return
    }

    if let onceIndex = arguments.firstIndex(of: "--once") {
      let jsonParts = arguments.dropFirst(onceIndex + 1)
      guard !jsonParts.isEmpty else {
        writeResponse(DaemonResponse(ok: false, event: "invalidArguments", message: "Missing JSON after --once"))
        return
      }

      handleLine(jsonParts.joined(separator: " "))
      return
    }

    writeResponse(DaemonResponse(ok: true, event: "ready", message: "LanternIC Swift daemon ready"))

    while let line = readLine() {
      handleLine(line)
    }
  }

  private static func handleLine(_ line: String) {
    let trimmedLine = line.trimmingCharacters(in: .whitespacesAndNewlines)

    guard !trimmedLine.isEmpty else {
      return
    }

    guard let data = trimmedLine.data(using: .utf8) else {
      writeResponse(DaemonResponse(ok: false, event: "invalidInput", message: "Input is not valid UTF-8"))
      return
    }

    do {
      let request = try JSONDecoder().decode(DaemonRequest.self, from: data)
      writeResponse(DaemonCommandHandler.handle(request))
    } catch {
      writeResponse(DaemonResponse(ok: false, event: "invalidJson", message: String(describing: error)))
    }
  }

  private static func writeResponse(_ response: DaemonResponse) {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]

    do {
      let data = try encoder.encode(response)
      writeLine(data)
    } catch {
      writeLine(Data(#"{"ok":false,"event":"encodeFailed","message":"Could not encode daemon response"}"#.utf8))
    }
  }

  private static func writeLine(_ data: Data) {
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
  }

  private static func printHelp() {
    print("""
    lanternicd - experimental Swift daemon for homebridge-lanternic

    Usage:
      lanternicd
      lanternicd --once '{"cmd":"ping"}'
      echo '{"cmd":"buildPower","value":true}' | lanternicd

    Current commands:
      ping
      capabilities
      buildPower        {"cmd":"buildPower","value":true}
      buildColor        {"cmd":"buildColor","red":255,"green":120,"blue":40}
      buildBrightness   {"cmd":"buildBrightness","brightness":75}
      buildEffectSpeed  {"cmd":"buildEffectSpeed","speed":50}
      buildBasicEffect  {"cmd":"buildBasicEffect","effectCode":1}

    Bluetooth commands are intentionally placeholders in this scaffold.
    """)
  }
}
