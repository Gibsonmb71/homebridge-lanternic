#!/usr/bin/env node
import { withBindings } from '@stoprocent/noble';

const binding = process.env.LANTERNIC_BINDING ?? 'default';
const address = process.argv[2];

if (!address) {
  console.error('Usage: lanternic-explore <address>');
  console.error('Repo development: npm run explore -- <address>');
  process.exit(2);
}

const cleanId = input => String(input ?? '').replace(/[^0-9a-f]/gi, '').toLowerCase();
const peripheralId = peripheral => peripheral.address || peripheral.uuid || peripheral.id;
const targetId = cleanId(address);
const noble = withBindings(binding);

console.log(`Exploring ${address} with binding=${binding}`);

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

const name = peripheral.advertisement?.localName ?? '(unnamed)';
console.log(`Found ${name} id=${peripheral.id} uuid=${peripheral.uuid ?? 'n/a'} address=${peripheral.address ?? 'n/a'} rssi=${peripheral.rssi ?? 'n/a'}`);

await peripheral.connectAsync();

try {
  const { services } = await peripheral.discoverAllServicesAndCharacteristicsAsync();

  for (const service of services) {
    console.log(`service ${service.uuid}`);

    for (const characteristic of service.characteristics ?? []) {
      const properties = characteristic.properties?.join(',') ?? '';
      console.log(`  char ${characteristic.uuid} props=${properties}`);

      if (characteristic.properties?.includes('read')) {
        try {
          const value = await characteristic.readAsync();
          console.log(`    read ${value.toString('hex') || '(empty)'}`);
        } catch (error) {
          console.log(`    read failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  }
} finally {
  await peripheral.disconnectAsync();
  noble.stop();
}
