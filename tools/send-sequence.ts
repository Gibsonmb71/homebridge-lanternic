#!/usr/bin/env node
import { withBindings } from '@stoprocent/noble';

const binding = process.env.LANTERNIC_BINDING ?? 'default';
const serviceUuid = (process.env.LANTERNIC_SERVICE_UUID ?? 'fff0').replace(/[^0-9a-f]/gi, '').toLowerCase();
const characteristicUuid = (process.env.LANTERNIC_CHARACTERISTIC_UUID ?? 'fff3').replace(/[^0-9a-f]/gi, '').toLowerCase();
const delayMs = Number(process.env.LANTERNIC_SEQUENCE_DELAY_MS ?? '150');
const address = process.argv[2];
const frames = process.argv.slice(3);

if (!address || frames.length === 0) {
  console.error('Usage: lanternic-send-sequence <address> <hex-frame> [hex-frame...]');
  console.error('Repo development: npm run send-sequence -- <address> <hex-frame> [hex-frame...]');
  process.exit(2);
}

const cleanId = (input: any) => String(input ?? '').replace(/[^0-9a-f]/gi, '').toLowerCase();
const peripheralId = (peripheral: any) => peripheral.address || peripheral.uuid || peripheral.id;
const delay = (milliseconds: any) => new Promise(resolve => setTimeout(resolve, milliseconds));
const targetId = cleanId(address);
const noble = withBindings((process.env.LANTERNIC_BINDING as any) ?? 'default');
const payloads = frames.map(frame => Buffer.from(cleanId(frame), 'hex'));

console.log(`Sending ${payloads.length} frame(s) to ${address} with binding=${binding}`);

await noble.waitForPoweredOnAsync(15_000);
await noble.startScanningAsync([], true);

const peripheral = await new Promise<any>((resolve, reject) => {
  const timeout = setTimeout(() => {
    noble.removeListener('discover', onDiscover);
    reject(new Error(`Timed out scanning for ${address}`));
  }, 20_000);

  const onDiscover = (candidate: any) => {
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
    console.log(`WRITE ${payload.toString('hex')} withoutResponse=${withoutResponse}`);
    await characteristic.writeAsync(payload, withoutResponse);
    await delay(delayMs);
  }

  console.log('Sequence complete');
} finally {
  await peripheral.disconnectAsync();
  noble.stop();
}
