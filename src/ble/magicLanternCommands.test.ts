import assert from 'node:assert/strict';
import { test } from 'node:test';

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

test('Magic Lantern command builders build on and off commands', () => {
  assert.equal(buildPowerCommand(true).toString('hex'), '7e0404f00001ff00ef');
  assert.equal(buildPowerCommand(false).toString('hex'), '7e0404000000ff00ef');
});

test('Magic Lantern command builders build RGB commands', () => {
  assert.equal(buildColorCommand({ red: 0, green: 0, blue: 255 }).toString('hex'), '7e0705030000ff10ef');
  assert.equal(buildColorCommand({ red: 255, green: 128, blue: 0 }).toString('hex'), '7e070503ff800010ef');
});

test('Magic Lantern command builders build brightness commands using the 0-100 Magic Lantern frame', () => {
  assert.equal(buildBrightnessCommand(0).toString('hex'), '7e04010001ffff00ef');
  assert.equal(buildBrightnessCommand(70).toString('hex'), '7e04014601ffff00ef');
  assert.equal(buildBrightnessCommand(100).toString('hex'), '7e04016401ffff00ef');
});

test('Magic Lantern command builders clamp brightness command values', () => {
  assert.equal(buildBrightnessCommand(-1).toString('hex'), '7e04010001ffff00ef');
  assert.equal(buildBrightnessCommand(101).toString('hex'), '7e04016401ffff00ef');
});

test('Magic Lantern command builders build resilient default power-off commands', () => {
  assert.deepEqual(hex(buildPowerOffCommands()), [
    '7e07050300000010ef',
    '7e0404000000ff00ef',
  ]);
});

test('Magic Lantern command builders support native-only and RGB-black-only power modes', () => {
  assert.deepEqual(hex(buildPowerOffCommands('native')), ['7e0404000000ff00ef']);
  assert.deepEqual(hex(buildPowerOffCommands('rgbBlack')), ['7e07050300000010ef']);
});

test('Magic Lantern command builders default brightness to RGB scaling without native brightness frames', () => {
  assert.equal(shouldScaleRgbBrightness(), true);
  assert.equal(shouldUseNativeBrightness(), false);
  assert.deepEqual(hex(buildNativeBrightnessCommands(70)), []);
});

test('Magic Lantern command builders support native and combined brightness modes', () => {
  assert.equal(shouldScaleRgbBrightness('native'), false);
  assert.equal(shouldUseNativeBrightness('native'), true);
  assert.deepEqual(hex(buildNativeBrightnessCommands(70, 'native')), ['7e04014601ffff00ef']);
  assert.equal(shouldScaleRgbBrightness('both'), true);
  assert.equal(shouldUseNativeBrightness('both'), true);
  assert.deepEqual(hex(buildNativeBrightnessCommands(70, 'both')), ['7e04014601ffff00ef']);
});

test('Magic Lantern command builders build power-on prefixes from selected power and brightness modes', () => {
  assert.deepEqual(hex(buildPowerOnPrefixCommands('both', 'rgb', 70)), ['7e0404f00001ff00ef']);
  assert.deepEqual(hex(buildPowerOnPrefixCommands('rgbBlack', 'native', 70)), ['7e04014601ffff00ef']);
  assert.deepEqual(hex(buildPowerOnPrefixCommands('both', 'both', 70)), [
    '7e0404f00001ff00ef',
    '7e04014601ffff00ef',
  ]);
});

test('Magic Lantern command builders build effect speed commands', () => {
  assert.equal(buildEffectSpeedCommand(0).toString('hex'), '7e040200ffffff00ef');
  assert.equal(buildEffectSpeedCommand(39).toString('hex'), '7e040227ffffff00ef');
  assert.equal(buildEffectSpeedCommand(100).toString('hex'), '7e040264ffffff00ef');
});

test('Magic Lantern command builders build basic effect commands', () => {
  assert.equal(buildBasicEffectCommand(0).toString('hex'), '7e05030006ffff00ef');
  assert.equal(buildBasicEffectCommand(1).toString('hex'), '7e05030106ffff00ef');
  assert.equal(buildBasicEffectCommand(0xcf).toString('hex'), '7e0503cf06ffff00ef');
});
