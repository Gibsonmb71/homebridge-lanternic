import { describe, expect, it } from 'vitest';

import { applyColorOrder, clampByte, clampPercent, hsbToRgb } from './color.js';

describe('color helpers', () => {
  it('clamps byte and percent values', () => {
    expect(clampByte(-1)).toBe(0);
    expect(clampByte(42.4)).toBe(42);
    expect(clampByte(255.9)).toBe(255);
    expect(clampByte(Number.NaN)).toBe(0);

    expect(clampPercent(-1)).toBe(0);
    expect(clampPercent(42.6)).toBe(43);
    expect(clampPercent(101)).toBe(100);
    expect(clampPercent(Number.NaN)).toBe(0);
  });

  it('converts HomeKit hue, saturation, brightness values to RGB', () => {
    expect(hsbToRgb(0, 100, 100)).toEqual({ red: 255, green: 0, blue: 0 });
    expect(hsbToRgb(120, 100, 100)).toEqual({ red: 0, green: 255, blue: 0 });
    expect(hsbToRgb(240, 100, 100)).toEqual({ red: 0, green: 0, blue: 255 });
    expect(hsbToRgb(60, 100, 50)).toEqual({ red: 128, green: 128, blue: 0 });
  });

  it('reorders RGB channels for strip variants', () => {
    const color = { red: 1, green: 2, blue: 3 };

    expect(applyColorOrder(color, 'rgb')).toEqual({ red: 1, green: 2, blue: 3 });
    expect(applyColorOrder(color, 'grb')).toEqual({ red: 2, green: 1, blue: 3 });
    expect(applyColorOrder(color, 'bgr')).toEqual({ red: 3, green: 2, blue: 1 });
  });
});
