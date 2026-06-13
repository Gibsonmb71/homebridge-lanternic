import type { Logging } from 'homebridge';
import { withBindings, type HciBindingsOptions } from '@stoprocent/noble';

import type { HciDriver, LanternIcBleConfig, LanternIcDeviceConfig, NobleBinding, WriteMode } from '../types.js';
import { delay, withTimeout } from '../util/async.js';
import { formatBluetoothAddress, normalizeBluetoothId, normalizeUuid } from '../util/bluetooth.js';
import {
  MAGIC_LANTERN_DEFAULT_CHARACTERISTIC_UUID,
  MAGIC_LANTERN_DEFAULT_SERVICE_UUID,
} from './magicLanternCommands.js';
import type { NobleAdapter, NobleCharacteristic, NoblePeripheral } from './nobleTypes.js';

export interface MagicLanternBleOptions {
  binding: NobleBinding;
  hciDriver: HciDriver;
  hciDeviceId: number;
  hciUserChannel: boolean;
  hciExtended?: boolean;
  serviceUuid: string;
  characteristicUuid: string;
  keepConnected: boolean;
  connectTimeoutMs: number;
  scanTimeoutMs: number;
  writeTimeoutMs: number;
  retryAttempts: number;
  retryDelayMs: number;
  maxRetryDelayMs: number;
  reconnectDelayMs: number;
  maxReconnectDelayMs: number;
  writeDelayMs: number;
  idleDisconnectMs: number;
  writeMode: WriteMode;
}

export interface CandidateDevice {
  id: string;
  address?: string;
  connectable?: boolean;
  manufacturerData?: string;
  name: string;
  rssi?: number;
  serviceUuids: string[];
}

export interface MagicLanternDiscoveryOptions {
  namePrefixes: string[];
  serviceUuids: string[];
  minRssi?: number;
}

export class MagicLanternBleManager {
  readonly options: MagicLanternBleOptions;

  private readonly noble: NobleAdapter;
  private queue = Promise.resolve();

  constructor(
    private readonly log: Logging,
    config: LanternIcBleConfig | undefined,
  ) {
    this.options = {
      binding: config?.binding ?? 'default',
      hciDriver: config?.hciDriver ?? 'native',
      hciDeviceId: config?.hciDeviceId ?? 0,
      hciUserChannel: config?.hciUserChannel ?? false,
      hciExtended: config?.hciExtended,
      serviceUuid: normalizeUuid(config?.serviceUuid ?? MAGIC_LANTERN_DEFAULT_SERVICE_UUID),
      characteristicUuid: normalizeUuid(config?.characteristicUuid ?? MAGIC_LANTERN_DEFAULT_CHARACTERISTIC_UUID),
      keepConnected: config?.keepConnected ?? false,
      connectTimeoutMs: config?.connectTimeoutMs ?? 15_000,
      scanTimeoutMs: config?.scanTimeoutMs ?? 15_000,
      writeTimeoutMs: config?.writeTimeoutMs ?? 5_000,
      retryAttempts: config?.retryAttempts ?? 3,
      retryDelayMs: config?.retryDelayMs ?? 500,
      maxRetryDelayMs: config?.maxRetryDelayMs ?? 5_000,
      reconnectDelayMs: config?.reconnectDelayMs ?? 1_000,
      maxReconnectDelayMs: config?.maxReconnectDelayMs ?? 60_000,
      writeDelayMs: config?.writeDelayMs ?? 120,
      idleDisconnectMs: config?.idleDisconnectMs ?? 30_000,
      writeMode: config?.writeMode ?? 'auto',
    };

    this.noble = withBindings(this.options.binding, this.bindingOptions()) as unknown as NobleAdapter;
  }

  createClient(device: LanternIcDeviceConfig): MagicLanternBleClient {
    return new MagicLanternBleClient(this.log, this, device);
  }

  async discoverCandidates(timeoutMs: number, options: MagicLanternDiscoveryOptions): Promise<CandidateDevice[]> {
    return this.runExclusive(async () => {
      await this.noble.waitForPoweredOnAsync(this.options.connectTimeoutMs);

      const candidates = new Map<string, CandidateDevice>();
      const normalizedPrefixes = options.namePrefixes.map(prefix => prefix.toLowerCase());
      const normalizedServiceUuids = options.serviceUuids.map(normalizeUuid);

      await this.noble.startScanningAsync([], true);

      try {
        await new Promise<void>(resolve => {
          const onDiscover = (peripheral: NoblePeripheral) => {
            const name = peripheral.advertisement?.localName ?? '';
            const serviceUuids = peripheral.advertisement?.serviceUuids?.map(normalizeUuid) ?? [];
            const matchesPrefix = Boolean(name)
              && normalizedPrefixes.some(prefix => name.toLowerCase().startsWith(prefix));
            const matchesService = normalizedServiceUuids.length > 0
              && serviceUuids.some(serviceUuid => normalizedServiceUuids.includes(serviceUuid));
            const matchesRssi = typeof options.minRssi !== 'number'
              || typeof peripheral.rssi !== 'number'
              || peripheral.rssi >= options.minRssi;

            if ((!matchesPrefix && !matchesService) || !matchesRssi) {
              return;
            }

            const id = this.peripheralId(peripheral);
            candidates.set(normalizeBluetoothId(id), {
              id,
              address: peripheral.address || undefined,
              connectable: peripheral.connectable,
              manufacturerData: peripheral.advertisement?.manufacturerData?.toString('hex'),
              name,
              rssi: peripheral.rssi,
              serviceUuids,
            });
          };

          this.noble.on('discover', onDiscover);

          setTimeout(() => {
            this.noble.removeListener('discover', onDiscover);
            resolve();
          }, timeoutMs);
        });
      } finally {
        await this.noble.stopScanningAsync();
      }

      return [...candidates.values()];
    });
  }

  private bindingOptions(): HciBindingsOptions | undefined {
    const shouldUseHciOptions = this.options.binding === 'hci'
      || (this.options.binding === 'default' && process.platform === 'linux');

    if (!shouldUseHciOptions) {
      return undefined;
    }

    return {
      deviceId: this.options.hciDeviceId,
      extended: this.options.hciExtended,
      hciDriver: this.options.hciDriver,
      userChannel: this.options.hciUserChannel,
    };
  }

  async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.queue.then(operation, operation);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );

    return run;
  }

  async findPeripheral(device: LanternIcDeviceConfig): Promise<NoblePeripheral> {
    await this.noble.waitForPoweredOnAsync(this.options.connectTimeoutMs);
    await this.noble.startScanningAsync([], true);

    let onDiscover: ((peripheral: NoblePeripheral) => void) | undefined;

    try {
      return await withTimeout(
        new Promise<NoblePeripheral>((resolve) => {
          onDiscover = (peripheral: NoblePeripheral) => {
            if (!this.matchesDevice(peripheral, device)) {
              return;
            }

            if (onDiscover) {
              this.noble.removeListener('discover', onDiscover);
            }
            resolve(peripheral);
          };

          this.noble.on('discover', onDiscover);
        }),
        this.options.scanTimeoutMs,
        `Timed out scanning for ${device.name} (${formatBluetoothAddress(device.address)})`,
      );
    } finally {
      if (onDiscover) {
        this.noble.removeListener('discover', onDiscover);
      }
      await this.noble.stopScanningAsync();
    }
  }

  private matchesDevice(peripheral: NoblePeripheral, device: LanternIcDeviceConfig): boolean {
    const configuredId = normalizeBluetoothId(device.address);
    const discoveredIds = [
      peripheral.id,
      peripheral.uuid,
      peripheral.address,
    ].filter((value): value is string => Boolean(value)).map(normalizeBluetoothId);

    return discoveredIds.includes(configuredId);
  }

  private peripheralId(peripheral: NoblePeripheral): string {
    return peripheral.address || peripheral.uuid || peripheral.id;
  }
}

export class MagicLanternBleClient {
  private peripheral?: NoblePeripheral;
  private characteristic?: NobleCharacteristic;
  private idleTimer?: ReturnType<typeof setTimeout>;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private readonly reconnectHandlers = new Set<() => Promise<void> | void>();
  private reconnectDelayMs: number;
  private expectedDisconnect = false;
  private disconnectListener?: () => void;

  constructor(
    private readonly log: Logging,
    private readonly manager: MagicLanternBleManager,
    private readonly device: LanternIcDeviceConfig,
  ) {
    this.reconnectDelayMs = this.manager.options.reconnectDelayMs;
  }

  onReconnect(handler: () => Promise<void> | void): () => void {
    this.reconnectHandlers.add(handler);

    return () => {
      this.reconnectHandlers.delete(handler);
    };
  }

  start(): void {
    if (!this.manager.options.keepConnected) {
      return;
    }

    this.scheduleReconnect(0);
  }

  async writeCommands(commands: Buffer[]): Promise<void> {
    this.clearReconnectTimer();

    await this.manager.runExclusive(async () => {
      for (let attempt = 1; attempt <= this.manager.options.retryAttempts; attempt += 1) {
        try {
          await this.ensureConnected();

          for (const command of commands) {
            await this.write(command);
            await delay(this.manager.options.writeDelayMs);
          }

          this.scheduleIdleDisconnect();
          this.reconnectDelayMs = this.manager.options.reconnectDelayMs;
          return;
        } catch (error) {
          await this.disconnect(false);

          if (attempt >= this.manager.options.retryAttempts) {
            this.scheduleReconnect();
            throw error;
          }

          const retryDelay = this.retryDelay(attempt);
          this.log.debug(
            `[${this.device.name}] BLE write failed, retrying in ${retryDelay}ms (${attempt}/${this.manager.options.retryAttempts}):`,
            error instanceof Error ? error.message : String(error),
          );
          await delay(retryDelay);
        }
      }
    });
  }

  async disconnect(reconnect = false): Promise<void> {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
    }

    if (!reconnect) {
      this.clearReconnectTimer();
    }

    const peripheral = this.peripheral;
    const listener = this.disconnectListener;
    this.peripheral = undefined;
    this.characteristic = undefined;
    this.disconnectListener = undefined;

    if (peripheral?.state === 'connected') {
      if (listener) {
        peripheral.removeListener('disconnect', listener);
      }

      this.expectedDisconnect = true;
      try {
        await withTimeout(
          peripheral.disconnectAsync(),
          this.manager.options.connectTimeoutMs,
          `Timed out disconnecting from ${this.device.name}`,
        );
      } finally {
        this.expectedDisconnect = false;
      }
    } else if (listener && peripheral) {
      peripheral.removeListener('disconnect', listener);
    }
  }

  private async ensureConnected(): Promise<void> {
    if (this.peripheral?.state === 'connected' && this.characteristic) {
      return;
    }

    const peripheral = await this.manager.findPeripheral(this.device);

    this.disconnectListener = () => {
      this.log.debug(`[${this.device.name}] BLE peripheral disconnected`);
      this.peripheral = undefined;
      this.characteristic = undefined;
      this.disconnectListener = undefined;

      if (!this.expectedDisconnect) {
        this.scheduleReconnect();
      }
    };
    peripheral.on('disconnect', this.disconnectListener);

    await withTimeout(
      peripheral.connectAsync(),
      this.manager.options.connectTimeoutMs,
      `Timed out connecting to ${this.device.name}`,
    );

    const { characteristics } = await peripheral.discoverSomeServicesAndCharacteristicsAsync(
      [this.manager.options.serviceUuid],
      [this.manager.options.characteristicUuid],
    );

    const characteristic = characteristics[0];

    if (!characteristic) {
      await peripheral.disconnectAsync();
      throw new Error(
        `Missing Magic Lantern characteristic ${this.manager.options.serviceUuid}/${this.manager.options.characteristicUuid}`,
      );
    }

    this.peripheral = peripheral;
    this.characteristic = characteristic;
    this.reconnectDelayMs = this.manager.options.reconnectDelayMs;
    this.log.debug(`[${this.device.name}] BLE connected`);
  }

  private async write(command: Buffer): Promise<void> {
    if (!this.characteristic) {
      throw new Error(`Cannot write to ${this.device.name}; BLE characteristic is not ready`);
    }

    const withoutResponse = this.shouldWriteWithoutResponse(this.characteristic);
    this.log.debug(`[${this.device.name}] BLE write ${command.toString('hex')} withoutResponse=${withoutResponse}`);
    await withTimeout(
      this.characteristic.writeAsync(command, withoutResponse),
      this.manager.options.writeTimeoutMs,
      `Timed out writing to ${this.device.name}`,
    );
  }

  private shouldWriteWithoutResponse(characteristic: NobleCharacteristic): boolean {
    if (this.manager.options.writeMode === 'withResponse') {
      return false;
    }

    if (this.manager.options.writeMode === 'withoutResponse') {
      return true;
    }

    return !characteristic.properties.includes('write') && characteristic.properties.includes('writeWithoutResponse');
  }

  private scheduleIdleDisconnect(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
    }

    if (this.manager.options.keepConnected || this.manager.options.idleDisconnectMs <= 0) {
      return;
    }

    this.idleTimer = setTimeout(() => {
      this.disconnect(false).catch(error => {
        this.log.debug(
          `[${this.device.name}] Idle disconnect failed:`,
          error instanceof Error ? error.message : String(error),
        );
      });
    }, this.manager.options.idleDisconnectMs);
  }

  private retryDelay(attempt: number): number {
    return Math.min(
      this.manager.options.maxRetryDelayMs,
      this.manager.options.retryDelayMs * 2 ** (attempt - 1),
    );
  }

  private scheduleReconnect(delayMs = this.reconnectDelayMs): void {
    if (!this.manager.options.keepConnected || this.reconnectTimer) {
      return;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;

      void this.manager.runExclusive(async () => {
        try {
          await this.ensureConnected();
          this.log.debug(`[${this.device.name}] BLE reconnect complete`);
          this.reconnectDelayMs = this.manager.options.reconnectDelayMs;
          this.emitReconnect();
        } catch (error) {
          this.log.debug(
            `[${this.device.name}] BLE reconnect failed:`,
            error instanceof Error ? error.message : String(error),
          );
          this.reconnectDelayMs = Math.min(
            this.manager.options.maxReconnectDelayMs,
            Math.max(this.manager.options.reconnectDelayMs, this.reconnectDelayMs * 2),
          );
          this.scheduleReconnect();
        }
      });
    }, delayMs);
  }

  private clearReconnectTimer(): void {
    if (!this.reconnectTimer) {
      return;
    }

    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
  }

  private emitReconnect(): void {
    for (const handler of this.reconnectHandlers) {
      setTimeout(() => {
        Promise.resolve(handler()).catch(error => {
          this.log.debug(
            `[${this.device.name}] Reconnect handler failed:`,
            error instanceof Error ? error.message : String(error),
          );
        });
      }, 0);
    }
  }
}
