import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CharacteristicValue, Logging, PlatformAccessory } from 'homebridge';

import type { MagicLanternBleClient } from './ble/magicLanternBleManager.js';
import type { LanternIcPlatform } from './platform.js';
import { LanternIcPlatformAccessory } from './platformAccessory.js';
import type { LanternIcAccessoryContext } from './types.js';

type SetHandler = (value: CharacteristicValue) => void | Promise<void>;
type GetHandler = () => CharacteristicValue | Promise<CharacteristicValue>;

class FakeCharacteristic {
  private setHandler?: SetHandler;
  private getHandler?: GetHandler;

  onSet(handler: SetHandler): this {
    this.setHandler = handler;
    return this;
  }

  onGet(handler: GetHandler): this {
    this.getHandler = handler;
    return this;
  }

  async set(value: CharacteristicValue): Promise<void> {
    assert.ok(this.setHandler, 'expected set handler to be registered');
    await this.setHandler(value);
  }

  async get(): Promise<CharacteristicValue> {
    assert.ok(this.getHandler, 'expected get handler to be registered');
    return await this.getHandler();
  }
}

class FakeService {
  private readonly characteristics = new Map<string, FakeCharacteristic>();

  setCharacteristic(name: string): this {
    this.characteristic(name);
    return this;
  }

  getCharacteristic(name: string): FakeCharacteristic {
    return this.characteristic(name);
  }

  characteristic(name: string): FakeCharacteristic {
    let characteristic = this.characteristics.get(name);

    if (!characteristic) {
      characteristic = new FakeCharacteristic();
      this.characteristics.set(name, characteristic);
    }

    return characteristic;
  }
}

class FakeAccessory {
  readonly context: LanternIcAccessoryContext = {
    device: {
      address: 'be:16:4e:00:38:31',
      name: 'LED Strip',
    },
  };
  readonly displayName = 'LED Strip';
  private readonly services = new Map<string, FakeService>();

  getService(name: string): FakeService | undefined {
    return this.services.get(name);
  }

  addService(name: string): FakeService {
    const service = new FakeService();
    this.services.set(name, service);
    return service;
  }

  service(name: string): FakeService {
    const service = this.services.get(name);
    assert.ok(service, `expected ${name} service to exist`);
    return service;
  }
}

const serviceNames = {
  AccessoryInformation: 'AccessoryInformation',
  Lightbulb: 'Lightbulb',
} as const;

const characteristicNames = {
  Brightness: 'Brightness',
  Hue: 'Hue',
  Manufacturer: 'Manufacturer',
  Model: 'Model',
  Name: 'Name',
  On: 'On',
  Saturation: 'Saturation',
  SerialNumber: 'SerialNumber',
} as const;

const createLog = () => {
  const warnings: string[] = [];
  const debugMessages: string[] = [];

  return {
    debug: (...message: unknown[]) => debugMessages.push(message.map(String).join(' ')),
    error: () => undefined,
    info: () => undefined,
    warn: (...message: unknown[]) => warnings.push(message.map(String).join(' ')),
    warnings,
    debugMessages,
  };
};

const createPlatformAccessory = (writeCommands: MagicLanternBleClient['writeCommands']) => {
  const log = createLog();
  const client = {
    onReconnect: () => () => undefined,
    start: () => undefined,
    writeCommands,
  };
  const platform = {
    Characteristic: characteristicNames,
    Service: serviceNames,
    api: {
      updatePlatformAccessories: () => undefined,
    },
    ble: {
      createClient: () => client,
    },
    log: log as unknown as Logging,
  } as unknown as LanternIcPlatform;
  const accessory = new FakeAccessory();

  new LanternIcPlatformAccessory(
    platform,
    accessory as unknown as PlatformAccessory<LanternIcAccessoryContext>,
  );

  return {
    accessory,
    log,
  };
};

test('characteristic write handlers log BLE failures without rejecting to Homebridge', async () => {
  const error = new Error('Timed out scanning for LED Strip (be:16:4e:00:38:31)');
  const { accessory, log } = createPlatformAccessory(async () => {
    throw error;
  });
  const light = accessory.service(serviceNames.Lightbulb);

  await assert.doesNotReject(light.characteristic(characteristicNames.On).set(true));
  await assert.doesNotReject(light.characteristic(characteristicNames.Brightness).set(50));
  await assert.doesNotReject(light.characteristic(characteristicNames.Hue).set(120));
  await assert.doesNotReject(light.characteristic(characteristicNames.Saturation).set(80));

  assert.equal(log.warnings.length, 4);
  assert.match(log.warnings[0], /\[LED Strip\] Could not apply On update over BLE/);
  assert.match(log.warnings[0], /Timed out scanning for LED Strip/);
  assert.equal(await light.characteristic(characteristicNames.On).get(), true);
  assert.equal(await light.characteristic(characteristicNames.Brightness).get(), 50);
  assert.equal(await light.characteristic(characteristicNames.Hue).get(), 120);
  assert.equal(await light.characteristic(characteristicNames.Saturation).get(), 80);
});

test('repeated characteristic write failures are throttled', async () => {
  const error = new Error('Timed out scanning for LED Strip (be:16:4e:00:38:31)');
  const { accessory, log } = createPlatformAccessory(async () => {
    throw error;
  });
  const on = accessory.service(serviceNames.Lightbulb).characteristic(characteristicNames.On);

  await on.set(true);
  await on.set(false);

  assert.equal(log.warnings.length, 1);
  assert.equal(log.debugMessages.length, 2);
  assert.match(log.debugMessages[1], /Suppressed repeated On BLE write failure/);
});
