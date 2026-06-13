import { describe, expect, it } from 'vitest';

import {
  buildBasicEffectCommand,
  buildBrightnessCommand,
  buildColorCommand,
  buildEffectSpeedCommand,
  buildNativeBrightnessCommands,
  buildPowerOffCommands,
  buildPowerOnPrefixCommands,
  buildPowerCommand,
  shouldScaleRgbBrightness,
  shouldUseNativeBrightness,
} from './magicLanternCommands.js';

const hex = (commands: Buffer[]): string[] => commands.map(command => command.toString('hex'));

describe('Magic Lantern command builders', () => {
  it('builds on and off commands', () => {
    expect(buildPowerCommand(true).toString('hex')).toBe('7e0404f00001ff00ef');
    expect(buildPowerCommand(false).toString('hex')).toBe('7e0404000000ff00ef');
  });

  it('builds RGB commands', () => {
    expect(buildColorCommand({ red: 0, green: 0, blue: 255 }).toString('hex')).toBe('7e0705030000ff10ef');
    expect(buildColorCommand({ red: 255, green: 128, blue: 0 }).toString('hex')).toBe('7e070503ff800010ef');
  });

  it('builds brightness commands using the 0-100 Magic Lantern frame', () => {
    expect(buildBrightnessCommand(0).toString('hex')).toBe('7e04010001ffff00ef');
    expect(buildBrightnessCommand(70).toString('hex')).toBe('7e04014601ffff00ef');
    expect(buildBrightnessCommand(100).toString('hex')).toBe('7e04016401ffff00ef');
  });

  it('clamps brightness command values', () => {
    expect(buildBrightnessCommand(-1).toString('hex')).toBe('7e04010001ffff00ef');
    expect(buildBrightnessCommand(101).toString('hex')).toBe('7e04016401ffff00ef');
  });

  it('builds resilient default power-off commands', () => {
    expect(hex(buildPowerOffCommands())).toEqual([
      '7e07050300000010ef',
      '7e0404000000ff00ef',
    ]);
  });

  it('supports native-only and RGB-black-only power modes', () => {
    expect(hex(buildPowerOffCommands('native'))).toEqual(['7e0404000000ff00ef']);
    expect(hex(buildPowerOffCommands('rgbBlack'))).toEqual(['7e07050300000010ef']);
  });

  it('defaults brightness to RGB scaling without native brightness frames', () => {
    expect(shouldScaleRgbBrightness()).toBe(true);
    expect(shouldUseNativeBrightness()).toBe(false);
    expect(hex(buildNativeBrightnessCommands(70))).toEqual([]);
  });

  it('supports native and combined brightness modes', () => {
    expect(shouldScaleRgbBrightness('native')).toBe(false);
    expect(shouldUseNativeBrightness('native')).toBe(true);
    expect(hex(buildNativeBrightnessCommands(70, 'native'))).toEqual(['7e04014601ffff00ef']);
    expect(shouldScaleRgbBrightness('both')).toBe(true);
    expect(shouldUseNativeBrightness('both')).toBe(true);
    expect(hex(buildNativeBrightnessCommands(70, 'both'))).toEqual(['7e04014601ffff00ef']);
  });

  it('builds power-on prefixes from selected power and brightness modes', () => {
    expect(hex(buildPowerOnPrefixCommands('both', 'rgb', 70))).toEqual(['7e0404f00001ff00ef']);
    expect(hex(buildPowerOnPrefixCommands('rgbBlack', 'native', 70))).toEqual(['7e04014601ffff00ef']);
    expect(hex(buildPowerOnPrefixCommands('both', 'both', 70))).toEqual([
      '7e0404f00001ff00ef',
      '7e04014601ffff00ef',
    ]);
  });

  it('builds effect speed commands', () => {
    expect(buildEffectSpeedCommand(0).toString('hex')).toBe('7e040200ffffff00ef');
    expect(buildEffectSpeedCommand(39).toString('hex')).toBe('7e040227ffffff00ef');
    expect(buildEffectSpeedCommand(100).toString('hex')).toBe('7e040264ffffff00ef');
  });

  it('builds basic effect commands', () => {
    expect(buildBasicEffectCommand(0).toString('hex')).toBe('7e05030006ffff00ef');
    expect(buildBasicEffectCommand(1).toString('hex')).toBe('7e05030106ffff00ef');
    expect(buildBasicEffectCommand(0xcf).toString('hex')).toBe('7e0503cf06ffff00ef');
  });
});
