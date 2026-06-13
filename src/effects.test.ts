import { describe, expect, it } from 'vitest';

import { resolveEffectsConfig } from './effects.js';

describe('effect config resolver', () => {
  it('does not expose effects unless explicitly enabled', () => {
    expect(resolveEffectsConfig(undefined).effects).toEqual([]);
    expect(resolveEffectsConfig({ enabled: false }).effects).toEqual([]);
  });

  it('uses the default starter effects when effects are enabled without items', () => {
    expect(resolveEffectsConfig({ enabled: true }).effects).toEqual([
      {
        name: 'AutoPlay',
        code: 0,
        speed: 39,
        subtype: 'lanternic-effect-autoplay-0',
      },
      {
        name: 'Magic Back',
        code: 1,
        speed: 39,
        subtype: 'lanternic-effect-magic-back-1',
      },
      {
        name: 'Yellow Marquee',
        code: 207,
        speed: 39,
        subtype: 'lanternic-effect-yellow-marquee-207',
      },
    ]);
  });

  it('clamps effect code and speed values', () => {
    expect(resolveEffectsConfig({
      enabled: true,
      defaultSpeed: 120,
      items: [
        { name: 'Fast Thing', code: 999 },
        { name: 'Slow Thing', code: -1, speed: -10 },
      ],
    }).effects).toMatchObject([
      { code: 255, speed: 100 },
      { code: 0, speed: 0 },
    ]);
  });

  it('builds unique subtypes for repeated effect ids', () => {
    expect(resolveEffectsConfig({
      enabled: true,
      items: [
        { id: 'same', name: 'One', code: 1 },
        { id: 'same', name: 'Two', code: 2 },
      ],
    }).effects.map(effect => effect.subtype)).toEqual([
      'lanternic-effect-same',
      'lanternic-effect-same-2',
    ]);
  });
});
