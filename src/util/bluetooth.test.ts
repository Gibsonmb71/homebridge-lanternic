import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatBluetoothAddress, normalizeBluetoothId, normalizeUuid } from './bluetooth.js';

test('bluetooth utilities normalize ids and uuids', () => {
  assert.equal(normalizeBluetoothId('BE:16:70:00:08:2A'), 'be167000082a');
  assert.equal(normalizeBluetoothId('3CE16196-9C28-0342-F1CB-C8DAC2B53DC5'), '3ce161969c280342f1cbc8dac2b53dc5');
  assert.equal(normalizeUuid('FFF0'), 'fff0');
});

test('bluetooth utilities format MAC-looking ids while leaving CoreBluetooth ids intact', () => {
  assert.equal(formatBluetoothAddress('be167000082a'), 'be:16:70:00:08:2a');
  assert.equal(formatBluetoothAddress('3ce161969c280342f1cbc8dac2b53dc5'), '3ce161969c280342f1cbc8dac2b53dc5');
});
