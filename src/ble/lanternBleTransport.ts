import type { LanternIcDeviceConfig } from '../types.js';

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

export interface LanternBleClient {
  onReconnect(handler: () => Promise<void> | void): () => void;
  start(): void;
  writeCommands(commands: Buffer[]): Promise<void>;
  disconnect(reconnect?: boolean): Promise<void>;
}

export interface LanternBleManager {
  createClient(device: LanternIcDeviceConfig): LanternBleClient;
  discoverCandidates(timeoutMs: number, options: MagicLanternDiscoveryOptions): Promise<CandidateDevice[]>;
}
