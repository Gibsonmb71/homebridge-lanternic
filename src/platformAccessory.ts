import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import { applyColorOrder, clampPercent, hsbToRgb } from './color.js';
import type { MagicLanternBleClient } from './ble/magicLanternBleManager.js';
import {
  buildBasicEffectCommands,
  buildColorCommand,
  buildNativeBrightnessCommands,
  buildPowerOffCommands,
  buildPowerOnPrefixCommands,
  shouldScaleRgbBrightness,
} from './ble/magicLanternCommands.js';
import {
  EFFECT_SERVICE_SUBTYPE_PREFIX,
  resolveEffectsConfig,
  type ResolvedLanternIcEffect,
  type ResolvedLanternIcEffectsConfig,
} from './effects.js';
import type { BrightnessMode, LanternIcAccessoryContext, LanternIcDeviceConfig, PowerMode } from './types.js';
import type { LanternIcPlatform } from './platform.js';

interface LightState {
  on: boolean;
  brightness: number;
  hue: number;
  saturation: number;
  activeEffect?: string;
}

export class LanternIcPlatformAccessory {
  private readonly device: LanternIcDeviceConfig;
  private readonly client: MagicLanternBleClient;
  private readonly accessory: PlatformAccessory<LanternIcAccessoryContext>;
  private readonly service: Service;
  private readonly effectSettings: ResolvedLanternIcEffectsConfig;
  private readonly effectServices = new Map<string, Service>();
  private readonly state: LightState;
  private colorTimer?: ReturnType<typeof setTimeout>;
  private colorWriteWaiters: Array<{
    resolve: () => void;
    reject: (error: unknown) => void;
  }> = [];

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
      activeEffect: accessory.context.state?.activeEffect,
    };
    this.effectSettings = resolveEffectsConfig(this.device.effects);

    if (this.state.activeEffect && !this.findEffect(this.state.activeEffect)) {
      this.state.activeEffect = undefined;
    }

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
      .onSet(value => this.setOn(Boolean(value)));

    this.service.getCharacteristic(this.platform.Characteristic.Brightness)
      .onGet(() => this.state.brightness)
      .onSet(value => this.setBrightness(Number(value)));

    this.service.getCharacteristic(this.platform.Characteristic.Hue)
      .onGet(() => this.state.hue)
      .onSet(value => this.setHue(Number(value)));

    this.service.getCharacteristic(this.platform.Characteristic.Saturation)
      .onGet(() => this.state.saturation)
      .onSet(value => this.setSaturation(Number(value)));

    this.configureEffectServices();

    this.client.onReconnect(() => this.resyncAfterReconnect());
    this.client.start();
  }

  private async setOn(onValue: boolean): Promise<void> {
    this.state.on = onValue;
    this.state.activeEffect = undefined;
    this.saveState();
    this.updateEffectSwitches();

    if (!onValue) {
      await this.client.writeCommands(buildPowerOffCommands(this.powerMode()));
      return;
    }

    await this.client.writeCommands(this.buildPowerOnCommands());
  }

  private async setBrightness(value: CharacteristicValue): Promise<void> {
    this.state.brightness = clampPercent(Number(value));
    this.state.activeEffect = undefined;
    this.saveState();
    this.updateEffectSwitches();

    if (!this.state.on) {
      return;
    }

    await this.client.writeCommands(this.buildBrightnessUpdateCommands());
  }

  private async setHue(value: CharacteristicValue): Promise<void> {
    this.state.hue = Number(value);
    this.state.activeEffect = undefined;
    this.saveState();
    this.updateEffectSwitches();
    await this.scheduleColorWrite();
  }

  private async setSaturation(value: CharacteristicValue): Promise<void> {
    this.state.saturation = clampPercent(Number(value));
    this.state.activeEffect = undefined;
    this.saveState();
    this.updateEffectSwitches();
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

  private buildEffectCommands(effect: ResolvedLanternIcEffect): Buffer[] {
    return [
      ...buildPowerOnPrefixCommands(this.powerMode(), this.brightnessMode(), this.state.brightness),
      ...buildBasicEffectCommands(effect.code, effect.speed),
    ];
  }

  private powerMode(): PowerMode {
    return this.device.powerMode ?? 'both';
  }

  private brightnessMode(): BrightnessMode {
    return this.device.brightnessMode ?? 'rgb';
  }

  private configureEffectServices(): void {
    const wantedSubtypes = new Set(this.effectSettings.effects.map(effect => effect.subtype));

    for (const existingService of [...this.accessory.services]) {
      if (
        existingService.UUID === this.platform.Service.Switch.UUID
        && existingService.subtype?.startsWith(EFFECT_SERVICE_SUBTYPE_PREFIX)
        && !wantedSubtypes.has(existingService.subtype)
      ) {
        this.accessory.removeService(existingService);
      }
    }

    for (const effect of this.effectSettings.effects) {
      const service = this.accessory.getServiceById(this.platform.Service.Switch, effect.subtype)
        ?? this.accessory.addService(this.platform.Service.Switch, effect.name, effect.subtype);

      service.setCharacteristic(this.platform.Characteristic.Name, effect.name);
      service.getCharacteristic(this.platform.Characteristic.On)
        .onGet(() => this.state.activeEffect === effect.subtype)
        .onSet(value => this.setEffectSwitch(effect, Boolean(value)));

      this.effectServices.set(effect.subtype, service);
    }

    this.updateEffectSwitches();
  }

  private async setEffectSwitch(effect: ResolvedLanternIcEffect, onValue: boolean): Promise<void> {
    if (!onValue) {
      if (this.state.activeEffect !== effect.subtype) {
        this.updateEffectSwitches();
        return;
      }

      this.state.activeEffect = undefined;
      this.saveState();
      this.updateEffectSwitches();

      if (this.effectSettings.restoreColorOnDisable && this.state.on) {
        await this.client.writeCommands(this.buildPowerOnCommands());
      }

      return;
    }

    this.state.on = true;
    this.state.activeEffect = effect.subtype;
    this.saveState();
    this.service.updateCharacteristic(this.platform.Characteristic.On, true);
    this.updateEffectSwitches();

    await this.client.writeCommands(this.buildEffectCommands(effect));
  }

  private updateEffectSwitches(): void {
    for (const [subtype, service] of this.effectServices) {
      service.updateCharacteristic(this.platform.Characteristic.On, this.state.activeEffect === subtype);
    }
  }

  private findEffect(subtype: string | undefined): ResolvedLanternIcEffect | undefined {
    return this.effectSettings.effects.find(effect => effect.subtype === subtype);
  }

  private async resyncAfterReconnect(): Promise<void> {
    if (!this.state.on) {
      return;
    }

    this.platform.log.debug(`[${this.device.name}] Resyncing desired state after BLE reconnect`);

    const activeEffect = this.findEffect(this.state.activeEffect);
    if (activeEffect) {
      await this.client.writeCommands(this.buildEffectCommands(activeEffect));
      return;
    }

    await this.client.writeCommands(this.buildPowerOnCommands());
  }

  private saveState(): void {
    this.accessory.context.state = { ...this.state };
    this.platform.api.updatePlatformAccessories([this.accessory]);
  }
}
