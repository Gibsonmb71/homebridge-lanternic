const BLUETOOTH_ID_PATTERN = /[^0-9a-f]/gi;

export const normalizeBluetoothId = (value: string): string => {
  return value.replace(BLUETOOTH_ID_PATTERN, '').toLowerCase();
};

export const formatBluetoothAddress = (value: string): string => {
  const normalized = normalizeBluetoothId(value);

  if (normalized.length !== 12) {
    return value;
  }

  return normalized.match(/.{1,2}/g)?.join(':') ?? value;
};

export const normalizeUuid = (value: string): string => {
  return value.replace(BLUETOOTH_ID_PATTERN, '').toLowerCase();
};
