#!/usr/bin/env node
import { withBindings } from '@stoprocent/noble';

const cleanId = value => String(value ?? '').replace(/[^0-9a-f]/gi, '').toLowerCase();
const binding = process.env.LANTERNIC_BINDING ?? 'default';
const seconds = Number(process.env.LANTERNIC_SCAN_SECONDS ?? '20');
const showAll = process.env.LANTERNIC_SCAN_ALL === '1';
const minRssi = process.env.LANTERNIC_MIN_RSSI === undefined
  ? undefined
  : Number(process.env.LANTERNIC_MIN_RSSI);
const prefixes = (process.env.LANTERNIC_PREFIXES ?? 'Triones,MELK,ELK-BLEDOM,LED,OA')
  .split(',')
  .map(prefix => prefix.trim().toLowerCase())
  .filter(Boolean);
const serviceUuids = (process.env.LANTERNIC_SERVICE_UUIDS ?? 'fff0')
  .split(',')
  .map(prefix => cleanId(prefix.trim()))
  .filter(Boolean);

const noble = withBindings(binding);
const seen = new Map();

const peripheralId = peripheral => peripheral.address || peripheral.uuid || peripheral.id;
const formatAddress = value => {
  const normalized = cleanId(value);
  if (normalized.length !== 12) {
    return value;
  }
  return normalized.match(/.{1,2}/g).join(':');
};

const matches = peripheral => {
  if (showAll) {
    return true;
  }

  const name = peripheral.advertisement?.localName?.toLowerCase() ?? '';
  const advertisedServiceUuids = peripheral.advertisement?.serviceUuids?.map(cleanId) ?? [];
  const matchesPrefix = prefixes.some(prefix => name.startsWith(prefix));
  const matchesService = serviceUuids.some(serviceUuid => advertisedServiceUuids.includes(serviceUuid));
  const matchesRssi = typeof minRssi !== 'number'
    || !Number.isFinite(minRssi)
    || typeof peripheral.rssi !== 'number'
    || peripheral.rssi >= minRssi;
  return (matchesPrefix || matchesService) && matchesRssi;
};

console.log(`Scanning ${seconds}s with binding=${binding} showAll=${showAll}`);
console.log('If macOS asks for Bluetooth access, approve it for the app running this command.');

await noble.waitForPoweredOnAsync(15_000);

noble.on('discover', peripheral => {
  if (!matches(peripheral)) {
    return;
  }

  const id = peripheralId(peripheral);
  const key = cleanId(id);

  if (seen.has(key)) {
    return;
  }

  const name = peripheral.advertisement?.localName ?? '(unnamed)';
  const address = formatAddress(peripheralId(peripheral));
  const rssi = typeof peripheral.rssi === 'number' ? peripheral.rssi : 'n/a';
  const advertisedServiceUuids = peripheral.advertisement?.serviceUuids ?? [];
  const manufacturerData = peripheral.advertisement?.manufacturerData?.toString('hex');
  const deviceConfig = {
    name: name === '(unnamed)' ? `LanternIC ${String(id).slice(-6)}` : name,
    address: id,
    manufacturer: 'Magic Lantern',
    model: 'Magic Lantern RGBIC',
    colorOrder: 'rgb',
  };

  seen.set(key, { name, address, id: peripheral.id, uuid: peripheral.uuid, rssi });
  console.log(`${name} address=${address} id=${peripheral.id} uuid=${peripheral.uuid ?? 'n/a'} rssi=${rssi} services=${advertisedServiceUuids.join(',') || 'n/a'} manufacturerData=${manufacturerData ?? 'n/a'}`);
  console.log(`  Homebridge device JSON: ${JSON.stringify(deviceConfig)}`);
});

await noble.startScanningAsync([], true);
await new Promise(resolve => setTimeout(resolve, seconds * 1000));
await noble.stopScanningAsync();
noble.stop();

console.log(`Found ${seen.size} matching device(s).`);
