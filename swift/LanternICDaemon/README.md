# LanternICDaemon

Experimental Swift daemon for `homebridge-lanternic`.

This package is intentionally small for the first Swift milestone. It does **not** talk to Bluetooth yet. Right now it gives us a buildable SwiftPM package, Magic Lantern frame builders, a newline-delimited JSON protocol, and tests.

## Build

From the repository root:

```sh
swift build --package-path swift/LanternICDaemon
```

## Test

```sh
swift test --package-path swift/LanternICDaemon
```

## Run once

```sh
swift run --package-path swift/LanternICDaemon lanternicd --once '{"cmd":"ping"}'
```

```sh
swift run --package-path swift/LanternICDaemon lanternicd --once '{"cmd":"buildColor","red":255,"green":120,"blue":40}'
```

Expected response:

```json
{"event":"frame","frame":"7e070503ff782810ef","ok":true}
```

## Long-running protocol

The TypeScript Homebridge wrapper will eventually spawn `lanternicd` and send one JSON request per line over stdin. The daemon returns one JSON response per line over stdout.

Example request:

```json
{"id":"1","cmd":"buildPower","value":true}
```

Example response:

```json
{"event":"frame","frame":"7e0404f00001ff00ef","id":"1","ok":true}
```

## Current command support

- `ping`
- `capabilities`
- `buildPower`
- `buildColor`
- `buildBrightness`
- `buildEffectSpeed`
- `buildBasicEffect`

The Bluetooth commands `scan`, `connect`, `write`, and `disconnect` are placeholders until the next milestone.
