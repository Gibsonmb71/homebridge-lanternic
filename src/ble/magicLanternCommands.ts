import { clampByte, clampPercent, type RgbColor } from '../color.js';
import type { BrightnessMode, PowerMode } from '../types.js';

export const MAGIC_LANTERN_DEFAULT_SERVICE_UUID = 'fff0';
export const MAGIC_LANTERN_DEFAULT_CHARACTERISTIC_UUID = 'fff3';

const frame = (...bytes: number[]): Buffer => Buffer.from(bytes.map(clampByte));

export const buildPowerCommand = (on: boolean): Buffer => {
  return on
    ? Buffer.from('7e0404f00001ff00ef', 'hex')
    : Buffer.from('7e0404000000ff00ef', 'hex');
};

export const buildColorCommand = ({ red, green, blue }: RgbColor): Buffer => {
  return frame(0x7e, 0x07, 0x05, 0x03, red, green, blue, 0x10, 0xef);
};

export const buildBrightnessCommand = (brightness: number): Buffer => {
  return frame(0x7e, 0x04, 0x01, clampPercent(brightness), 0x01, 0xff, 0xff, 0x00, 0xef);
};

export const shouldUseNativePower = (powerMode: PowerMode = 'both'): boolean => {
  return powerMode === 'native' || powerMode === 'both';
};

export const shouldUseRgbBlackOff = (powerMode: PowerMode = 'both'): boolean => {
  return powerMode === 'rgbBlack' || powerMode === 'both';
};

export const shouldUseNativeBrightness = (brightnessMode: BrightnessMode = 'rgb'): boolean => {
  return brightnessMode === 'native' || brightnessMode === 'both';
};

export const shouldScaleRgbBrightness = (brightnessMode: BrightnessMode = 'rgb'): boolean => {
  return brightnessMode === 'rgb' || brightnessMode === 'both';
};

export const buildNativeBrightnessCommands = (
  brightness: number,
  brightnessMode: BrightnessMode = 'rgb',
): Buffer[] => {
  return shouldUseNativeBrightness(brightnessMode) ? [buildBrightnessCommand(brightness)] : [];
};

export const buildPowerOnPrefixCommands = (
  powerMode: PowerMode = 'both',
  brightnessMode: BrightnessMode = 'rgb',
  brightness = 100,
): Buffer[] => {
  return [
    ...(shouldUseNativePower(powerMode) ? [buildPowerCommand(true)] : []),
    ...buildNativeBrightnessCommands(brightness, brightnessMode),
  ];
};

export const buildPowerOffCommands = (powerMode: PowerMode = 'both'): Buffer[] => {
  return [
    ...(shouldUseRgbBlackOff(powerMode) ? [buildColorCommand({ red: 0, green: 0, blue: 0 })] : []),
    ...(shouldUseNativePower(powerMode) ? [buildPowerCommand(false)] : []),
  ];
};

export const buildEffectSpeedCommand = (speed: number): Buffer => {
  return frame(0x7e, 0x04, 0x02, clampPercent(speed), 0xff, 0xff, 0xff, 0x00, 0xef);
};

export const buildBasicEffectCommand = (effectCode: number): Buffer => {
  return frame(0x7e, 0x05, 0x03, effectCode, 0x06, 0xff, 0xff, 0x00, 0xef);
};

export const buildBasicEffectCommands = (effectCode: number, speed: number): Buffer[] => {
  return [
    buildEffectSpeedCommand(speed),
    buildBasicEffectCommand(effectCode),
  ];
};
