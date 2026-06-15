import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Logging } from 'homebridge';

import type { HciDriver, LanternIcDeviceConfig, NobleBinding, WriteMode } from '../types.js';
import type { NobleCharacteristic, NoblePeripheral } from './nobleTypes.js';
import { MagicLanternBleClient, type MagicLanternBleOptions } from './magicLanternBleManager.js';

const createOptions = (overrides: Partial<MagicLanternBleOptions> = {}): MagicLanternBleOptions => ({
  binding: 'default' as NobleBinding,
  characteristicUuid: 'fff3',
  connectTimeoutMs: 50,
  hciDeviceId: 0,
  hciDriver: 'native' as HciDriver,
  hciUserChannel: false,
  idleDisconnectMs: 0,
  keepConnected: false,
  maxReconnectDelayMs: 5,
  maxRetryDelayMs: 5,
  reconnectDelayMs: 1,
  retryAttempts: 1,
  retryDelayMs: 1,
  scanTimeoutMs: 50,
  serviceUuid: 'fff0',
  writeDelayMs: 0,
  writeMode: 'withoutResponse' as WriteMode,
  writeTimeoutMs: 50,
  ...overrides,
});

const createLog = () => {
  const debugMessages: string[] = [];

  return {
    debug: (...message: unknown[]) => debugMessages.push(message.map(String).join(' ')),
    error: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    debugMessages,
  };
};

const waitFor = async (predicate: () => boolean, message: string): Promise<void> => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 250) {
    if (predicate()) {
      return;
    }

    await new Promise(resolve => setTimeout(resolve, 5));
  }

  assert.fail(message);
};

const createPeripheral = (writes: Buffer[]): NoblePeripheral => {
  let disconnectListener: (() => void) | undefined;
  const characteristic: NobleCharacteristic = {
    properties: ['writeWithoutResponse'],
    uuid: 'fff3',
    writeAsync: async data => {
      writes.push(Buffer.from(data));
    },
  };

  return {
    address: 'be:16:4e:00:38:31',
    connectAsync: async function connectAsync(this: NoblePeripheral) {
      this.state = 'connected';
    },
    disconnectAsync: async function disconnectAsync(this: NoblePeripheral) {
      this.state = 'disconnected';
      disconnectListener?.();
    },
    discoverSomeServicesAndCharacteristicsAsync: async () => ({
      characteristics: [characteristic],
    }),
    id: 'be164e003831',
    on: (_event, listener) => {
      disconnectListener = listener;
    },
    removeListener: () => {
      disconnectListener = undefined;
    },
    state: 'disconnected',
  };
};

const createClient = (
  options: MagicLanternBleOptions,
  findPeripheral: () => Promise<NoblePeripheral>,
  log: ReturnType<typeof createLog>,
): MagicLanternBleClient => {
  const device: LanternIcDeviceConfig = {
    address: 'be:16:4e:00:38:31',
    name: 'LED Strip',
  };
  const manager = {
    findPeripheral,
    options,
    runExclusive: async <T>(operation: () => Promise<T>) => await operation(),
  };

  return new MagicLanternBleClient(
    log as unknown as Logging,
    manager as never,
    device,
  );
};

test('failed writes start a background recovery scan even when keepConnected is disabled', async () => {
  const log = createLog();
  const writes: Buffer[] = [];
  const peripheral = createPeripheral(writes);
  let findCalls = 0;
  let reconnects = 0;
  const client = createClient(createOptions(), async () => {
    findCalls += 1;

    if (findCalls === 1) {
      throw new Error('Timed out scanning for LED Strip (be:16:4e:00:38:31)');
    }

    return peripheral;
  }, log);

  client.onReconnect(() => {
    reconnects += 1;
  });

  await assert.rejects(
    client.writeCommands([Buffer.from([0x01])]),
    /Timed out scanning for LED Strip/,
  );
  await waitFor(() => reconnects === 1, 'expected background recovery to reconnect');

  assert.equal(findCalls, 2);
  assert.deepEqual(writes, []);
  assert.ok(log.debugMessages.some(message => message.includes('Scheduled background BLE recovery scan after failed write')));
  assert.ok(log.debugMessages.some(message => message.includes('BLE reconnect complete')));
});

test('background recovery lets reconnect handlers resend desired commands', async () => {
  const log = createLog();
  const writes: Buffer[] = [];
  const peripheral = createPeripheral(writes);
  let findCalls = 0;
  const client = createClient(createOptions(), async () => {
    findCalls += 1;

    if (findCalls === 1) {
      throw new Error('Timed out scanning for LED Strip (be:16:4e:00:38:31)');
    }

    return peripheral;
  }, log);

  client.onReconnect(() => client.writeCommands([Buffer.from([0x02])]));

  await assert.rejects(
    client.writeCommands([Buffer.from([0x01])]),
    /Timed out scanning for LED Strip/,
  );
  await waitFor(() => writes.length === 1, 'expected reconnect handler to write desired command');

  assert.equal(findCalls, 2);
  assert.equal(writes[0]?.toString('hex'), '02');
});
