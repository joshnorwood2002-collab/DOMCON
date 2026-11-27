// Small shared tools for the renderer: colour strings, cheap noise, offscreen
// canvases, and the cache of soft glow sprites that every light in the game is
// drawn with.

export const TAU = Math.PI * 2;

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Fractional part, always in [0, 1). */
export function fract(value: number): number {
  return value - Math.floor(value);
}

export function smooth(t: number): number {
  const c = clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
}

/** A repeatable pseudo-random value in [0, 1) for an integer, used to scatter things without storing them. */
export function hash01(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function wrapHue(hue: number): number {
  return ((hue % 360) + 360) % 360;
}

export function hsl(hue: number, saturation: number, lightness: number): string {
  return `hsl(${Math.round(wrapHue(hue))}, ${Math.round(clamp(saturation, 0, 100))}%, ${Math.round(clamp(lightness, 0, 100))}%)`;
}

export function hsla(hue: number, saturation: number, lightness: number, alpha: number): string {
  return `hsla(${Math.round(wrapHue(hue))}, ${Math.round(clamp(saturation, 0, 100))}%, ${Math.round(clamp(lightness, 0, 100))}%, ${clamp(alpha, 0, 1).toFixed(3)})`;
}

export type Rgb = readonly [number, number, number];

export function hexToRgb(hex: string): Rgb {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

export function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

export function rgb(colour: Rgb, alpha = 1): string {
  const r = Math.round(clamp(colour[0], 0, 255));
  const g = Math.round(clamp(colour[1], 0, 255));
  const b = Math.round(clamp(colour[2], 0, 255));
  return alpha >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1).toFixed(3)})`;
}

export interface Sheet {
  readonly canvas: HTMLCanvasElement;
  readonly g: CanvasRenderingContext2D;
}

/** An offscreen canvas and its context. `opaque` sheets copy faster, so use them for full backdrops. */
export function makeSheet(width: number, height: number, opaque = false): Sheet {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const g = canvas.getContext('2d', opaque ? { alpha: false } : undefined);
  if (!g) throw new Error('Canvas 2D is not available');
  return { canvas, g };
}

// ---------------------------------------------------------------- glow sprites

/** A soft round light with a bright middle. */
export const GLOW_SOFT = 0;
/** A light with a white-hot centre, for lures and lamps. */
export const GLOW_CORE = 1;
/** A wide, faint halo with no hard centre, for auras. */
export const GLOW_AURA = 2;
/** A four-pointed glint, for sparkles. */
export const GLOW_STAR = 3;

const BUCKETS = 32;
const BUCKET_GROWTH = 1.18;
const BUCKET_LOG = Math.log(BUCKET_GROWTH);
const HUE_STEPS = 60;
/** Total sprite pixels kept before the cache is emptied and rebuilt on demand. */
const MAX_CACHED_PIXELS = 5_000_000;

function bucketRadius(bucket: number): number {
  return Math.max(2, Math.round(2 * Math.pow(BUCKET_GROWTH, bucket)));
}

/**
 * Glow sprites are drawn at exactly the size they were made, on whole pixels:
 * an unscaled copy is several times cheaper than a stretched one. Radii snap to
 * a ladder of sizes about 18% apart, which the eye cannot tell from a soft light.
 */
export class GlowBank {
  private readonly sprites = new Map<number, HTMLCanvasElement>();
  private pixels = 0;

  /** `radius` is in device pixels; `saturation` is 0-100. */
  get(kind: number, hue: number, saturation: number, radius: number): HTMLCanvasElement {
    const bucket = clamp(Math.round(Math.log(Math.max(2, radius) / 2) / BUCKET_LOG), 0, BUCKETS - 1);
    const hueStep = Math.round((wrapHue(hue) / 360) * HUE_STEPS) % HUE_STEPS;
    const satStep = clamp(Math.round(saturation / 34), 0, 3);
    const key = ((kind * 4 + satStep) * HUE_STEPS + hueStep) * BUCKETS + bucket;
    let sprite = this.sprites.get(key);
    if (!sprite) {
      if (this.pixels > MAX_CACHED_PIXELS) this.clear();
      sprite = paintGlow(kind, (hueStep * 360) / HUE_STEPS, satStep * 33, bucketRadius(bucket));
      this.sprites.set(key, sprite);
      this.pixels += sprite.width * sprite.height;
    }
    return sprite;
  }

  clear(): void {
    this.sprites.clear();
    this.pixels = 0;
  }
}

function paintGlow(kind: number, hue: number, saturation: number, radius: number): HTMLCanvasElement {
  const size = radius * 2;
  const { canvas, g } = makeSheet(size, size);
  const gradient = g.createRadialGradient(radius, radius, 0, radius, radius, radius);
  if (kind === GLOW_CORE) {
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    gradient.addColorStop(0.1, hsla(hue, saturation, 88, 0.95));
    gradient.addColorStop(0.3, hsla(hue, saturation, 64, 0.42));
    gradient.addColorStop(0.62, hsla(hue, saturation, 52, 0.1));
    gradient.addColorStop(1, hsla(hue, saturation, 50, 0));
  } else if (kind === GLOW_AURA) {
    gradient.addColorStop(0, hsla(hue, saturation, 68, 0.58));
    gradient.addColorStop(0.35, hsla(hue, saturation, 60, 0.3));
    gradient.addColorStop(0.7, hsla(hue, saturation, 54, 0.08));
    gradient.addColorStop(1, hsla(hue, saturation, 50, 0));
  } else if (kind === GLOW_STAR) {
    gradient.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
    gradient.addColorStop(0.18, hsla(hue, saturation, 84, 0.5));
    gradient.addColorStop(0.5, hsla(hue, saturation, 70, 0.1));
    gradient.addColorStop(1, hsla(hue, saturation, 60, 0));
  } else {
    gradient.addColorStop(0, hsla(hue, saturation, 80, 0.95));
    gradient.addColorStop(0.25, hsla(hue, saturation, 64, 0.45));
    gradient.addColorStop(0.6, hsla(hue, saturation, 52, 0.12));
    gradient.addColorStop(1, hsla(hue, saturation, 50, 0));
  }
  g.fillStyle = gradient;
  if (kind === GLOW_STAR) {
    // A faint round core, then two long thin diamonds for the points.
    g.globalAlpha = 0.55;
    g.beginPath();
    g.arc(radius, radius, radius * 0.5, 0, TAU);
    g.fill();
    g.globalAlpha = 1;
    const thin = Math.max(0.7, radius * 0.11);
    g.beginPath();
    g.moveTo(0, radius);
    g.lineTo(radius, radius - thin);
    g.lineTo(size, radius);
    g.lineTo(radius, radius + thin);
    g.closePath();
    g.moveTo(radius, 0);
    g.lineTo(radius + thin, radius);
    g.lineTo(radius, size);
    g.lineTo(radius - thin, radius);
    g.closePath();
    g.fill();
  } else {
    g.fillRect(0, 0, size, size);
  }
  return canvas;
}

// ---------------------------------------------------------------- batched sprite drawing

/**
 * Collects sprites to draw later in one additive pass. Positions are device
 * pixels; every sprite is drawn unscaled and centred on a whole pixel.
 */
export class SpriteQueue {
  private readonly sprites: (HTMLCanvasElement | null)[];
  private readonly xs: Float32Array;
  private readonly ys: Float32Array;
  private readonly alphas: Float32Array;
  private readonly capacity: number;
  private count = 0;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.sprites = new Array<HTMLCanvasElement | null>(capacity).fill(null);
    this.xs = new Float32Array(capacity);
    this.ys = new Float32Array(capacity);
    this.alphas = new Float32Array(capacity);
  }

  push(sprite: HTMLCanvasElement, x: number, y: number, alpha: number): void {
    if (this.count >= this.capacity || alpha <= 0.004) return;
    const i = this.count++;
    this.sprites[i] = sprite;
    this.xs[i] = x;
    this.ys[i] = y;
    this.alphas[i] = alpha > 1 ? 1 : alpha;
  }

  /** Draws everything queued with additive blending, then empties the queue. Leaves the transform at identity. */
  flush(g: CanvasRenderingContext2D): void {
    if (this.count === 0) return;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < this.count; i++) {
      const sprite = this.sprites[i] as HTMLCanvasElement;
      g.globalAlpha = this.alphas[i] as number;
      g.drawImage(sprite, Math.round((this.xs[i] as number) - sprite.width / 2), Math.round((this.ys[i] as number) - sprite.height / 2));
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    this.count = 0;
  }

  discard(): void {
    this.count = 0;
  }
}

/** What the drawing code needs to know about the surface it is drawing on. */
export interface Stage {
  /** Device pixels per CSS pixel. */
  ratio: number;
  /** Size multiplier for this screen (SceneView.unit). */
  unit: number;
  /** 1 for full animation; lower when the player asked for reduced motion. */
  motion: number;
  /** 2 = everything, 1 = fewer decorative lights, 0 = essentials only. */
  detail: number;
  readonly glows: GlowBank;
  /** Drawn before creature bodies. */
  readonly auras: SpriteQueue;
  /** Drawn after creature bodies. */
  readonly lights: SpriteQueue;
}

export function makeStage(): Stage {
  return { ratio: 1, unit: 1, motion: 1, detail: 2, glows: new GlowBank(), auras: new SpriteQueue(96), lights: new SpriteQueue(640) };
}

export const FONT_STACK = 'ui-rounded, "SF Pro Rounded", "Segoe UI", system-ui, -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif';
