import type { Logging } from 'homebridge';

import type { LanternIcBleConfig, LanternIcDeviceConfig } from '../types.js';
import { delay, withTimeout } from '../util/async.js';
import { normalizeUuid } from '../util/bluetooth.js';
import { SwiftDaemonClient } from '../native/swiftDaemon.js';
import {
  MAGIC_LANTERN_DEFAULT_CHARACTERISTIC_UUID,
  MAGIC_LANTERN_DEFAULT_SERVICE_UUID,
} from './magicLanternCommands.js';
import type {
  CandidateDevice,
  LanternBleClient,
  LanternBleManager,
  MagicLanternDiscoveryOptions,
} from './lanternBleTransport.js';

export interface SwiftLanternBleOptions {
  serviceUuid: string;
  characteristicUuid: string;
  connectTimeoutMs: number;
  scanTimeoutMs: number;
  writeTimeoutMs: number;
  retryAttempts: number;
  retryDelayMs: number;
  maxRetryDelayMs: number;
  reconnectDelayMs: number;
  maxReconnectDelayMs: number;
  writeDelayMs: number;
  keepConnected: boolean;
}

export class SwiftLanternBleManager implements LanternBleManager {
  readonly options: SwiftLanternBleOptions;

  private readonly daemon = new SwiftDaemonClient();
  private queue = Promise.resolve();

  constructor(
    private readonly log: Logging,
    config: LanternIcBleConfig | undefined,
  ) {
    this.options = {
      serviceUuid: normalizeUuid(config?.serviceUuid ?? MAGIC_LANTERN_DEFAULT_SERVICE_UUID),
      characteristicUuid: normalizeUuid(config?.characteristicUuid ?? MAGIC_LANTERN_DEFAULT_CHARACTERISTIC_UUID),
      connectTimeoutMs: config?.connectTimeoutMs ?? 15_000,
      scanTimeoutMs: config?.scanTimeoutMs ?? 15_000,
      writeTimeoutMs: config?.writeTimeoutMs ?? 5_000,
      retryAttempts: config?.retryAttempts ?? 3,
      retryDelayMs: config?.retryDelayMs ?? 500,
      maxRetryDelayMs: config?.maxRetryDelayMs ?? 5_000,
      reconnectDelayMs: config?.reconnectDelayMs ?? 1_000,
      maxReconnectDelayMs: config?.maxReconnectDelayMs ?? 60_000,
      writeDelayMs: config?.writeDelayMs ?? 120,
      keepConnected: config?.keepConnected ?? false,
    };
  }

  createClient(device: LanternIcDeviceConfig): SwiftLanternBleClient {
    return new SwiftLanternBleClient(this.log, this, device);
  }

  async discoverCandidates(timeoutMs: number, options: MagicLanternDiscoveryOptions): Promise<CandidateDevice[]> {
    const response = await this.daemon.request({
      cmd: 'scan',
      timeoutMs,
      namePrefixes: options.namePrefixes,
      serviceUuids: options.serviceUuids,
      minRssi: options.minRssi,
    });

    return response.candidates ?? [];
  }

  async writeFrames(device: LanternIcDeviceConfig, commands: Buffer[]): Promise<void> {
    await this.runExclusive(async () => {
      await this.daemon.request({
        cmd: 'write',
        device: device.address,
        serviceUuid: this.options.serviceUuid,
        characteristicUuid: this.options.characteristicUuid,
        writeWithoutResponse: true,
        frames: commands.map(command => command.toString('hex')),
      });
    });
  }

  async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.queue.then(operation, operation);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );

    return run;
  }
}

export class SwiftLanternBleClient implements LanternBleClient {
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private readonly reconnectHandlers = new Set<() => Promise<void> | void>();
  private reconnectDelayMs: number;

  constructor(
    private readonly log: Logging,
    private readonly manager: SwiftLanternBleManager,
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

    for (let attempt = 1; attempt <= this.manager.options.retryAttempts; attempt += 1) {
      try {
        await withTimeout(
          this.manager.writeFrames(this.device, commands),
          this.manager.options.writeTimeoutMs,
          `Timed out writing to ${this.device.name} through Swift daemon`,
        );

        this.reconnectDelayMs = this.manager.options.reconnectDelayMs;
        return;
      } catch (error) {
        if (attempt >= this.manager.options.retryAttempts) {
          this.scheduleRecoveryReconnect();
          throw error;
        }

        const retryDelay = this.retryDelay(attempt);
        this.log.debug(
          `[${this.device.name}] Swift BLE write failed, retrying in ${retryDelay}ms (${attempt}/${this.manager.options.retryAttempts}):`,
          error instanceof Error ? error.message : String(error),
        );
        await delay(retryDelay);
      }
    }
  }

  async disconnect(reconnect = false): Promise<void> {
    if (!reconnect) {
      this.clearReconnectTimer();
    }
  }

  private retryDelay(attempt: number): number {
    return Math.min(
      this.manager.options.maxRetryDelayMs,
      this.manager.options.retryDelayMs * 2 ** (attempt - 1),
    );
  }

  private scheduleReconnect(delayMs = this.reconnectDelayMs): void {
    this.scheduleReconnectLoop(delayMs, this.manager.options.keepConnected);
  }

  private scheduleRecoveryReconnect(): void {
    if (this.scheduleReconnectLoop(this.manager.options.reconnectDelayMs, true)) {
      this.log.debug(`[${this.device.name}] Scheduled background Swift BLE recovery after failed write`);
    }
  }

  private scheduleReconnectLoop(delayMs: number, enabled: boolean): boolean {
    if (!enabled || this.reconnectTimer) {
      return false;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;

      this.emitReconnect();
      this.reconnectDelayMs = this.manager.options.reconnectDelayMs;
      this.scheduleReconnectLoop(this.reconnectDelayMs, enabled);
    }, delayMs);

    return true;
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
            `[${this.device.name}] Swift reconnect handler failed:`,
            error instanceof Error ? error.message : String(error),
          );
        });
      }, 0);
    }
  }
}
