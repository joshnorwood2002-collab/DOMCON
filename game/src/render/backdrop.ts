// The water and everything fixed in it: the zone's colour column, light shafts,
// the silhouettes along the bottom edge, the sea floor, marine snow and bubbles.
//
// Almost all of it is painted once into offscreen sheets and then copied each
// frame, because an unscaled copy is the cheapest thing a canvas can do:
//   base   the zone's water with everything that never moves baked in
//   water  the base, darkened for how far through the zone the sub has sunk
//   strip  the silhouettes along the bottom edge, with see-through sky above
// Only what must move is drawn live: a few swaying light shafts, kelp, the
// pulsing tips of tube worms, vent shimmer, snow and bubbles.

import { mulberry32, type Rng } from '../core/rng.ts';
import { GLOW_AURA, GLOW_CORE, GLOW_SOFT, TAU, clamp, fract, hash01, hexToRgb, lerp, makeSheet, mixRgb, rgb, type Rgb, type Sheet, type Stage } from './kit.ts';

/** Water colours by zone: top, middle and bottom of the screen. */
const WATER: readonly (readonly [Rgb, Rgb, Rgb])[] = [
  [hexToRgb('#3ec6d8'), hexToRgb('#1b8fb8'), hexToRgb('#0b4f86')],
  [hexToRgb('#0d4f86'), hexToRgb('#0a2f63'), hexToRgb('#071a40')],
  [hexToRgb('#06153a'), hexToRgb('#040c26'), hexToRgb('#020614')],
  [hexToRgb('#030816'), hexToRgb('#02040d'), hexToRgb('#010207')],
  [hexToRgb('#04030c'), hexToRgb('#020108'), hexToRgb('#000004')],
];
/** What each zone darkens towards as the sub sinks through it. */
const DEEPER: readonly Rgb[] = [hexToRgb('#0b4f86'), hexToRgb('#071a40'), hexToRgb('#020614'), hexToRgb('#010207'), hexToRgb('#000002')];
const VIGNETTE: readonly number[] = [0.3, 0.4, 0.5, 0.55, 0.6];
/** Share of the snow that falls in each zone: denser with depth. */
const SNOW_DENSITY: readonly number[] = [0.3, 0.5, 0.78, 1, 0.94];
const SNOW_ALPHA: readonly number[] = [0.62, 0.6, 0.66, 0.7, 0.66];
const BUBBLES_BY_ZONE: readonly number[] = [14, 8, 3, 0, 0];
/** Hues that tube-worm tips glow in, by zone. */
const WORM_HUES: readonly (readonly number[])[] = [[], [186, 170], [176, 196, 284, 318], [162, 190, 150], [2, 330, 282]];

/**
 * The interface lays a bar across the bottom of the play area, about this many
 * CSS pixels tall. The contract does not tell the renderer where it is, so the
 * bottom silhouettes are simply raised by this much to stand clear of it.
 */
const DOCK_ALLOWANCE = 70;
const MAX_SNOW = 190;
const MAX_BUBBLES = 14;
const RUSH_STREAKS = 22;
/** How far the bottom silhouettes travel during one dive, in CSS pixels at unit 1. */
const SLIDE = 54;
const PROGRESS_STEPS = 24;

interface Boulder {
  x: number;
  rx: number;
  ry: number;
}

/** A sum of three sines: a cheap, repeatable rolling skyline. Returns about -1 to 1. */
function makeRoll(rng: Rng, width: number): (x: number) => number {
  const f1 = (TAU * (0.9 + rng() * 0.9)) / width;
  const f2 = (TAU * (2.2 + rng() * 1.6)) / width;
  const f3 = (TAU * (5 + rng() * 3)) / width;
  const p1 = rng() * TAU;
  const p2 = rng() * TAU;
  const p3 = rng() * TAU;
  return (x) => 0.56 * Math.sin(x * f1 + p1) + 0.3 * Math.sin(x * f2 + p2) + 0.14 * Math.sin(x * f3 + p3);
}

export class Backdrop {
  private readonly seed: number;
  private width = 1;
  private height = 1;
  private ratio = 1;
  private unit = 1;

  private base: Sheet | null = null;
  private water: Sheet | null = null;
  private strip: Sheet | null = null;
  private fade: Sheet | null = null;
  /** CSS y of the strip's top edge. */
  private stripTop = 0;
  private stripHeight = 1;

  private zone = -1;
  private floor = false;
  private progressStep = -1;
  private sonar = false;
  private dirty = true;
  /** 1 just after the zone on screen changed, easing to 0 while the old picture fades away. */
  private fadeAlpha = 0;
  /** 0 when the sea floor first comes into view, rising to 1. */
  private floorRise = 1;
  /** True for the dive that changed zone: the old silhouettes are in the fading snapshot, not the strip. */
  private freshZone = false;
  /** Pixels the water has rushed past during dives; shifts snow and bubbles. */
  private scroll = 0;
  private motion = 1;

  // Decoration that is drawn live. Positions are CSS pixels.
  private readonly boulders: Boulder[] = [];
  private nearCrest: (x: number) => number = () => 0;
  private kelp = new Float32Array(0);
  private whips = new Float32Array(0);
  private tips = new Float32Array(0);
  private vents = new Float32Array(0);
  private shafts: HTMLCanvasElement[] = [];
  private flecks = new Float32Array(0);

  private readonly snow = new Float32Array(MAX_SNOW * 5);
  private readonly bubbles = new Float32Array(MAX_BUBBLES * 5);
  private dot: HTMLCanvasElement | null = null;
  private bubbleSprites: HTMLCanvasElement[] = [];

  constructor(seed: number) {
    this.seed = seed >>> 0;
    const rng = mulberry32(this.seed ^ 0x51ed270b);
    for (let i = 0; i < MAX_SNOW; i++) {
      // Far, middle and near flakes in that order, so each depth can be drawn with one alpha.
      const layer = i < MAX_SNOW * 0.55 ? 0 : i < MAX_SNOW * 0.9 ? 1 : 2;
      this.snow[i * 5] = rng();
      this.snow[i * 5 + 1] = rng();
      this.snow[i * 5 + 2] = (5 + rng() * 9) * (1 + layer * 0.7);
      this.snow[i * 5 + 3] = layer === 0 ? 1 + rng() * 0.5 : layer === 1 ? 1.4 + rng() * 0.8 : 2.2 + rng() * 1.2;
      this.snow[i * 5 + 4] = rng() * TAU;
    }
    for (let i = 0; i < MAX_BUBBLES; i++) {
      this.bubbles[i * 5] = rng();
      this.bubbles[i * 5 + 1] = rng();
      this.bubbles[i * 5 + 2] = 16 + rng() * 26;
      this.bubbles[i * 5 + 3] = Math.floor(rng() * 3);
      this.bubbles[i * 5 + 4] = rng() * TAU;
    }
  }

  resize(width: number, height: number, ratio: number): void {
    if (width === this.width && height === this.height && ratio === this.ratio) return;
    this.width = width;
    this.height = height;
    this.ratio = ratio;
    this.base = null;
    this.water = null;
    this.strip = null;
    this.fade = null;
    this.fadeAlpha = 0;
    this.dirty = true;
  }

  /** CSS y of the top of the bottom silhouettes at `x`, for things that stand on them. */
  crestAt(x: number): number {
    return this.nearCrest(x);
  }

  /**
   * Brings the sheets up to date with the scene. Cheap when nothing changed;
   * a dive within a zone only recomposes `water`, which is two copies and a fill.
   */
  update(zone: number, progress: number, atFloor: boolean, sonar: boolean, unit: number, rush: number, dt: number, motion: number): void {
    this.motion = motion;
    if (unit !== this.unit) {
      this.unit = unit;
      this.dirty = true;
    }
    const z = clamp(Math.round(zone), 0, WATER.length - 1);
    const step = Math.round(clamp(progress, 0, 1) * PROGRESS_STEPS);
    const sceneChanged = z !== this.zone || atFloor !== this.floor;
    if (sceneChanged || this.dirty) {
      const hadPicture = !this.dirty && this.water !== null && this.strip !== null;
      if (hadPicture) this.snapshot();
      const zoneChanged = z !== this.zone;
      if (atFloor && !this.floor && hadPicture) this.floorRise = 0;
      this.zone = z;
      this.floor = atFloor;
      this.progressStep = step;
      this.sonar = sonar;
      this.dirty = false;
      this.paintBase();
      this.paintStrip();
      this.composeWater();
      this.makeShafts();
      this.makeSprites();
      this.fadeAlpha = hadPicture ? 1 : 0;
      this.freshZone = hadPicture && zoneChanged;
    } else if (step !== this.progressStep || sonar !== this.sonar) {
      this.progressStep = step;
      this.sonar = sonar;
      this.composeWater();
    }
    if (this.fadeAlpha > 0) this.fadeAlpha = Math.max(0, this.fadeAlpha - dt * 1.7);
    if (this.floorRise < 1) this.floorRise = Math.min(1, this.floorRise + dt * 0.8);
    if (rush <= 0) this.freshZone = false;
    if (motion >= 1) this.scroll += rush * 760 * this.unit * dt;
  }

  // ---------------------------------------------------------------- baking

  private sheet(existing: Sheet | null, cssWidth: number, cssHeight: number, opaque: boolean): Sheet {
    const w = Math.max(1, Math.round(cssWidth * this.ratio));
    const h = Math.max(1, Math.round(cssHeight * this.ratio));
    if (existing && existing.canvas.width === w && existing.canvas.height === h) return existing;
    return makeSheet(w, h, opaque);
  }

  /** Keeps a copy of the picture as it is now, to fade out over the new one. */
  private snapshot(): void {
    if (!this.water || !this.strip) return;
    this.fade = this.sheet(this.fade, this.width, this.height, true);
    const g = this.fade.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.drawImage(this.water.canvas, 0, 0);
    g.drawImage(this.strip.canvas, 0, Math.round(this.stripTop * this.ratio));
  }

  private vignette(g: CanvasRenderingContext2D, strength: number): CanvasGradient {
    const w = this.width;
    const h = this.height;
    const gradient = g.createRadialGradient(w * 0.5, h * 0.46, Math.min(w, h) * 0.42, w * 0.5, h * 0.46, Math.hypot(w, h) * 0.62);
    gradient.addColorStop(0, 'rgba(0, 3, 12, 0)');
    gradient.addColorStop(1, `rgba(0, 3, 12, ${strength})`);
    return gradient;
  }

  /**
   * A soft beam of light, painted as thin slices so that it can widen, lean and
   * fade as it goes down. `x` is the middle of its top; sizes are CSS pixels.
   */
  private paintShaft(g: CanvasRenderingContext2D, x: number, topY: number, topWidth: number, bottomWidth: number, length: number, lean: number, alpha: number): void {
    const ratio = this.ratio;
    const slices = Math.max(8, Math.ceil(length / 5));
    const thick = length / slices;
    const across = g.createLinearGradient(0, 0, 1, 0);
    across.addColorStop(0, 'rgba(205, 250, 255, 0)');
    across.addColorStop(0.5, 'rgba(205, 250, 255, 1)');
    across.addColorStop(1, 'rgba(205, 250, 255, 0)');
    g.fillStyle = across;
    for (let i = 0; i < slices; i++) {
      const v = i / slices;
      const w = lerp(topWidth, bottomWidth, v);
      g.setTransform(ratio * w, 0, 0, ratio, ratio * (x + lean * v - w * 0.5), ratio * (topY + v * length));
      g.globalAlpha = alpha * Math.pow(1 - v, 1.5);
      g.fillRect(0, 0, 1, thick + 0.6);
    }
    g.globalAlpha = 1;
    g.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  private paintBase(): void {
    this.base = this.sheet(this.base, this.width, this.height, true);
    const g = this.base.g;
    const w = this.width;
    const h = this.height;
    const zone = this.zone;
    const colours = WATER[zone] as readonly [Rgb, Rgb, Rgb];
    const rng = mulberry32(this.seed + zone * 7919);
    g.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    const column = g.createLinearGradient(0, 0, 0, h);
    column.addColorStop(0, rgb(colours[0]));
    column.addColorStop(0.5, rgb(colours[1]));
    column.addColorStop(1, rgb(colours[2]));
    g.fillStyle = column;
    g.fillRect(0, 0, w, h);

    if (zone === 0) {
      // The surface: a bright band the sun pours through.
      const glow = g.createLinearGradient(0, 0, 0, h * 0.2);
      glow.addColorStop(0, 'rgba(222, 255, 250, 0.5)');
      glow.addColorStop(0.4, 'rgba(190, 250, 250, 0.16)');
      glow.addColorStop(1, 'rgba(190, 250, 250, 0)');
      g.globalCompositeOperation = 'lighter';
      g.fillStyle = glow;
      g.fillRect(0, 0, w, h * 0.2);
      // Broad, still shafts; the narrow moving ones are drawn live over them.
      for (let i = 0; i < 6; i++) {
        const x = ((i + 0.2 + rng() * 0.6) / 6) * w * 1.1 - w * 0.12;
        const top = (16 + rng() * 34) * Math.max(0.7, w / 900);
        this.paintShaft(g, x, 0, top, top * (2.6 + rng()), h * (0.66 + rng() * 0.3), h * 0.17, 0.1 + rng() * 0.08);
      }
      g.globalCompositeOperation = 'source-over';
    } else if (zone === 1) {
      // The last of the daylight.
      const glow = g.createLinearGradient(0, 0, 0, h * 0.3);
      glow.addColorStop(0, 'rgba(90, 170, 230, 0.17)');
      glow.addColorStop(1, 'rgba(90, 170, 230, 0)');
      g.globalCompositeOperation = 'lighter';
      g.fillStyle = glow;
      g.fillRect(0, 0, w, h * 0.3);
      for (let i = 0; i < 4; i++) {
        const x = ((i + 0.2 + rng() * 0.6) / 4) * w * 1.1 - w * 0.1;
        const top = (22 + rng() * 30) * Math.max(0.7, w / 900);
        this.paintShaft(g, x, 0, top, top * 3, h * (0.5 + rng() * 0.25), h * 0.12, 0.05 + rng() * 0.03);
      }
      g.globalCompositeOperation = 'source-over';
    } else if (zone === 2) {
      // No sun, only a memory of blue overhead.
      const haze = g.createRadialGradient(w * 0.5, -h * 0.2, 0, w * 0.5, -h * 0.2, h * 1.05);
      haze.addColorStop(0, 'rgba(46, 86, 170, 0.2)');
      haze.addColorStop(1, 'rgba(46, 86, 170, 0)');
      g.fillStyle = haze;
      g.fillRect(0, 0, w, h);
    } else if (zone === 3) {
      // Silt hangs low over the plain.
      const haze = g.createLinearGradient(0, h * 0.62, 0, h);
      haze.addColorStop(0, 'rgba(60, 72, 110, 0)');
      haze.addColorStop(1, 'rgba(60, 72, 110, 0.13)');
      g.fillStyle = haze;
      g.fillRect(0, h * 0.62, w, h * 0.38);
    } else {
      this.paintTrenchWalls(g, rng);
    }

    g.fillStyle = this.vignette(g, VIGNETTE[zone] ?? 0.5);
    g.fillRect(0, 0, w, h);
  }

  /** The trench's rock faces, rising out of sight on both sides. */
  private paintTrenchWalls(g: CanvasRenderingContext2D, rng: Rng): void {
    const w = this.width;
    const h = this.height;
    for (let layer = 0; layer < 2; layer++) {
      for (let side = 0; side < 2; side++) {
        const reach = w * (layer === 0 ? 0.15 : 0.085);
        const roll = makeRoll(rng, h);
        g.beginPath();
        g.moveTo(side === 0 ? 0 : w, 0);
        for (let y = 0; y <= h; y += 12) {
          const v = y / h;
          const jut = reach * (0.3 + 0.7 * Math.pow(v, 1.4)) * (1 + 0.3 * roll(y)) + ((y / 12) % 3 === 0 ? reach * 0.07 : 0);
          g.lineTo(side === 0 ? jut : w - jut, y);
        }
        g.lineTo(side === 0 ? 0 : w, h);
        g.closePath();
        g.fillStyle = layer === 0 ? 'rgba(13, 9, 26, 0.75)' : 'rgba(6, 4, 13, 0.92)';
        g.fill();
        if (layer === 1) {
          g.strokeStyle = 'rgba(120, 84, 160, 0.13)';
          g.lineWidth = 1;
          g.stroke();
        }
      }
    }
  }

  private paintStrip(): void {
    const unit = this.unit;
    const w = this.width;
    const h = this.height;
    const zone = this.zone;
    const tall = Math.min(h, Math.round(DOCK_ALLOWANCE + (this.floor ? 240 : 150) * unit));
    this.stripHeight = tall;
    this.stripTop = h - tall;
    this.strip = this.sheet(this.strip, w, tall, false);
    const g = this.strip.g;
    const ratio = this.ratio;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.clearRect(0, 0, this.strip.canvas.width, this.strip.canvas.height);
    // From here on the strip is painted in the play area's own CSS coordinates.
    g.setTransform(ratio, 0, 0, ratio, 0, -this.stripTop * ratio);

    const rng = mulberry32(this.seed + zone * 104729 + (this.floor ? 17 : 0));
    this.boulders.length = 0;
    const tips: number[] = [];
    const vents: number[] = [];
    const kelp: number[] = [];
    const whips: number[] = [];
    const flecks: number[] = [];
    const lift = DOCK_ALLOWANCE;

    if (this.floor) {
      this.paintFloor(g, rng, tips, vents);
    } else if (zone === 0) {
      const far = makeRoll(rng, w);
      this.ridge(g, (x) => h - (lift + 82 * unit + 24 * unit * far(x)), 'rgba(15, 96, 146, 0.55)');
      const mid = makeRoll(rng, w);
      const midCrest = (x: number): number => h - (lift + 50 * unit + 20 * unit * mid(x));
      this.ridge(g, midCrest, 'rgba(9, 70, 116, 0.86)');
      // Distant weed, too far away to see moving.
      g.strokeStyle = 'rgba(8, 74, 104, 0.8)';
      g.lineCap = 'round';
      for (let i = 0; i < 9; i++) {
        const x = rng() * w;
        const top = (26 + rng() * 40) * unit;
        g.lineWidth = (2 + rng() * 1.6) * unit;
        g.beginPath();
        g.moveTo(x, midCrest(x) + 4);
        g.quadraticCurveTo(x + (rng() - 0.5) * 22 * unit, midCrest(x) - top * 0.5, x + (rng() - 0.5) * 16 * unit, midCrest(x) - top);
        g.stroke();
      }
      // Pale sand between the rocks.
      const sand = makeRoll(rng, w);
      this.ridge(g, (x) => h - (lift + 12 * unit + 7 * unit * sand(x)), 'rgba(58, 150, 160, 0.62)');
      this.paintBoulders(g, rng, lift, '#0b5078', '#052c4c', 'rgba(150, 232, 240, 0.3)');
      this.paintCorals(g, rng);
      // A net of warm light thrown across rock and sand by the waves above.
      g.globalCompositeOperation = 'source-atop';
      g.strokeStyle = 'rgba(255, 244, 196, 0.2)';
      g.lineWidth = 1.5 * unit;
      g.lineJoin = 'round';
      const cells = Math.ceil(w / (46 * unit));
      for (let i = 0; i < cells; i++) {
        for (let row = 0; row < 3; row++) {
          const cx = (i + rng()) * 46 * unit;
          const cy = h - (lift * 0.4 + row * 44 * unit + rng() * 30 * unit);
          const r = (15 + rng() * 14) * unit;
          g.beginPath();
          for (let k = 0; k <= 6; k++) {
            const angle = (k / 6) * TAU;
            const rr = r * (0.7 + 0.5 * hash01(i * 97 + row * 31 + (k % 6)));
            const x = cx + Math.cos(angle) * rr * 1.3;
            const y = cy + Math.sin(angle) * rr * 0.6;
            if (k === 0) g.moveTo(x, y);
            else g.lineTo(x, y);
          }
          g.stroke();
        }
      }
      g.globalCompositeOperation = 'source-over';
      // Kelp roots and the flecks of sun that play over the bottom.
      const strands = clamp(Math.round(w / (64 * unit)), 5, 13);
      for (let i = 0; i < strands; i++) {
        const x = ((i + 0.15 + rng() * 0.7) / strands) * w;
        const near = i % 3 !== 1;
        kelp.push(x, (near ? 70 + rng() * 80 : 46 + rng() * 50) * unit, rng() * TAU, (near ? 7 + rng() * 4 : 4.5 + rng() * 2) * unit, (rng() - 0.5) * 26 * unit, near ? 1 : 0);
      }
      const spots = clamp(Math.round(w / 90), 5, 12);
      for (let i = 0; i < spots; i++) flecks.push(rng() * w, h - lift - rng() * 120 * unit, 20 + rng() * 22, rng() * TAU);
    } else if (zone === 1) {
      const far = makeRoll(rng, w);
      this.ridge(g, (x) => h - (lift + 62 * unit + 22 * unit * far(x)), 'rgba(9, 38, 88, 0.7)');
      const near = makeRoll(rng, w);
      const crest = (x: number): number => h - (lift + 26 * unit + 18 * unit * near(x));
      const fill = g.createLinearGradient(0, h - lift - 50 * unit, 0, h);
      fill.addColorStop(0, '#07245a');
      fill.addColorStop(1, '#030e28');
      this.ridge(g, crest, fill, 'rgba(96, 156, 232, 0.2)');
      this.nearCrest = crest;
      const count = clamp(Math.round(w / (150 * unit)), 3, 7);
      for (let i = 0; i < count; i++) {
        const x = ((i + 0.2 + rng() * 0.6) / count) * w;
        whips.push(x, (60 + rng() * 70) * unit, rng() * TAU, (rng() - 0.5) * 40 * unit);
      }
    } else if (zone === 2) {
      const far = makeRoll(rng, w);
      const farCrest = (x: number): number => h - (lift + 54 * unit + 22 * unit * far(x));
      this.ridge(g, farCrest, 'rgba(6, 17, 46, 0.86)');
      this.paintChimney(g, rng, w * (0.58 + rng() * 0.3), farCrest, 26 * unit, 'rgba(7, 19, 50, 0.95)', vents, 0.7);
      const near = makeRoll(rng, w);
      const crest = (x: number): number => h - (lift + 22 * unit + 20 * unit * near(x));
      const fill = g.createLinearGradient(0, h - lift - 44 * unit, 0, h);
      fill.addColorStop(0, '#050f2a');
      fill.addColorStop(1, '#02060f');
      this.ridge(g, crest, fill, 'rgba(84, 128, 220, 0.24)');
      this.nearCrest = crest;
      this.paintWorms(g, rng, crest, clamp(Math.round(w / (170 * unit)), 3, 6), 4, tips, WORM_HUES[2] as readonly number[], '#12254a', 'rgba(110, 170, 240, 0.3)');
    } else if (zone === 3) {
      const far = makeRoll(rng, w);
      const farCrest = (x: number): number => h - (lift + 40 * unit + 7 * unit * far(x));
      this.ridge(g, farCrest, 'rgba(9, 13, 28, 0.94)', 'rgba(110, 124, 170, 0.1)');
      this.paintChimney(g, rng, w * (0.5 + rng() * 0.36), farCrest, 20 * unit, 'rgba(10, 14, 30, 0.96)', vents, 0.6);
      const near = makeRoll(rng, w);
      const crest = (x: number): number => h - (lift + 17 * unit + 7 * unit * near(x));
      const fill = g.createLinearGradient(0, h - lift - 26 * unit, 0, h);
      fill.addColorStop(0, '#0a0e1b');
      fill.addColorStop(1, '#03050b');
      this.ridge(g, crest, fill, 'rgba(140, 150, 190, 0.16)');
      this.nearCrest = crest;
      // Ripple marks in the silt and a scatter of nodules.
      g.strokeStyle = 'rgba(140, 150, 190, 0.07)';
      g.lineWidth = unit;
      for (let k = 1; k <= 3; k++) {
        g.beginPath();
        for (let x = 0; x <= w; x += 16) {
          const y = crest(x) + k * 9 * unit + Math.sin(x * 0.03 + k * 2) * 2 * unit;
          if (x === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.stroke();
      }
      g.fillStyle = '#0d1120';
      for (let i = 0; i < Math.round(w / 60); i++) {
        const x = rng() * w;
        g.beginPath();
        g.ellipse(x, crest(x) + (2 + rng() * 14) * unit, (3 + rng() * 6) * unit, (2 + rng() * 2.4) * unit, 0, 0, TAU);
        g.fill();
      }
      this.paintWorms(g, rng, crest, clamp(Math.round(w / (300 * unit)), 2, 3), 3, tips, WORM_HUES[3] as readonly number[], '#141a2c', 'rgba(150, 170, 210, 0.26)');
    } else {
      const farCrest = this.crags(g, rng, lift + 46 * unit, 30 * unit, 'rgba(11, 7, 22, 0.94)', '');
      this.paintChimney(g, rng, w * (0.3 + rng() * 0.16), farCrest, 24 * unit, 'rgba(12, 8, 24, 0.96)', vents, 0.7);
      this.paintChimney(g, rng, w * (0.62 + rng() * 0.26), farCrest, 30 * unit, 'rgba(12, 8, 24, 0.96)', vents, 0.8);
      const crest = this.crags(g, rng, lift + 18 * unit, 24 * unit, '#05030c', 'rgba(170, 96, 190, 0.2)');
      this.nearCrest = crest;
      this.paintWorms(g, rng, crest, clamp(Math.round(w / (200 * unit)), 3, 5), 4, tips, WORM_HUES[4] as readonly number[], '#170f24', 'rgba(210, 130, 200, 0.26)');
    }

    if (zone === 0 && !this.floor) {
      const boulders = this.boulders;
      this.nearCrest = (x) => {
        let top = h - lift * 0.7;
        for (const boulder of boulders) {
          const d = (x - boulder.x) / boulder.rx;
          if (d > -1 && d < 1) top = Math.min(top, h - boulder.ry * Math.sqrt(1 - d * d));
        }
        return top;
      };
    }

    // Shade the strip's corners to match the vignette baked into the water.
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = this.vignette(g, VIGNETTE[zone] ?? 0.5);
    g.fillRect(0, this.stripTop, w, tall);
    g.globalCompositeOperation = 'source-over';

    this.kelp = Float32Array.from(kelp);
    this.whips = Float32Array.from(whips);
    this.tips = Float32Array.from(tips);
    this.vents = Float32Array.from(vents);
    this.flecks = Float32Array.from(flecks);
  }

  /** Fills everything below a skyline, optionally tracing the skyline itself with a rim of light. */
  private ridge(g: CanvasRenderingContext2D, crest: (x: number) => number, fill: string | CanvasGradient, rim = ''): void {
    const w = this.width;
    g.beginPath();
    g.moveTo(0, crest(0));
    for (let x = 8; x < w + 8; x += 8) g.lineTo(x, crest(x));
    if (rim) {
      g.strokeStyle = rim;
      g.lineWidth = 1.4 * this.unit;
      g.stroke();
    }
    g.lineTo(w + 8, this.height + 2);
    g.lineTo(0, this.height + 2);
    g.closePath();
    g.fillStyle = fill;
    g.fill();
  }

  /** A jagged skyline of broken rock. Returns its height function. */
  private crags(g: CanvasRenderingContext2D, rng: Rng, lift: number, jag: number, fill: string, rim: string): (x: number) => number {
    const w = this.width;
    const h = this.height;
    const step = 26 * this.unit;
    const count = Math.ceil(w / step) + 2;
    const peaks = new Float32Array(count);
    const roll = makeRoll(rng, w);
    for (let i = 0; i < count; i++) peaks[i] = lift + jag * (0.5 + 0.5 * roll(i * step)) + (rng() - 0.3) * jag * 0.7;
    const crest = (x: number): number => {
      const f = clamp(x / step, 0, count - 1.001);
      const i = Math.floor(f);
      return h - lerp(peaks[i] as number, peaks[i + 1] as number, f - i);
    };
    this.ridge(g, crest, fill, rim);
    return crest;
  }

  /** Rounded rocks along the bottom, lit from above. */
  private paintBoulders(g: CanvasRenderingContext2D, rng: Rng, lift: number, top: string, bottom: string, highlight: string): void {
    const unit = this.unit;
    const w = this.width;
    const h = this.height;
    const count = clamp(Math.round(w / (120 * unit)), 4, 10);
    const fill = g.createLinearGradient(0, h - lift - 50 * unit, 0, h);
    fill.addColorStop(0, top);
    fill.addColorStop(1, bottom);
    for (let i = 0; i < count; i++) {
      const boulder: Boulder = {
        x: ((i + 0.1 + rng() * 0.8) / count) * w,
        rx: (56 + rng() * 80) * unit,
        ry: lift + (8 + rng() * 34) * unit,
      };
      this.boulders.push(boulder);
      g.fillStyle = fill;
      g.beginPath();
      g.ellipse(boulder.x, h, boulder.rx, boulder.ry, 0, Math.PI, TAU);
      g.fill();
      g.strokeStyle = highlight;
      g.lineWidth = 1.6 * unit;
      g.beginPath();
      g.ellipse(boulder.x, h, boulder.rx - unit, boulder.ry - unit, 0, Math.PI * 1.14, Math.PI * 1.62);
      g.stroke();
    }
  }

  /** A few muted corals on the rocks: fans, tubes and domes. */
  private paintCorals(g: CanvasRenderingContext2D, rng: Rng): void {
    const unit = this.unit;
    const h = this.height;
    const colours = ['rgba(226, 104, 132, 0.8)', 'rgba(240, 150, 84, 0.8)', 'rgba(168, 120, 214, 0.78)', 'rgba(244, 196, 96, 0.76)'];
    for (const boulder of this.boulders) {
      if (rng() < 0.3) continue;
      const offset = (rng() - 0.5) * 1.2;
      const x = boulder.x + offset * boulder.rx;
      const y = h - boulder.ry * Math.sqrt(Math.max(0.05, 1 - offset * offset)) + 2 * unit;
      const colour = colours[Math.floor(rng() * colours.length)] as string;
      const kind = Math.floor(rng() * 3);
      g.fillStyle = colour;
      g.strokeStyle = colour;
      g.lineCap = 'round';
      if (kind === 0) {
        // A fan of branches.
        g.lineWidth = 2 * unit;
        g.beginPath();
        for (let k = 0; k < 5; k++) {
          const angle = -Math.PI / 2 + (k - 2) * 0.36;
          const length = (13 + rng() * 9) * unit;
          g.moveTo(x, y);
          g.quadraticCurveTo(x + Math.cos(angle) * length * 0.5, y + Math.sin(angle) * length * 0.7, x + Math.cos(angle) * length, y + Math.sin(angle) * length);
        }
        g.stroke();
      } else if (kind === 1) {
        // A dome.
        g.beginPath();
        g.ellipse(x, y + 2 * unit, (9 + rng() * 6) * unit, (7 + rng() * 4) * unit, 0, Math.PI, TAU);
        g.fill();
      } else {
        // A clump of tubes.
        g.lineWidth = 3.4 * unit;
        g.beginPath();
        for (let k = 0; k < 3; k++) {
          g.moveTo(x + (k - 1) * 5 * unit, y + unit);
          g.lineTo(x + (k - 1) * 6.5 * unit, y - (8 + rng() * 8) * unit);
        }
        g.stroke();
      }
    }
  }

  /** Clusters of tube worms standing on a skyline. Their tips are recorded so they can glow. */
  private paintWorms(g: CanvasRenderingContext2D, rng: Rng, crest: (x: number) => number, clusters: number, perCluster: number, tips: number[], hues: readonly number[], tube: string, shine: string): void {
    const unit = this.unit;
    const w = this.width;
    g.lineCap = 'round';
    for (let c = 0; c < clusters; c++) {
      const cx = ((c + 0.2 + rng() * 0.6) / clusters) * w;
      const hue = hues[Math.floor(rng() * hues.length)] ?? 190;
      const count = perCluster - 1 + Math.floor(rng() * 3);
      for (let k = 0; k < count; k++) {
        const x = cx + (k - count / 2) * (7 + rng() * 5) * unit;
        const baseY = crest(x) + 3 * unit;
        const tall = (22 + rng() * 34) * unit;
        const lean = (rng() - 0.5) * 16 * unit;
        const tipX = x + lean;
        const tipY = baseY - tall;
        g.strokeStyle = tube;
        g.lineWidth = 2.6 * unit;
        g.beginPath();
        g.moveTo(x, baseY);
        g.quadraticCurveTo(x + lean * 0.1, baseY - tall * 0.6, tipX, tipY);
        g.stroke();
        g.strokeStyle = shine;
        g.lineWidth = 0.9 * unit;
        g.stroke();
        tips.push(tipX, tipY, hue + (rng() - 0.5) * 16, rng() * TAU);
      }
    }
  }

  /** A small hydrothermal chimney on a skyline, with its mouth recorded as a vent. */
  private paintChimney(g: CanvasRenderingContext2D, rng: Rng, x: number, crest: (x: number) => number, tall: number, fill: string, vents: number[], strength: number): void {
    const baseY = crest(x) + 4 * this.unit;
    const wide = tall * (0.34 + rng() * 0.14);
    g.fillStyle = fill;
    g.beginPath();
    g.moveTo(x - wide, baseY);
    g.quadraticCurveTo(x - wide * 0.5, baseY - tall * 0.5, x - wide * 0.32, baseY - tall);
    g.lineTo(x + wide * 0.3, baseY - tall * 0.94);
    g.quadraticCurveTo(x + wide * 0.56, baseY - tall * 0.4, x + wide, baseY);
    g.closePath();
    g.fill();
    vents.push(x, baseY - tall, strength, rng() * TAU);
  }

  /** The bottom of the trench: a bed of pale silt, black smokers and tube-worm colonies. */
  private paintFloor(g: CanvasRenderingContext2D, rng: Rng, tips: number[], vents: number[]): void {
    const unit = this.unit;
    const w = this.width;
    const h = this.height;
    const lift = DOCK_ALLOWANCE;
    // The far wall of the trench closing in behind.
    this.crags(g, rng, lift + 104 * unit, 46 * unit, 'rgba(12, 9, 24, 0.95)', 'rgba(150, 100, 190, 0.12)');
    const bed = makeRoll(rng, w);
    const crest = (x: number): number => h - (lift + 58 * unit + 6 * unit * bed(x));
    const silt = g.createLinearGradient(0, h - lift - 66 * unit, 0, h);
    silt.addColorStop(0, '#2b2740');
    silt.addColorStop(0.35, '#191628');
    silt.addColorStop(1, '#08070f');
    this.ridge(g, crest, silt, 'rgba(206, 190, 240, 0.3)');
    this.nearCrest = crest;

    // Where the headlamp falls on the bed.
    g.globalCompositeOperation = 'source-atop';
    const pool = g.createRadialGradient(w * 0.36, h - lift - 30 * unit, 0, w * 0.36, h - lift - 30 * unit, Math.max(160 * unit, w * 0.32));
    pool.addColorStop(0, 'rgba(255, 238, 200, 0.2)');
    pool.addColorStop(1, 'rgba(255, 238, 200, 0)');
    g.fillStyle = pool;
    g.fillRect(0, this.stripTop, w, this.stripHeight);
    g.globalCompositeOperation = 'source-over';

    // Ridges combed into the silt by slow currents.
    g.strokeStyle = 'rgba(214, 200, 244, 0.1)';
    g.lineWidth = 1.2 * unit;
    for (let k = 1; k <= 5; k++) {
      g.beginPath();
      for (let x = 0; x <= w + 14; x += 14) {
        const y = crest(x) + k * 10 * unit + Math.sin(x * 0.024 + k * 1.7) * 3 * unit;
        if (x === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    }
    // Stones and nodules, each with a lit edge.
    for (let i = 0; i < Math.round(w / 46); i++) {
      const x = rng() * w;
      const y = crest(x) + (4 + rng() * 44) * unit;
      const rx = (3 + rng() * 9) * unit;
      g.fillStyle = '#0c0a15';
      g.beginPath();
      g.ellipse(x, y, rx, rx * 0.56, 0, 0, TAU);
      g.fill();
      g.strokeStyle = 'rgba(214, 200, 244, 0.2)';
      g.lineWidth = unit;
      g.beginPath();
      g.ellipse(x, y, rx, rx * 0.56, 0, Math.PI * 1.1, Math.PI * 1.7);
      g.stroke();
    }

    // Black smokers: knobbly chimneys with glowing throats.
    const chimneys = w < 520 ? 2 : 3;
    for (let c = 0; c < chimneys; c++) {
      const x = w * (chimneys === 2 ? 0.46 + c * 0.36 : 0.4 + c * 0.24) + (rng() - 0.5) * w * 0.06;
      const baseY = crest(x) + 10 * unit;
      const tall = (78 + rng() * 60) * unit * (c === 1 ? 1.15 : 1);
      const wide = (17 + rng() * 9) * unit;
      g.fillStyle = '#0a0812';
      g.beginPath();
      g.moveTo(x - wide * 1.5, baseY);
      for (let k = 1; k <= 6; k++) {
        const v = k / 6;
        g.lineTo(x - wide * (1.2 - 0.82 * v) - (k % 2) * wide * 0.2, baseY - tall * v);
      }
      g.lineTo(x + wide * 0.34, baseY - tall * 0.97);
      for (let k = 5; k >= 0; k--) {
        const v = k / 6;
        g.lineTo(x + wide * (1.2 - 0.82 * v) + ((k + 1) % 2) * wide * 0.2, baseY - tall * v);
      }
      g.closePath();
      g.fill();
      g.strokeStyle = 'rgba(255, 150, 90, 0.22)';
      g.lineWidth = 1.2 * unit;
      g.stroke();
      // Cracks where the heat shows through.
      g.strokeStyle = 'rgba(255, 140, 60, 0.55)';
      g.lineWidth = 1.3 * unit;
      g.beginPath();
      for (let k = 0; k < 3; k++) {
        const y = baseY - tall * (0.24 + k * 0.24);
        g.moveTo(x - wide * 0.2 + (rng() - 0.5) * wide * 0.5, y);
        g.lineTo(x + (rng() - 0.5) * wide * 0.5, y - tall * 0.1);
      }
      g.stroke();
      vents.push(x, baseY - tall, 1.5, rng() * TAU);

      // A colony of pale tube worms at the foot, plumes out.
      const colony = 4 + Math.floor(rng() * 3);
      for (let k = 0; k < colony; k++) {
        const wx = x + (c % 2 === 0 ? 1 : -1) * (wide * 1.7 + k * 6 * unit);
        const wy = crest(wx) + 8 * unit;
        const tallWorm = (16 + rng() * 20) * unit;
        g.strokeStyle = 'rgba(214, 222, 236, 0.86)';
        g.lineWidth = 2.6 * unit;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(wx, wy);
        g.lineTo(wx + (rng() - 0.5) * 6 * unit, wy - tallWorm);
        g.stroke();
        tips.push(wx, wy - tallWorm, 356 + rng() * 12, rng() * TAU);
      }
    }
  }

  /** Recomposes `water`: the base, darkened by depth and lifted a touch while sonar is running. */
  private composeWater(): void {
    if (!this.base) return;
    this.water = this.sheet(this.water, this.width, this.height, true);
    const g = this.water.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.drawImage(this.base.canvas, 0, 0);
    const depth = (this.progressStep / PROGRESS_STEPS) * 0.36;
    if (depth > 0.004) {
      g.fillStyle = rgb(DEEPER[this.zone] ?? [0, 0, 2], depth);
      g.fillRect(0, 0, this.water.canvas.width, this.water.canvas.height);
    }
    if (this.sonar) {
      g.fillStyle = this.zone <= 1 ? 'rgba(150, 240, 255, 0.07)' : 'rgba(60, 150, 200, 0.07)';
      g.fillRect(0, 0, this.water.canvas.width, this.water.canvas.height);
    }
  }

  /** Pre-renders the narrow shafts that sway across the sunlit zones. */
  private makeShafts(): void {
    this.shafts = [];
    if (this.zone > 1) return;
    const h = this.height;
    const scale = Math.max(0.6, this.width / 900);
    const count = this.zone === 0 ? 3 : 1;
    for (let i = 0; i < count; i++) {
      const top = (10 + i * 7) * scale;
      const bottom = top * 3.2;
      const length = h * (this.zone === 0 ? 0.78 - i * 0.08 : 0.5);
      const lean = h * 0.17 * (length / h);
      const sheet = makeSheet((bottom + lean + 8) * this.ratio, length * this.ratio);
      sheet.g.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
      this.paintShaft(sheet.g, bottom * 0.5 + 4, 0, top, bottom, length, lean, this.zone === 0 ? 0.2 - i * 0.03 : 0.07);
      this.shafts.push(sheet.canvas);
    }
  }

  /** Small sprites drawn many times a frame: the soft snow dot and three sizes of bubble. */
  private makeSprites(): void {
    const ratio = this.ratio;
    const dotRadius = Math.max(2, Math.round(2.6 * ratio * Math.max(0.8, this.unit)));
    const dot = makeSheet(dotRadius * 2, dotRadius * 2);
    const soft = dot.g.createRadialGradient(dotRadius, dotRadius, 0, dotRadius, dotRadius, dotRadius);
    soft.addColorStop(0, 'rgba(226, 246, 255, 0.95)');
    soft.addColorStop(0.5, 'rgba(226, 246, 255, 0.4)');
    soft.addColorStop(1, 'rgba(226, 246, 255, 0)');
    dot.g.fillStyle = soft;
    dot.g.fillRect(0, 0, dotRadius * 2, dotRadius * 2);
    this.dot = dot.canvas;

    this.bubbleSprites = [];
    for (let size = 0; size < 3; size++) {
      const radius = Math.max(2, Math.round((2 + size * 1.5) * ratio * Math.max(0.8, this.unit)));
      const sheet = makeSheet(radius * 2 + 2, radius * 2 + 2);
      const b = sheet.g;
      const c = radius + 1;
      b.strokeStyle = 'rgba(214, 246, 255, 0.6)';
      b.lineWidth = Math.max(1, ratio);
      b.beginPath();
      b.arc(c, c, radius - b.lineWidth * 0.5, 0, TAU);
      b.stroke();
      b.fillStyle = 'rgba(214, 246, 255, 0.12)';
      b.fill();
      b.fillStyle = 'rgba(255, 255, 255, 0.85)';
      b.beginPath();
      b.arc(c - radius * 0.36, c - radius * 0.36, Math.max(0.7, radius * 0.22), 0, TAU);
      b.fill();
      this.bubbleSprites.push(sheet.canvas);
    }
  }

  // ---------------------------------------------------------------- drawing

  /** Everything behind the creatures. Leaves the transform at the CSS-pixel scale. */
  drawBack(g: CanvasRenderingContext2D, stage: Stage, time: number, rush: number): void {
    if (!this.water || !this.strip) return;
    const ratio = this.ratio;
    const w = this.width;
    const unit = this.unit;
    const moving = this.motion >= 1;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.drawImage(this.water.canvas, 0, 0);

    // Narrow shafts drifting across the still ones; where two cross, the water brightens.
    if (this.shafts.length > 0 && stage.detail >= 1) {
      const dim = 1 - (this.progressStep / PROGRESS_STEPS) * 0.5;
      g.globalAlpha = dim;
      for (let i = 0; i < this.shafts.length; i++) {
        const sprite = this.shafts[i] as HTMLCanvasElement;
        const home = w * (0.16 + 0.31 * i) + (hash01(this.seed + i * 13) - 0.5) * w * 0.1;
        const sway = moving ? Math.sin(time * (0.16 + i * 0.045) + i * 2.3) * w * 0.075 : 0;
        g.drawImage(sprite, Math.round((home + sway) * ratio - sprite.width * 0.3), 0);
      }
      g.globalAlpha = 1;
    }

    if (this.zone === 0 && !this.floor) this.drawSurface(g, stage, time);

    // The bottom silhouettes. During a dive they glide upward: the old view lifts and fades as the same view rises from below.
    const slide = SLIDE * unit;
    const r2 = moving ? rush * rush : 0;
    const rise = this.floorRise < 1 ? Math.pow(1 - this.floorRise, 2) * this.stripHeight * 0.8 : 0;
    const stripY = this.stripTop + rise;
    if (r2 > 0.004 && rise === 0) {
      if (!this.freshZone) {
        g.globalAlpha = r2;
        g.drawImage(this.strip.canvas, 0, Math.round((stripY - slide * (1 - r2)) * ratio));
        this.drawDecor(g, stage, time, -slide * (1 - r2), r2);
      }
      g.globalAlpha = 1 - r2;
      g.drawImage(this.strip.canvas, 0, Math.round((stripY + slide * r2) * ratio));
      g.globalAlpha = 1;
      this.drawDecor(g, stage, time, slide * r2, 1 - r2);
    } else {
      g.drawImage(this.strip.canvas, 0, Math.round(stripY * ratio));
      this.drawDecor(g, stage, time, rise, 1);
    }

    // The previous zone, fading out over the new one.
    if (this.fadeAlpha > 0.004 && this.fade) {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalAlpha = this.fadeAlpha * this.fadeAlpha * (3 - 2 * this.fadeAlpha);
      g.drawImage(this.fade.canvas, 0, 0);
      g.globalAlpha = 1;
    }

    this.drawSnow(g, time, rush, 0, 2);
    g.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  /** The play of light just under the surface: bright patches sliding along the top edge and two rippling lines. */
  private drawSurface(g: CanvasRenderingContext2D, stage: Stage, time: number): void {
    const ratio = this.ratio;
    const w = this.width;
    const h = this.height;
    const moving = this.motion >= 1;
    const t = moving ? time : 0;
    if (stage.detail >= 1) {
      const patches = clamp(Math.round(w / 170), 3, 7);
      for (let i = 0; i < patches; i++) {
        const x = fract((i + 0.5) / patches + t * 0.012 * (i % 2 === 0 ? 1 : -0.7) + hash01(i * 7 + 3) * 0.2) * (w + 160) - 80;
        const pulse = 0.5 + 0.5 * Math.sin(t * (0.7 + 0.13 * i) + i * 1.9);
        stage.auras.push(stage.glows.get(GLOW_AURA, 172, 40, (48 + 26 * hash01(i * 5)) * ratio * Math.max(0.75, this.unit)), x * ratio, (4 + 9 * hash01(i * 11)) * ratio, 0.26 + 0.3 * pulse);
      }
      stage.auras.flush(g);
    }
    g.setTransform(ratio, 0, 0, ratio, 0, 0);
    g.lineWidth = 1.6;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (let line = 0; line < 2; line++) {
      const y0 = h * (0.03 + line * 0.035) + 6;
      g.strokeStyle = line === 0 ? 'rgba(236, 255, 252, 0.34)' : 'rgba(236, 255, 252, 0.18)';
      g.beginPath();
      for (let x = -10; x <= w + 30; x += 30) {
        const y = y0 + Math.sin(x * 0.021 + t * (1 + line * 0.3) + line * 2) * 3.2 + Math.sin(x * 0.047 - t * 0.8) * 1.8;
        if (x === -10) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
  }

  /** The living parts of the bottom edge, shifted and faded along with the strip they stand on. */
  private drawDecor(g: CanvasRenderingContext2D, stage: Stage, time: number, offsetY: number, alpha: number): void {
    const ratio = this.ratio;
    const unit = this.unit;
    const h = this.height;
    const t = this.motion >= 1 ? time : time * 0.35;
    const glows = stage.glows;

    if (this.kelp.length > 0) {
      // Kelp: tapering ribbons that lean and curl with the swell.
      g.setTransform(ratio, 0, 0, ratio, 0, offsetY * ratio);
      for (let pass = 0; pass < 2; pass++) {
        g.globalAlpha = alpha * (pass === 0 ? 0.72 : 0.94);
        g.fillStyle = pass === 0 ? '#0b5a70' : '#063847';
        g.beginPath();
        for (let i = 0; i < this.kelp.length; i += 6) {
          if ((this.kelp[i + 5] as number) !== pass) continue;
          const x = this.kelp[i] as number;
          const tall = this.kelp[i + 1] as number;
          const phase = this.kelp[i + 2] as number;
          const wide = this.kelp[i + 3] as number;
          const lean = this.kelp[i + 4] as number;
          const rootY = Math.min(h, this.nearCrest(x) + 6 * unit);
          const swayMid = Math.sin(t * 0.8 + phase) * 9 * unit + lean * 0.4;
          const swayTop = Math.sin(t * 0.8 + phase - 1.1) * 17 * unit + lean;
          const topY = h - DOCK_ALLOWANCE - tall;
          const midY = (rootY + topY) * 0.5;
          g.moveTo(x - wide * 0.5, rootY);
          g.quadraticCurveTo(x - wide * 0.5 + swayMid * 1.5, midY, x + swayTop, topY);
          g.quadraticCurveTo(x + wide * 0.6 + swayMid * 1.5, midY, x + wide * 0.5, rootY);
        }
        g.fill();
      }
      g.globalAlpha = 1;
    }

    if (this.whips.length > 0) {
      // Sea whips: thin, sparse and slow, some carrying a first spark of living light.
      g.setTransform(ratio, 0, 0, ratio, 0, offsetY * ratio);
      g.strokeStyle = '#061a44';
      g.lineCap = 'round';
      g.lineWidth = 2.2 * unit;
      g.globalAlpha = alpha;
      g.beginPath();
      for (let i = 0; i < this.whips.length; i += 4) {
        const x = this.whips[i] as number;
        const tall = this.whips[i + 1] as number;
        const phase = this.whips[i + 2] as number;
        const lean = this.whips[i + 3] as number;
        const rootY = this.nearCrest(x) + 4 * unit;
        const sway = Math.sin(t * 0.5 + phase) * 12 * unit;
        const tipX = x + lean + sway;
        const tipY = rootY - tall;
        g.moveTo(x, rootY);
        g.quadraticCurveTo(x + lean * 0.1 - sway * 0.4, rootY - tall * 0.55, tipX, tipY);
        // A side branch.
        g.moveTo(x + lean * 0.14, rootY - tall * 0.4);
        g.quadraticCurveTo(x + lean * 0.4 + 10 * unit, rootY - tall * 0.56, x + lean * 0.5 + 14 * unit + sway * 0.6, rootY - tall * 0.78);
        if (stage.detail >= 1) {
          const pulse = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(t * 1.3 + phase * 3));
          stage.lights.push(glows.get(GLOW_SOFT, i % 8 === 0 ? 186 : 170, 100, 5.5 * unit * ratio), tipX * ratio, (tipY + offsetY) * ratio, alpha * pulse * 0.8);
        }
      }
      g.stroke();
      g.globalAlpha = 1;
    }

    // Tube-worm tips: a hard bright core in a soft halo, each pulsing to its own rhythm.
    for (let i = 0; i < this.tips.length; i += 4) {
      const pulse = 0.55 + 0.45 * Math.sin(t * 1.4 + (this.tips[i + 3] as number));
      const x = (this.tips[i] as number) * ratio;
      const y = ((this.tips[i + 1] as number) + offsetY) * ratio;
      const hue = this.tips[i + 2] as number;
      stage.lights.push(glows.get(GLOW_CORE, hue, 100, (this.floor ? 6 : 8) * unit * ratio), x, y, alpha * pulse);
    }

    // Vents: a warm breath of light and a column of shimmer rising from each mouth.
    for (let i = 0; i < this.vents.length; i += 4) {
      const x = this.vents[i] as number;
      const y = (this.vents[i + 1] as number) + offsetY;
      const strength = this.vents[i + 2] as number;
      const phase = this.vents[i + 3] as number;
      const breath = 0.7 + 0.3 * Math.sin(t * 1.1 + phase);
      stage.lights.push(glows.get(GLOW_AURA, 20, 100, 30 * strength * unit * ratio), x * ratio, y * ratio, alpha * breath * Math.min(1, 0.5 * strength));
      stage.lights.push(glows.get(GLOW_CORE, 26, 100, 7 * strength * unit * ratio), x * ratio, y * ratio, alpha * breath * 0.8);
      const motes = stage.detail >= 2 ? (strength > 1 ? 9 : 5) : 3;
      const climb = (strength > 1 ? 210 : 86) * unit;
      for (let k = 0; k < motes; k++) {
        const life = fract(t * (0.2 + 0.03 * (k % 3)) + k / motes + phase);
        const wobble = Math.sin(life * 9 + k * 2.1 + phase) * (4 + 14 * life) * unit;
        const fade = Math.sin(life * Math.PI) * (1 - life * 0.5);
        stage.lights.push(glows.get(GLOW_SOFT, 24 - life * 14, 90, (3.5 + 7 * life) * strength * unit * ratio), (x + wobble) * ratio, (y - life * climb) * ratio, alpha * fade * 0.5);
      }
    }

    // Flecks of sunlight wandering over the bottom.
    if (stage.detail >= 1) {
      for (let i = 0; i < this.flecks.length; i += 4) {
        const phase = this.flecks[i + 3] as number;
        const x = (this.flecks[i] as number) + Math.sin(t * 0.21 + phase) * 26 * unit;
        const y = (this.flecks[i + 1] as number) + Math.cos(t * 0.17 + phase * 2) * 8 * unit + offsetY;
        const pulse = Math.pow(0.5 + 0.5 * Math.sin(t * 0.9 + phase * 3), 2);
        stage.lights.push(glows.get(GLOW_AURA, 50, 70, (this.flecks[i + 2] as number) * unit * ratio), x * ratio, y * ratio, alpha * (0.12 + 0.3 * pulse));
      }
    }
    stage.lights.flush(g);
  }

  /** Marine snow for the given depth layers (0 far, 1 middle, 2 near). Expects and leaves an identity transform. */
  private drawSnow(g: CanvasRenderingContext2D, time: number, rush: number, fromLayer: number, toLayer: number): void {
    const ratio = this.ratio;
    const w = this.width;
    const h = this.height;
    const unit = this.unit;
    const zone = this.zone;
    const reduced = this.motion < 1;
    const density = (SNOW_DENSITY[zone] ?? 1) * (reduced ? 0.5 : 1);
    const budget = clamp(Math.round((w * h) / 4200), 40, MAX_SNOW);
    const fadeIn = 1 - this.fadeAlpha;
    const baseAlpha = (SNOW_ALPHA[zone] ?? 0.6) * fadeIn;
    const streak = reduced ? 0 : rush;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = zone === 0 ? '#f2fdff' : '#cfe6ff';
    for (let layer = fromLayer; layer < toLayer; layer++) {
      const start = layer === 0 ? 0 : Math.floor(MAX_SNOW * 0.55);
      const end = layer === 0 ? Math.floor(MAX_SNOW * 0.55) : Math.floor(MAX_SNOW * 0.9);
      const shown = Math.round((end - start) * density * (budget / MAX_SNOW));
      const parallax = layer === 0 ? 0.55 : 0.9;
      g.globalAlpha = baseAlpha * (layer === 0 ? 0.42 : 0.66);
      const long = streak * (layer === 0 ? 9 : 18) * unit * ratio;
      let dots = false;
      for (let i = start; i < start + shown; i++) {
        const o = i * 5;
        const fall = time * (this.snow[o + 2] as number) * unit - this.scroll * parallax;
        const y = fract((this.snow[o + 1] as number) + fall / h) * h;
        const x = (this.snow[o] as number) * w + Math.sin(time * 0.5 + (this.snow[o + 4] as number)) * 9 * unit;
        const size = Math.max(1, Math.round((this.snow[o + 3] as number) * ratio * Math.max(0.8, unit)));
        const left = Math.round(x * ratio);
        const top = Math.round(y * ratio);
        if (size >= 4 && long < 1) {
          // Big enough on this screen for its corners to show: a round speck instead of a square one.
          if (!dots) {
            g.beginPath();
            dots = true;
          }
          const radius = size / 2;
          g.moveTo(left + size, top + radius);
          g.arc(left + radius, top + radius, radius, 0, TAU);
        } else {
          g.fillRect(left, top, size, size + long);
        }
      }
      if (dots) g.fill();
    }
    g.globalAlpha = 1;
  }

  /** What drifts in front of the creatures: the nearest snow, bubbles, and the streaks of a dive. */
  drawFront(g: CanvasRenderingContext2D, time: number, rush: number): void {
    const ratio = this.ratio;
    const w = this.width;
    const h = this.height;
    const unit = this.unit;
    const reduced = this.motion < 1;
    const fadeIn = 1 - this.fadeAlpha;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';

    // The nearest flakes are big enough to be round.
    const dot = this.dot;
    if (dot) {
      const start = Math.floor(MAX_SNOW * 0.9);
      const density = (SNOW_DENSITY[this.zone] ?? 1) * (reduced ? 0.5 : 1);
      const shown = Math.round((MAX_SNOW - start) * density * clamp((w * h) / 640_000, 0.4, 1));
      g.globalAlpha = (SNOW_ALPHA[this.zone] ?? 0.6) * 0.8 * fadeIn;
      for (let i = start; i < start + shown; i++) {
        const o = i * 5;
        const fall = time * (this.snow[o + 2] as number) * unit - this.scroll * 1.3;
        const y = fract((this.snow[o + 1] as number) + fall / h) * (h + 12) - 6;
        const x = (this.snow[o] as number) * w + Math.sin(time * 0.4 + (this.snow[o + 4] as number)) * 14 * unit;
        g.drawImage(dot, Math.round(x * ratio - dot.width * 0.5), Math.round(y * ratio - dot.height * 0.5));
      }
    }

    const bubbles = Math.round((BUBBLES_BY_ZONE[this.zone] ?? 0) * (reduced ? 0.5 : 1));
    if (bubbles > 0 && this.bubbleSprites.length === 3) {
      g.globalAlpha = 0.8 * fadeIn;
      const span = h + 40;
      for (let i = 0; i < bubbles; i++) {
        const o = i * 5;
        const sprite = this.bubbleSprites[this.bubbles[o + 3] as number] as HTMLCanvasElement;
        const climb = time * (this.bubbles[o + 2] as number) * unit + this.scroll * 1.1;
        const y = h + 20 - fract((this.bubbles[o + 1] as number) + climb / span) * span;
        const x = (this.bubbles[o] as number) * w + Math.sin(time * 1.3 + (this.bubbles[o + 4] as number)) * 7 * unit;
        g.drawImage(sprite, Math.round(x * ratio - sprite.width * 0.5), Math.round(y * ratio - sprite.height * 0.5));
      }
    }

    // Dive streaks: thin lines of bubbles tearing upward, gone within the second.
    if (rush > 0.01 && !reduced) {
      g.fillStyle = '#d8f4ff';
      const span = h + 160 * unit;
      for (let i = 0; i < RUSH_STREAKS; i++) {
        const speed = 1.5 + hash01(i * 3 + 1) * 1.4;
        const y = h + 80 * unit - fract(hash01(i * 3 + 2) + (this.scroll * speed) / span) * span;
        const x = hash01(i * 3 + this.seed) * w;
        const long = (36 + 70 * hash01(i * 7)) * unit * rush;
        g.globalAlpha = (0.1 + 0.2 * hash01(i * 11)) * rush;
        g.fillRect(Math.round(x * ratio), Math.round(y * ratio), Math.max(1, Math.round((1 + hash01(i * 13)) * ratio)), Math.round(long * ratio));
      }
    }
    g.globalAlpha = 1;
    g.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  /** The two colours a species portrait is backed with, for a zone: [centre, edge]. */
  static portraitColours(zone: number): readonly [string, string] {
    const colours = WATER[clamp(Math.round(zone), 0, WATER.length - 1)] as readonly [Rgb, Rgb, Rgb];
    return [rgb(mixRgb(colours[0], colours[1], 0.35)), rgb(mixRgb(colours[1], colours[2], 0.7))];
  }
}
