// The player's submarine: a small, round, yellow research sub that hovers at
// the left of the play area. Its hull is painted once into a sprite; only the
// propeller, the lights, the lamp beam and a few bubbles are drawn live.

import { GLOW_CORE, GLOW_SOFT, TAU, clamp, fract, makeSheet, smooth, type Stage } from './kit.ts';

/** The hull sprite covers this box, in design pixels around the sub's centre. */
const BOX_LEFT = 56;
const BOX_RIGHT = 52;
const BOX_UP = 44;
const BOX_DOWN = 30;
/** How much the hull is dimmed by the dark of each zone. */
const SHADE: readonly number[] = [0, 0.14, 0.3, 0.38, 0.44];
/** How strongly the headlamp shows in each zone: barely in sunlight, boldly in the dark. */
const BEAM: readonly number[] = [0.2, 0.5, 0.82, 0.9, 0.95];
const BEAM_LENGTH = 250;
const BEAM_SPREAD = 150;
const NOSE_X = 45;
const NOSE_Y = 3;
const LAMP_X = 41;
const LAMP_Y = -9;

function hullPath(g: CanvasRenderingContext2D): void {
  g.beginPath();
  g.moveTo(-36, -5);
  g.bezierCurveTo(-36, -19, -14, -19, 6, -19);
  g.bezierCurveTo(30, -19, 46, -11, 46, 1);
  g.bezierCurveTo(46, 12, 30, 19, 6, 19);
  g.bezierCurveTo(-14, 19, -36, 19, -36, 6);
  g.closePath();
}

function porthole(g: CanvasRenderingContext2D, x: number, y: number, radius: number, lit: boolean): void {
  if (!lit) {
    const ring = g.createLinearGradient(0, y - radius, 0, y + radius);
    ring.addColorStop(0, '#f4f9fd');
    ring.addColorStop(1, '#8198ae');
    g.fillStyle = ring;
    g.beginPath();
    g.arc(x, y, radius, 0, TAU);
    g.fill();
    g.strokeStyle = 'rgba(70, 40, 0, 0.35)';
    g.lineWidth = 0.8;
    g.stroke();
    return;
  }
  const inner = radius * 0.76;
  const glass = g.createRadialGradient(x - inner * 0.3, y - inner * 0.35, 0, x, y, inner);
  glass.addColorStop(0, '#f2ffff');
  glass.addColorStop(0.5, '#7df0f4');
  glass.addColorStop(1, '#1d93b4');
  g.fillStyle = glass;
  g.beginPath();
  g.arc(x, y, inner, 0, TAU);
  g.fill();
  if (radius > 7) {
    // The pilot: a small round head and shoulders against the cabin light.
    g.fillStyle = 'rgba(12, 52, 78, 0.72)';
    g.beginPath();
    g.arc(x - 0.6, y + inner * 0.08, inner * 0.34, 0, TAU);
    g.fill();
    g.beginPath();
    g.ellipse(x - 0.6, y + inner * 0.86, inner * 0.62, inner * 0.46, 0, Math.PI, TAU);
    g.fill();
  }
  g.strokeStyle = 'rgba(255, 255, 255, 0.85)';
  g.lineWidth = Math.max(0.8, radius * 0.12);
  g.lineCap = 'round';
  g.beginPath();
  g.arc(x, y, inner * 0.72, Math.PI * 1.08, Math.PI * 1.42);
  g.stroke();
}

/** Paints everything on the sub that never moves. Coordinates are design pixels. */
function paintHull(g: CanvasRenderingContext2D, shade: number): void {
  g.lineJoin = 'round';
  g.lineCap = 'round';

  // Tail planes and rudder, behind the hull.
  g.fillStyle = '#1fb7c4';
  g.beginPath();
  g.moveTo(-24, -15);
  g.quadraticCurveTo(-36, -28, -43, -27);
  g.lineTo(-38, -10);
  g.closePath();
  g.moveTo(-24, 15);
  g.quadraticCurveTo(-36, 27, -43, 25);
  g.lineTo(-38, 9);
  g.closePath();
  g.fill();
  // Propeller boss.
  g.fillStyle = '#8fa4b8';
  g.beginPath();
  g.moveTo(-34, -6);
  g.lineTo(-45, -2.6);
  g.lineTo(-45, 3);
  g.lineTo(-34, 7);
  g.closePath();
  g.fill();

  // Skids.
  g.strokeStyle = '#173a57';
  g.lineWidth = 3.4;
  g.beginPath();
  g.moveTo(-17, 24.5);
  g.lineTo(24, 24.5);
  g.moveTo(-9, 17);
  g.lineTo(-11, 24);
  g.moveTo(15, 17);
  g.lineTo(17, 24);
  g.stroke();

  // Conning tower and mast.
  g.strokeStyle = '#8fa4b8';
  g.lineWidth = 1.6;
  g.beginPath();
  g.moveTo(-6, -27);
  g.lineTo(-6, -39);
  g.stroke();
  const tower = g.createLinearGradient(0, -31, 0, -16);
  tower.addColorStop(0, '#ffdc80');
  tower.addColorStop(1, '#f2a630');
  g.fillStyle = tower;
  g.beginPath();
  g.moveTo(-17, -15);
  g.quadraticCurveTo(-17, -30, -9, -30);
  g.lineTo(2, -30);
  g.quadraticCurveTo(9, -30, 11, -15);
  g.closePath();
  g.fill();
  g.strokeStyle = 'rgba(92, 50, 0, 0.4)';
  g.lineWidth = 1;
  g.stroke();

  // Hull.
  const hull = g.createLinearGradient(0, -19, 0, 19);
  hull.addColorStop(0, '#ffe38c');
  hull.addColorStop(0.42, '#ffc23e');
  hull.addColorStop(1, '#e8861a');
  hullPath(g);
  g.fillStyle = hull;
  g.fill();
  g.strokeStyle = 'rgba(92, 50, 0, 0.42)';
  g.lineWidth = 1;
  g.stroke();

  // A teal band round the stern and a pale shine along the top.
  g.save();
  hullPath(g);
  g.clip();
  g.fillStyle = '#1fb7c4';
  g.fillRect(-28, -22, 7, 44);
  g.fillStyle = 'rgba(120, 52, 0, 0.16)';
  g.fillRect(-40, 9, 90, 14);
  g.restore();
  g.strokeStyle = 'rgba(255, 255, 255, 0.6)';
  g.lineWidth = 2.2;
  g.beginPath();
  g.moveTo(-14, -14.5);
  g.quadraticCurveTo(10, -16, 30, -10.5);
  g.stroke();

  // Side plane.
  g.fillStyle = '#1aa3b0';
  g.beginPath();
  g.ellipse(-3, 11, 9, 3, 0.12, 0, TAU);
  g.fill();

  // Port rims, lamp housing and scanner socket.
  porthole(g, 20, -1, 10.5, false);
  porthole(g, -3, -2, 5.6, false);
  porthole(g, -4, -23, 3.6, false);
  g.fillStyle = '#6f879d';
  g.beginPath();
  g.moveTo(31, -15);
  g.lineTo(LAMP_X, -13.5);
  g.lineTo(LAMP_X, -5);
  g.lineTo(33, -6.5);
  g.closePath();
  g.fill();
  g.fillStyle = '#173a57';
  g.beginPath();
  g.arc(NOSE_X - 1.6, NOSE_Y + 1, 2.6, 0, TAU);
  g.fill();

  if (shade > 0) {
    // The deeper the water, the less light there is on the paintwork.
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = `rgba(4, 10, 32, ${shade})`;
    g.fillRect(-BOX_LEFT, -BOX_UP, BOX_LEFT + BOX_RIGHT, BOX_UP + BOX_DOWN);
    g.globalCompositeOperation = 'source-over';
  }

  // What shines by its own light is painted last, so the dark does not dim it.
  porthole(g, 20, -1, 10.5, true);
  porthole(g, -3, -2, 5.6, true);
  porthole(g, -4, -23, 3.6, true);
  g.fillStyle = '#fff6d0';
  g.beginPath();
  g.ellipse(LAMP_X + 0.4, LAMP_Y - 0.2, 1.9, 4.2, 0, 0, TAU);
  g.fill();
}

export class Submarine {
  /** Centre of the sub in CSS pixels. */
  x = 0;
  y = 0;
  /** Where scanning beams leave the sub. */
  noseX = 0;
  noseY = 0;

  private angle = 0;
  private hull: HTMLCanvasElement | null = null;
  private beam: HTMLCanvasElement | null = null;
  private key = '';

  /** Works out where the sub is this frame. Call before anything that needs its position. */
  place(width: number, height: number, unit: number, time: number, rush: number, motion: number): void {
    // Tall play areas put the sub higher and a little further in, clear of the creatures' lanes.
    const tall = 1 - clamp((width / Math.max(1, height) - 0.75) / 0.5, 0, 1);
    const homeX = width * (0.13 + 0.03 * tall);
    const homeY = height * (0.46 - 0.16 * tall);
    const dive = motion >= 1 ? smooth(rush) : 0;
    const bob = Math.sin(time * 1.15) * 3.2 + Math.sin(time * 0.53) * 1.6;
    this.x = Math.max(homeX, 58 * unit) + Math.sin(time * 0.4) * 1.5 * unit * motion;
    this.y = homeY + (bob * motion + dive * 7) * unit;
    this.angle = Math.sin(time * 1.15 - 0.9) * 0.022 * motion + dive * 0.13;
    const cos = Math.cos(this.angle);
    const sin = Math.sin(this.angle);
    this.noseX = this.x + (NOSE_X * cos - NOSE_Y * sin) * unit;
    this.noseY = this.y + (NOSE_X * sin + NOSE_Y * cos) * unit;
  }

  private ensureSprites(stage: Stage, zone: number): void {
    const scale = stage.unit * stage.ratio;
    const key = `${scale.toFixed(3)}:${zone}`;
    if (key === this.key && this.hull && this.beam) return;
    this.key = key;

    const hull = makeSheet((BOX_LEFT + BOX_RIGHT) * scale, (BOX_UP + BOX_DOWN) * scale);
    hull.g.setTransform(scale, 0, 0, scale, BOX_LEFT * scale, BOX_UP * scale);
    paintHull(hull.g, SHADE[zone] ?? 0.4);
    this.hull = hull.canvas;

    // The headlamp's cone, painted as slices that widen and fade with distance.
    const beam = makeSheet(BEAM_LENGTH * scale, BEAM_SPREAD * scale);
    const g = beam.g;
    const slices = Math.ceil(BEAM_LENGTH / 4);
    const across = g.createLinearGradient(0, 0, 0, 1);
    across.addColorStop(0, 'rgba(255, 244, 214, 0)');
    across.addColorStop(0.5, 'rgba(255, 244, 214, 1)');
    across.addColorStop(1, 'rgba(255, 244, 214, 0)');
    g.fillStyle = across;
    const strength = BEAM[zone] ?? 0.9;
    for (let i = 0; i < slices; i++) {
      const v = i / slices;
      const tall = 7 + (BEAM_SPREAD - 12) * v;
      const middle = BEAM_SPREAD * 0.42 + v * BEAM_SPREAD * 0.12;
      g.setTransform(scale, 0, 0, scale * tall, v * BEAM_LENGTH * scale, (middle - tall * 0.5) * scale);
      g.globalAlpha = strength * 0.5 * Math.pow(1 - v, 1.7);
      g.fillRect(0, 0, BEAM_LENGTH / slices + 0.5, 1);
    }
    this.beam = beam.canvas;
  }

  /** Draws the sub. `scanFlash` is 1 at the instant of a scan and fades to 0. */
  draw(g: CanvasRenderingContext2D, stage: Stage, zone: number, time: number, rush: number, scanFlash: number, sonar: boolean): void {
    this.ensureSprites(stage, zone);
    const hull = this.hull;
    const beam = this.beam;
    if (!hull || !beam) return;
    const ratio = stage.ratio;
    const unit = stage.unit;
    const scale = unit * ratio;
    const cos = Math.cos(this.angle);
    const sin = Math.sin(this.angle);
    const cx = this.x * ratio;
    const cy = this.y * ratio;
    const steady = Math.abs(this.angle) < 0.03;

    // Lamp cone first, so the hull sits on top of its root.
    const lampX = cx + (LAMP_X * cos - LAMP_Y * sin) * scale;
    const lampY = cy + (LAMP_X * sin + LAMP_Y * cos) * scale;
    const flicker = 0.9 + 0.1 * Math.sin(time * 7.3) * Math.sin(time * 2.9);
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = Math.min(1, flicker * (1 + scanFlash * 0.35));
    if (steady) {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.drawImage(beam, Math.round(lampX), Math.round(lampY - BEAM_SPREAD * 0.42 * scale));
    } else {
      g.setTransform(cos, sin, -sin, cos, lampX, lampY);
      g.drawImage(beam, 0, -BEAM_SPREAD * 0.42 * scale);
    }
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;

    // Hull sprite: copied straight across while the sub is level, turned only while it pitches into a dive.
    if (steady) {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.drawImage(hull, Math.round(cx - BOX_LEFT * scale), Math.round(cy - BOX_UP * scale));
    } else {
      g.setTransform(cos, sin, -sin, cos, cx, cy);
      g.drawImage(hull, -BOX_LEFT * scale, -BOX_UP * scale);
    }

    // Propeller: three blades turning about the shaft, seen edge-on as they come round.
    if (steady) g.setTransform(scale, 0, 0, scale, cx, cy);
    else g.setTransform(cos * scale, sin * scale, -sin * scale, cos * scale, cx, cy);
    const spin = time * (3.2 + rush * 9);
    for (let k = 0; k < 3; k++) {
      const angle = spin + (k * TAU) / 3;
      const reach = Math.sin(angle) * 11.5;
      const facing = Math.cos(angle);
      g.fillStyle = facing < 0 ? '#7c93a8' : '#d5e2ee';
      g.beginPath();
      g.ellipse(-46.5, reach * 0.5, 2 + 1.5 * Math.abs(facing), Math.abs(reach) * 0.5 + 0.9, 0, 0, TAU);
      g.fill();
    }
    g.fillStyle = '#eaf2f8';
    g.beginPath();
    g.arc(-47, 0.2, 2.1, 0, TAU);
    g.fill();

    // Exhaust bubbles wandering up from the stern: more of them, faster, during a dive.
    const bubbles = stage.motion < 1 ? 2 : rush > 0.05 ? 7 : 4;
    g.strokeStyle = 'rgba(214, 246, 255, 0.62)';
    g.lineWidth = 0.9;
    for (let k = 0; k < bubbles; k++) {
      const life = fract(time * (0.42 + rush * 1.6) + k / bubbles);
      g.globalAlpha = (1 - life) * 0.8;
      g.beginPath();
      g.arc(-44 - life * 12 + Math.sin(life * 9 + k * 2.2) * 3, -8 - life * (38 + rush * 50), 1.2 + life * 2 + (k % 2) * 0.6, 0, TAU);
      g.stroke();
    }
    g.globalAlpha = 1;

    // Lights: the cabin glow, the lamp, the scanner eye and a blinking mast light.
    const glows = stage.glows;
    const lights = stage.lights;
    const ax = cos * scale;
    const ay = sin * scale;
    const cabin = 0.42 + 0.06 * Math.sin(time * 1.7) + (zone >= 2 ? 0.18 : 0);
    lights.push(glows.get(GLOW_SOFT, 182, 80, 24 * scale), cx + 20 * ax + ay, cy + 20 * ay - ax, cabin);
    lights.push(glows.get(GLOW_SOFT, 182, 80, 11 * scale), cx - 3 * ax + 2 * ay, cy - 3 * ay - 2 * ax, cabin * 0.8);
    lights.push(glows.get(GLOW_CORE, 46, 60, 13 * scale), lampX, lampY, 0.7 * flicker + scanFlash * 0.3);
    const eye = sonar ? 0.6 + 0.4 * Math.sin(time * 5) : 0.25 + scanFlash * 0.75;
    const eyeX = NOSE_X - 1.6;
    const eyeY = NOSE_Y + 1;
    lights.push(glows.get(GLOW_CORE, 174, 100, (7 + scanFlash * 6) * scale), cx + eyeX * ax - eyeY * ay, cy + eyeX * ay + eyeY * ax, eye);
    const blink = fract(time * 0.55);
    if (blink < 0.16) lights.push(glows.get(GLOW_CORE, 356, 100, 6.5 * scale), cx - 6 * ax + 40 * ay, cy - 6 * ay - 40 * ax, Math.sin((blink / 0.16) * Math.PI));
  }
}
