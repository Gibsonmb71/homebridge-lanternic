import { clampByte, clampPercent } from './color.js';
import type { LanternIcEffectConfig, LanternIcEffectsConfig } from './types.js';

export const EFFECT_SERVICE_SUBTYPE_PREFIX = 'lanternic-effect-';

export interface ResolvedLanternIcEffect {
  name: string;
  code: number;
  speed: number;
  subtype: string;
}

export interface ResolvedLanternIcEffectsConfig {
  effects: ResolvedLanternIcEffect[];
  restoreColorOnDisable: boolean;
}

export const DEFAULT_EFFECT_SPEED = 39;

export const DEFAULT_EFFECTS: LanternIcEffectConfig[] = [
  { name: 'AutoPlay', code: 0 },
  { name: 'Magic Back', code: 1 },
  { name: 'Yellow Marquee', code: 0xcf },
];

const slugify = (value: string): string => {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
};

export const resolveEffectsConfig = (
  config: LanternIcEffectsConfig | undefined,
): ResolvedLanternIcEffectsConfig => {
  if (config?.enabled !== true) {
    return {
      effects: [],
      restoreColorOnDisable: config?.restoreColorOnDisable ?? true,
    };
  }

  const defaultSpeed = clampPercent(config.defaultSpeed ?? DEFAULT_EFFECT_SPEED);
  const usedSubtypes = new Set<string>();

  const effects = (config.items?.length ? config.items : DEFAULT_EFFECTS)
    .filter(effect => typeof effect.name === 'string' && effect.name.trim().length > 0)
    .map((effect): ResolvedLanternIcEffect => {
      const code = clampByte(effect.code);
      const baseId = slugify(effect.id ?? `${effect.name}-${code}`) || `effect-${code}`;
      let subtype = `${EFFECT_SERVICE_SUBTYPE_PREFIX}${baseId}`;
      let suffix = 2;

      while (usedSubtypes.has(subtype)) {
        subtype = `${EFFECT_SERVICE_SUBTYPE_PREFIX}${baseId}-${suffix}`;
        suffix += 1;
      }

      usedSubtypes.add(subtype);

      return {
        name: effect.name,
        code,
        speed: clampPercent(effect.speed ?? defaultSpeed),
        subtype,
      };
    });

  return {
    effects,
    restoreColorOnDisable: config.restoreColorOnDisable ?? true,
  };
};
