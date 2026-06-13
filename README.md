# Homebridge LanternIC

[![npm version](https://img.shields.io/npm/v/homebridge-lanternic.svg)](https://www.npmjs.com/package/homebridge-lanternic)
[![CI](https://github.com/Gibsonmb71/homebridge-lanternic/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Gibsonmb71/homebridge-lanternic/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/node/v/homebridge-lanternic.svg)](https://www.npmjs.com/package/homebridge-lanternic)
[![Homebridge](https://img.shields.io/badge/homebridge-1.8%20%7C%202.x-blue.svg)](https://homebridge.io/)
[![License](https://img.shields.io/npm/l/homebridge-lanternic.svg)](LICENSE)

Homebridge plugin for BLE RGBIC/RGBWIC light strips controlled by the Magic Lantern app.

## Status

These unbranded Magic Lantern BLE strips ship with multiple firmware variants so it's hard to ensure compatibility for all strips.

- HomeKit Lightbulb service
- On/off with RGB-black fallback plus optional native Magic Lantern power frames
- Brightness via RGB scaling by default, with optional native Magic Lantern brightness frames
- Optional HomeKit switches for Magic Lantern effects
- HomeKit on/off, brightness, and color control confirmed on a `MELK-OC21WCT31` strip
- Homebridge UI config schema
- BLE discovery with log snippets and optional auto-add
- Serialized BLE writes with timeout, retry/backoff, reconnect, and optional keep-alive
- Command-builder tests for the known Magic Lantern frames
- Package smoke tests against Homebridge 1 and 2 on Node.js 22 and 24 in CI

Segment-level IC control is not supported yet.

## Install

Install it like any other Homebridge plugin:

```sh
sudo npm install -g homebridge-lanternic
```

For local development from this repository:

```sh
npm install
npm run build
sudo hb-service link
```

## Homebridge UI Setup

LanternIC supports Homebridge UI through `config.schema.json`.

1. Install the plugin.
2. Open Homebridge UI.
3. Go to Plugins, select LanternIC, then Settings.
4. Choose `Auto Mode` for first setup, or `Manual Mode` if you already know your strip's Bluetooth address.
5. Save and restart Homebridge.
6. In Auto Mode, LanternIC scans and auto-adds matching first-run candidates. In Manual Mode, paste the address into the `Light Strips` list.

After at least one light strip is configured, the setup mode picker is hidden and the advanced Discovery/Bluetooth settings become available.

You can also use the local scanner:

```sh
lanternic-scan
```

Useful scanner filters:

```sh
LANTERNIC_MIN_RSSI=-75 lanternic-scan
LANTERNIC_SCAN_SECONDS=45 lanternic-scan
LANTERNIC_SCAN_ALL=1 lanternic-scan
```

When working from this repository instead of a global install, use `npm run scan` in place of `lanternic-scan`.

First-run `Auto Mode` can create HomeKit accessories automatically for matching BLE candidates. After setup, use the advanced `Auto-Add Discovered Devices` setting only when your filters are tight, because nearby BLE devices may advertise similar services.

## CLI Tools

LanternIC ships a few BLE helpers for setup and firmware troubleshooting:

```sh
lanternic-scan
lanternic-explore <address>
lanternic-send <address> rgb ff0000
lanternic-send <address> brightness 50
lanternic-send <address> effect 207 39
lanternic-send-sequence <address> 7e070503ff000010ef 7e07050300ff0010ef
lanternic-calibrate <address>
```

All tools default to Noble's cross-platform `default` binding. Override it only when needed:

```sh
LANTERNIC_BINDING=hci lanternic-scan
LANTERNIC_BINDING=mac lanternic-scan
```

## Linux / Raspberry Pi

This plugin uses `@stoprocent/noble`, which ships Linux prebuilds for common Raspberry Pi and x64 platforms. Homebridge should run on Node.js 22 or 24.

Install Bluetooth dependencies:

```sh
sudo apt-get update
sudo apt-get install -y bluetooth bluez libbluetooth-dev libudev-dev libcap2-bin
```

Allow the Node binary used by Homebridge to access BLE:

```sh
sudo setcap cap_net_raw,cap_net_admin+eip "$(eval readlink -f "$(which node)")"
```

If Homebridge runs under `hb-service`, make sure you run the `setcap` command against the same `node` binary that service uses. The safest path is to run it in the same shell/environment where Homebridge was installed, or from the Homebridge UI terminal.

Recommended Linux BLE settings:

```json
{
  "ble": {
    "binding": "default",
    "hciDriver": "native",
    "hciDeviceId": 0,
    "writeMode": "withoutResponse"
  }
}
```

`binding: "default"` auto-selects Linux HCI on Linux. Set `hciDeviceId` to `1` for `hci1`, etc. If scanning sees nothing on a Raspberry Pi, try adding this to `/etc/bluetooth/main.conf`, then reboot:

```ini
DisablePlugins=pnat
```

If Linux discovery works from the CLI but Homebridge cannot connect, run the `setcap` command against the exact Node binary used by `hb-service`, then restart Homebridge. If `keepConnected` is enabled, expect the Magic Lantern iPhone app to fail or hang while Homebridge owns the BLE connection.

## Homebridge Config

Start with discovery enabled and no devices:

```json
{
  "platform": "LanternIC",
  "name": "LanternIC",
  "setupMode": "auto",
  "devices": [],
  "discovery": {
    "enabled": true,
    "scanSeconds": 20
  }
}
```

Restart Homebridge and look for candidate device addresses in the logs. Then add your strip:

```json
{
  "platform": "LanternIC",
  "name": "LanternIC",
  "devices": [
    {
      "name": "TV Strip",
      "address": "BE:16:70:00:08:2A",
      "model": "Magic Lantern RGBIC",
      "colorOrder": "rgb",
      "powerMode": "both",
      "brightnessMode": "rgb"
    }
  ],
  "discovery": {
    "enabled": true,
    "autoAdd": false,
    "scanSeconds": 20,
    "minRssi": -95,
    "namePrefixes": [
      "MELK",
      "Triones",
      "ELK-BLEDOM",
      "LED",
      "OA"
    ],
    "serviceUuids": [
      "fff0"
    ]
  },
  "ble": {
    "writeMode": "withoutResponse",
    "keepConnected": true
  }
}
```

## Test Loop With A Real Strip

1. Pair/configure the strip in the Magic Lantern app first so it is powered, reachable, and known-good.
2. Fully quit the Magic Lantern app before testing Homebridge. BLE devices usually allow only one active central connection.
3. Start Homebridge in debug mode and confirm the plugin logs your strip during discovery.
4. Add the address to config and restart.
5. Test in this order: On, Off, Brightness 10/50/100, Red, Green, Blue, White-ish.
6. If colors are swapped, change `colorOrder`.
7. If Off leaves the strip visibly on, keep `powerMode` as `both` or try `rgbBlack`.
8. If brightness does not change, keep `brightnessMode` as `rgb`; if it double-dims, try `native`.
9. If effects are enabled, test one effect switch at a time. Turning an effect switch off should restore the saved HomeKit color.

## HomeKit Effects

Magic Lantern animation effects are exposed as optional `Switch` services on the same HomeKit accessory as the light. Apple Home does not provide a native effect picker for a `Lightbulb`, and custom effect characteristics usually do not appear in the Home app.

Effects are disabled by default. Enable them per strip:

```json
{
  "effects": {
    "enabled": true,
    "defaultSpeed": 39,
    "restoreColorOnDisable": true
  }
}
```

When `effects.enabled` is true and no custom `items` list is provided, LanternIC creates these starter switches:

- AutoPlay: effect code `0`
- Magic Back: effect code `1`
- Yellow Marquee: effect code `207` (`0xcf`)

Only one effect switch is kept active at a time. Turning on an effect sends the speed frame followed by the effect frame. Turning off the active effect restores the saved HomeKit color and brightness when `restoreColorOnDisable` is true.

## Protocol Notes

Known Magic Lantern BLE writes go to:

- Service UUID: `FFF0`
- Characteristic UUID: `FFF3`

Confirmed through HomeKit against a `MELK-OC21WCT31` / firmware string `WCKJ3016FV25HCV6` strip:

- RGB: `7e070503RRGGBB10ef`
- Off fallback: `7e07050300000010ef`
- Brightness: RGB scaling through the same RGB frame

The core frames available here are:

- On: `7e0404f00001ff00ef`
- Off: `7e0404000000ff00ef`
- RGB: `7e070503RRGGBB10ef`
- Brightness: `7e0401xx01ffff00ef`, where `xx` is 0-100 decimal encoded as one byte
- Effect speed: `7e0402xxffffff00ef`, where `xx` is 0-100 decimal encoded as one byte
- Basic effect: `7e0503xx06ffff00ef`

> These Magic Lantern BLE frame notes are based on packet-captures from [@kassabov](https://github.com/kassabov) in Home Assistant Core issue [#145934](https://github.com/home-assistant/core/issues/145934). (thanks!)

- Home Assistant Core issue: <https://github.com/home-assistant/core/issues/145934>
- Home Assistant community thread: <https://community.home-assistant.io/t/new-integration-for-ble-magic-lantern/454055>
- Magic Lantern app overview: <https://magiclantern.app/>
- Modern Noble fork used for BLE: <https://github.com/stoprocent/noble>

The default `powerMode` is `both`, which sends RGB black before the native off frame. The default `brightnessMode` is `rgb`, which scales RGB values instead of relying on the native brightness frame. These defaults favor the RGB command that is confirmed on real hardware.

The command builders are isolated so we can add variants if your strip uses a slightly different firmware.

## Known Hardware Notes

- HomeKit on/off, brightness, and RGB color control are confirmed on the MELK firmware above.
- Native power and brightness frames are implemented, but still need more real-strip validation because some Magic Lantern-family firmware appears to accept RGB frames while ignoring one or both native frames.
- If color works but power or brightness does not, use `lanternic-send <address> raw <hex-frame>` while testing candidate frames and open an issue with the model name, firmware string from `lanternic-explore`, and the working frame.
- Avoid enabling discovery `autoAdd` until your filters are tight. Some nearby BLE devices can share generic names or services and should not be bridged as lights.

## Reliability Choices

- All BLE operations are serialized through a single manager queue.
- Every characteristic write has a timeout and is retried with exponential backoff.
- Failed writes force a disconnect and rediscovery.
- Desired HomeKit state is cached and resent after a background reconnect when `keepConnected` is enabled.
- Connections are closed after an idle timeout by default, so the Magic Lantern app or another controller is less likely to be locked out forever.
- Set `ble.keepConnected` to `true` for the most reliable HomeKit behavior. This keeps Homebridge attached to the strip and automatically reconnects after drops, but the Magic Lantern app may not be able to connect until Homebridge releases the device.

Useful reliability settings:

```json
{
  "ble": {
    "keepConnected": true,
    "writeMode": "withoutResponse",
    "writeTimeoutMs": 5000,
    "retryAttempts": 4,
    "retryDelayMs": 500,
    "maxRetryDelayMs": 5000,
    "reconnectDelayMs": 1000,
    "maxReconnectDelayMs": 60000
  }
}
```
