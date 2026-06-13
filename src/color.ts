import type { ColorOrder } from './types.js';

export interface RgbColor {
  red: number;
  green: number;
  blue: number;
}

export const clampByte = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(255, Math.round(value)));
};

export const clampPercent = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(value)));
};

export const hsbToRgb = (hue: number, saturation: number, brightness: number): RgbColor => {
  const h = ((hue % 360) + 360) % 360;
  const s = Math.max(0, Math.min(100, saturation)) / 100;
  const v = Math.max(0, Math.min(100, brightness)) / 100;

  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;

  let red = 0;
  let green = 0;
  let blue = 0;

  if (h < 60) {
    red = c;
    green = x;
  } else if (h < 120) {
    red = x;
    green = c;
  } else if (h < 180) {
    green = c;
    blue = x;
  } else if (h < 240) {
    green = x;
    blue = c;
  } else if (h < 300) {
    red = x;
    blue = c;
  } else {
    red = c;
    blue = x;
  }

  return {
    red: clampByte((red + m) * 255),
    green: clampByte((green + m) * 255),
    blue: clampByte((blue + m) * 255),
  };
};

export const applyColorOrder = (color: RgbColor, colorOrder: ColorOrder = 'rgb'): RgbColor => {
  const values = {
    r: color.red,
    g: color.green,
    b: color.blue,
  };

  return {
    red: values[colorOrder[0] as keyof typeof values],
    green: values[colorOrder[1] as keyof typeof values],
    blue: values[colorOrder[2] as keyof typeof values],
  };
};
