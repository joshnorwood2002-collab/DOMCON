// Draws the eight creature archetypes. Bodies are vector shapes built each
// frame from a moving spine or a pulsing outline; every light is a cached glow
// sprite queued for one additive pass (see SpriteQueue). Nothing here allocates
// while drawing: all scratch space is in the typed arrays below.

import { GLOW_AURA, GLOW_CORE, GLOW_SOFT, GLOW_STAR, TAU, fract, hash01, hsl, hsla, type Stage } from './kit.ts';
import {
  DORSAL_NONE,
  DORSAL_PEAK,
  DORSAL_SAIL,
  PATTERN_BARS,
  PATTERN_SADDLES,
  PATTERN_SPOTS,
  PATTERN_STRIPE,
  PATTERN_TWOTONE,
  TAIL_FAN,
  TAIL_FORK,
  TAIL_LUNATE,
  TAIL_POINT,
  TAIL_VEIL,
  type Look,
} from './looks.ts';

// ---------------------------------------------------------------- scratch state

const MAX_SPINE = 32;
/** Spine points and their upward normals, in design pixels. */
const PX = new Float32Array(MAX_SPINE);
const PY = new Float32Array(MAX_SPINE);
const NX = new Float32Array(MAX_SPINE);
const NY = new Float32Array(MAX_SPINE);
/** Outline being assembled. */
const OX = new Float32Array(MAX_SPINE * 2 + 8);
const OY = new Float32Array(MAX_SPINE * 2 + 8);

/** Where the current creature is being drawn. */
let G: CanvasRenderingContext2D;
let STAGE: Stage;
/** Design pixels to device pixels for the creature being drawn. */
let TA = 1;
let TB = 0;
let TC = 0;
let TD = 1;
let TX = 0;
let TY = 0;
/** Device pixels per design pixel, for light radii. */
let TS = 1;
let ALPHA = 1;
let FLASH = 0;
/** False when drawing a silhouette: lights and eyes are skipped. */
let LIT = true;
/** Animation amplitude, lower with reduced motion. */
let MOTION = 1;

const WHITE = '#ffffff';
const RAINBOW: readonly string[] = Array.from({ length: 24 }, (_, i) => hsl(i * 15, 100, 66));

function setCreatureTransform(g: CanvasRenderingContext2D): void {
  g.setTransform(TA, TB, TC, TD, TX, TY);
}

/** Moves the drawing origin to a point on the creature, turned by the angle whose cosine and sine are given. */
function frame(g: CanvasRenderingContext2D, x: number, y: number, cos: number, sin: number): void {
  g.setTransform(TA * cos + TC * sin, TB * cos + TD * sin, TC * cos - TA * sin, TD * cos - TB * sin, TA * x + TC * y + TX, TB * x + TD * y + TY);
}

/** Queues a light at a point given in the creature's own coordinates. */
function light(x: number, y: number, radius: number, hue: number, alpha: number, kind = GLOW_SOFT, saturation = 100): void {
  if (!LIT || alpha <= 0.004) return;
  const sprite = STAGE.glows.get(kind, hue, saturation, radius * TS);
  STAGE.lights.push(sprite, TA * x + TC * y + TX, TB * x + TD * y + TY, alpha * ALPHA);
}

/**
 * Lays a travelling wave along a straight spine that starts at the nose and
 * runs backwards. `lead` is how much of the swing reaches the head.
 */
function spine(segments: number, length: number, nose: number, phase: number, wave: number, sway: number, lead: number, power: number): void {
  for (let i = 0; i <= segments; i++) {
    const u = i / segments;
    PX[i] = nose - u * length;
    PY[i] = Math.sin(phase - u * wave) * sway * (lead + (1 - lead) * Math.pow(u, power));
  }
  for (let i = 0; i <= segments; i++) {
    const a = i > 0 ? i - 1 : 0;
    const b = i < segments ? i + 1 : segments;
    const dx = PX[b]! - PX[a]!;
    const dy = PY[b]! - PY[a]!;
    const inv = 1 / (Math.hypot(dx, dy) || 1);
    // The spine runs tailwards (towards -x), so this normal points up the screen.
    NX[i] = -dy * inv;
    NY[i] = dx * inv;
  }
}

/** Traces a closed curve through the midpoints of the first `count` outline points, rounding every corner. */
function smoothClosed(g: CanvasRenderingContext2D, count: number): void {
  const lastX = OX[count - 1]!;
  const lastY = OY[count - 1]!;
  g.beginPath();
  g.moveTo((lastX + OX[0]!) * 0.5, (lastY + OY[0]!) * 0.5);
  for (let i = 0; i < count; i++) {
    const next = i + 1 < count ? i + 1 : 0;
    const cx = OX[i]!;
    const cy = OY[i]!;
    g.quadraticCurveTo(cx, cy, (cx + OX[next]!) * 0.5, (cy + OY[next]!) * 0.5);
  }
  g.closePath();
}

/** Builds the body outline around the spine: over the back from nose to tail, then back along the belly. */
function bodyOutline(segments: number, upper: Float32Array, lowerScale: number, keel: number): number {
  let k = 0;
  OX[k] = PX[0]! + upper[0]! * 0.9;
  OY[k] = PY[0]!;
  k++;
  for (let i = 0; i <= segments; i++) {
    const w = upper[i]!;
    OX[k] = PX[i]! + NX[i]! * w;
    OY[k] = PY[i]! + NY[i]! * w;
    k++;
  }
  for (let i = segments; i >= 0; i--) {
    const w = upper[i]! * lowerScale * (1 + keel * keelProfile(i / segments));
    OX[k] = PX[i]! - NX[i]! * w;
    OY[k] = PY[i]! - NY[i]! * w;
    k++;
  }
  return k;
}

/** Where a deep-bellied fish carries its extra depth: most of it under the shoulder. */
function keelProfile(u: number): number {
  return u < 0.72 ? Math.pow(Math.sin((u / 0.72) * Math.PI), 0.8) : 0;
}

function bodyGradient(g: CanvasRenderingContext2D, look: Look, reach: number): CanvasGradient {
  if (!look.gradient) {
    const gradient = g.createLinearGradient(0, -reach, 0, reach * (1 + look.keel));
    gradient.addColorStop(0, look.top);
    gradient.addColorStop(0.5, look.mid);
    gradient.addColorStop(1, look.belly);
    look.gradient = gradient;
  }
  return look.gradient;
}

/** Fills the current path as the creature's body, with the white pop of a hit and the rim of a deep species. */
function fillBody(g: CanvasRenderingContext2D, look: Look, style: string | CanvasGradient): void {
  g.globalAlpha = ALPHA * look.bodyAlpha;
  g.fillStyle = style;
  g.fill();
  if (FLASH > 0.02) {
    g.globalAlpha = ALPHA * FLASH * 0.62;
    g.fillStyle = WHITE;
    g.fill();
  }
  if (look.rim) {
    g.globalAlpha = ALPHA;
    g.strokeStyle = look.rim;
    g.lineWidth = 0.9;
    g.stroke();
  }
  g.globalAlpha = ALPHA;
}

function eye(g: CanvasRenderingContext2D, look: Look, x: number, y: number, radius: number): void {
  if (!LIT || look.eyeless) return;
  g.fillStyle = look.eyeWhite;
  g.beginPath();
  g.arc(x, y, radius, 0, TAU);
  g.fill();
  g.fillStyle = look.pupil;
  g.beginPath();
  g.arc(x + radius * 0.24, y + radius * 0.04, radius * 0.6, 0, TAU);
  g.fill();
  if (radius * TS > 2.2) {
    g.fillStyle = WHITE;
    g.beginPath();
    g.arc(x + radius * 0.02, y - radius * 0.3, radius * 0.24, 0, TAU);
    g.fill();
  }
}

// ---------------------------------------------------------------- fish, lanternfish and anglers

function tailFin(g: CanvasRenderingContext2D, look: Look, phase: number): void {
  const l = look.tailLen;
  const s = look.tailSpread;
  g.beginPath();
  g.moveTo(-2, 0);
  switch (look.tail) {
    case TAIL_FAN:
      g.quadraticCurveTo(l * 0.3, -s * 0.95, l * 0.92, -s * 0.82);
      g.quadraticCurveTo(l * 1.14, 0, l * 0.92, s * 0.82);
      g.quadraticCurveTo(l * 0.3, s * 0.95, -2, 0);
      break;
    case TAIL_LUNATE:
      g.quadraticCurveTo(l * 0.28, -s * 0.5, l * 1.05, -s * 1.12);
      g.quadraticCurveTo(l * 0.36, 0, l * 1.05, s * 1.12);
      g.quadraticCurveTo(l * 0.28, s * 0.5, -2, 0);
      break;
    case TAIL_VEIL: {
      // Two long lobes that trail and ripple, like a fantail's.
      const ripple = Math.sin(phase * 0.5 - 1.2) * 0.14 * MOTION;
      g.bezierCurveTo(l * 0.3, -s * 1.05, l * 0.8, -s * 1.25, l * 1.02, -s * (0.92 + ripple));
      g.quadraticCurveTo(l * 0.7, -s * 0.2, l * 0.56, 0);
      g.quadraticCurveTo(l * 0.7, s * 0.2, l * 1.02, s * (0.92 - ripple));
      g.bezierCurveTo(l * 0.8, s * 1.25, l * 0.3, s * 1.05, -2, 0);
      break;
    }
    case TAIL_POINT:
      g.quadraticCurveTo(l * 0.4, -s * 0.9, l * 1.1, 0);
      g.quadraticCurveTo(l * 0.4, s * 0.9, -2, 0);
      break;
    case TAIL_FORK:
    default:
      g.quadraticCurveTo(l * 0.42, -s * 0.3, l, -s);
      g.quadraticCurveTo(l * 0.6, 0, l, s);
      g.quadraticCurveTo(l * 0.42, s * 0.3, -2, 0);
      break;
  }
  g.fillStyle = look.fin;
  g.fill();
  if (look.tier >= 1 || look.deep) {
    g.strokeStyle = look.finEdge;
    g.lineWidth = 0.8;
    g.globalAlpha = ALPHA * 0.55;
    g.stroke();
    g.globalAlpha = ALPHA;
  }
}

/** The fin on the back. Drawn before the body so that its base is hidden. */
function dorsalFin(g: CanvasRenderingContext2D, look: Look, segments: number, widths: Float32Array, phase: number): void {
  if (look.dorsal === DORSAL_NONE) return;
  const h = look.dorsalH;
  g.fillStyle = look.fin;
  if (look.dorsal === DORSAL_PEAK) {
    const i0 = Math.round(segments * look.peak);
    const i1 = Math.round(segments * 0.68);
    const im = (i0 + i1) >> 1;
    const ax = PX[i0]! + NX[i0]! * widths[i0]! * 0.85;
    const ay = PY[i0]! + NY[i0]! * widths[i0]! * 0.85;
    const bx = PX[i1]! + NX[i1]! * widths[i1]! * 0.85;
    const by = PY[i1]! + NY[i1]! * widths[i1]! * 0.85;
    const px = PX[im]! + NX[im]! * (widths[im]! + h) - h * 0.55;
    const py = PY[im]! + NY[im]! * (widths[im]! + h);
    g.beginPath();
    g.moveTo(ax, ay);
    g.quadraticCurveTo(ax + NX[i0]! * h * 0.9 - h * 0.1, ay + NY[i0]! * h * 0.9, px, py);
    g.quadraticCurveTo((px + bx) * 0.5 + h * 0.12, (py + by) * 0.5 + h * 0.2, bx, by);
    g.closePath();
    g.fill();
    return;
  }
  const sail = look.dorsal === DORSAL_SAIL;
  const i0 = sail ? 2 : look.feature === 'sprite' ? 3 : Math.round(segments * 0.28);
  const i1 = sail ? Math.round(segments * 0.74) : look.feature === 'sprite' ? segments : Math.round(segments * 0.8);
  g.beginPath();
  g.moveTo(PX[i0]! + NX[i0]! * widths[i0]! * 0.8, PY[i0]! + NY[i0]! * widths[i0]! * 0.8);
  for (let i = i0; i <= i1; i++) {
    const v = (i - i0) / (i1 - i0);
    const profile = sail ? (0.42 + 0.58 * Math.sin(Math.PI * Math.pow(v, 0.5))) * (1 - v * v * v * 0.55) : Math.pow(Math.sin(Math.PI * v), 0.7);
    const lift = widths[i]! + h * profile * (1 + 0.07 * Math.sin(phase * 0.6 - i * 0.9) * MOTION);
    g.lineTo(PX[i]! + NX[i]! * lift - (sail ? h * 0.1 * v : 0), PY[i]! + NY[i]! * lift);
  }
  g.lineTo(PX[i1]! + NX[i1]! * widths[i1]! * 0.8, PY[i1]! + NY[i1]! * widths[i1]! * 0.8);
  g.closePath();
  g.fill();
  if (sail) {
    // Fin rays, so the sail reads as a sail rather than a blob.
    g.beginPath();
    for (let i = i0 + 1; i < i1; i += 2) {
      const v = (i - i0) / (i1 - i0);
      const profile = (0.42 + 0.58 * Math.sin(Math.PI * Math.pow(v, 0.5))) * (1 - v * v * v * 0.55);
      const lift = widths[i]! + h * profile * 0.94;
      g.moveTo(PX[i]! + NX[i]! * widths[i]!, PY[i]! + NY[i]! * widths[i]!);
      g.lineTo(PX[i]! + NX[i]! * lift - h * 0.1 * v, PY[i]! + NY[i]! * lift);
    }
    g.strokeStyle = look.finEdge;
    g.lineWidth = 0.8;
    g.globalAlpha = ALPHA * 0.6;
    g.stroke();
    g.globalAlpha = ALPHA;
  }
}

function analFin(g: CanvasRenderingContext2D, look: Look, segments: number, widths: Float32Array): void {
  const ridge = look.feature === 'sprite';
  const i0 = Math.round(segments * (ridge ? 0.34 : 0.58));
  const i1 = ridge ? segments : Math.round(segments * 0.8);
  const im = (i0 + i1) >> 1;
  const h = look.dorsalH * (ridge ? 0.9 : 0.72);
  const ax = PX[i0]! - NX[i0]! * widths[i0]! * 0.8;
  const ay = PY[i0]! - NY[i0]! * widths[i0]! * 0.8;
  const bx = PX[i1]! - NX[i1]! * widths[i1]! * 0.8;
  const by = PY[i1]! - NY[i1]! * widths[i1]! * 0.8;
  g.fillStyle = look.fin;
  g.beginPath();
  g.moveTo(ax, ay);
  g.quadraticCurveTo(PX[im]! - NX[im]! * (widths[im]! + h * 1.5) - h * 0.4, PY[im]! - NY[im]! * (widths[im]! + h * 1.5), bx, by);
  g.closePath();
  g.fill();
}

function pattern(g: CanvasRenderingContext2D, look: Look, segments: number, widths: Float32Array): void {
  const marks = look.marks;
  g.fillStyle = look.mark;
  g.strokeStyle = look.mark;
  switch (look.pattern) {
    case PATTERN_BARS: {
      g.beginPath();
      for (let m = 0; m < marks; m++) {
        const i = Math.round(segments * (0.3 + (0.42 * m) / Math.max(1, marks - 1)));
        const w = widths[i]! * 0.8;
        g.moveTo(PX[i]! + NX[i]! * w, PY[i]! + NY[i]! * w);
        g.lineTo(PX[i]! - NX[i]! * w, PY[i]! - NY[i]! * w);
      }
      g.lineWidth = look.len * 0.05;
      g.lineCap = 'round';
      g.stroke();
      break;
    }
    case PATTERN_SADDLES: {
      g.beginPath();
      for (let m = 0; m < 3; m++) {
        const i = Math.round(segments * (0.3 + 0.19 * m));
        const w = widths[i]!;
        g.moveTo(PX[i]! + NX[i]! * w * 0.84, PY[i]! + NY[i]! * w * 0.84);
        g.lineTo(PX[i]! + NX[i]! * w * 0.08, PY[i]! + NY[i]! * w * 0.08);
      }
      g.lineWidth = look.len * 0.07;
      g.lineCap = 'round';
      g.stroke();
      break;
    }
    case PATTERN_STRIPE: {
      // A band along the flank, a little above the midline, that thins with the body.
      const band = look.feature === 'needle' ? 0.3 : 0.24;
      g.beginPath();
      g.moveTo(PX[1]! + NX[1]! * widths[1]! * (0.14 + band), PY[1]! + NY[1]! * widths[1]! * (0.14 + band));
      for (let i = 2; i <= segments; i++) g.lineTo(PX[i]! + NX[i]! * widths[i]! * (0.14 + band), PY[i]! + NY[i]! * widths[i]! * (0.14 + band));
      for (let i = segments; i >= 1; i--) g.lineTo(PX[i]! + NX[i]! * widths[i]! * (0.14 - band), PY[i]! + NY[i]! * widths[i]! * (0.14 - band));
      g.closePath();
      g.fill();
      break;
    }
    case PATTERN_SPOTS: {
      const radius = Math.max(1.1, look.half * 0.15);
      g.beginPath();
      for (let m = 0; m < marks + 2; m++) {
        const i = Math.min(segments - 2, 3 + m * 2 - (m > 3 ? 7 : 0));
        const v = (m % 2 === 0 ? 0.4 : -0.3) * (m > 3 ? -1 : 1);
        const x = PX[i]! + NX[i]! * widths[i]! * v;
        const y = PY[i]! + NY[i]! * widths[i]! * v;
        g.moveTo(x + radius, y);
        g.arc(x, y, radius, 0, TAU);
      }
      g.fill();
      break;
    }
    case PATTERN_TWOTONE: {
      // The rear half of the body in the second colour.
      const start = Math.round(segments * 0.52);
      g.beginPath();
      g.moveTo(PX[start]! + NX[start]! * widths[start]! * 0.96, PY[start]! + NY[start]! * widths[start]! * 0.96);
      for (let i = start + 1; i <= segments; i++) g.lineTo(PX[i]! + NX[i]! * widths[i]! * 0.96, PY[i]! + NY[i]! * widths[i]! * 0.96);
      for (let i = segments; i >= start; i--) g.lineTo(PX[i]! - NX[i]! * widths[i]! * 0.96, PY[i]! - NY[i]! * widths[i]! * 0.96);
      g.quadraticCurveTo(PX[start]! + look.half * 0.5, PY[start]!, PX[start]! + NX[start]! * widths[start]! * 0.96, PY[start]! + NY[start]! * widths[start]! * 0.96);
      g.closePath();
      g.fill();
      break;
    }
    default:
      break;
  }
}

/**
 * A row of light organs along the flank, between two points on the body.
 * `drop` is how far below the midline they sit, as a share of the body's half-height.
 * On a pale body each organ is also drawn as a bright dot, since a glow alone would not show.
 */
function flankLights(g: CanvasRenderingContext2D, look: Look, segments: number, widths: Float32Array, count: number, from: number, to: number, drop: number, radius: number, hue: number, t: number, speed: number): void {
  for (let k = 0; k < count; k++) {
    const f = (from + ((to - from) * k) / Math.max(1, count - 1)) * segments;
    const i = Math.min(segments - 1, Math.floor(f));
    const mix = f - i;
    const w = (widths[i]! + (widths[i + 1]! - widths[i]!) * mix) * drop * (1 + look.keel * keelProfile(f / segments));
    OX[k] = PX[i]! + (PX[i + 1]! - PX[i]!) * mix - NX[i]! * w;
    OY[k] = PY[i]! + (PY[i + 1]! - PY[i]!) * mix - NY[i]! * w;
  }
  if (!look.deep) {
    g.fillStyle = hsl(hue, 100, 90);
    g.beginPath();
    for (let k = 0; k < count; k++) {
      g.moveTo(OX[k]! + radius * 0.3, OY[k]!);
      g.arc(OX[k]!, OY[k]!, radius * 0.3, 0, TAU);
    }
    g.fill();
  }
  for (let k = 0; k < count; k++) {
    light(OX[k]!, OY[k]!, radius, hue, look.shine * (0.55 + 0.45 * Math.sin(t * speed - k * 0.9)));
  }
}

function drawSwimmer(look: Look, t: number): void {
  const g = G;
  const n = look.segments;
  const widths = look.widths;
  const len = look.len;
  const bodyLen = len - look.tailLen * 0.82;
  const phase = t * look.beat;
  const angler = look.archetype === 'angler';
  spine(n, bodyLen, len * 0.5, phase, look.wave, look.sway * MOTION, angler ? 0.06 : 0.14, 2);

  // Tail fin: it follows the last piece of spine and whips a little further.
  const ex = PX[n]! - PX[n - 1]!;
  const ey = PY[n]! - PY[n - 1]!;
  const inv = 1 / (Math.hypot(ex, ey) || 1);
  const swing = Math.sin(phase - look.wave - 0.7) * 0.3 * MOTION;
  const cs = Math.cos(swing);
  const sn = Math.sin(swing);
  frame(g, PX[n]!, PY[n]!, (ex * cs - ey * sn) * inv, (ex * sn + ey * cs) * inv);
  tailFin(g, look, phase);
  setCreatureTransform(g);

  dorsalFin(g, look, n, widths, phase);
  if (look.feature !== 'needle') analFin(g, look, n, widths);

  const count = bodyOutline(n, widths, 1, look.keel);
  smoothClosed(g, count);
  fillBody(g, look, bodyGradient(g, look, look.half));

  if (!LIT) return;
  pattern(g, look, n, widths);

  if (look.feature === 'sprite') {
    // A snailfish is nearly see-through: its dark gut shows.
    g.fillStyle = hsla(look.hue, 40, 34, 0.55);
    g.beginPath();
    g.ellipse(PX[3]!, PY[3]! + look.half * 0.28, look.half * 0.5, look.half * 0.36, 0, 0, TAU);
    g.fill();
  }

  if (angler) {
    anglerFace(g, look, t);
  } else {
    // Pectoral fin, paddling.
    const ip = Math.round(n * (look.peak + 0.02));
    const flap = 0.62 + 0.3 * Math.sin(phase * 0.5) * MOTION;
    const size = look.half * 0.95 * look.finScale * (look.feature === 'needle' ? 1.6 : 1);
    frame(g, PX[ip]!, PY[ip]! + widths[ip]! * 0.28, -Math.cos(flap), Math.sin(flap));
    g.fillStyle = look.finEdge;
    g.globalAlpha = ALPHA * 0.8;
    g.beginPath();
    g.moveTo(0, 0);
    g.quadraticCurveTo(size * 0.45, -size * 0.5, size, -size * 0.12);
    g.quadraticCurveTo(size * 0.6, size * 0.34, 0, 0);
    g.fill();
    g.globalAlpha = ALPHA;
    setCreatureTransform(g);

    const eyeAt = look.feature === 'lance' ? 2 : 1;
    eye(g, look, (PX[eyeAt]! + PX[eyeAt + 1]!) * 0.5 + NX[eyeAt]! * widths[eyeAt]! * 0.2, (PY[eyeAt]! + PY[eyeAt + 1]!) * 0.5 + NY[eyeAt + 1]! * widths[eyeAt + 1]! * 0.26, look.eyeSize);
  }

  if (look.lights > 0 && !angler) {
    const radius = Math.max(2.6, look.half * 0.44);
    if (look.feature === 'hatchet') {
      flankLights(g, look, n, widths, look.lights, 0.22, 0.64, 0.92, radius, look.glow, t, 2.4);
    } else {
      flankLights(g, look, n, widths, look.lights, 0.2, 0.84, 0.42, radius, look.glow, t, 2.2);
      if (look.lightRows > 1) flankLights(g, look, n, widths, look.lights - 2, 0.26, 0.74, 0.86, radius * 0.8, look.glow2, t, -1.7);
      light(PX[1]! - 1, PY[1]! + look.half * 0.42, radius * 1.1, look.glow, look.shine * (0.6 + 0.4 * Math.sin(t * 3.1)));
    }
  }
}

/** The angler's jaw, teeth, eye and lure, drawn over its body. */
function anglerFace(g: CanvasRenderingContext2D, look: Look, t: number): void {
  const h = look.half;
  const len = look.len;
  const nose = PX[0]! + look.widths[0]! * 0.55;
  const ny = PY[0]!;

  // Mouth: a dark crescent low on the face, with the under-jaw pushed forward.
  g.fillStyle = 'rgba(3, 5, 12, 0.92)';
  g.beginPath();
  g.moveTo(nose + 0.8, ny + h * 0.04);
  g.quadraticCurveTo(nose - len * 0.1, ny + h * 0.3, nose - len * 0.27, ny + h * 0.44);
  g.quadraticCurveTo(nose - len * 0.1, ny + h * 0.82, nose + 1.2, ny + h * 0.42);
  g.closePath();
  g.fill();
  g.fillStyle = 'rgba(238, 246, 255, 0.95)';
  g.beginPath();
  const teeth = Math.min(6, look.marks);
  for (let i = 0; i < teeth; i++) {
    const v = (i + 0.6) / (teeth + 0.4);
    // Upper teeth hang from the lip; lower teeth stand on the jaw.
    const ux = nose - len * 0.26 * v;
    const uy = ny + h * (0.05 + 0.4 * v * (1.6 - 0.6 * v));
    g.moveTo(ux + 1.3, uy - 0.4);
    g.lineTo(ux - 0.2, uy + h * 0.22);
    g.lineTo(ux - 1.5, uy);
    const lx = nose - len * 0.22 * v;
    const ly = ny + h * (0.44 + 0.3 * v * (1.5 - 0.9 * v));
    g.moveTo(lx + 1.3, ly + 0.5);
    g.lineTo(lx, ly - h * 0.2);
    g.lineTo(lx - 1.4, ly + 0.3);
  }
  g.fill();

  eye(g, look, nose - len * 0.19, ny - h * 0.3, look.eyeSize);

  // Small side fin.
  g.fillStyle = look.fin;
  g.beginPath();
  g.moveTo(nose - len * 0.36, ny + h * 0.3);
  g.quadraticCurveTo(nose - len * 0.5, ny + h * 0.95, nose - len * 0.56, ny + h * 0.4);
  g.closePath();
  g.fill();

  // Lure stalks: each arcs forward from the forehead to a glowing bulb.
  const lures = Math.max(1, look.strands);
  for (let k = 0; k < lures; k++) {
    const spread = lures === 1 ? 0 : k - 1;
    const rootX = nose - len * (0.2 + 0.05 * spread);
    const rootY = ny - h * 0.86;
    const bob = Math.sin(t * 1.7 + k * 1.9) * 1.6 * MOTION;
    const tipX = nose + len * (0.17 - 0.2 * Math.abs(spread) - (spread > 0 ? 0.26 : 0)) + bob * 0.4;
    const tipY = ny - h * (1.72 + (spread === 0 && lures > 1 ? 0.5 : 0) + (spread > 0 ? 0.2 : 0)) + bob;
    g.strokeStyle = look.rim || look.fin;
    g.lineWidth = 1.2;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(rootX, rootY);
    g.quadraticCurveTo(rootX + (tipX - rootX) * 0.25, tipY - h * 0.5, tipX, tipY);
    g.stroke();
    g.fillStyle = hsl(look.glow, 100, 86);
    g.beginPath();
    g.arc(tipX, tipY, 1.9, 0, TAU);
    g.fill();
    const pulse = 0.78 + 0.22 * Math.sin(t * 3 + k * 2.1);
    light(tipX, tipY, look.len * (lures > 1 ? 0.26 : 0.34), look.glow, pulse, GLOW_CORE);
  }
  // The lure lights its owner's face.
  light(nose - len * 0.12, ny - h * 0.3, h * 1.5, look.glow, 0.2);

  if (look.feature === 'windows') {
    // Warm panes along the flank, like a chapel lit from inside.
    for (let k = 0; k < look.lights; k++) {
      const v = k / (look.lights - 1);
      const x = nose - len * (0.3 + 0.4 * v);
      const y = ny + h * (0.1 - 0.5 * Math.sin(Math.PI * v) * 0.5 - 0.16);
      const tall = h * (0.34 - 0.18 * Math.abs(v - 0.5));
      g.fillStyle = hsl(look.glow + (k % 2) * 16 - 8, 96, 70);
      g.beginPath();
      g.ellipse(x, y, 1.6, tall, 0, 0, TAU);
      g.fill();
      light(x, y, h * 0.5, look.glow, 0.7 + 0.3 * Math.sin(t * 1.3 + k));
    }
  } else {
    for (let k = 0; k < look.lights; k++) {
      light(nose - len * (0.34 + 0.13 * k), ny + h * (0.12 - 0.2 * (k % 2)), h * 0.26, look.glow2, look.shine * (0.5 + 0.5 * Math.sin(t * 2 + k * 2.3)));
    }
  }
}

// ---------------------------------------------------------------- eels

function drawEel(look: Look, t: number): void {
  const g = G;
  const n = look.segments;
  const widths = look.widths;
  const len = look.len;
  const phase = t * look.beat;
  spine(n, len, len * 0.5, phase, look.wave, look.sway * MOTION, 0.1, 0.8);
  const fin = look.dorsalH;

  // The long fin down the back (and under the belly, for the leafy ones), rippling as it goes.
  for (let side = 1; side >= -1; side -= 2) {
    if (side === -1 && look.feature !== 'frond' && look.feature !== 'warden') break;
    g.beginPath();
    g.moveTo(PX[2]! + NX[2]! * widths[2]! * side * 0.8, PY[2]! + NY[2]! * widths[2]! * side * 0.8);
    for (let i = 2; i <= n; i++) {
      const u = i / n;
      const profile = Math.pow(Math.sin(Math.PI * Math.min(1, (u - 0.06) / 0.94)), 0.55);
      const lift = (widths[i]! + fin * profile * (1 + 0.24 * Math.sin(phase * 1.3 - u * 17) * MOTION)) * side;
      g.lineTo(PX[i]! + NX[i]! * lift, PY[i]! + NY[i]! * lift);
    }
    for (let i = n; i >= 2; i--) g.lineTo(PX[i]! + NX[i]! * widths[i]! * side * 0.8, PY[i]! + NY[i]! * widths[i]! * side * 0.8);
    g.closePath();
    g.fillStyle = look.fin;
    g.fill();
  }

  if (look.feature === 'oar' && LIT) {
    // An oarfish: a crest of long rays over the head and two trailing "oars" beneath it.
    g.strokeStyle = look.finEdge;
    g.lineCap = 'round';
    g.lineWidth = 1.1;
    g.beginPath();
    for (let k = 0; k < 5; k++) {
      const i = 1 + (k >> 1);
      const reach = fin * (3.4 - k * 0.42);
      const wobble = Math.sin(t * 1.4 + k * 0.8) * 2 * MOTION;
      const bx = PX[i]! + NX[i]! * widths[i]!;
      const by = PY[i]! + NY[i]! * widths[i]!;
      g.moveTo(bx, by);
      g.quadraticCurveTo(bx - reach * 0.3, by - reach * 0.8, bx - reach * (0.9 + k * 0.12) + wobble, by - reach * (0.72 - k * 0.08));
    }
    for (let k = 0; k < 2; k++) {
      const bx = PX[2]!;
      const by = PY[2]! - NY[2]! * widths[2]!;
      const ex = bx - len * (0.2 + k * 0.06);
      const ey = by + fin * (2.6 + k * 0.7) + Math.sin(t * 1.2 + k) * 2.5 * MOTION;
      g.moveTo(bx, by);
      g.quadraticCurveTo(bx - len * 0.04, ey - 2, ex, ey);
    }
    g.stroke();
  }

  if (look.feature === 'warden' && LIT) {
    // Barbels trailing from the chin.
    g.strokeStyle = look.rim || look.fin;
    g.lineCap = 'round';
    g.lineWidth = 1.2;
    g.beginPath();
    for (let k = 0; k < 3; k++) {
      const bx = PX[0]! - k * 3.2;
      const by = PY[0]! + widths[1]! * 0.7;
      const drift = Math.sin(t * 1.3 + k * 1.4) * 3 * MOTION;
      g.moveTo(bx, by);
      g.quadraticCurveTo(bx - 4, by + 9 + k * 2, bx - 15 - k * 4 + drift, by + 11 + k * 3.5);
    }
    g.stroke();
  }

  if (look.feature === 'gulper') {
    // Mostly mouth: a great pouch of a lower jaw hanging under a small head.
    const drop = widths[1]! * 2.6;
    g.beginPath();
    g.moveTo(PX[0]! + widths[0]! + 1, PY[0]!);
    g.quadraticCurveTo(PX[0]! + 2, PY[0]! + drop * 1.25, PX[2]!, PY[2]! + drop);
    g.quadraticCurveTo(PX[4]! + 2, PY[4]! + drop * 0.9, PX[5]!, PY[5]! + widths[5]! * 0.5);
    g.lineTo(PX[5]!, PY[5]!);
    g.closePath();
    g.fillStyle = look.top;
    g.globalAlpha = ALPHA * 0.92;
    g.fill();
    if (look.rim) {
      g.strokeStyle = look.rim;
      g.lineWidth = 0.9;
      g.stroke();
    }
    if (LIT) {
      g.fillStyle = 'rgba(4, 6, 14, 0.88)';
      g.beginPath();
      g.moveTo(PX[0]! + widths[0]!, PY[0]! + 1);
      g.quadraticCurveTo(PX[1]!, PY[1]! + drop * 0.86, PX[3]!, PY[3]! + drop * 0.3);
      g.lineTo(PX[3]!, PY[3]!);
      g.closePath();
      g.fill();
    }
    g.globalAlpha = ALPHA;
  }

  const count = bodyOutline(n, widths, 1, 0);
  smoothClosed(g, count);
  fillBody(g, look, look.mid);
  if (!LIT) return;

  // A paler belly along the lower third.
  g.beginPath();
  g.moveTo(PX[1]! - NX[1]! * widths[1]! * 0.3, PY[1]! - NY[1]! * widths[1]! * 0.3);
  for (let i = 2; i <= n - 1; i++) g.lineTo(PX[i]! - NX[i]! * widths[i]! * 0.3, PY[i]! - NY[i]! * widths[i]! * 0.3);
  for (let i = n - 1; i >= 1; i--) g.lineTo(PX[i]! - NX[i]! * widths[i]! * 0.9, PY[i]! - NY[i]! * widths[i]! * 0.9);
  g.closePath();
  g.fillStyle = look.belly;
  g.globalAlpha = ALPHA * 0.75;
  g.fill();
  g.globalAlpha = ALPHA;

  if (look.pattern === PATTERN_BARS) {
    g.beginPath();
    for (let i = 3; i < n - 2; i += 2) {
      g.moveTo(PX[i]! + NX[i]! * widths[i]! * 0.9, PY[i]! + NY[i]! * widths[i]! * 0.9);
      g.lineTo(PX[i]! - NX[i]! * widths[i]! * 0.2, PY[i]! - NY[i]! * widths[i]! * 0.2);
    }
    g.strokeStyle = look.mark;
    g.lineWidth = len * 0.022;
    g.lineCap = 'round';
    g.stroke();
  } else if (look.pattern === PATTERN_SPOTS) {
    g.fillStyle = look.mark;
    g.beginPath();
    for (let i = 3; i < n - 1; i += 2) {
      const x = PX[i]! + NX[i]! * widths[i]! * 0.3;
      const y = PY[i]! + NY[i]! * widths[i]! * 0.3;
      const radius = Math.max(0.9, widths[i]! * 0.34);
      g.moveTo(x + radius, y);
      g.arc(x, y, radius, 0, TAU);
    }
    g.fill();
  }

  if (look.feature === 'bones') {
    // Pale enough to count the vertebrae.
    g.beginPath();
    for (let i = 2; i < n - 1; i++) {
      g.moveTo(PX[i]! + NX[i]! * widths[i]! * 0.62, PY[i]! + NY[i]! * widths[i]! * 0.62);
      g.lineTo(PX[i]! - NX[i]! * widths[i]! * 0.62, PY[i]! - NY[i]! * widths[i]! * 0.62);
    }
    g.moveTo(PX[1]!, PY[1]!);
    for (let i = 2; i < n; i++) g.lineTo(PX[i]!, PY[i]!);
    g.strokeStyle = hsla(look.hue, 30, 30, 0.5);
    g.lineWidth = 0.9;
    g.stroke();
  }

  if (look.feature === 'gulper') {
    eye(g, look, PX[1]! + widths[1]! * 0.5, PY[1]! + NY[1]! * widths[1]! * 0.35, look.eyeSize);
    // A lamp at the very tip of the tail.
    light(PX[n]!, PY[n]!, 7, look.glow, 0.7 + 0.3 * Math.sin(t * 2.6), GLOW_CORE);
  } else {
    eye(g, look, PX[1]! + widths[1]! * 0.2, PY[1]! + NY[1]! * widths[1]! * 0.3, look.eyeSize);
  }

  if (look.lights > 1) {
    const radius = Math.max(2.8, look.half * 0.62);
    flankLights(g, look, n, widths, look.lights, 0.1, 0.9, 0.1, radius, look.glow, t, 3);
    if (look.feature === 'warden') {
      flankLights(g, look, n, widths, look.lights - 3, 0.16, 0.8, -0.6, radius * 0.7, look.glow2, t, -2);
      light(PX[1]! + 1, PY[1]! + NY[1]! * widths[1]! * 0.3, 9, look.glow, 0.8, GLOW_CORE);
    }
  }
}

// ---------------------------------------------------------------- jellies

function jellyGradient(g: CanvasRenderingContext2D, look: Look, rimY: number): CanvasGradient {
  if (!look.gradient) {
    const gradient = g.createRadialGradient(0, rimY - look.span * 0.66, look.span * 0.08, 0, rimY - look.span * 0.3, look.half * 1.28);
    if (look.deep) {
      gradient.addColorStop(0, hsla(look.glow, 86, 76, 0.86));
      gradient.addColorStop(0.5, hsla(look.glow, 74, 44, 0.6));
      gradient.addColorStop(1, hsla(look.hue, 52, 22, 0.55));
    } else {
      gradient.addColorStop(0, hsla(look.hue, 90, 93, 0.92));
      gradient.addColorStop(0.5, hsla(look.hue, 84, 70, 0.7));
      gradient.addColorStop(1, hsla(look.hue2, 82, 60, 0.46));
    }
    look.gradient = gradient;
  }
  return look.gradient;
}

function drawJelly(look: Look, t: number): void {
  const g = G;
  const beat = t * look.beat;
  // A quick squeeze and a slow recovery.
  const squeeze = Math.pow(0.5 + 0.5 * Math.sin(beat), 2.4) * MOTION;
  const radius = look.half * (1 - 0.13 * squeeze);
  const height = look.span * (1 + 0.12 * squeeze);
  const rimY = look.span * 0.42;
  const strands = look.strands;
  const reach = look.strandLen;
  const trail = reach * 0.24;
  const tentacle = look.deep ? hsla(look.glow, 82, 70, 0.58) : hsla(look.hue2, 82, 78, 0.62);

  if (look.feature === 'chain') {
    drawSiphon(look, t);
    return;
  }

  if (look.feature === 'wings') {
    // Six slow wings in three pairs, beating one after another.
    for (let pair = 2; pair >= 0; pair--) {
      for (let side = -1; side <= 1; side += 2) {
        const flap = Math.sin(beat - pair * 0.9) * 0.26 * MOTION;
        const angle = side * (0.34 + pair * 0.46 + flap);
        const size = reach * (1 - pair * 0.16);
        frame(g, side * radius * 0.34, rimY - 1, Math.cos(angle), -Math.sin(angle));
        g.beginPath();
        g.moveTo(0, 0);
        g.bezierCurveTo(-size * 0.34, size * 0.3, -size * 0.3, size * 0.85, 0, size);
        g.bezierCurveTo(size * 0.3, size * 0.85, size * 0.34, size * 0.3, 0, 0);
        g.fillStyle = hsla(look.glow, 76, 72, 0.26);
        g.fill();
        if (LIT) {
          g.strokeStyle = hsla(look.glow, 90, 86, 0.55);
          g.lineWidth = 0.9;
          g.stroke();
        }
        setCreatureTransform(g);
        light(side * radius * 0.34 + Math.sin(angle) * size * 0.92, rimY - 1 + Math.cos(angle) * size * 0.92, 4.2, look.glow2, 0.5 + 0.4 * Math.sin(beat - pair * 0.9));
      }
    }
  } else if (strands > 0) {
    if (look.feature === 'veil' && LIT) {
      // A faint sheet between the outermost threads, so the tentacles read as a curtain.
      g.fillStyle = hsla(look.hue, 80, 80, 0.1);
      g.beginPath();
      g.moveTo(-radius * 0.86, rimY);
      g.quadraticCurveTo(-radius * 0.9 - trail * 0.5, rimY + reach * 0.6, -radius * 0.5 - trail, rimY + reach * 0.9);
      g.lineTo(radius * 0.4 - trail, rimY + reach * 0.9);
      g.quadraticCurveTo(radius * 0.8 - trail * 0.5, rimY + reach * 0.6, radius * 0.86, rimY);
      g.closePath();
      g.fill();
    }
    // Tentacles: one path, one stroke.
    g.beginPath();
    for (let k = 0; k < strands; k++) {
      const x0 = (k / (strands - 1) - 0.5) * radius * 1.72;
      const length = reach * (0.7 + 0.3 * hash01(k * 31 + 7));
      g.moveTo(x0, rimY - 1);
      for (let s = 1; s <= 6; s++) {
        const v = s / 6;
        const x = x0 * (1 - 0.3 * v) + Math.sin(t * 2.1 - v * 4.2 + k * 1.7) * (1.5 + 5 * v) * MOTION - v * v * trail;
        g.lineTo(x, rimY + v * length * (1 - 0.1 * squeeze));
      }
    }
    g.strokeStyle = tentacle;
    g.lineWidth = look.feature === 'veil' ? 0.8 : 1.1;
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.stroke();
  }

  if (look.frills > 0) {
    // Oral arms: shorter, thicker and frillier than the tentacles.
    g.beginPath();
    for (let k = 0; k < look.frills; k++) {
      const x0 = (look.frills === 1 ? 0 : k / (look.frills - 1) - 0.5) * radius * 0.8;
      g.moveTo(x0, rimY - 2);
      for (let s = 1; s <= 4; s++) {
        const v = s / 4;
        g.lineTo(x0 * (1 - 0.4 * v) + Math.sin(t * 1.8 - v * 3.4 + k * 2.4) * (2 + 4 * v) * MOTION - v * v * trail * 0.6, rimY + v * reach * 0.56);
      }
    }
    g.strokeStyle = look.deep ? hsla(look.glow, 70, 64, 0.38) : hsla(look.hue, 76, 84, 0.46);
    g.lineWidth = radius * 0.2;
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.stroke();
  }

  // The bell: a dome with a scalloped rim.
  g.beginPath();
  g.moveTo(-radius, rimY);
  g.bezierCurveTo(-radius * 1.1, rimY - height * 1.36, radius * 1.1, rimY - height * 1.36, radius, rimY);
  const scallops = Math.max(3, look.scallops);
  const sag = height * 0.15 * (1 + squeeze);
  for (let j = 0; j < scallops; j++) {
    const xa = radius - (j / scallops) * 2 * radius;
    const xb = radius - ((j + 1) / scallops) * 2 * radius;
    g.quadraticCurveTo((xa + xb) * 0.5, rimY + sag, xb, rimY);
  }
  g.closePath();
  fillBody(g, look, jellyGradient(g, look, rimY));
  if (!LIT) return;
  g.strokeStyle = look.deep ? hsla(look.glow, 90, 80, 0.62) : hsla(look.hue, 92, 92, 0.7);
  g.lineWidth = 1;
  g.stroke();

  const centreY = rimY - height * 0.52;
  if (look.pattern === 1) {
    // Four rings, like a moon jelly's.
    g.beginPath();
    for (let k = 0; k < 4; k++) {
      const x = (k % 2 === 0 ? -1 : 1) * radius * 0.25;
      const y = centreY + (k < 2 ? -1 : 1) * height * 0.17;
      g.moveTo(x + radius * 0.17, y);
      g.arc(x, y, radius * 0.17, 0, TAU);
    }
    g.strokeStyle = look.deep ? hsla(look.glow2, 90, 78, 0.75) : hsla(look.hue2, 88, 84, 0.8);
    g.lineWidth = 1.2;
    g.stroke();
  } else if (look.pattern === 2) {
    // Canals fanning from the crown to the rim.
    g.beginPath();
    for (let k = 0; k < 5; k++) {
      const v = k / 4 - 0.5;
      g.moveTo(v * radius * 0.2, rimY - height * 1.02);
      g.quadraticCurveTo(v * radius * 1.5, rimY - height * 0.7, v * radius * 1.6, rimY - 1);
    }
    g.strokeStyle = look.deep ? hsla(look.glow2, 90, 78, 0.42) : hsla(look.hue2, 88, 90, 0.5);
    g.lineWidth = 0.9;
    g.stroke();
  } else if (look.pattern === 3) {
    // A bright core.
    g.fillStyle = look.deep ? hsla(look.glow2, 96, 70, 0.85) : hsla(look.hue2, 90, 82, 0.8);
    g.beginPath();
    g.ellipse(0, centreY, radius * 0.36, height * 0.24, 0, 0, TAU);
    g.fill();
    light(0, centreY, radius * 0.9, look.glow2, 0.6 + 0.3 * squeeze, GLOW_CORE);
  } else if (look.pattern === 4) {
    // A star drawn in light inside the bell.
    g.beginPath();
    for (let k = 0; k < 10; k++) {
      const angle = (k / 10) * TAU - Math.PI / 2;
      const r = k % 2 === 0 ? radius * 0.62 : radius * 0.26;
      const x = Math.cos(angle) * r;
      const y = centreY + Math.sin(angle) * r * 0.74;
      if (k === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.closePath();
    g.fillStyle = hsla(look.glow2, 100, 80, 0.5 + 0.3 * squeeze);
    g.fill();
    for (let k = 0; k < 5; k++) {
      const angle = (k / 5) * TAU - Math.PI / 2;
      light(Math.cos(angle) * radius * 0.62, centreY + Math.sin(angle) * radius * 0.46, 5, look.glow2, 0.55 + 0.45 * Math.sin(t * 1.7 + k * 1.3), GLOW_CORE);
    }
    light(0, centreY, radius * 0.8, look.glow2, 0.5 + 0.35 * squeeze);
  }

  light(0, centreY, radius * 1.35, look.glow, (0.3 + 0.3 * squeeze) * look.shine);
  for (let k = 0; k < look.lights; k++) {
    const v = k / (look.lights - 1) - 0.5;
    light(v * radius * 1.84, rimY - Math.abs(v) * height * 0.1, 3.3, look.glow2, look.shine * (0.45 + 0.55 * Math.sin(t * 2.4 - k * 0.8)));
  }
}

/** A siphonophore: a small float towing a chain of glowing bells. */
function drawSiphon(look: Look, t: number): void {
  const g = G;
  const beads = look.strands;
  const step = look.strandLen;
  const startX = step * beads * 0.42;
  const startY = -step * beads * 0.24;
  // Stem first, then the bells strung along it.
  g.beginPath();
  g.moveTo(startX, startY);
  for (let k = 1; k <= beads; k++) {
    g.lineTo(startX - k * step * 0.9, startY + k * step * 0.5 + Math.sin(t * 1.8 - k * 0.7) * 3 * MOTION);
  }
  g.strokeStyle = hsla(look.hue, 80, 80, 0.6);
  g.lineWidth = 1.2;
  g.lineJoin = 'round';
  g.stroke();
  // Fine threads hanging from every other bell.
  g.beginPath();
  for (let k = 2; k <= beads; k += 2) {
    const x = startX - k * step * 0.9;
    const y = startY + k * step * 0.5 + Math.sin(t * 1.8 - k * 0.7) * 3 * MOTION;
    g.moveTo(x, y);
    g.quadraticCurveTo(x - 4 + Math.sin(t * 2 + k) * 2 * MOTION, y + 10, x - 9, y + 19);
  }
  g.strokeStyle = hsla(look.hue2, 80, 78, 0.45);
  g.lineWidth = 0.8;
  g.stroke();

  g.fillStyle = hsla(look.hue, 82, 74, 0.62);
  for (let k = 1; k <= beads; k++) {
    const x = startX - k * step * 0.9;
    const y = startY + k * step * 0.5 + Math.sin(t * 1.8 - k * 0.7) * 3 * MOTION;
    const r = 4.6 - k * 0.22;
    g.beginPath();
    g.arc(x, y, r, 0, TAU);
    g.fill();
    light(x, y, r * 1.9, k % 2 === 0 ? look.glow : look.glow2, 0.45 + 0.5 * Math.sin(t * 2.6 - k * 0.9));
  }
  // The float at the head of the chain.
  g.beginPath();
  g.ellipse(startX + 2, startY - 1, 8, 5.6, -0.4, 0, TAU);
  fillBody(g, look, hsla(look.hue, 86, 82, 0.78));
  if (LIT) {
    g.strokeStyle = hsla(look.hue, 95, 92, 0.75);
    g.lineWidth = 1;
    g.stroke();
    light(startX + 2, startY - 1, 13, look.glow, 0.55);
  }
}

// ---------------------------------------------------------------- comb jellies

function combGradient(g: CanvasRenderingContext2D, look: Look, half: number): CanvasGradient {
  if (!look.gradient) {
    const gradient = g.createRadialGradient(half * 0.3, -look.half * 0.3, 1, 0, 0, half * 1.15);
    const tint = look.deep ? look.glow : look.hue;
    const strength = look.feature === 'wisp' ? 0.55 : 1;
    gradient.addColorStop(0, hsla(tint, 76, 90, 0.62 * strength));
    gradient.addColorStop(0.6, hsla(tint, 74, look.deep ? 52 : 68, 0.34 * strength));
    gradient.addColorStop(1, hsla(look.deep ? look.glow2 : look.hue2, 72, look.deep ? 46 : 64, 0.2 * strength));
    look.gradient = gradient;
  }
  return look.gradient;
}

function drawComb(look: Look, t: number): void {
  const g = G;
  const half = look.len * 0.5;
  const breathe = 1 + 0.045 * Math.sin(t * look.beat * 0.5) * MOTION;
  const tall = look.half * breathe;

  if (look.strandLen > 0 && LIT) {
    // Two fine tentacles streaming behind.
    g.beginPath();
    for (let side = -1; side <= 1; side += 2) {
      g.moveTo(-half * 0.66, side * tall * 0.34);
      for (let s = 1; s <= 6; s++) {
        const v = s / 6;
        const x = -half * 0.66 - v * look.strandLen;
        const y = side * tall * (0.34 + 0.3 * v) + Math.sin(t * 2.2 - v * 5 + side) * 4 * v * MOTION;
        g.lineTo(x, y);
        if (look.feature === 'wisp') {
          g.lineTo(x - 2.4, y + side * 3.4);
          g.moveTo(x, y);
        }
      }
    }
    g.strokeStyle = hsla(look.deep ? look.glow : look.hue, 80, 82, 0.5);
    g.lineWidth = 0.8;
    g.lineJoin = 'round';
    g.stroke();
  }

  // The body: an egg, a little fuller at the front.
  g.beginPath();
  g.moveTo(half, 0);
  g.bezierCurveTo(half, -tall * 1.08, -half * 0.5, -tall * 1.22, -half * 0.94, -tall * 0.3);
  g.quadraticCurveTo(-half * 1.06, 0, -half * 0.94, tall * 0.3);
  g.bezierCurveTo(-half * 0.5, tall * 1.22, half, tall * 1.08, half, 0);
  fillBody(g, look, combGradient(g, look, half));
  if (!LIT) return;
  g.strokeStyle = hsla(look.deep ? look.glow : look.hue, 92, 90, look.feature === 'wisp' ? 0.38 : 0.58);
  g.lineWidth = 1;
  g.stroke();

  // The gut: a darker thread down the middle.
  g.fillStyle = hsla(look.deep ? look.glow2 : look.hue2, 60, look.deep ? 60 : 50, 0.26);
  g.beginPath();
  g.ellipse(-half * 0.05, 0, half * 0.5, tall * 0.16, 0, 0, TAU);
  g.fill();

  // Comb rows: bands of beating plates that split light into a travelling rainbow.
  const rows = look.strands;
  const plates = look.frills;
  const strength = look.feature === 'wisp' ? 0.6 : 1;
  // A faint rail under each row ties its plates into a line.
  g.beginPath();
  for (let row = 0; row < rows; row++) {
    const lateral = (row / (rows - 1) - 0.5) * 2;
    g.moveTo(half * 0.8, lateral * tall * 0.4);
    g.quadraticCurveTo(-half * 0.04, lateral * tall * 1.32, -half * 0.84, lateral * tall * 0.4);
  }
  g.strokeStyle = hsla(look.deep ? look.glow : look.hue, 90, 92, 0.26 * strength);
  g.lineWidth = 0.8;
  g.stroke();
  for (let row = 0; row < rows; row++) {
    const lateral = (row / (rows - 1) - 0.5) * 2;
    for (let k = 0; k < plates; k++) {
      const angle = Math.PI * (0.15 + (0.7 * k) / (plates - 1));
      const x = half * 0.9 * Math.cos(angle) - half * 0.04;
      const y = lateral * tall * 0.88 * Math.sin(angle);
      let wavefront = Math.sin(t * 5.2 - k * 0.85 + row * 0.9);
      if (look.feature === 'echo') wavefront = Math.max(wavefront, Math.sin(t * 5.2 - k * 0.85 + row * 0.9 - 2.2) * 0.75);
      const bright = 0.22 + 0.78 * Math.max(0, wavefront);
      g.globalAlpha = ALPHA * bright * strength;
      g.fillStyle = RAINBOW[Math.floor(fract(k * 0.085 + t * 0.32 + row * 0.11) * 24) % 24] as string;
      g.fillRect(x - 0.8, y - 1.7, 1.6, 3.4);
    }
  }
  g.globalAlpha = ALPHA;

  // A few true lights riding the wave, so the shimmer glows as well as glitters.
  const sparks = STAGE.detail >= 2 ? (look.feature === 'prism' ? 4 : 2) : 1;
  for (let s = 0; s < sparks; s++) {
    const row = (s * 2 + 1) % rows;
    const lateral = (row / (rows - 1) - 0.5) * 2;
    const k = fract(t * 0.83 + s * 0.37) * (plates - 1);
    const angle = Math.PI * (0.15 + (0.7 * k) / (plates - 1));
    light(half * 0.9 * Math.cos(angle) - half * 0.04, lateral * tall * 0.88 * Math.sin(angle), 5.2, fract(k * 0.085 + t * 0.32 + row * 0.11) * 360, 0.75 * strength);
  }
  light(0, 0, half * 1.25, look.deep ? look.glow : look.hue, (look.deep ? 0.34 : 0.2) * strength);
}

// ---------------------------------------------------------------- squid

function drawSquid(look: Look, t: number): void {
  const g = G;
  const beat = t * look.beat;
  // The jet: a sharp squeeze of the mantle that snaps the arms together.
  const jet = Math.pow(Math.max(0, Math.sin(beat)), 2.2) * MOTION;
  const mantle = look.len * 0.46;
  const arms = look.strandLen;
  const head = 8;
  const width = look.span * (1 - 0.14 * jet);
  // The join of mantle and head sits where it centres the whole animal on its position.
  const join = -(mantle - head - arms) * 0.5 + jet * 2;
  const tip = join + mantle;
  const armRoot = join - head;
  // Arms stream behind in a loose bundle and snap shut with each jet.
  const spread = 1.3 - 0.75 * jet;
  const count = look.strands;

  if (look.feature === 'web') {
    // A cloak of skin between the arms.
    g.beginPath();
    g.moveTo(armRoot + 2, -width * 0.62);
    g.quadraticCurveTo(armRoot - arms * 0.4, -width * 1.7 * spread, armRoot - arms * 0.72, -width * 1.5 * spread);
    for (let k = 1; k < count; k++) {
      const y = (k / (count - 1) - 0.5) * width * 3 * spread;
      g.quadraticCurveTo(armRoot - arms * 0.56, y - width * 0.3 * spread, armRoot - arms * 0.72, y);
    }
    g.quadraticCurveTo(armRoot - arms * 0.4, width * 1.7 * spread, armRoot + 2, width * 0.62);
    g.closePath();
    g.fillStyle = look.mid;
    g.globalAlpha = ALPHA * 0.9;
    g.fill();
    if (look.rim) {
      g.strokeStyle = look.rim;
      g.lineWidth = 0.8;
      g.stroke();
    }
    g.globalAlpha = ALPHA;
  }

  // Arms: tapered, streaming behind the head. One path for all of them.
  g.beginPath();
  for (let k = 0; k < count; k++) {
    const lane = k / (count - 1) - 0.5;
    const by = lane * width * 1.3;
    const length = arms * (0.84 + 0.16 * hash01(k * 17 + 3));
    const ty = lane * width * 3 * spread + Math.sin(t * 3.1 - k * 1.3) * 2.2 * MOTION;
    const cx = armRoot - length * 0.5;
    const cy = lane * width * 2.3 * spread + Math.sin(t * 3.1 - k * 1.3 + 1.2) * 1.8 * MOTION;
    g.moveTo(armRoot + 1, by - 1.6);
    g.quadraticCurveTo(cx, cy - 1.1, armRoot - length, ty);
    g.quadraticCurveTo(cx, cy + 1.1, armRoot + 1, by + 1.6);
    if (look.deep && (k === 0 || k === count - 1 || look.feature === 'web')) light(armRoot - length, ty, 4.6, look.glow2, look.shine * (0.5 + 0.5 * Math.sin(t * 2.2 + k)));
  }
  g.fillStyle = look.fin;
  g.fill();

  // Two long feeding tentacles with clubbed ends.
  if (LIT) {
    const length = arms * (look.feature === 'colossal' ? 1.6 : 1.42);
    g.beginPath();
    for (let side = -1; side <= 1; side += 2) {
      const ty = side * width * 0.7 * spread + Math.sin(t * 2.3 + side) * 3 * MOTION;
      g.moveTo(armRoot, side * width * 0.2);
      g.quadraticCurveTo(armRoot - length * 0.5, side * width * 1.1 * spread + Math.sin(t * 2.3 + side + 1) * 2.4 * MOTION, armRoot - length, ty);
    }
    g.strokeStyle = look.fin;
    g.lineWidth = 1;
    g.lineCap = 'round';
    g.stroke();
    g.beginPath();
    for (let side = -1; side <= 1; side += 2) {
      const ty = side * width * 0.7 * spread + Math.sin(t * 2.3 + side) * 3 * MOTION;
      g.moveTo(armRoot - length + 2.6, ty);
      g.ellipse(armRoot - length - 1, ty, 3.4, 1.5, 0, 0, TAU);
      if (look.feature === 'colossal') light(armRoot - length, ty, 5, look.glow, 0.6 + 0.4 * Math.sin(t * 1.9 + side));
    }
    g.fill();
  }

  // Fins at the leading tip: with the mantle they make an arrowhead pointing the way it swims.
  const ripple = 1 + 0.1 * Math.sin(beat * 2) * MOTION;
  g.fillStyle = look.fin;
  g.beginPath();
  g.moveTo(tip - mantle * 0.02, 0);
  g.quadraticCurveTo(tip - mantle * 0.2, -width * 2.5 * ripple, tip - mantle * 0.46, -width * 0.7);
  g.lineTo(tip - mantle * 0.46, width * 0.7);
  g.quadraticCurveTo(tip - mantle * 0.2, width * 2.5 * (2 - ripple), tip - mantle * 0.02, 0);
  g.fill();

  // Head, behind the mantle's open end.
  g.fillStyle = look.mid;
  g.globalAlpha = ALPHA * Math.min(1, look.bodyAlpha + 0.25);
  g.beginPath();
  g.ellipse(join - head * 0.5, 0, head * 0.72, width * 0.76, 0, 0, TAU);
  g.fill();
  g.globalAlpha = ALPHA;

  // Mantle: a torpedo with its point forward.
  g.beginPath();
  g.moveTo(tip, 0);
  g.bezierCurveTo(tip - mantle * 0.3, -width * 0.96, join + mantle * 0.3, -width * 1.14, join, -width * 0.88);
  g.quadraticCurveTo(join - 1.6, 0, join, width * 0.88);
  g.bezierCurveTo(join + mantle * 0.3, width * 1.14, tip - mantle * 0.3, width * 0.96, tip, 0);
  fillBody(g, look, bodyGradient(g, look, look.span));
  if (!LIT) return;

  if (look.feature === 'glass') {
    // See-through, apart from the eyes and one bright organ.
    g.strokeStyle = hsla(look.hue, 80, 88, 0.6);
    g.lineWidth = 0.9;
    g.stroke();
    g.fillStyle = hsla(look.glow, 96, 62, 0.9);
    g.beginPath();
    g.ellipse(join + mantle * 0.36, 0, mantle * 0.16, width * 0.34, 0, 0, TAU);
    g.fill();
    light(join + mantle * 0.36, 0, width * 1.5, look.glow, 0.75 + 0.2 * Math.sin(t * 2));
  } else if (look.marks > 0) {
    // Colour cells scattered over the mantle.
    g.fillStyle = look.mark;
    g.beginPath();
    for (let m = 0; m < look.marks; m++) {
      const x = join + mantle * (0.14 + 0.66 * hash01(m * 13 + 5));
      const y = (hash01(m * 29 + 11) - 0.5) * width * 1.1 * (1 - (x - join) / mantle);
      g.moveTo(x + 1, y);
      g.arc(x, y, 1, 0, TAU);
    }
    g.fill();
  }

  eye(g, look, join - head * 0.46, -width * 0.14, look.eyeSize);

  if (look.feature === 'flash') {
    // Flashes once, then is somewhere else.
    const cycle = fract(t * 0.36 + hash01(look.len * 100) * 0.5);
    if (cycle < 0.1) {
      const pop = Math.sin((cycle / 0.1) * Math.PI);
      light(join + mantle * 0.4, 0, look.len * 0.52, look.glow, pop * 0.9, GLOW_CORE);
      light(join + mantle * 0.4, 0, look.len * 0.2, look.glow, pop);
    }
  }
  for (let k = 0; k < look.lights; k++) {
    if (look.feature === 'glass') break;
    const v = (k + 0.5) / look.lights;
    light(join + mantle * (0.08 + 0.8 * v), width * 0.34 * (1 - v * 0.7), look.feature === 'colossal' ? 4.4 : 3.6, look.glow, look.shine * (0.45 + 0.55 * Math.sin(t * 2.8 - k * 0.9)));
  }
}

// ---------------------------------------------------------------- rays

function rayGradient(g: CanvasRenderingContext2D, look: Look): CanvasGradient {
  if (!look.gradient) {
    const gradient = g.createLinearGradient(0, -look.span, 0, look.span);
    gradient.addColorStop(0, look.belly);
    gradient.addColorStop(0.3, look.mid);
    gradient.addColorStop(0.5, look.top);
    gradient.addColorStop(0.7, look.mid);
    gradient.addColorStop(1, look.belly);
    look.gradient = gradient;
  }
  return look.gradient;
}

/**
 * Wing outlines, as shares of body length (x) and wing reach (y):
 * nose, two control points to the wing tip, the tip, two control points back to the tail root, the tail root.
 */
const PLANS: readonly (readonly number[])[] = [
  // swept: an eagle ray, pointed tips raked well back
  [0.54, 0.38, 0.2, 0.2, 0.9, -0.16, 1, -0.04, 0.5, -0.32, 0.2, -0.5],
  // manta: a broad head and long, straight-edged wings
  [0.46, 0.44, 0.34, 0.3, 0.92, -0.06, 1, 0.06, 0.54, -0.26, 0.2, -0.46],
  // disc: a round stingray
  [0.5, 0.5, 0.62, 0.16, 1.04, -0.14, 0.92, -0.3, 0.82, -0.44, 0.3, -0.5],
  // kite: a skate, all straight lines and a sharp nose
  [0.58, 0.3, 0.14, 0.12, 0.86, -0.02, 1, -0.08, 0.58, -0.38, 0.16, -0.5],
];

function drawRay(look: Look, t: number): void {
  const g = G;
  const len = look.len;
  const span = look.span;
  const beat = t * look.beat;
  const flap = Math.cos(beat) * MOTION + (1 - MOTION);
  // Seen from above and a little to one side: the wings shorten as they rise, and the far wing is the shorter.
  const near = span * (0.78 + 0.22 * flap);
  const far = near * 0.86;
  const sweep = (1 - flap) * len * 0.07;
  const plan = PLANS[look.plan] ?? (PLANS[0] as readonly number[]);
  const tipX = len * plan[5]! - sweep;
  const rootX = len * plan[11]!;
  const reach = look.strandLen;

  // Tail: a thin whip.
  const whipY = Math.sin(t * 1.6) * 5 * MOTION;
  const whipMid = Math.sin(t * 1.6 + 1) * 3 * MOTION;
  g.fillStyle = look.mid;
  g.beginPath();
  g.moveTo(rootX + len * 0.08, -1.8);
  g.quadraticCurveTo(rootX - reach * 0.5, whipMid - 0.7, rootX - reach, whipY);
  g.quadraticCurveTo(rootX - reach * 0.5, whipMid + 0.7, rootX + len * 0.08, 1.8);
  g.closePath();
  g.fill();
  if (look.rim) {
    g.strokeStyle = look.rim;
    g.lineWidth = 0.7;
    g.stroke();
  }

  if (look.plan === 1) {
    // Head fins curling forward either side of the mouth.
    g.fillStyle = look.mid;
    g.beginPath();
    for (let side = -1; side <= 1; side += 2) {
      g.moveTo(len * 0.36, side * span * 0.06);
      g.quadraticCurveTo(len * 0.58, side * span * 0.05, len * 0.62, side * span * 0.15);
      g.quadraticCurveTo(len * 0.54, side * span * 0.2, len * 0.36, side * span * 0.19);
    }
    g.fill();
  }

  // Wings and body in one outline: swept tips and a hollow trailing edge.
  g.beginPath();
  g.moveTo(len * plan[0]!, 0);
  g.bezierCurveTo(len * plan[1]!, -far * plan[2]!, len * plan[3]!, -far * plan[4]!, tipX, -far * plan[6]!);
  g.bezierCurveTo(len * plan[7]! - sweep * 0.6, -far * plan[8]!, len * plan[9]!, -far * plan[10]!, rootX, -len * 0.07);
  g.lineTo(rootX, len * 0.07);
  g.bezierCurveTo(len * plan[9]!, near * plan[10]!, len * plan[7]! - sweep * 0.6, near * plan[8]!, tipX, near * plan[6]!);
  g.bezierCurveTo(len * plan[3]!, near * plan[4]!, len * plan[1]!, near * plan[2]!, len * plan[0]!, 0);
  fillBody(g, look, rayGradient(g, look));
  if (!LIT) return;
  if (look.feature === 'glass') {
    g.strokeStyle = hsla(look.hue, 80, 92, 0.75);
    g.lineWidth = 1;
    g.stroke();
    // Cartilage showing through.
    g.beginPath();
    for (let k = 0; k < 4; k++) {
      const x = len * (0.2 - k * 0.14);
      g.moveTo(len * 0.1, 0);
      g.quadraticCurveTo(x, -far * 0.4, x - len * 0.06, -far * (0.8 - k * 0.15));
      g.moveTo(len * 0.1, 0);
      g.quadraticCurveTo(x, near * 0.4, x - len * 0.06, near * (0.8 - k * 0.15));
    }
    g.strokeStyle = hsla(look.hue, 70, 96, 0.45);
    g.lineWidth = 0.7;
    g.stroke();
  }

  // The raised spine down the middle.
  g.fillStyle = look.top;
  g.globalAlpha = ALPHA * 0.7;
  g.beginPath();
  g.ellipse(-len * 0.03, 0, len * 0.42, span * 0.11, 0, 0, TAU);
  g.fill();
  g.globalAlpha = ALPHA;

  if (look.pattern === PATTERN_SPOTS) {
    g.fillStyle = look.mark;
    g.beginPath();
    for (let m = 0; m < look.marks; m++) {
      const x = len * (0.14 - 0.1 * m);
      const r = 1.9 - m * 0.22;
      for (let side = -1; side <= 1; side += 2) {
        const y = side * (side < 0 ? far : near) * (0.28 + 0.13 * m);
        g.moveTo(x + r, y);
        g.arc(x, y, r, 0, TAU);
      }
    }
    g.fill();
  }

  if (look.feature === 'scars') {
    // Pale slashes: each one a rockfall it survived.
    g.beginPath();
    g.moveTo(len * 0.12, near * 0.26);
    g.lineTo(-len * 0.1, near * 0.6);
    g.moveTo(len * 0.02, near * 0.2);
    g.lineTo(-len * 0.16, near * 0.44);
    g.moveTo(len * 0.2, -far * 0.3);
    g.lineTo(len * 0.02, -far * 0.62);
    g.strokeStyle = hsla(look.glow, 60, 78, 0.7);
    g.lineWidth = 1.1;
    g.lineCap = 'round';
    g.stroke();
  }

  // Eyes on top of the head, one each side.
  const eyeX = len * (plan[0]! - 0.2);
  eye(g, look, eyeX, -far * 0.14, look.eyeSize);
  eye(g, look, eyeX, near * 0.14, look.eyeSize);

  if (look.feature === 'stars') {
    // A night sky across its back.
    for (let k = 0; k < look.lights; k++) {
      const side = k % 2 === 0 ? -far : near;
      const along = hash01(k * 7 + 1);
      const x = len * (0.24 - 0.5 * along);
      const y = side * (0.14 + 0.6 * hash01(k * 11 + 5)) * (0.45 + 0.55 * Math.sin(Math.PI * (0.25 + 0.6 * along)));
      const twinkle = 0.4 + 0.6 * Math.pow(0.5 + 0.5 * Math.sin(t * (1.4 + hash01(k) * 1.6) + k * 2.1), 2);
      const big = k % 3 === 0;
      light(x, y, big ? 5.4 : 3.4, big ? look.glow : look.glow2, twinkle, big ? GLOW_STAR : GLOW_SOFT, big ? 60 : 50);
    }
  } else if (look.feature === 'trim') {
    // Lights along the trailing edge of each wing, and a three-jewel crown.
    const perWing = look.lights >> 1;
    for (let k = 0; k < perWing; k++) {
      const v = (k + 0.5) / perWing;
      const x = rootX + len * 0.1 + (tipX - rootX - len * 0.1) * v * v;
      const edge = 0.16 + 0.82 * v;
      const pulse = 0.4 + 0.6 * Math.sin(t * 2.2 - k * 0.8);
      light(x, -far * edge, 3.6, look.glow, pulse);
      light(x, near * edge, 3.6, look.glow, pulse);
    }
    for (let k = -1; k <= 1; k++) light(len * 0.2, k * span * 0.07, k === 0 ? 4.6 : 3.2, look.glow, 0.9, GLOW_CORE);
  } else {
    for (let k = 0; k < look.lights; k++) {
      const side = k % 2 === 0 ? -far : near;
      light(len * (0.16 - 0.12 * (k >> 1)), side * (0.28 + 0.14 * (k >> 1)), 3.8, look.glow, look.shine * (0.45 + 0.55 * Math.sin(t * 2 + k * 1.1)));
    }
  }
}

// ---------------------------------------------------------------- public drawing

/** Points all creature drawing at a canvas. Call once before a run of drawCreature calls. */
export function beginCreatures(g: CanvasRenderingContext2D, stage: Stage): void {
  G = g;
  STAGE = stage;
  MOTION = stage.motion;
}

/**
 * Draws one creature's body and queues its lights.
 * `x`, `y` are CSS pixels; `scale` turns design pixels into CSS pixels;
 * `flee` runs 0 to 1 as a scanned creature stretches away; `lit` false draws
 * only the bare shape, for silhouettes.
 */
export function drawCreature(look: Look, x: number, y: number, dir: number, scale: number, time: number, alpha: number, flash: number, flee: number, lit: boolean): void {
  const g = G;
  const ratio = STAGE.ratio;
  const pop = scale * (1 + 0.14 * flash);
  const kx = pop * (1 + 0.3 * flee);
  const ky = pop * (1 - 0.14 * flee);
  const upright = look.archetype === 'jelly';
  const tilt = look.tilt * (upright ? 1 + 0.5 * flee : 1) + (upright ? 0 : Math.sin(time * 0.9) * 0.035 * MOTION);
  const cos = Math.cos(tilt);
  const sin = Math.sin(tilt);
  TA = dir * kx * cos * ratio;
  TB = ky * sin * ratio;
  TC = -dir * kx * sin * ratio;
  TD = ky * cos * ratio;
  TX = x * ratio;
  TY = y * ratio;
  TS = pop * ratio;
  ALPHA = alpha;
  FLASH = flash;
  LIT = lit;
  g.setTransform(TA, TB, TC, TD, TX, TY);
  g.globalAlpha = alpha;
  const t = MOTION < 1 ? time * 0.8 : time;
  // A fleeing creature beats its tail harder.
  const hurry = 1 + flee * 0.6;
  switch (look.archetype) {
    case 'eel':
      drawEel(look, t * hurry);
      break;
    case 'jelly':
      drawJelly(look, t * hurry);
      break;
    case 'comb':
      drawComb(look, t);
      break;
    case 'squid':
      drawSquid(look, t * hurry);
      break;
    case 'ray':
      drawRay(look, t * hurry);
      break;
    case 'fish':
    case 'lantern':
    case 'angler':
    default:
      drawSwimmer(look, t * hurry);
      break;
  }
  if (lit && flash > 0.02) {
    light(0, 0, look.len * 0.5 * (1.3 - 0.3 * flash), look.deep ? look.glow : look.hue, flash * 0.55, GLOW_SOFT, 50);
  }
  g.globalAlpha = 1;
}

/** Direction a creature's sparkle trail drifts in, in its own coordinates: swimmers leave it behind, drifters shed it downwards. */
function trailsDown(look: Look): boolean {
  return look.archetype === 'jelly' || look.archetype === 'comb';
}

/**
 * Queues what marks a creature's rarity: an occasional glint for uncommon,
 * an aura and a few motes for rare, a strong aura and a long drifting trail
 * for legendary. `tier` is passed separately so shoal fish can borrow the effect.
 */
export function queueRarity(look: Look, tier: number, x: number, y: number, dir: number, scale: number, time: number, alpha: number, seed: number): void {
  if (tier <= 0 || alpha <= 0.02) return;
  const stage = STAGE;
  const ratio = stage.ratio;
  const px = x * ratio;
  const py = y * ratio;
  const s = scale * ratio;
  const glows = stage.glows;
  const hue = look.deep || tier >= 2 ? look.glow : look.hue;
  const size = look.archetype === 'jelly' ? look.half * 2.6 : look.archetype === 'eel' ? look.len * 0.62 : look.len;
  const bright = look.deep ? 1 : 0.9;

  if (tier >= 2) {
    const breathe = 0.86 + 0.14 * Math.sin(time * 1.5 + seed);
    stage.auras.push(glows.get(GLOW_AURA, hue, 90, size * (tier === 3 ? 1.02 : 0.8) * s), px, py, alpha * breathe * (tier === 3 ? 1 : 0.85) * bright);
    if (tier === 3) stage.auras.push(glows.get(GLOW_AURA, look.glow2, 80, size * 0.58 * s), px, py, alpha * (1.06 - breathe * 0.4) * 0.6 * bright);
  }

  // Glints that wink on and off over the body.
  const glints = stage.detail >= 2 ? (tier === 3 ? 4 : tier === 2 ? 2 : 1) : tier >= 2 ? 1 : 0;
  for (let k = 0; k < glints; k++) {
    const cycle = time * (0.5 + 0.1 * k) + seed * 3.7 + k * 0.41;
    const life = fract(cycle);
    const spot = Math.floor(cycle) * 7 + k * 13 + Math.floor(seed * 100);
    const twinkle = Math.sin(life * Math.PI);
    const lx = (hash01(spot) - 0.5) * size * 0.72;
    const ly = (hash01(spot + 1) - 0.5) * look.half * 1.5;
    stage.lights.push(glows.get(GLOW_STAR, hue, 40, (tier === 3 ? 8 : 6.4) * s), px + dir * lx * s, py + ly * s, alpha * twinkle * twinkle * twinkle);
  }

  if (tier >= 2 && stage.detail >= 1) {
    // Motes shed behind the animal: each drifts back, wobbles, rises a little and fades.
    const motes = Math.round((tier === 3 ? 12 : 4) * (stage.motion < 1 ? 0.5 : 1));
    const trail = size * (tier === 3 ? 1.25 : 0.85);
    const down = trailsDown(look);
    for (let k = 0; k < motes; k++) {
      const life = fract(time * (tier === 3 ? 0.34 : 0.42) + k / motes + seed);
      const wobble = Math.sin(life * 6.5 + k * 2.4) * 5;
      const lane = (hash01(k * 5 + Math.floor(seed * 50)) - 0.5) * look.half * 2;
      const back = size * 0.22 + life * trail;
      const mx = down ? lane * 1.4 - dir * life * trail * 0.35 : -dir * back;
      const my = down ? look.half * 0.6 + life * trail * 0.9 : lane + wobble - life * 9;
      const fade = (1 - life) * Math.min(1, life * 7);
      stage.lights.push(glows.get(GLOW_SOFT, k % 4 === 3 ? look.glow2 : hue, 90, (3 + 3 * hash01(k * 3 + 1)) * (1 - 0.35 * life) * s), px + mx * s, py + my * s, alpha * fade * 0.95);
    }
  }
}

/** Extras for a glimmer-shoal fish: a gold halo, a highlight running down the body and a trail of sparkles. */
export function queueGlimmer(look: Look, x: number, y: number, dir: number, scale: number, time: number, alpha: number, seed: number): void {
  if (alpha <= 0.02) return;
  const stage = STAGE;
  const ratio = stage.ratio;
  const px = x * ratio;
  const py = y * ratio;
  const s = scale * ratio;
  const glows = stage.glows;
  stage.auras.push(glows.get(GLOW_AURA, 46, 100, look.len * 0.74 * s), px, py, alpha * (0.7 + 0.2 * Math.sin(time * 5 + seed * 9)));
  const sweep = fract(time * 1.5 + seed);
  stage.lights.push(glows.get(GLOW_SOFT, 52, 70, look.half * 1.5 * s), px + dir * (0.4 - sweep * 0.8) * look.len * s, py, alpha * Math.sin(sweep * Math.PI) * 0.8);
  const sparks = stage.detail >= 1 ? 3 : 1;
  for (let k = 0; k < sparks; k++) {
    const life = fract(time * 1.3 + k / sparks + seed * 5);
    const lane = (hash01(k * 9 + Math.floor(seed * 40)) - 0.5) * look.half * 2.6;
    const fade = (1 - life) * Math.min(1, life * 6);
    stage.lights.push(glows.get(GLOW_STAR, 50, 70, (7.5 - 3 * life) * s), px - dir * (look.len * 0.4 + life * look.len * 1.15) * s, py + (lane - life * 5) * s, alpha * fade);
  }
}

/** The soft light behind a species in its codex portrait: a spotlight in its own colour, stronger for the rarer ones. */
export function queuePortraitGlow(look: Look, x: number, y: number, reach: number): void {
  const stage = STAGE;
  const hue = look.deep || look.tier >= 2 ? look.glow : look.hue;
  stage.auras.push(stage.glows.get(GLOW_AURA, hue, 90, reach), x, y, look.tier >= 3 ? 0.95 : look.tier === 2 ? 0.7 : look.deep ? 0.42 : 0.3);
  if (look.tier >= 3) stage.auras.push(stage.glows.get(GLOW_AURA, look.glow2, 80, reach * 0.6), x, y, 0.5);
}

const DASHES: number[] = [5, 5];
const SOLID: number[] = [];
const RARITY_RING: readonly string[] = ['#9bb3cc', '#6fe3ff', '#c79bff', '#ffd66b'];

/**
 * The rings around a creature, in CSS pixels: a turning dashed ring while the
 * fleet is scanning it, and a segmented ring that fills as it is tapped.
 */
export function drawRings(g: CanvasRenderingContext2D, x: number, y: number, radius: number, unit: number, time: number, alpha: number, targeted: boolean, tapsLeft: number, tapsTotal: number, tier: number): void {
  const showTaps = tapsTotal > 1 && tapsLeft < tapsTotal && tapsLeft > 0;
  if (!targeted && !showTaps) return;
  g.lineCap = 'butt';
  if (showTaps) {
    const gap = tapsTotal > 4 ? 0.12 : 0.16;
    const arc = TAU / tapsTotal;
    const done = tapsTotal - tapsLeft;
    // A dark underlay keeps the ring readable on bright water.
    g.globalAlpha = alpha * 0.42;
    g.strokeStyle = '#030814';
    g.lineWidth = 5 * unit;
    g.beginPath();
    for (let k = 0; k < tapsTotal; k++) {
      const start = -Math.PI / 2 + k * arc + gap * 0.5;
      g.moveTo(x + Math.cos(start) * radius, y + Math.sin(start) * radius);
      g.arc(x, y, radius, start, start + arc - gap);
    }
    g.stroke();
    g.globalAlpha = alpha * 0.34;
    g.strokeStyle = '#e9f5ff';
    g.lineWidth = 2.6 * unit;
    g.beginPath();
    for (let k = done; k < tapsTotal; k++) {
      const start = -Math.PI / 2 + k * arc + gap * 0.5;
      g.moveTo(x + Math.cos(start) * radius, y + Math.sin(start) * radius);
      g.arc(x, y, radius, start, start + arc - gap);
    }
    g.stroke();
    g.globalAlpha = alpha;
    g.strokeStyle = RARITY_RING[tier] ?? '#6fe3ff';
    g.beginPath();
    for (let k = 0; k < done; k++) {
      const start = -Math.PI / 2 + k * arc + gap * 0.5;
      g.moveTo(x + Math.cos(start) * radius, y + Math.sin(start) * radius);
      g.arc(x, y, radius, start, start + arc - gap);
    }
    g.stroke();
  }
  if (targeted) {
    const r = radius + (showTaps ? 7 * unit : 0);
    g.setLineDash(DASHES);
    g.lineDashOffset = -time * 14;
    g.globalAlpha = alpha * 0.4;
    g.strokeStyle = '#030814';
    g.lineWidth = 3 * unit;
    g.beginPath();
    g.arc(x, y, r, 0, TAU);
    g.stroke();
    g.globalAlpha = alpha * 0.85;
    g.strokeStyle = '#5ff2e4';
    g.lineWidth = 1.4 * unit;
    g.stroke();
    g.setLineDash(SOLID);
  }
  g.globalAlpha = 1;
}

/** How far a species reaches from its centre in design pixels: [left, right, up, down] when facing right. */
export function extent(look: Look): readonly [number, number, number, number] {
  const l = look.len;
  switch (look.archetype) {
    case 'jelly':
      if (look.feature === 'chain') return [look.strandLen * look.strands * 0.56, look.strandLen * look.strands * 0.5, look.strandLen * look.strands * 0.34, look.strandLen * look.strands * 0.46];
      return [look.half * 1.5, look.half * 1.25, look.span * 1.05, look.span * 0.5 + look.strandLen * (look.feature === 'wings' ? 0.95 : 0.86)];
    case 'ray':
      return [l * 0.5 + look.strandLen * 0.8, l * 0.66, look.span * 0.92, look.span * 1.02];
    case 'comb':
      return [l * 0.54 + look.strandLen * 0.6, l * 0.54, look.half * 1.15, look.half * 1.15];
    case 'squid':
      return [l * 0.56, l * 0.5, look.span * 2.5, look.span * 2.5];
    case 'eel':
      return [l * 0.5, l * 0.52, look.half + look.dorsalH * (look.feature === 'oar' ? 3 : 1.4) + look.sway, look.half + look.sway + (look.feature === 'oar' ? look.dorsalH * 3 : look.feature === 'warden' ? 12 : 2)];
    case 'angler':
      return [l * 0.52, l * 0.6, look.half * (look.strands > 1 ? 2.5 : 2.1), look.half * 1.15];
    default:
      return [l * 0.52, l * 0.52, look.half + (look.dorsal === DORSAL_NONE ? 1 : look.dorsalH) + 1, Math.max(look.half * (1 + look.keel) + 2, look.tailSpread)];
  }
}
