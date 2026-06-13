export interface NobleAdvertisement {
  localName?: string;
  manufacturerData?: Buffer;
  serviceUuids?: string[];
}

export interface NobleCharacteristic {
  uuid: string;
  properties: string[];
  writeAsync(data: Buffer, withoutResponse: boolean): Promise<void>;
}

export interface NoblePeripheral {
  id: string;
  uuid?: string;
  address?: string;
  advertisement?: NobleAdvertisement;
  connectable?: boolean;
  rssi?: number;
  state?: string;
  connectAsync(): Promise<void>;
  disconnectAsync(): Promise<void>;
  discoverSomeServicesAndCharacteristicsAsync(
    serviceUuids: string[],
    characteristicUuids: string[],
  ): Promise<{
    characteristics: NobleCharacteristic[];
  }>;
  on(event: 'disconnect', listener: () => void): void;
  removeListener(event: 'disconnect', listener: () => void): void;
}

export interface NobleAdapter {
  waitForPoweredOnAsync(timeout?: number): Promise<void>;
  startScanningAsync(serviceUuids?: string[], allowDuplicates?: boolean): Promise<void>;
  stopScanningAsync(): Promise<void>;
  on(event: 'discover', listener: (peripheral: NoblePeripheral) => void): void;
  removeListener(event: 'discover', listener: (peripheral: NoblePeripheral) => void): void;
}
