// Short-lived effects: scan rings, miss ripples, bursts of sparks, the sub's
// scanning beam, floating text, and the screen-wide signs of a boost. Every
// kind lives in a fixed pool, so however fast the player taps, the cost of a
// frame has a ceiling.

import type { FloatStyle } from '../contracts.ts';
import { mulberry32, type Rng } from '../core/rng.ts';
import { FONT_STACK, GLOW_SOFT, GLOW_STAR, TAU, clamp, fract, hash01, hsla, makeSheet, type Stage } from './kit.ts';

const MAX_RINGS = 14;
const MAX_SPARKS = 150;
const MAX_TEXTS = 16;
const MAX_BEAMS = 4;

const RING_PULSE = 0;
const RING_RIPPLE = 1;
const RING_SHOCK = 2;

interface Ring {
  x: number;
  y: number;
  age: number;
  life: number;
  from: number;
  to: number;
  kind: number;
  colour: string;
}

interface FloatingText {
  text: string;
  x: number;
  y: number;
  age: number;
  life: number;
  style: FloatStyle;
  /** Half the drawn width in CSS pixels, measured on first draw; negative until then. */
  half: number;
}

interface Beam {
  x: number;
  y: number;
  age: number;
  colour: string;
}

interface TextStyle {
  readonly size: number;
  readonly weight: number;
  readonly fill: string;
  readonly outline: string;
  readonly outlineWidth: number;
  /** A second, inner outline in colour ('' for none). */
  readonly halo: string;
  readonly life: number;
  readonly rise: number;
  /** Extra size at the moment of appearing, settling to 0. */
  readonly pop: number;
}

const TEXT_STYLES: Readonly<Record<FloatStyle, TextStyle>> = {
  gain: { size: 17, weight: 700, fill: '#fff3d0', outline: 'rgba(3, 8, 20, 0.9)', outlineWidth: 3.6, halo: '', life: 1.05, rise: 46, pop: 0.12 },
  big: { size: 23, weight: 800, fill: '#ffd66b', outline: 'rgba(3, 8, 20, 0.92)', outlineWidth: 4.4, halo: '', life: 1.3, rise: 56, pop: 0.4 },
  combo: { size: 18, weight: 800, fill: '#5ff2e4', outline: 'rgba(3, 8, 20, 0.92)', outlineWidth: 4, halo: '', life: 1.15, rise: 40, pop: 0.3 },
  discover: { size: 25, weight: 800, fill: '#ffe08a', outline: 'rgba(3, 8, 20, 0.92)', outlineWidth: 7, halo: '#6a3fd0', life: 1.9, rise: 40, pop: 0.45 },
  fleet: { size: 12.5, weight: 600, fill: '#9bb3cc', outline: 'rgba(3, 8, 20, 0.8)', outlineWidth: 2.8, halo: '', life: 0.85, rise: 26, pop: 0 },
};

const STYLE_NAMES = Object.keys(TEXT_STYLES) as FloatStyle[];

export class Effects {
  private readonly rng: Rng;
  private readonly rings: Ring[] = [];
  private readonly texts: FloatingText[] = [];
  private readonly beams: Beam[] = [];
  private ringCount = 0;
  private textCount = 0;
  private beamCount = 0;

  private readonly sparkX = new Float32Array(MAX_SPARKS);
  private readonly sparkY = new Float32Array(MAX_SPARKS);
  private readonly sparkVX = new Float32Array(MAX_SPARKS);
  private readonly sparkVY = new Float32Array(MAX_SPARKS);
  private readonly sparkAge = new Float32Array(MAX_SPARKS);
  private readonly sparkLife = new Float32Array(MAX_SPARKS);
  private readonly sparkSize = new Float32Array(MAX_SPARKS);
  private readonly sparkHue = new Float32Array(MAX_SPARKS);
  private readonly sparkKind = new Uint8Array(MAX_SPARKS);
  private sparkCount = 0;

  /** 1 at the instant of a scan, fading to 0: brightens the sub's lamp and scanner. */
  scanFlash = 0;
  /** Fonts are built once per size of screen. */
  private fonts: Record<FloatStyle, string> = { gain: '', big: '', combo: '', discover: '', fleet: '' };
  private fontScale = 0;
  private frenzy = 0;
  private shoal = 0;
  private shoalY = 0;
  private edgeSprites: HTMLCanvasElement[] = [];
  private edgeKey = '';
  private band: HTMLCanvasElement | null = null;
  private bandKey = '';
  private unit = 1;
  private reduced = false;

  constructor(seed: number) {
    this.rng = mulberry32((seed ^ 0x2f6e2b1) >>> 0);
    for (let i = 0; i < MAX_RINGS; i++) this.rings.push({ x: 0, y: 0, age: 0, life: 1, from: 0, to: 0, kind: 0, colour: '' });
    for (let i = 0; i < MAX_TEXTS; i++) this.texts.push({ text: '', x: 0, y: 0, age: 0, life: 1, style: 'gain', half: -1 });
    for (let i = 0; i < MAX_BEAMS; i++) this.beams.push({ x: 0, y: 0, age: 0, colour: '' });
  }

  setUnit(unit: number): void {
    this.unit = unit;
  }

  setReduced(reduced: boolean): void {
    this.reduced = reduced;
  }

  // ---------------------------------------------------------------- spawning

  /** Takes the next free slot in a pool, or reuses the oldest entry when the pool is full. */
  private claim<T extends { age: number; life?: number }>(pool: T[], count: number): T {
    if (count < pool.length) return pool[count] as T;
    let oldest = pool[0] as T;
    for (const item of pool) if (item.age > oldest.age) oldest = item;
    return oldest;
  }

  private addRing(x: number, y: number, kind: number, from: number, to: number, life: number, colour: string): void {
    const ring = this.claim(this.rings, this.ringCount);
    if (this.ringCount < MAX_RINGS) this.ringCount++;
    ring.x = x;
    ring.y = y;
    ring.age = 0;
    ring.life = life;
    ring.from = from;
    ring.to = to;
    ring.kind = kind;
    ring.colour = colour;
  }

  scanPulse(x: number, y: number, hue: number): void {
    const unit = this.unit;
    this.addRing(x, y, RING_PULSE, 12 * unit, 52 * unit, 0.42, hsla(hue, 95, 74, 1));
    const beam = this.claim(this.beams, this.beamCount);
    if (this.beamCount < MAX_BEAMS) this.beamCount++;
    beam.x = x;
    beam.y = y;
    beam.age = 0;
    beam.colour = hsla(hue, 95, 76, 1);
    this.scanFlash = 1;
  }

  ripple(x: number, y: number): void {
    const unit = this.unit;
    this.addRing(x, y, RING_RIPPLE, 5 * unit, 30 * unit, 0.5, 'rgba(220, 246, 255, 1)');
  }

  burst(x: number, y: number, hue: number, strength: number): void {
    const unit = this.unit;
    const power = clamp(strength, 0.3, 4);
    const count = Math.round((5 + 6.5 * power) * (this.reduced ? 0.4 : 1));
    const reach = (64 + 44 * power) * unit;
    for (let i = 0; i < count; i++) {
      // When the pool is full the oldest spark makes way: new sparks matter more than dying ones.
      let slot = this.sparkCount;
      if (slot >= MAX_SPARKS) {
        slot = 0;
        let oldest = -1;
        for (let k = 0; k < MAX_SPARKS; k++) {
          const done = (this.sparkAge[k] as number) / (this.sparkLife[k] as number);
          if (done > oldest) {
            oldest = done;
            slot = k;
          }
        }
      } else {
        this.sparkCount++;
      }
      const angle = this.rng() * TAU;
      const speed = reach * (0.5 + this.rng() * 1.3);
      this.sparkX[slot] = x;
      this.sparkY[slot] = y;
      this.sparkVX[slot] = Math.cos(angle) * speed;
      this.sparkVY[slot] = Math.sin(angle) * speed - 20 * unit;
      this.sparkAge[slot] = 0;
      this.sparkLife[slot] = (0.42 + this.rng() * 0.5) * (0.85 + 0.12 * power);
      this.sparkSize[slot] = (3.2 + this.rng() * 3.4 + power * 0.5) * unit;
      const roll = this.rng();
      this.sparkHue[slot] = roll < 0.2 ? 48 : hue + (this.rng() - 0.5) * 36;
      this.sparkKind[slot] = power >= 2.5 && roll > 0.72 ? GLOW_STAR : GLOW_SOFT;
    }
    if (power >= 2.5) this.addRing(x, y, RING_SHOCK, 16 * unit, (70 + 26 * power) * unit, 0.6, hsla(hue, 95, 78, 1));
  }

  floatText(x: number, y: number, text: string, style: FloatStyle): void {
    const entry = this.claim(this.texts, this.textCount);
    if (this.textCount < MAX_TEXTS) this.textCount++;
    entry.text = text;
    entry.x = x;
    entry.y = y;
    entry.age = 0;
    entry.life = TEXT_STYLES[style].life;
    entry.style = style;
    entry.half = -1;
  }

  // ---------------------------------------------------------------- stepping

  /** Ages everything by `dt` seconds and drops what has finished. */
  update(dt: number, frenzyActive: boolean, shoalActive: boolean, shoalY: number): void {
    this.scanFlash = Math.max(0, this.scanFlash - dt * 4.5);
    this.frenzy = clamp(this.frenzy + (frenzyActive ? dt * 2.2 : -dt * 1.6), 0, 1);
    if (shoalActive && shoalY > 0) {
      this.shoalY = this.shoal <= 0.01 ? shoalY : this.shoalY + (shoalY - this.shoalY) * Math.min(1, dt * 2.5);
      this.shoal = Math.min(1, this.shoal + dt * 1.8);
    } else {
      this.shoal = Math.max(0, this.shoal - dt * 1.3);
    }
    if (dt <= 0) return;

    for (let i = 0; i < this.ringCount; ) {
      const ring = this.rings[i] as Ring;
      ring.age += dt;
      if (ring.age >= ring.life) {
        const last = this.rings[this.ringCount - 1] as Ring;
        this.rings[i] = last;
        this.rings[this.ringCount - 1] = ring;
        this.ringCount--;
      } else {
        i++;
      }
    }
    for (let i = 0; i < this.beamCount; ) {
      const beam = this.beams[i] as Beam;
      beam.age += dt;
      if (beam.age >= 0.24) {
        const last = this.beams[this.beamCount - 1] as Beam;
        this.beams[i] = last;
        this.beams[this.beamCount - 1] = beam;
        this.beamCount--;
      } else {
        i++;
      }
    }
    for (let i = 0; i < this.textCount; ) {
      const text = this.texts[i] as FloatingText;
      text.age += dt;
      if (text.age >= text.life) {
        const last = this.texts[this.textCount - 1] as FloatingText;
        this.texts[i] = last;
        this.texts[this.textCount - 1] = text;
        this.textCount--;
      } else {
        i++;
      }
    }
    // Sparks coast to a stop in the water and drift up a little as they die.
    const drag = Math.exp(-3.4 * dt);
    const lift = 26 * this.unit * dt;
    for (let i = 0; i < this.sparkCount; ) {
      const age = (this.sparkAge[i] as number) + dt;
      if (age >= (this.sparkLife[i] as number)) {
        const last = this.sparkCount - 1;
        this.sparkX[i] = this.sparkX[last] as number;
        this.sparkY[i] = this.sparkY[last] as number;
        this.sparkVX[i] = this.sparkVX[last] as number;
        this.sparkVY[i] = this.sparkVY[last] as number;
        this.sparkAge[i] = this.sparkAge[last] as number;
        this.sparkLife[i] = this.sparkLife[last] as number;
        this.sparkSize[i] = this.sparkSize[last] as number;
        this.sparkHue[i] = this.sparkHue[last] as number;
        this.sparkKind[i] = this.sparkKind[last] as number;
        this.sparkCount--;
        continue;
      }
      this.sparkAge[i] = age;
      this.sparkVX[i] = (this.sparkVX[i] as number) * drag;
      this.sparkVY[i] = (this.sparkVY[i] as number) * drag - lift;
      this.sparkX[i] = (this.sparkX[i] as number) + (this.sparkVX[i] as number) * dt;
      this.sparkY[i] = (this.sparkY[i] as number) + (this.sparkVY[i] as number) * dt;
      i++;
    }
  }

  // ---------------------------------------------------------------- drawing

  /** Boost effects that belong behind the creatures: the sonar sweep and the shoal's golden path. */
  drawUnder(g: CanvasRenderingContext2D, stage: Stage, width: number, height: number, time: number, sonar: boolean, subX: number, subY: number): void {
    const ratio = stage.ratio;
    const unit = stage.unit;
    if (this.shoal > 0.01) {
      const tall = Math.round(150 * unit * ratio);
      const key = `${Math.round(width * ratio)}:${tall}`;
      if (key !== this.bandKey || !this.band) {
        this.bandKey = key;
        const sheet = makeSheet(width * ratio, tall);
        const fill = sheet.g.createLinearGradient(0, 0, 0, tall);
        fill.addColorStop(0, 'rgba(255, 214, 107, 0)');
        fill.addColorStop(0.5, 'rgba(255, 214, 107, 0.2)');
        fill.addColorStop(1, 'rgba(255, 214, 107, 0)');
        sheet.g.fillStyle = fill;
        sheet.g.fillRect(0, 0, sheet.canvas.width, tall);
        this.band = sheet.canvas;
      }
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = this.shoal * (0.75 + 0.25 * Math.sin(time * 3.1));
      g.drawImage(this.band, 0, Math.round(this.shoalY * ratio - tall * 0.5));
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = 1;
      // Glints drifting along the path.
      const glints = stage.detail >= 1 ? 7 : 3;
      for (let k = 0; k < glints; k++) {
        const along = fract(hash01(k * 17 + 3) + time * (0.035 + 0.02 * hash01(k * 5)));
        const twinkle = Math.pow(0.5 + 0.5 * Math.sin(time * (2.2 + k * 0.37) + k * 1.9), 3);
        stage.lights.push(stage.glows.get(GLOW_STAR, 48, 80, (6 + 5 * hash01(k * 3)) * unit * ratio), along * width * ratio, (this.shoalY + (hash01(k * 29 + 1) - 0.5) * 96 * unit) * ratio, this.shoal * twinkle * 0.9);
      }
    }
    if (sonar) {
      // A ring of sound leaving the sub every couple of seconds.
      const cycle = fract(time / 2.3);
      const reach = Math.hypot(width, height) * 0.95;
      const radius = 30 * unit + cycle * reach;
      const fade = Math.pow(1 - cycle, 1.4);
      g.setTransform(ratio, 0, 0, ratio, 0, 0);
      g.strokeStyle = '#5ff2e4';
      g.globalAlpha = 0.1 * fade;
      g.lineWidth = 14 * unit;
      g.beginPath();
      g.arc(subX, subY, Math.max(1, radius - 9 * unit), 0, TAU);
      g.stroke();
      g.globalAlpha = 0.5 * fade;
      g.lineWidth = 2 * unit;
      g.beginPath();
      g.arc(subX, subY, radius, 0, TAU);
      g.stroke();
      g.globalAlpha = 1;
    }
  }

  /** Radius of the sonar ring this instant, for lighting up what it passes; 0 when sonar is off. */
  sonarRadius(width: number, height: number, time: number, sonar: boolean, unit: number): number {
    return sonar ? 30 * unit + fract(time / 2.3) * Math.hypot(width, height) * 0.95 : 0;
  }

  /** The sub's scanning beams, drawn over the creatures they point at. */
  drawBeams(g: CanvasRenderingContext2D, stage: Stage, noseX: number, noseY: number): void {
    if (this.beamCount === 0) return;
    const unit = stage.unit;
    g.setTransform(stage.ratio, 0, 0, stage.ratio, 0, 0);
    g.lineCap = 'round';
    for (let i = 0; i < this.beamCount; i++) {
      const beam = this.beams[i] as Beam;
      const fade = 1 - beam.age / 0.24;
      g.globalAlpha = 0.3 * fade;
      g.strokeStyle = beam.colour;
      g.lineWidth = 6 * unit * (0.6 + 0.4 * fade);
      g.beginPath();
      g.moveTo(noseX, noseY);
      g.lineTo(beam.x, beam.y);
      g.stroke();
      g.globalAlpha = 0.9 * fade;
      g.strokeStyle = '#f2fffd';
      g.lineWidth = 1.5 * unit;
      g.stroke();
    }
    g.globalAlpha = 1;
  }

  /** Rings and sparks, over everything in the water. */
  drawOver(g: CanvasRenderingContext2D, stage: Stage): void {
    const ratio = stage.ratio;
    const unit = stage.unit;
    if (this.ringCount > 0) {
      g.setTransform(ratio, 0, 0, ratio, 0, 0);
      for (let i = 0; i < this.ringCount; i++) {
        const ring = this.rings[i] as Ring;
        const v = ring.age / ring.life;
        const eased = 1 - (1 - v) * (1 - v);
        const radius = ring.from + (ring.to - ring.from) * eased;
        g.strokeStyle = ring.colour;
        g.beginPath();
        g.arc(ring.x, ring.y, radius, 0, TAU);
        if (ring.kind === RING_RIPPLE) {
          g.globalAlpha = 0.34 * (1 - v);
          g.lineWidth = 1.3 * unit;
          g.stroke();
        } else {
          // A dark edge under the bright one keeps the ring readable on sunlit water.
          g.globalAlpha = 0.28 * (1 - v);
          g.lineWidth = (ring.kind === RING_SHOCK ? 7 : 5.4) * unit * (1 - v * 0.5);
          g.strokeStyle = '#04122c';
          g.stroke();
          g.globalAlpha = (1 - v) * (1 - v) * 0.95 + (1 - v) * 0.05;
          g.strokeStyle = ring.colour;
          g.lineWidth = (ring.kind === RING_SHOCK ? 3.6 : 2.8) * unit * (1 - v * 0.6);
          g.stroke();
        }
      }
      g.globalAlpha = 1;
    }
    const glows = stage.glows;
    for (let i = 0; i < this.sparkCount; i++) {
      const v = (this.sparkAge[i] as number) / (this.sparkLife[i] as number);
      const size = (this.sparkSize[i] as number) * (1 - 0.45 * v) * ratio;
      const kind = this.sparkKind[i] as number;
      stage.lights.push(glows.get(kind, this.sparkHue[i] as number, kind === GLOW_STAR ? 60 : 100, kind === GLOW_STAR ? size * 1.7 : size), (this.sparkX[i] as number) * ratio, (this.sparkY[i] as number) * ratio, Math.pow(1 - v, 1.3));
    }
    stage.lights.flush(g);
  }

  /** Floating text and the frenzy glow: the very top of the picture. */
  drawTop(g: CanvasRenderingContext2D, stage: Stage, width: number, height: number, time: number, zone: number): void {
    const ratio = stage.ratio;
    const unit = stage.unit;

    if (this.frenzy > 0.01) {
      // A warm glow breathing in from every edge.
      const depth = Math.round(clamp(70 * unit, 40, 110) * ratio);
      const w = Math.round(width * ratio);
      const h = Math.round(height * ratio);
      const key = `${w}:${h}:${depth}`;
      if (key !== this.edgeKey || this.edgeSprites.length !== 4) {
        this.edgeKey = key;
        this.edgeSprites = [];
        for (let side = 0; side < 4; side++) {
          const horizontal = side < 2;
          const sheet = makeSheet(horizontal ? w : depth, horizontal ? depth : h);
          const fill = horizontal ? sheet.g.createLinearGradient(0, side === 0 ? 0 : depth, 0, side === 0 ? depth : 0) : sheet.g.createLinearGradient(side === 2 ? 0 : depth, 0, side === 2 ? depth : 0, 0);
          fill.addColorStop(0, 'rgba(255, 146, 54, 0.62)');
          fill.addColorStop(0.4, 'rgba(255, 170, 70, 0.2)');
          fill.addColorStop(1, 'rgba(255, 180, 80, 0)');
          sheet.g.fillStyle = fill;
          sheet.g.fillRect(0, 0, sheet.canvas.width, sheet.canvas.height);
          this.edgeSprites.push(sheet.canvas);
        }
      }
      const pulse = this.reduced ? 0.7 : 0.62 + 0.38 * Math.sin(time * 4.4);
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalCompositeOperation = zone >= 2 ? 'lighter' : 'source-over';
      g.globalAlpha = this.frenzy * pulse;
      g.drawImage(this.edgeSprites[0] as HTMLCanvasElement, 0, 0);
      g.drawImage(this.edgeSprites[1] as HTMLCanvasElement, 0, h - depth);
      g.drawImage(this.edgeSprites[2] as HTMLCanvasElement, 0, 0);
      g.drawImage(this.edgeSprites[3] as HTMLCanvasElement, w - depth, 0);
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = 1;
    }

    if (this.textCount === 0) return;
    const scale = clamp(0.8 + 0.2 * unit, 0.9, 1.1);
    if (scale !== this.fontScale) {
      this.fontScale = scale;
      for (const name of STYLE_NAMES) {
        const style = TEXT_STYLES[name];
        this.fonts[name] = `${style.weight} ${(style.size * scale).toFixed(1)}px ${FONT_STACK}`;
      }
    }
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    for (let i = 0; i < this.textCount; i++) {
      const entry = this.texts[i] as FloatingText;
      const style = TEXT_STYLES[entry.style];
      const v = entry.age / entry.life;
      const rise = style.rise * unit * (1 - (1 - v) * (1 - v));
      const alpha = v < 0.62 ? 1 : 1 - (v - 0.62) / 0.38;
      const popIn = entry.age < 0.2 ? style.pop * (1 - entry.age / 0.2) : 0;
      const zoom = ratio * (1 + popIn);
      g.font = this.fonts[entry.style];
      // Keep the whole string on the canvas.
      if (entry.half < 0) entry.half = g.measureText(entry.text).width * 0.5 + 4;
      const half = entry.half;
      const x = half * 2 >= width ? width * 0.5 : clamp(entry.x, half, width - half);
      const y = Math.max(style.size * scale * 0.7, entry.y - rise);
      g.setTransform(zoom, 0, 0, zoom, x * ratio, y * ratio);
      g.globalAlpha = alpha;
      g.strokeStyle = style.outline;
      g.lineWidth = style.outlineWidth * scale;
      g.strokeText(entry.text, 0, 0);
      if (style.halo) {
        g.strokeStyle = style.halo;
        g.lineWidth = style.outlineWidth * 0.52 * scale;
        g.strokeText(entry.text, 0, 0);
      }
      g.fillStyle = style.fill;
      g.fillText(entry.text, 0, 0);
    }
    g.globalAlpha = 1;
    g.setTransform(ratio, 0, 0, ratio, 0, 0);
  }
}
