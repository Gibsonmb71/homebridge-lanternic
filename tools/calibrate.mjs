#!/usr/bin/env node
import { createReadStream, existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

import { withBindings } from '@stoprocent/noble';

const root = fileURLToPath(new URL('.', import.meta.url));
const staticRoot = join(root, 'calibrator');
const profilePath = join(process.cwd(), '.lanternic-calibration.json');

const binding = process.env.LANTERNIC_BINDING ?? 'default';
const port = Number(process.env.LANTERNIC_CALIBRATE_PORT ?? '4287');
const serviceUuid = cleanHex(process.env.LANTERNIC_SERVICE_UUID ?? 'fff0');
const characteristicUuid = cleanHex(process.env.LANTERNIC_CHARACTERISTIC_UUID ?? 'fff3');
const defaultAddress = process.env.LANTERNIC_ADDRESS ?? process.argv[2] ?? '3ce161969c280342f1cbc8dac2b53dc5';

const noble = withBindings(binding);

let targetAddress = defaultAddress;
let queue = Promise.resolve();
let peripheral;
let characteristic;
let idleTimer;

function cleanHex(input) {
  return String(input ?? '').replace(/[^0-9a-f]/gi, '').toLowerCase();
}

function peripheralId(candidate) {
  return candidate.address || candidate.uuid || candidate.id;
}

function clampByte(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.max(0, Math.min(255, Math.round(numeric)));
}

function colorFrame({ red, green, blue }) {
  return Buffer.from([
    0x7e,
    0x07,
    0x05,
    0x03,
    clampByte(red),
    clampByte(green),
    clampByte(blue),
    0x10,
    0xef,
  ]);
}

function powerFrame(on) {
  return on
    ? Buffer.from('7e0404f00001ff00ef', 'hex')
    : Buffer.from('7e0404000000ff00ef', 'hex');
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function json(response, status, body) {
  const data = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(data),
  });
  response.end(data);
}

async function requestJson(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks).toString('utf8');
  return body ? JSON.parse(body) : {};
}

function runExclusive(operation) {
  const run = queue.then(operation, operation);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function ensureConnected() {
  if (peripheral?.state === 'connected' && characteristic) {
    return;
  }

  await noble.waitForPoweredOnAsync(15_000);
  await noble.startScanningAsync([], true);

  const targetId = cleanHex(targetAddress);
  const found = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      noble.removeListener('discover', onDiscover);
      reject(new Error(`Timed out scanning for ${targetAddress}`));
    }, 20_000);

    const onDiscover = candidate => {
      const ids = [candidate.id, candidate.uuid, candidate.address, peripheralId(candidate)].map(cleanHex);
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
  await found.connectAsync();

  const result = await found.discoverSomeServicesAndCharacteristicsAsync(
    [serviceUuid],
    [characteristicUuid],
  );
  const foundCharacteristic = result.characteristics[0];

  if (!foundCharacteristic) {
    await found.disconnectAsync();
    throw new Error(`Missing characteristic ${serviceUuid}/${characteristicUuid}`);
  }

  found.on('disconnect', () => {
    peripheral = undefined;
    characteristic = undefined;
  });

  peripheral = found;
  characteristic = foundCharacteristic;
}

async function disconnectSoon() {
  if (idleTimer) {
    clearTimeout(idleTimer);
  }

  idleTimer = setTimeout(() => {
    void runExclusive(async () => {
      if (peripheral?.state === 'connected') {
        await peripheral.disconnectAsync();
      }
      peripheral = undefined;
      characteristic = undefined;
    });
  }, 15_000);
}

async function writeFrames(frames) {
  return runExclusive(async () => {
    await ensureConnected();
    const withoutResponse = !characteristic.properties.includes('write')
      && characteristic.properties.includes('writeWithoutResponse');

    for (const frame of frames) {
      await characteristic.writeAsync(frame, withoutResponse);
      await delay(80);
    }

    await disconnectSoon();
    return frames.map(frame => frame.toString('hex'));
  });
}

async function serveStatic(request, response) {
  const url = new URL(request.url, 'http://localhost');
  const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
  const filePath = normalize(join(staticRoot, relative));

  if (!filePath.startsWith(staticRoot) || !existsSync(filePath)) {
    response.writeHead(404);
    response.end('Not found');
    return;
  }

  const types = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
  };

  response.writeHead(200, {
    'content-type': types[extname(filePath)] ?? 'application/octet-stream',
  });
  createReadStream(filePath).pipe(response);
}

async function handleApi(request, response) {
  try {
    if (request.method === 'GET' && request.url === '/api/status') {
      let savedProfile = null;
      if (existsSync(profilePath)) {
        savedProfile = JSON.parse(await readFile(profilePath, 'utf8'));
      }
      json(response, 200, {
        binding,
        targetAddress,
        serviceUuid,
        characteristicUuid,
        savedProfile,
      });
      return;
    }

    if (request.method === 'POST' && request.url === '/api/target') {
      const body = await requestJson(request);
      targetAddress = String(body.address ?? '').trim();
      peripheral = undefined;
      characteristic = undefined;
      json(response, 200, { targetAddress });
      return;
    }

    if (request.method === 'POST' && request.url === '/api/color') {
      const body = await requestJson(request);
      const frames = await writeFrames([colorFrame(body)]);
      json(response, 200, { ok: true, frames });
      return;
    }

    if (request.method === 'POST' && request.url === '/api/power') {
      const body = await requestJson(request);
      const frames = await writeFrames([powerFrame(Boolean(body.on))]);
      json(response, 200, { ok: true, frames });
      return;
    }

    if (request.method === 'POST' && request.url === '/api/sequence') {
      const body = await requestJson(request);
      const delayBetween = Math.max(100, Math.min(5000, Number(body.delayMs ?? 900)));
      const colors = Array.isArray(body.colors) ? body.colors : [];
      const frames = [];

      for (const color of colors) {
        frames.push(colorFrame(color));
        if (delayBetween > 80) {
          frames.push(Buffer.from([]));
        }
      }

      const written = await runExclusive(async () => {
        await ensureConnected();
        const withoutResponse = !characteristic.properties.includes('write')
          && characteristic.properties.includes('writeWithoutResponse');
        const hexFrames = [];

        for (const color of colors) {
          const frame = colorFrame(color);
          await characteristic.writeAsync(frame, withoutResponse);
          hexFrames.push(frame.toString('hex'));
          await delay(delayBetween);
        }

        await disconnectSoon();
        return hexFrames;
      });

      json(response, 200, { ok: true, frames: written });
      return;
    }

    if (request.method === 'POST' && request.url === '/api/profile') {
      const body = await requestJson(request);
      await writeFile(profilePath, `${JSON.stringify(body, null, 2)}\n`);
      json(response, 200, { ok: true, path: profilePath });
      return;
    }

    json(response, 404, { error: 'Not found' });
  } catch (error) {
    json(response, 500, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

const server = createServer((request, response) => {
  if (request.url?.startsWith('/api/')) {
    void handleApi(request, response);
    return;
  }

  void serveStatic(request, response);
});

process.on('SIGINT', async () => {
  try {
    if (peripheral?.state === 'connected') {
      await peripheral.disconnectAsync();
    }
    noble.stop();
  } finally {
    process.exit(0);
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`LanternIC calibration app: http://127.0.0.1:${port}`);
  console.log(`Target: ${targetAddress}`);
});
