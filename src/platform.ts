import type {
  API,
  Characteristic,
  DynamicPlatformPlugin,
  Logging,
  PlatformAccessory,
  Service,
} from 'homebridge';

import { MagicLanternBleManager, type CandidateDevice } from './ble/magicLanternBleManager.js';
import { LanternIcPlatformAccessory } from './platformAccessory.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';
import type { LanternIcAccessoryContext, LanternIcDeviceConfig, LanternIcPlatformConfig } from './types.js';
import { formatBluetoothAddress, normalizeBluetoothId } from './util/bluetooth.js';

export class LanternIcPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;
  public readonly ble: MagicLanternBleManager;

  private readonly accessories = new Map<string, PlatformAccessory<LanternIcAccessoryContext>>();

  constructor(
    public readonly log: Logging,
    public readonly config: LanternIcPlatformConfig,
    public readonly api: API,
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;
    this.ble = new MagicLanternBleManager(log, config.ble);

    this.api.on('didFinishLaunching', () => {
      this.log.debug('LanternIC didFinishLaunching');
      void this.setupAccessories().catch(error => {
        this.log.error(
          'LanternIC setup failed:',
          error instanceof Error ? error.message : String(error),
        );
      });
    });
  }

  configureAccessory(accessory: PlatformAccessory<LanternIcAccessoryContext>): void {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    this.accessories.set(accessory.UUID, accessory);
  }

  private async setupAccessories(): Promise<void> {
    const devices = this.validDevices();
    const activeUuids = new Set<string>();

    for (const device of devices) {
      activeUuids.add(this.registerDeviceAccessory(device, false));
    }

    const discoverySucceeded = await this.discoverAndMaybeRegister(devices, activeUuids);

    for (const [uuid, accessory] of this.accessories) {
      if (activeUuids.has(uuid)) {
        continue;
      }

      if (this.discoveryAutoAdd(devices) && accessory.context.autoDiscovered) {
        const reason = discoverySucceeded ? 'it was previously auto-discovered' : 'discovery scan failed';
        this.log.info(`Keeping cached auto-discovered accessory because ${reason}:`, accessory.displayName);
        continue;
      }

      this.log.info('Removing accessory no longer in LanternIC config:', accessory.displayName);
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    }
  }

  private registerDeviceAccessory(device: LanternIcDeviceConfig, autoDiscovered: boolean): string {
    const uuid = this.api.hap.uuid.generate(this.deviceUniqueId(device));
    const existingAccessory = this.accessories.get(uuid);

    if (existingAccessory) {
      this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);
      existingAccessory.context.device = device;
      existingAccessory.context.autoDiscovered = autoDiscovered;
      this.api.updatePlatformAccessories([existingAccessory]);
      new LanternIcPlatformAccessory(this, existingAccessory);
    } else {
      this.log.info('Adding new accessory:', device.name, formatBluetoothAddress(device.address));
      const accessory = new this.api.platformAccessory(device.name, uuid) as PlatformAccessory<LanternIcAccessoryContext>;
      accessory.context.device = device;
      accessory.context.autoDiscovered = autoDiscovered;
      new LanternIcPlatformAccessory(this, accessory);
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      this.accessories.set(uuid, accessory);
    }

    return uuid;
  }

  private async discoverAndMaybeRegister(
    configuredDevices: LanternIcDeviceConfig[],
    activeUuids: Set<string>,
  ): Promise<boolean> {
    if (this.config.discovery?.enabled === false) {
      return true;
    }

    const scanSeconds = this.config.discovery?.scanSeconds ?? 15;
    const namePrefixes = this.config.discovery?.namePrefixes ?? [
      'Triones',
      'MELK',
      'ELK-BLEDOM',
      'LED',
      'OA',
    ];
    const serviceUuids = this.config.discovery?.serviceUuids ?? [
      this.config.ble?.serviceUuid ?? 'fff0',
    ];

    try {
      this.log.info(`Scanning ${scanSeconds}s for Magic Lantern BLE candidates...`);
      const candidates = await this.ble.discoverCandidates(scanSeconds * 1000, {
        minRssi: this.config.discovery?.minRssi,
        namePrefixes,
        serviceUuids,
      });

      if (candidates.length === 0) {
        this.log.info('No Magic Lantern BLE candidates found during discovery scan.');
        return true;
      }

      for (const candidate of candidates) {
        this.logCandidate(candidate);

        if (!this.discoveryAutoAdd(configuredDevices) || this.isConfigured(candidate, configuredDevices)) {
          continue;
        }

        const device = this.deviceFromCandidate(candidate);
        activeUuids.add(this.registerDeviceAccessory(device, true));
      }

      return true;
    } catch (error) {
      this.log.warn(
        'BLE discovery scan failed:',
        error instanceof Error ? error.message : String(error),
      );
      return false;
    }
  }

  private logCandidate(candidate: CandidateDevice): void {
    const address = candidate.address ? formatBluetoothAddress(candidate.address) : candidate.id;
    const rssi = typeof candidate.rssi === 'number' ? ` RSSI=${candidate.rssi}` : '';
    const services = candidate.serviceUuids.length > 0 ? ` services=${candidate.serviceUuids.join(',')}` : '';
    this.log.info(`Discovered BLE candidate: ${candidate.name || '(unnamed)'} address=${address}${rssi}${services}`);
    this.log.info(`LanternIC device config: ${JSON.stringify(this.deviceFromCandidate(candidate))}`);
  }

  private deviceFromCandidate(candidate: CandidateDevice): LanternIcDeviceConfig {
    return {
      name: candidate.name || `LanternIC ${candidate.id.slice(-6)}`,
      address: candidate.address || candidate.id,
      manufacturer: 'Magic Lantern',
      model: 'Magic Lantern RGBIC',
      colorOrder: 'rgb',
    };
  }

  private isConfigured(candidate: CandidateDevice, devices: LanternIcDeviceConfig[]): boolean {
    const candidateId = normalizeBluetoothId(candidate.address || candidate.id);

    return devices.some(device => normalizeBluetoothId(device.address) === candidateId);
  }

  private discoveryAutoAdd(configuredDevices: LanternIcDeviceConfig[]): boolean {
    return this.config.discovery?.autoAdd === true
      || (this.firstSetupAutoMode() && configuredDevices.length === 0);
  }

  private firstSetupAutoMode(): boolean {
    return this.config.setupMode !== 'manual';
  }

  private validDevices(): LanternIcDeviceConfig[] {
    const devices = this.config.devices ?? [];

    return devices.filter((device): device is LanternIcDeviceConfig => {
      if (!device?.name || !device.address) {
        this.log.warn('Skipping LanternIC device with missing name or address');
        return false;
      }

      return true;
    });
  }

  private deviceUniqueId(device: LanternIcDeviceConfig): string {
    return `lanternic:${normalizeBluetoothId(device.address)}`;
  }
}
