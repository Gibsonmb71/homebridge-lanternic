#!/usr/bin/env node
import { withBindings } from '@stoprocent/noble';

const binding = process.env.LANTERNIC_BINDING ?? 'default';
const serviceUuid = (process.env.LANTERNIC_SERVICE_UUID ?? 'fff0').replace(/[^0-9a-f]/gi, '').toLowerCase();
const characteristicUuid = (process.env.LANTERNIC_CHARACTERISTIC_UUID ?? 'fff3').replace(/[^0-9a-f]/gi, '').toLowerCase();
const delayMs = Number(process.env.LANTERNIC_WRITE_DELAY_MS ?? 120);
const address = process.argv[2];
const command = process.argv[3];
const value = process.argv[4];
const extraValue = process.argv[5];

if (!address || !command) {
  console.error('Usage: lanternic-send <address> <on|off|brightness|speed|effect|rgb|raw> [value] [speed]');
  console.error('Repo development: npm run send -- <address> <on|off|brightness|speed|effect|rgb|raw> [value] [speed]');
  console.error('Examples:');
  console.error('  lanternic-send be:16:70:00:08:2a on');
  console.error('  lanternic-send be:16:70:00:08:2a brightness 50');
  console.error('  lanternic-send be:16:70:00:08:2a speed 39');
  console.error('  lanternic-send be:16:70:00:08:2a effect 207 39');
  console.error('  lanternic-send be:16:70:00:08:2a rgb ff0000');
  console.error('  lanternic-send be:16:70:00:08:2a raw 7e0404f00001ff00ef');
  process.exit(2);
}

const cleanId = input => String(input ?? '').replace(/[^0-9a-f]/gi, '').toLowerCase();
const peripheralId = peripheral => peripheral.address || peripheral.uuid || peripheral.id;
const targetId = cleanId(address);
const noble = withBindings(binding);

const byte = number => Math.max(0, Math.min(255, Math.round(number)));
const percent = number => Math.max(0, Math.min(100, Math.round(number)));
const frame = (...bytes) => Buffer.from(bytes.map(byte));
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

const buildPayloads = () => {
  if (command === 'on') {
    return [Buffer.from('7e0404f00001ff00ef', 'hex')];
  }

  if (command === 'off') {
    return [Buffer.from('7e0404000000ff00ef', 'hex')];
  }

  if (command === 'brightness') {
    return [frame(0x7e, 0x04, 0x01, percent(Number(value)), 0x01, 0xff, 0xff, 0x00, 0xef)];
  }

  if (command === 'speed') {
    return [frame(0x7e, 0x04, 0x02, percent(Number(value)), 0xff, 0xff, 0xff, 0x00, 0xef)];
  }

  if (command === 'effect') {
    const payloads = [];
    if (extraValue !== undefined) {
      payloads.push(frame(0x7e, 0x04, 0x02, percent(Number(extraValue)), 0xff, 0xff, 0xff, 0x00, 0xef));
    }

    payloads.push(frame(0x7e, 0x05, 0x03, byte(Number(value)), 0x06, 0xff, 0xff, 0x00, 0xef));
    return payloads;
  }

  if (command === 'rgb') {
    const rgb = cleanId(value);
    if (rgb.length !== 6) {
      throw new Error('rgb value must be RRGGBB hex, for example ff0000');
    }
    return [Buffer.from(`7e070503${rgb}10ef`, 'hex')];
  }

  if (command === 'raw') {
    return [Buffer.from(cleanId(value), 'hex')];
  }

  throw new Error(`Unknown command: ${command}`);
};

const payloads = buildPayloads();
console.log(`Sending ${payloads.map(payload => payload.toString('hex')).join(', ')} to ${address} with binding=${binding}`);

await noble.waitForPoweredOnAsync(15_000);
await noble.startScanningAsync([], true);

const peripheral = await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => {
    noble.removeListener('discover', onDiscover);
    reject(new Error(`Timed out scanning for ${address}`));
  }, 20_000);

  const onDiscover = candidate => {
    const ids = [candidate.id, candidate.uuid, candidate.address, peripheralId(candidate)].map(cleanId);
    if (!ids.includes(targetId)) {
      return;
    }

    clearTimeout(timeout);
    noble.removeListener('discover', onDiscover);
    resolve(candidate);
  };

  noble.on('discover', onDiscover);
});

await noble.stopScanningAsync();
await peripheral.connectAsync();

try {
  const { characteristics } = await peripheral.discoverSomeServicesAndCharacteristicsAsync(
    [serviceUuid],
    [characteristicUuid],
  );
  const characteristic = characteristics[0];

  if (!characteristic) {
    throw new Error(`Missing characteristic ${serviceUuid}/${characteristicUuid}`);
  }

  const withoutResponse = !characteristic.properties.includes('write')
    && characteristic.properties.includes('writeWithoutResponse');
  for (const payload of payloads) {
    await characteristic.writeAsync(payload, withoutResponse);
    await wait(delayMs);
  }
  console.log(`Write complete withoutResponse=${withoutResponse}`);
} finally {
  await peripheral.disconnectAsync();
  noble.stop();
}
