// Turns a species into a "look": its colours, proportions, pattern and light
// layout. Everything is derived from a hash of the species id, so a species is
// drawn the same for every player on every visit. Words in the species name
// narrow the dice (an "Amber" fish is amber, a "Crown" angler has three lures)
// so that each creature matches what the codex calls it; a species with no
// known word in its name still gets a complete, attractive look from the hash.

import { hashString, mulberry32, type Rng } from '../core/rng.ts';
import type { Archetype, Rarity, SpeciesDef } from '../game/content.ts';
import { hsl, hsla } from './kit.ts';

export type Feature =
  | 'none'
  // fish
  | 'hatchet'
  | 'needle'
  | 'sprite'
  | 'sail'
  | 'lance'
  // eels
  | 'gulper'
  | 'oar'
  | 'warden'
  | 'bones'
  | 'frond'
  // jellies
  | 'chain'
  | 'wings'
  | 'veil'
  | 'star'
  | 'ember'
  // anglers
  | 'crown'
  | 'windows'
  // rays
  | 'stars'
  | 'trim'
  | 'scars'
  | 'manta'
  // combs
  | 'prism'
  | 'echo'
  | 'wisp'
  // squid
  | 'web'
  | 'glass'
  | 'flash'
  | 'colossal';

export const TAIL_FORK = 0;
export const TAIL_FAN = 1;
export const TAIL_LUNATE = 2;
export const TAIL_VEIL = 3;
export const TAIL_POINT = 4;

export const DORSAL_NONE = 0;
export const DORSAL_PEAK = 1;
export const DORSAL_RIDGE = 2;
export const DORSAL_SAIL = 3;

export const PATTERN_NONE = 0;
export const PATTERN_BARS = 1;
export const PATTERN_STRIPE = 2;
export const PATTERN_SPOTS = 3;
export const PATTERN_TWOTONE = 4;
export const PATTERN_SADDLES = 5;

/** Ray wing outlines. */
export const PLAN_SWEPT = 0;
export const PLAN_MANTA = 1;
export const PLAN_DISC = 2;
export const PLAN_KITE = 3;

export interface Look {
  readonly id: string;
  readonly archetype: Archetype;
  /** 0 common, 1 uncommon, 2 rare, 3 legendary. */
  readonly tier: number;
  /** True for the dark-bodied creatures of the deep zones, which show by their own light. */
  readonly deep: boolean;
  readonly feature: Feature;

  /** Main body hue; also what effects are tinted with. */
  readonly hue: number;
  readonly hue2: number;
  /** Hue of light organs and the aura. */
  readonly glow: number;
  readonly glow2: number;
  /** How strongly the creature's own lights shine, 0-1. */
  readonly shine: number;

  readonly top: string;
  readonly mid: string;
  readonly belly: string;
  readonly fin: string;
  readonly finEdge: string;
  readonly mark: string;
  /** Thin outline that keeps a dark body readable on dark water; '' when not needed. */
  readonly rim: string;
  readonly eyeWhite: string;
  readonly pupil: string;
  /** Opacity of the main body: below 1 for glassy creatures. */
  readonly bodyAlpha: number;

  /** Overall length in design pixels (the size at unit 1 and creature size 1). */
  readonly len: number;
  /** Greatest half-height of the body. */
  readonly half: number;
  /** Extra depth of the belly, as a share of `half` (hatchetfish). */
  readonly keel: number;
  /** Where along the body it is thickest, 0 (nose) to 1. */
  readonly peak: number;
  /** Width of the tail stalk as a share of `half`. */
  readonly stalk: number;

  /** Tail beats: radians per second. */
  readonly beat: number;
  /** How many radians of wave lie along the body. */
  readonly wave: number;
  /** Side-to-side swing of the tail in design pixels. */
  readonly sway: number;
  /** Nose-up tilt in radians. */
  readonly tilt: number;

  readonly tail: number;
  readonly tailLen: number;
  readonly tailSpread: number;
  readonly dorsal: number;
  readonly dorsalH: number;
  readonly finScale: number;
  readonly pattern: number;
  readonly marks: number;
  readonly eyeSize: number;
  readonly eyeless: boolean;

  /** Light organs along the body. */
  readonly lights: number;
  readonly lightRows: number;

  /** Jelly tentacles, comb rows, squid arms, angler lures: the count that archetype needs. */
  readonly strands: number;
  readonly strandLen: number;
  /** Jelly oral arms; comb plates per row. */
  readonly frills: number;
  /** Jelly bell height, ray half-span, squid mantle half-width: the archetype's second size. */
  readonly span: number;
  readonly scallops: number;
  /** Wing outline of a ray: one of the PLAN_ constants. */
  readonly plan: number;

  /** Body width at each spine point, nose to tail, in design pixels. Filled for spine swimmers. */
  readonly widths: Float32Array;
  /** Number of spine segments. */
  readonly segments: number;

  /** Made on first use, then reused every frame. */
  gradient: CanvasGradient | null;
  gradient2: CanvasGradient | null;
}

const RARITY_TIER: Readonly<Record<Rarity, number>> = { common: 0, uncommon: 1, rare: 2, legendary: 3 };

// Body hues that stand out against each sunlit zone's water.
const BRIGHT_HUES: readonly (readonly number[])[] = [
  [8, 22, 345, 326, 292, 268, 52, 150],
  [186, 170, 258, 288, 318, 44, 336, 204],
];
// Light-organ hues for the dark zones.
const GLOW_HUES: readonly (readonly number[])[] = [
  [48, 190, 320],
  [186, 170, 280, 50],
  [176, 194, 284, 318, 140, 212],
  [162, 190, 300, 18, 95, 262],
  [2, 330, 282, 170, 40, 200],
];

/** What a word in a species name pins down. Anything left out is rolled from the hash. */
interface Hint {
  hue?: number;
  hue2?: number;
  glow?: number;
  glow2?: number;
  /** Body saturation and lightness overrides. */
  sat?: number;
  light?: number;
  feature?: Feature;
  tail?: number;
  dorsal?: number;
  pattern?: number;
  /** Multipliers on rolled proportions. */
  long?: number;
  deepBody?: number;
  alpha?: number;
  eyeless?: boolean;
  strands?: number;
  tilt?: number;
}

const HINTS: readonly (readonly [word: string, hint: Hint])[] = [
  // colour words
  ['coral', { hue: 6, hue2: 44, sat: 88, light: 63 }],
  ['sunstripe', { hue: 222, hue2: 50, sat: 72, light: 66, pattern: PATTERN_STRIPE }],
  ['reef', { hue: 288, hue2: 48 }],
  ['kelp', { hue: 84, hue2: 58, sat: 62, light: 46, feature: 'frond' }],
  ['pearl', { hue: 322, hue2: 200, sat: 55, light: 86 }],
  ['amber', { hue: 34, hue2: 50, sat: 94, light: 58 }],
  ['dawn', { hue: 344, hue2: 28, glow: 24, sat: 82, light: 70 }],
  ['gilded', { hue: 44, hue2: 26, glow: 46, sat: 96, light: 60 }],
  ['dusk', { hue: 268, hue2: 28, glow: 196, sat: 34, light: 74 }],
  ['silver', { hue: 208, hue2: 196, sat: 16, light: 84 }],
  ['violet', { hue: 274, hue2: 320, glow: 276, glow2: 196 }],
  ['twilight', { hue: 214, hue2: 352, glow: 352, sat: 20, light: 82 }],
  ['ember', { hue: 14, glow: 24, glow2: 44 }],
  ['ghost', { hue: 196, glow: 186, glow2: 210, sat: 16, light: 30 }],
  ['gloom', { hue: 268, glow: 204, glow2: 286 }],
  ['pale', { hue: 336, glow: 330, sat: 14, light: 40 }],
  ['starback', { hue: 232, glow: 48, glow2: 200, feature: 'stars' }],
  ['cinder', { hue: 4, glow: 8, glow2: 30, feature: 'ember' }],
  ['drowned', { hue: 214, glow: 204, glow2: 46, feature: 'star' }],
  ['ash', { hue: 220, glow: 200, sat: 8, light: 30 }],
  ['smelt', { hue: 206, hue2: 190, glow: 184, sat: 40, light: 66 }],
  ['wraith', { hue: 252, hue2: 276, glow: 262, sat: 46, light: 84, pattern: PATTERN_NONE, alpha: 0.88 }],
  ['bone', { hue: 44, glow: 52, sat: 22, light: 74, feature: 'bones' }],
  ['hollow', { hue: 222, glow: 190, sat: 22, light: 9 }],
  ['spectre', { hue: 150, glow: 146, glow2: 190 }],
  ['monarch', { hue: 276, glow: 46, glow2: 282, feature: 'trim' }],
  ['patient', { hue: 354, glow: 44, glow2: 356, feature: 'colossal' }],
  ['trench', { hue: 338, hue2: 330, glow: 334, sat: 34, light: 78 }],
  ['null', { hue: 262, glow: 356, eyeless: true }],
  ['rift', { hue: 18, glow: 22, glow2: 46 }],
  ['vent', { hue: 8, glow: 22, glow2: 2 }],
  ['scar', { hue: 214, glow: 336, sat: 16, feature: 'scars' }],
  ['hadal', { hue: 262, glow: 266, glow2: 196 }],
  ['warden', { hue: 196, glow: 42, glow2: 172, feature: 'warden' }],
  ['pressure', { hue: 232, glow: 42, glow2: 28, feature: 'windows', deepBody: 1.2, long: 0.9 }],
  ['crown', { hue: 268, glow: 46, glow2: 300, feature: 'crown', strands: 3 }],
  // shape words
  ['darter', { long: 0.84, deepBody: 1.12, tail: TAIL_FORK }],
  ['minnow', { long: 0.94, deepBody: 0.74, tail: TAIL_FORK, dorsal: DORSAL_PEAK }],
  ['lancer', { long: 1.18, deepBody: 0.8, feature: 'lance', tail: TAIL_LUNATE, pattern: PATTERN_BARS }],
  ['fantail', { tail: TAIL_VEIL, deepBody: 1.16, dorsal: DORSAL_RIDGE, pattern: PATTERN_TWOTONE }],
  ['sailfin', { feature: 'sail', dorsal: DORSAL_SAIL, tail: TAIL_LUNATE, long: 1.12, pattern: PATTERN_STRIPE }],
  ['hatchet', { feature: 'hatchet', tail: TAIL_FORK, dorsal: DORSAL_PEAK, pattern: PATTERN_NONE }],
  ['needle', { feature: 'needle', tail: TAIL_POINT, dorsal: DORSAL_NONE, pattern: PATTERN_STRIPE, tilt: -0.3 }],
  ['sprite', { feature: 'sprite', tail: TAIL_POINT, dorsal: DORSAL_RIDGE, pattern: PATTERN_NONE }],
  ['gulper', { feature: 'gulper' }],
  ['oar', { feature: 'oar', long: 1.2 }],
  ['siphon', { feature: 'chain' }],
  ['veil', { feature: 'veil' }],
  ['seraph', { feature: 'wings' }],
  ['manta', { feature: 'manta' }],
  ['prism', { feature: 'prism' }],
  ['echo', { feature: 'echo', glow: 172 }],
  ['wisp', { feature: 'wisp', glow: 200, alpha: 0.6 }],
  ['glass', { feature: 'glass', alpha: 0.42, hue: 190, glow: 26, sat: 30, light: 80 }],
  ['blink', { feature: 'flash', hue: 326, glow: 188 }],
];

function collectHints(name: string): Hint {
  // Whole words only, so that "Drifter" does not pick up the hint for "rift".
  const words = name.toLowerCase().split(/[^a-z]+/);
  const merged: Hint = {};
  for (const [word, hint] of HINTS) {
    if (words.includes(word)) Object.assign(merged, hint);
  }
  return merged;
}

function between(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min);
}

function choose<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))] as T;
}

/** Body width along a fish-like spine: a rounded head, a thick shoulder and a thin tail stalk. */
function fishWidths(segments: number, half: number, peak: number, stalk: number, headPower: number, blunt: number): Float32Array {
  const widths = new Float32Array(segments + 1);
  for (let i = 0; i <= segments; i++) {
    const u = i / segments;
    let w: number;
    if (u < peak) {
      w = blunt + (1 - blunt) * Math.pow(Math.sin((u / peak) * Math.PI * 0.5), headPower);
    } else {
      const v = (u - peak) / (1 - peak);
      w = 1 - (1 - stalk) * Math.pow(v, 1.4);
    }
    widths[i] = half * w;
  }
  return widths;
}

/** An eel is the same width for most of its length and comes to a point. */
function eelWidths(segments: number, half: number, headScale: number): Float32Array {
  const widths = new Float32Array(segments + 1);
  for (let i = 0; i <= segments; i++) {
    const u = i / segments;
    const head = Math.pow(Math.sin(Math.min(1, u / 0.07) * Math.PI * 0.5), 0.8);
    const bulge = 1 + (headScale - 1) * Math.max(0, 1 - u / 0.16);
    const taper = 1 - Math.pow(u, 2.4) * 0.94;
    widths[i] = half * Math.max(0.3 * (u < 0.5 ? 1 : 0), head) * bulge * taper;
  }
  return widths;
}

export function makeLook(species: SpeciesDef): Look {
  const rng = mulberry32(hashString(`look:${species.id}`));
  const hint = collectHints(species.name);
  const tier = RARITY_TIER[species.rarity];
  const zone = Math.max(0, Math.min(GLOW_HUES.length - 1, species.zone));
  const deep = zone >= 2;
  const archetype = species.archetype;

  // ---- colour
  const glowPalette = GLOW_HUES[zone] as readonly number[];
  let hue: number;
  let glow: number;
  if (deep) {
    glow = hint.glow ?? choose(rng, glowPalette) + between(rng, -8, 8);
    hue = hint.hue ?? glow + between(rng, -14, 14);
  } else {
    hue = hint.hue ?? choose(rng, BRIGHT_HUES[zone] as readonly number[]) + between(rng, -7, 7);
    glow = hint.glow ?? (zone === 1 ? choose(rng, glowPalette) : hue);
  }
  const scheme = rng();
  const hue2 = hint.hue2 ?? (scheme < 0.4 ? hue + 180 + between(rng, -30, 30) : scheme < 0.7 ? hue + (rng() < 0.5 ? 125 : -125) : hue + (rng() < 0.5 ? 36 : -36));
  const glow2 = hint.glow2 ?? (rng() < 0.5 ? glow + between(rng, 150, 210) : glow + between(rng, 28, 60));

  const richness = tier >= 1 ? 6 : 0;
  const sat = hint.sat ?? (deep ? between(rng, 30, 44) : between(rng, 76, 90) + richness);
  const light = hint.light ?? (deep ? between(rng, 15, 20) + (archetype === 'ray' ? 5 : 0) : zone === 0 ? between(rng, 57, 64) : between(rng, 62, 70));
  // A pale creature in a dark zone is its own light source; treat it as bright for shading.
  const paleBody = light > 45;
  const top = hsl(hue - 6, sat + 4, paleBody ? light - 11 : light - 4);
  const mid = hsl(hue, sat, light);
  const belly = paleBody ? hsl(hue + 14, sat * 0.5, Math.min(95, light + 22)) : hsl(hue + 8, sat - 4, light + 11);
  const finLight = paleBody ? Math.min(82, light + 8) : light + 16;
  const fin = deep && !paleBody ? hsla(glow, 52, 30, 0.82) : hsla(hue2, Math.min(96, sat + 6), finLight, 0.86);
  const finEdge = deep && !paleBody ? hsla(glow, 80, 62, 0.9) : hsla(hue2, 92, Math.min(90, finLight + 14), 0.95);
  const mark = deep && !paleBody ? hsla(glow, 60, 40, 0.75) : hsla(hue2, Math.min(96, sat + 8), paleBody ? light - 6 + (hue2 === hue ? 16 : 0) : light + 20, 0.9);
  const rim = deep && !paleBody ? hsla(glow, 62, 46, 0.6) : '';
  const eyeWhite = deep && !paleBody ? hsl(glow, 40, 86) : '#f6fcff';
  const pupil = '#07111f';

  // ---- proportions shared by the spine swimmers
  const longer = hint.long ?? 1;
  const deeper = hint.deepBody ?? 1;
  let feature: Feature = hint.feature ?? 'none';
  let len = 64;
  let half = 11;
  let keel = 0;
  let peak = 0.3;
  let stalk = 0.16;
  let beat = 10;
  let wave = 5;
  let sway = 4;
  let tilt = hint.tilt ?? 0;
  let tail = TAIL_FORK;
  let tailLen = 14;
  let tailSpread = 10;
  let dorsal = DORSAL_PEAK;
  let dorsalH = 7;
  let finScale = 1;
  let pattern = PATTERN_NONE;
  let marks = 0;
  let eyeSize = 3;
  let lights = 0;
  let lightRows = 0;
  let strands = 0;
  let strandLen = 0;
  let frills = 0;
  let span = 0;
  let scallops = 0;
  let plan = PLAN_SWEPT;
  let segments = 12;
  let widths: Float32Array = new Float32Array(0);
  let bodyAlpha = hint.alpha ?? 1;
  const slow = tier === 3 ? 0.55 : tier === 2 ? 0.82 : 1;

  // Features only make sense on the archetype they were written for.
  const allowed: Readonly<Record<Archetype, readonly Feature[]>> = {
    fish: ['hatchet', 'needle', 'sprite', 'sail', 'lance'],
    lantern: ['hatchet', 'needle'],
    eel: ['gulper', 'oar', 'warden', 'bones', 'frond'],
    jelly: ['chain', 'wings', 'veil', 'star', 'ember'],
    angler: ['crown', 'windows'],
    ray: ['stars', 'trim', 'scars', 'manta', 'glass'],
    comb: ['prism', 'echo', 'wisp'],
    squid: ['web', 'glass', 'flash', 'colossal'],
  };
  if (!allowed[archetype].includes(feature)) feature = 'none';

  switch (archetype) {
    case 'fish':
    case 'lantern': {
      len = between(rng, 58, 68) * longer;
      const girth = between(rng, 0.155, 0.2) * deeper;
      half = len * girth;
      peak = between(rng, 0.27, 0.34);
      stalk = between(rng, 0.14, 0.2);
      tail = hint.tail ?? choose(rng, [TAIL_FORK, TAIL_FORK, TAIL_FAN, TAIL_LUNATE]);
      dorsal = hint.dorsal ?? choose(rng, [DORSAL_PEAK, DORSAL_PEAK, DORSAL_RIDGE]);
      pattern = hint.pattern ?? choose(rng, tier >= 1 ? [PATTERN_BARS, PATTERN_STRIPE, PATTERN_SPOTS, PATTERN_TWOTONE] : [PATTERN_BARS, PATTERN_STRIPE, PATTERN_SPOTS, PATTERN_TWOTONE, PATTERN_SADDLES, PATTERN_NONE]);
      marks = 2 + Math.floor(rng() * 3);
      finScale = between(rng, 0.9, 1.2);
      tailLen = len * between(rng, 0.2, 0.25) * (tail === TAIL_VEIL ? 1.5 : tail === TAIL_LUNATE ? 1.08 : 1);
      tailSpread = half * between(rng, 0.95, 1.25) * (tail === TAIL_VEIL ? 1.2 : 1);
      dorsalH = half * between(rng, 0.55, 0.8);
      beat = between(rng, 9.5, 12.5) * slow;
      wave = between(rng, 4.6, 5.4);
      sway = len * between(rng, 0.05, 0.068);
      eyeSize = Math.max(2.5, half * 0.3);
      let headPower = 0.72;
      let blunt = 0.2;
      if (feature === 'hatchet') {
        len = 50 * longer;
        half = len * 0.2;
        keel = 0.95;
        peak = 0.36;
        stalk = 0.12;
        eyeSize = half * 0.42;
        lights = 6;
        lightRows = 1;
        tailLen = len * 0.2;
        tailSpread = half * 1.1;
        sway = len * 0.04;
      } else if (feature === 'needle') {
        len = 80;
        half = 3.6;
        peak = 0.2;
        stalk = 0.3;
        headPower = 1.5;
        blunt = 0.1;
        eyeSize = 2.2;
        tailLen = 9;
        tailSpread = 5;
        sway = 2.6;
        wave = 6.5;
        beat = 8;
        marks = 1;
      } else if (feature === 'sprite') {
        len = 54;
        half = 9.5;
        peak = 0.2;
        stalk = 0.06;
        blunt = 0.55;
        headPower = 0.5;
        eyeSize = 2.3;
        tailLen = 7;
        tailSpread = 3.4;
        dorsalH = 3.2;
        sway = 4.6;
        wave = 5.6;
        beat = 7.5;
        bodyAlpha = 0.9;
      } else if (feature === 'lance') {
        headPower = 1.55;
        blunt = 0.06;
        peak = 0.36;
      } else if (feature === 'sail') {
        dorsalH = half * 2.3;
        tailLen = len * 0.3;
        tailSpread = half * 1.9;
        marks = 1;
        finScale = 1.35;
      }
      if (archetype === 'lantern') {
        lights = 6 + Math.floor(rng() * 3);
        lightRows = rng() < 0.5 ? 2 : 1;
        eyeSize = Math.max(eyeSize, half * 0.38);
        pattern = PATTERN_NONE;
        peak = 0.25;
      }
      widths = fishWidths(segments, half, peak, stalk, headPower, blunt);
      break;
    }
    case 'angler': {
      len = between(rng, 58, 66) * longer;
      half = len * between(rng, 0.27, 0.31) * deeper;
      peak = 0.3;
      stalk = 0.13;
      segments = 10;
      tail = TAIL_FAN;
      tailLen = len * 0.2;
      tailSpread = half * 0.72;
      dorsal = DORSAL_PEAK;
      dorsalH = half * 0.42;
      finScale = between(rng, 0.85, 1.05);
      beat = between(rng, 5.5, 7) * slow;
      wave = 4.2;
      sway = len * 0.04;
      eyeSize = Math.max(2.4, half * 0.17);
      strands = hint.strands ?? 1;
      marks = 4 + Math.floor(rng() * 3);
      lights = feature === 'windows' ? 5 : Math.floor(rng() * 3);
      widths = fishWidths(segments, half, peak, stalk, 0.5, 0.5);
      break;
    }
    case 'eel': {
      len = between(rng, 118, 136) * longer;
      half = between(rng, 4.6, 6);
      segments = 22;
      beat = between(rng, 4.2, 5.4) * slow;
      wave = between(rng, 8.5, 10.5);
      sway = len * between(rng, 0.05, 0.065);
      dorsalH = half * between(rng, 0.8, 1.2);
      pattern = hint.pattern ?? choose(rng, [PATTERN_BARS, PATTERN_SPOTS, PATTERN_NONE]);
      marks = 5 + Math.floor(rng() * 4);
      eyeSize = Math.max(1.9, half * 0.38);
      lights = deep ? 6 + Math.floor(rng() * 4) : 0;
      let headScale = 1.25;
      if (feature === 'gulper') {
        headScale = 1.9;
        half = 3.9;
        len = 126;
        lights = 1;
        pattern = PATTERN_NONE;
      } else if (feature === 'oar') {
        half = 7.2;
        len = 170;
        dorsalH = half * 1.15;
        pattern = PATTERN_SPOTS;
        marks = 7;
        wave = 9.5;
        sway = len * 0.05;
      } else if (feature === 'warden') {
        half = 8.4;
        len = 168;
        headScale = 1.5;
        lights = 11;
        dorsalH = half * 0.8;
        pattern = PATTERN_NONE;
        sway = len * 0.052;
      } else if (feature === 'bones') {
        pattern = PATTERN_NONE;
        lights = 0;
      } else if (feature === 'frond') {
        dorsalH = half * 1.9;
        half = 4.4;
        pattern = PATTERN_NONE;
      }
      widths = eelWidths(segments, half, headScale);
      break;
    }
    case 'jelly': {
      half = between(rng, 17, 21) * (tier === 3 ? 1.12 : 1);
      span = half * between(rng, 0.82, 1.08);
      len = half * 2;
      strands = hint.strands ?? 5 + Math.floor(rng() * 4);
      strandLen = half * between(rng, 2.2, 3.1);
      frills = 2 + Math.floor(rng() * 3);
      scallops = 5 + Math.floor(rng() * 4);
      pattern = choose(rng, [1, 1, 2, 3]);
      beat = between(rng, 2.3, 3) * slow;
      tilt = 0.26;
      lights = deep ? 5 + Math.floor(rng() * 3) : 0;
      if (feature === 'veil') {
        strands = 11;
        strandLen = half * 3.5;
        frills = 0;
      } else if (feature === 'chain') {
        half = 12;
        span = 12;
        strands = 10;
        strandLen = 8.5;
        frills = 0;
        tilt = 0.5;
      } else if (feature === 'wings') {
        strands = 6;
        strandLen = half * 1.9;
        frills = 0;
        span = half * 0.8;
        beat = 1.5;
      } else if (feature === 'star') {
        half = 23;
        span = 20;
        strands = 9;
        strandLen = half * 3;
        frills = 4;
        scallops = 8;
        pattern = 4;
        beat = 1.25;
        lights = 8;
      } else if (feature === 'ember') {
        pattern = 3;
        frills = 3;
      }
      break;
    }
    case 'ray': {
      len = between(rng, 46, 52) * (tier >= 2 ? 1.06 : 1);
      span = len * between(rng, 0.74, 0.86);
      half = span;
      strandLen = len * between(rng, 0.95, 1.3);
      beat = between(rng, 2.9, 3.6) * slow;
      pattern = choose(rng, [PATTERN_SPOTS, PATTERN_SPOTS, PATTERN_NONE]);
      marks = 3 + Math.floor(rng() * 3);
      lights = deep ? 4 + Math.floor(rng() * 3) : 0;
      eyeSize = 1.9;
      plan = choose(rng, [PLAN_SWEPT, PLAN_DISC]);
      if (feature === 'manta') {
        plan = PLAN_MANTA;
        span = len * 1.02;
        strandLen = len * 0.9;
        pattern = PATTERN_NONE;
      } else if (feature === 'stars') {
        plan = PLAN_SWEPT;
        lights = 11;
        pattern = PATTERN_NONE;
      } else if (feature === 'trim') {
        plan = PLAN_SWEPT;
        span = len * 0.96;
        lights = 10;
        pattern = PATTERN_NONE;
      } else if (feature === 'scars') {
        plan = PLAN_DISC;
        pattern = PATTERN_NONE;
        lights = 3;
      } else if (feature === 'glass') {
        plan = PLAN_KITE;
        pattern = PATTERN_NONE;
      }
      half = span;
      break;
    }
    case 'comb': {
      len = between(rng, 44, 52);
      half = len * between(rng, 0.31, 0.36);
      strands = 4;
      frills = feature === 'prism' ? 14 : 12;
      beat = between(rng, 3.4, 4.6);
      strandLen = feature === 'wisp' || rng() < 0.5 ? len * between(rng, 0.9, 1.3) : 0;
      bodyAlpha = hint.alpha ?? 1;
      break;
    }
    case 'squid': {
      len = between(rng, 82, 92) * (tier === 3 ? 1.08 : 1);
      span = between(rng, 7.6, 9);
      half = span * 2;
      strands = 5;
      strandLen = len * between(rng, 0.36, 0.42);
      beat = between(rng, 2.5, 3.2) * slow;
      marks = 4 + Math.floor(rng() * 4);
      lights = deep ? 3 + Math.floor(rng() * 3) : 0;
      eyeSize = span * 0.42;
      if (feature === 'colossal') {
        strandLen = len * 0.5;
        eyeSize = span * 0.52;
        lights = 7;
      } else if (feature === 'glass') {
        lights = 1;
        marks = 0;
        eyeSize = span * 0.5;
      } else if (feature === 'web') {
        strands = 6;
        lights = 6;
      }
      break;
    }
  }

  const shine = deep ? between(rng, 0.78, 1) : zone === 1 ? between(rng, 0.45, 0.6) : between(rng, 0.2, 0.3);

  return {
    id: species.id,
    archetype,
    tier,
    deep,
    feature,
    hue,
    hue2,
    glow,
    glow2,
    shine,
    top,
    mid,
    belly,
    fin,
    finEdge,
    mark,
    rim,
    eyeWhite,
    pupil,
    bodyAlpha,
    len,
    half,
    keel,
    peak,
    stalk,
    beat,
    wave,
    sway,
    tilt,
    tail,
    tailLen,
    tailSpread,
    dorsal,
    dorsalH,
    finScale,
    pattern,
    marks,
    eyeSize,
    eyeless: hint.eyeless ?? false,
    lights,
    lightRows,
    strands,
    strandLen,
    frills,
    span,
    scallops,
    plan,
    widths,
    segments,
    gradient: null,
    gradient2: null,
  };
}

const cache = new Map<string, Look>();

export function lookOf(species: SpeciesDef): Look {
  let look = cache.get(species.id);
  if (!look) {
    look = makeLook(species);
    cache.set(species.id, look);
  }
  return look;
}

/** The look shared by every fish of a glimmer shoal: small, sleek and gold whatever the zone. */
export const GLIMMER_LOOK: Look = (() => {
  const base = makeLook({ id: 'glimmer-shoal', name: 'Glimmer', zone: 0, rarity: 'common', archetype: 'fish', note: '' });
  const len = 46;
  const half = 7.6;
  return {
    ...base,
    hue: 46,
    hue2: 36,
    glow: 46,
    glow2: 52,
    shine: 1,
    top: hsl(38, 96, 52),
    mid: hsl(46, 98, 62),
    belly: hsl(54, 100, 84),
    fin: hsla(40, 100, 66, 0.9),
    finEdge: hsla(54, 100, 86, 0.95),
    mark: hsla(56, 100, 90, 0.9),
    len,
    half,
    peak: 0.3,
    stalk: 0.16,
    beat: 15,
    wave: 5,
    sway: 3.4,
    tail: TAIL_FORK,
    tailLen: 11,
    tailSpread: 8.4,
    dorsal: DORSAL_PEAK,
    dorsalH: 5,
    finScale: 0.9,
    pattern: PATTERN_STRIPE,
    marks: 1,
    eyeSize: 2.4,
    feature: 'none',
    lights: 0,
    lightRows: 0,
    widths: fishWidths(12, half, 0.3, 0.16, 0.72, 0.2),
    segments: 12,
    gradient: null,
    gradient2: null,
  };
})();
