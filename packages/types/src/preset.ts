import type { Adjustments } from './edit.js';
import { NEUTRAL_ADJUSTMENTS } from './edit.js';

/**
 * A saved look.
 *
 * A preset stores edit parameters, never rendered pixels - which is what the
 * edit stack already is, so a preset is a handful of numbers and applying one
 * is an ordinary operation that undo can take back.
 *
 * Today that is one set of adjustments. Presets that carry a whole stack of
 * masked layers are a later step: a mask is positioned for the photograph it
 * was drawn on, so carrying one to another picture means deciding what it
 * should mean there, and that decision is not obvious.
 */
export type PresetCategory = 'colour' | 'monochrome' | 'cinematic' | 'portrait' | 'landscape';

export interface Preset {
  id: string;
  name: string;
  category: PresetCategory;
  adjustments: Adjustments;
  /** Shipped with the app: it can be applied, but not edited or deleted. */
  builtIn: boolean;
}

export const PRESET_CATEGORIES: ReadonlyArray<PresetCategory> = [
  'colour',
  'monochrome',
  'cinematic',
  'portrait',
  'landscape',
];

/** Builds a preset from a partial set of adjustments, leaving the rest neutral. */
function look(
  id: string,
  name: string,
  category: PresetCategory,
  adjustments: Partial<Adjustments>,
): Preset {
  return { id, name, category, adjustments: { ...NEUTRAL_ADJUSTMENTS, ...adjustments }, builtIn: true };
}

/**
 * The presets that ship with the app.
 *
 * These are a starting point rather than a finished set: they were written by
 * reasoning about what each look asks for, not by trying them on a few hundred
 * photographs, which is the only way to actually settle numbers like these.
 */
export const BUILT_IN_PRESETS: ReadonlyArray<Preset> = [
  look('builtin.warm', 'Quente', 'colour', { temperature: 18, vibrance: 10 }),
  look('builtin.cool', 'Fria', 'colour', { temperature: -18, vibrance: 8 }),
  look('builtin.punch', 'Encorpada', 'colour', { contrast: 16, vibrance: 24, clarity: 12 }),

  look('builtin.mono', 'Preto e branco', 'monochrome', { saturation: -100, contrast: 12, clarity: 10 }),
  look('builtin.mono-hard', 'Preto e branco duro', 'monochrome', {
    saturation: -100, contrast: 38, clarity: 22, shadows: -14, highlights: 10,
  }),

  look('builtin.cinema', 'Cinematográfico', 'cinematic', {
    temperature: -12, contrast: 18, saturation: -12, shadows: 14, highlights: -20,
    clarity: 8, vignette: -25,
  }),
  look('builtin.cinema-warm', 'Cinematográfico quente', 'cinematic', {
    temperature: 14, contrast: 14, saturation: -8, highlights: -18, shadows: 12, vignette: -18,
  }),

  look('builtin.portrait', 'Retrato', 'portrait', {
    contrast: 6, shadows: 14, highlights: -12, vibrance: 12, saturation: -4,
    clarity: -8, sharpen: 25,
  }),
  look('builtin.portrait-soft', 'Retrato suave', 'portrait', {
    brightness: 6, shadows: 20, highlights: -18, vibrance: 8, clarity: -20,
  }),

  look('builtin.landscape', 'Paisagem', 'landscape', {
    contrast: 14, clarity: 22, vibrance: 25, saturation: 5, sharpen: 35, shadows: 8,
  }),
  look('builtin.landscape-dramatic', 'Paisagem dramática', 'landscape', {
    contrast: 26, clarity: 34, vibrance: 20, highlights: -28, shadows: 16,
    sharpen: 40, vignette: -20,
  }),
];
