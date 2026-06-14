import assert from 'node:assert/strict';
import { test } from 'node:test';

import { applyColorOrder, clampByte, clampPercent, hsbToRgb } from './color.js';

test('color helpers clamp byte and percent values', () => {
  assert.equal(clampByte(-1), 0);
  assert.equal(clampByte(42.4), 42);
  assert.equal(clampByte(255.9), 255);
  assert.equal(clampByte(Number.NaN), 0);

  assert.equal(clampPercent(-1), 0);
  assert.equal(clampPercent(42.6), 43);
  assert.equal(clampPercent(101), 100);
  assert.equal(clampPercent(Number.NaN), 0);
});

test('color helpers convert HomeKit hue, saturation, brightness values to RGB', () => {
  assert.deepEqual(hsbToRgb(0, 100, 100), { red: 255, green: 0, blue: 0 });
  assert.deepEqual(hsbToRgb(120, 100, 100), { red: 0, green: 255, blue: 0 });
  assert.deepEqual(hsbToRgb(240, 100, 100), { red: 0, green: 0, blue: 255 });
  assert.deepEqual(hsbToRgb(60, 100, 50), { red: 128, green: 128, blue: 0 });
});

test('color helpers reorder RGB channels for strip variants', () => {
  const color = { red: 1, green: 2, blue: 3 };

  assert.deepEqual(applyColorOrder(color, 'rgb'), { red: 1, green: 2, blue: 3 });
  assert.deepEqual(applyColorOrder(color, 'grb'), { red: 2, green: 1, blue: 3 });
  assert.deepEqual(applyColorOrder(color, 'bgr'), { red: 3, green: 2, blue: 1 });
});
