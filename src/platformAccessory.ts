import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import { applyColorOrder, clampPercent, hsbToRgb } from './color.js';
import type { LanternBleClient } from './ble/lanternBleTransport.js';
import {
  buildColorCommand,
  buildNativeBrightnessCommands,
  buildPowerOffCommands,
  buildPowerOnPrefixCommands,
  shouldScaleRgbBrightness,
} from './ble/magicLanternCommands.js';
import type { BrightnessMode, LanternIcAccessoryContext, LanternIcDeviceConfig, PowerMode } from './types.js';
import type { LanternIcPlatform } from './platform.js';

interface LightState {
  on: boolean;
  brightness: number;
  hue: number;
  saturation: number;
}

export class LanternIcPlatformAccessory {
  private static readonly writeFailureLogWindowMs = 60_000;

  private readonly device: LanternIcDeviceConfig;
  private readonly client: LanternBleClient;
  private readonly accessory: PlatformAccessory<LanternIcAccessoryContext>;
  private readonly service: Service;
  private readonly state: LightState;
  private colorTimer?: ReturnType<typeof setTimeout>;
  private colorWriteWaiters: Array<{
    resolve: () => void;
    reject: (error: unknown) => void;
  }> = [];
  private readonly writeFailureLogTimes = new Map<string, number>();

  constructor(
    private readonly platform: LanternIcPlatform,
    accessory: PlatformAccessory<LanternIcAccessoryContext>,
  ) {
    if (!accessory.context.device) {
      throw new Error(`Accessory ${accessory.displayName} is missing LanternIC device context`);
    }

    this.accessory = accessory;
    this.device = accessory.context.device;
    this.client = this.platform.ble.createClient(this.device);
    this.state = {
      on: accessory.context.state?.on ?? false,
      brightness: accessory.context.state?.brightness ?? 100,
      hue: accessory.context.state?.hue ?? 0,
      saturation: accessory.context.state?.saturation ?? 0,
    };

    const informationService = accessory.getService(this.platform.Service.AccessoryInformation)
      ?? accessory.addService(this.platform.Service.AccessoryInformation);

    informationService
      .setCharacteristic(this.platform.Characteristic.Manufacturer, this.device.manufacturer ?? 'Magic Lantern')
      .setCharacteristic(this.platform.Characteristic.Model, this.device.model ?? 'Magic Lantern RGBIC')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.device.address);

    this.service = accessory.getService(this.platform.Service.Lightbulb)
      ?? accessory.addService(this.platform.Service.Lightbulb);

    this.service.setCharacteristic(this.platform.Characteristic.Name, this.device.name);

    this.service.getCharacteristic(this.platform.Characteristic.On)
      .onGet(() => this.state.on)
      .onSet(value => this.handleSet('On', () => this.setOn(Boolean(value))));

    this.service.getCharacteristic(this.platform.Characteristic.Brightness)
      .onGet(() => this.state.brightness)
      .onSet(value => this.handleSet('Brightness', () => this.setBrightness(Number(value))));

    this.service.getCharacteristic(this.platform.Characteristic.Hue)
      .onGet(() => this.state.hue)
      .onSet(value => this.handleSet('Hue', () => this.setHue(Number(value))));

    this.service.getCharacteristic(this.platform.Characteristic.Saturation)
      .onGet(() => this.state.saturation)
      .onSet(value => this.handleSet('Saturation', () => this.setSaturation(Number(value))));

    this.client.onReconnect(() => this.resyncAfterReconnect());
    this.client.start();
  }

  private async handleSet(characteristicName: string, operation: () => Promise<void>): Promise<void> {
    try {
      await operation();
    } catch (error) {
      this.logWriteFailure(characteristicName, error);
    }
  }

  private logWriteFailure(characteristicName: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    const key = `${characteristicName}:${message}`;
    const now = Date.now();

    const lastLoggedAt = this.writeFailureLogTimes.get(key);

    if (typeof lastLoggedAt === 'number' && now - lastLoggedAt < LanternIcPlatformAccessory.writeFailureLogWindowMs) {
      this.platform.log.debug(`[${this.device.name}] Suppressed repeated ${characteristicName} BLE write failure: ${message}`);
      return;
    }

    this.writeFailureLogTimes.set(key, now);
    this.platform.log.warn(`[${this.device.name}] Could not apply ${characteristicName} update over BLE: ${message}`);

    if (error instanceof Error && error.stack) {
      this.platform.log.debug(`[${this.device.name}] ${characteristicName} BLE write failure stack:`, error.stack);
    }
  }

  private async setOn(onValue: boolean): Promise<void> {
    this.state.on = onValue;
    this.saveState();

    if (!onValue) {
      await this.client.writeCommands(buildPowerOffCommands(this.powerMode()));
      return;
    }

    await this.client.writeCommands(this.buildPowerOnCommands());
  }

  private async setBrightness(value: CharacteristicValue): Promise<void> {
    this.state.brightness = clampPercent(Number(value));
    this.saveState();

    if (!this.state.on) {
      return;
    }

    await this.client.writeCommands(this.buildBrightnessUpdateCommands());
  }

  private async setHue(value: CharacteristicValue): Promise<void> {
    this.state.hue = Number(value);
    this.saveState();
    await this.scheduleColorWrite();
  }

  private async setSaturation(value: CharacteristicValue): Promise<void> {
    this.state.saturation = clampPercent(Number(value));
    this.saveState();
    await this.scheduleColorWrite();
  }

  private async scheduleColorWrite(): Promise<void> {
    if (!this.state.on) {
      return;
    }

    if (this.colorTimer) {
      clearTimeout(this.colorTimer);
    }

    await new Promise<void>((resolve, reject) => {
      this.colorWriteWaiters.push({ resolve, reject });
      this.colorTimer = setTimeout(() => {
        const waiters = this.colorWriteWaiters.splice(0);
        this.colorTimer = undefined;

        this.client.writeCommands([this.buildCurrentColorCommand()])
          .then(() => {
            for (const waiter of waiters) {
              waiter.resolve();
            }
          })
          .catch(error => {
            for (const waiter of waiters) {
              waiter.reject(error);
            }
          });
      }, 150);
    });
  }

  private buildCurrentColorCommand(): Buffer {
    const brightness = shouldScaleRgbBrightness(this.brightnessMode()) ? this.state.brightness : 100;
    const rgb = hsbToRgb(this.state.hue, this.state.saturation, brightness);
    const ordered = applyColorOrder(rgb, this.device.colorOrder ?? 'rgb');
    return buildColorCommand(ordered);
  }

  private buildPowerOnCommands(): Buffer[] {
    return [
      ...buildPowerOnPrefixCommands(this.powerMode(), this.brightnessMode(), this.state.brightness),
      this.buildCurrentColorCommand(),
    ];
  }

  private buildBrightnessUpdateCommands(): Buffer[] {
    return [
      ...buildNativeBrightnessCommands(this.state.brightness, this.brightnessMode()),
      ...(shouldScaleRgbBrightness(this.brightnessMode()) ? [this.buildCurrentColorCommand()] : []),
    ];
  }

  private powerMode(): PowerMode {
    return this.device.powerMode ?? 'both';
  }

  private brightnessMode(): BrightnessMode {
    return this.device.brightnessMode ?? 'rgb';
  }

  private async resyncAfterReconnect(): Promise<void> {
    this.platform.log.debug(`[${this.device.name}] Resyncing desired state after BLE reconnect`);
    await this.client.writeCommands(
      this.state.on ? this.buildPowerOnCommands() : buildPowerOffCommands(this.powerMode()),
    );
  }

  private saveState(): void {
    this.accessory.context.state = { ...this.state };
    this.platform.api.updatePlatformAccessories([this.accessory]);
  }
}
