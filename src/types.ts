import type { PlatformConfig } from 'homebridge';

export type ColorOrder = 'rgb' | 'rbg' | 'grb' | 'gbr' | 'brg' | 'bgr';

export type PowerMode = 'native' | 'rgbBlack' | 'both';

export type BrightnessMode = 'rgb' | 'native' | 'both';

export type NobleBinding = 'default' | 'hci' | 'mac' | 'win';

export type HciDriver = 'default' | 'native' | 'usb' | 'uart';

export type WriteMode = 'auto' | 'withResponse' | 'withoutResponse';

export interface LanternIcEffectConfig {
  name: string;
  code: number;
  id?: string;
  speed?: number;
}

export interface LanternIcEffectsConfig {
  enabled?: boolean;
  defaultSpeed?: number;
  restoreColorOnDisable?: boolean;
  items?: LanternIcEffectConfig[];
}

export interface LanternIcDeviceConfig {
  name: string;
  address: string;
  manufacturer?: string;
  model?: string;
  colorOrder?: ColorOrder;
  powerMode?: PowerMode;
  brightnessMode?: BrightnessMode;
  effects?: LanternIcEffectsConfig;
}

export interface LanternIcDiscoveryConfig {
  enabled?: boolean;
  autoAdd?: boolean;
  scanSeconds?: number;
  minRssi?: number;
  namePrefixes?: string[];
  serviceUuids?: string[];
}

export interface LanternIcBleConfig {
  binding?: NobleBinding;
  hciDriver?: HciDriver;
  hciDeviceId?: number;
  hciUserChannel?: boolean;
  hciExtended?: boolean;
  serviceUuid?: string;
  characteristicUuid?: string;
  keepConnected?: boolean;
  connectTimeoutMs?: number;
  scanTimeoutMs?: number;
  writeTimeoutMs?: number;
  retryAttempts?: number;
  retryDelayMs?: number;
  maxRetryDelayMs?: number;
  reconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
  writeDelayMs?: number;
  idleDisconnectMs?: number;
  writeMode?: WriteMode;
}

export interface LanternIcPlatformConfig extends PlatformConfig {
  name?: string;
  devices?: LanternIcDeviceConfig[];
  discovery?: LanternIcDiscoveryConfig;
  ble?: LanternIcBleConfig;
}

export interface LanternIcStoredState {
  on?: boolean;
  brightness?: number;
  hue?: number;
  saturation?: number;
  activeEffect?: string;
}

export interface LanternIcAccessoryContext {
  autoDiscovered?: boolean;
  device?: LanternIcDeviceConfig;
  state?: LanternIcStoredState;
}
