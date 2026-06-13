import { describe, expect, it } from 'vitest';

import { formatBluetoothAddress, normalizeBluetoothId, normalizeUuid } from './bluetooth.js';

describe('bluetooth utilities', () => {
  it('normalizes ids and uuids', () => {
    expect(normalizeBluetoothId('BE:16:70:00:08:2A')).toBe('be167000082a');
    expect(normalizeBluetoothId('3CE16196-9C28-0342-F1CB-C8DAC2B53DC5')).toBe('3ce161969c280342f1cbc8dac2b53dc5');
    expect(normalizeUuid('FFF0')).toBe('fff0');
  });

  it('formats MAC-looking ids while leaving CoreBluetooth ids intact', () => {
    expect(formatBluetoothAddress('be167000082a')).toBe('be:16:70:00:08:2a');
    expect(formatBluetoothAddress('3ce161969c280342f1cbc8dac2b53dc5')).toBe('3ce161969c280342f1cbc8dac2b53dc5');
  });
});
