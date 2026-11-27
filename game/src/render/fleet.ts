// The fleet: the small craft that drift about scanning by themselves. Each of
// the twelve tiers has its own silhouette, painted once into a sprite; the
// running lights and the scanning beam are drawn live.

import type { CreatureView, DroneView } from '../contracts.ts';
import { GLOW_CORE, GLOW_SOFT, TAU, fract, makeSheet, type Stage } from './kit.ts';

/** Sprites cover this many design pixels either side of a craft's centre. */
const HALF_WIDTH = 20;
const HALF_HEIGHT = 18;
const TIERS = 12;

const LIGHT = '#dbe8f4';
const MID = '#93aac0';
const DARK = '#35506c';
const LINE = 'rgba(4, 14, 34, 0.6)';
const CYAN = '#5ff2e4';
const WARM = '#ffd66b';

/** Where each tier carries its lights: x, y, hue, and whether it blinks (1) or glows steadily (0). */
const LAMPS: readonly (readonly number[])[] = [
  [0, -15, 46, 1],
  [5, 0, 174, 0, -9, -8, 356, 1],
  [-9, 4, 44, 0, 0, 7, 44, 0, 9, 4, 44, 0],
  [6, -4, 174, 0, 0, 9, 356, 1],
  [-7, 0, 174, 0, 0, 0, 174, 0, 7, 0, 174, 0],
  [10, -10, 46, 0, -9, -3, 356, 1],
  [12, 0, 18, 0, -10, -6, 174, 1],
  [0, -15, 356, 1, -5, -3, 174, 0, 5, -3, 174, 0],
  [-1, -1, 46, 0, -8, -11, 356, 1],
  [5, -2, 174, 0, -6, -6, 46, 1],
  [0, 3, 22, 0, 6, -13, 22, 1],
  [0, 0, 174, 0, 0, -13, 282, 1],
];

function roundedBox(g: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  g.beginPath();
  g.moveTo(x + radius, y);
  g.arcTo(x + width, y, x + width, y + height, radius);
  g.arcTo(x + width, y + height, x, y + height, radius);
  g.arcTo(x, y + height, x, y, radius);
  g.arcTo(x, y, x + width, y, radius);
  g.closePath();
}

function solid(g: CanvasRenderingContext2D, colour: string): void {
  g.fillStyle = colour;
  g.fill();
  g.strokeStyle = LINE;
  g.lineWidth = 1;
  g.stroke();
}

function disc(g: CanvasRenderingContext2D, x: number, y: number, radius: number, colour: string, outlined = true): void {
  g.beginPath();
  g.arc(x, y, radius, 0, TAU);
  g.fillStyle = colour;
  g.fill();
  if (outlined) {
    g.strokeStyle = LINE;
    g.lineWidth = 1;
    g.stroke();
  }
}

function strokes(g: CanvasRenderingContext2D, colour: string, width: number): void {
  g.strokeStyle = LINE;
  g.lineWidth = width + 1.6;
  g.stroke();
  g.strokeStyle = colour;
  g.lineWidth = width;
  g.stroke();
}

/** Paints one tier's craft around the origin, in design pixels. */
function paintCraft(g: CanvasRenderingContext2D, tier: number): void {
  g.lineCap = 'round';
  g.lineJoin = 'round';
  switch (tier) {
    case 0: {
      // Glow Buoy: a striped float with a lamp on a mast and a weighted keel.
      g.beginPath();
      g.moveTo(0, -8);
      g.lineTo(0, -14);
      strokes(g, MID, 1.6);
      g.beginPath();
      g.moveTo(-3.4, 4);
      g.lineTo(0, 14);
      g.lineTo(3.4, 4);
      g.closePath();
      solid(g, DARK);
      disc(g, 0, -1, 7.6, LIGHT);
      g.beginPath();
      g.ellipse(0, -1, 7.6, 2.6, 0, 0, TAU);
      g.fillStyle = '#ff9d4a';
      g.fill();
      disc(g, 0, -15, 2.2, WARM);
      break;
    }
    case 1: {
      // Scout Drone: a camera pod with a V tail.
      g.beginPath();
      g.moveTo(-6, -3);
      g.lineTo(-11, -9);
      g.moveTo(-6, 3);
      g.lineTo(-11, 9);
      strokes(g, MID, 2.2);
      roundedBox(g, -10, -5.5, 20, 11, 5.5);
      solid(g, LIGHT);
      disc(g, 5, 0, 4, '#0d2238');
      disc(g, 5.6, -0.6, 1.6, CYAN, false);
      break;
    }
    case 2: {
      // Lantern Rig: three lamps hanging from a floating bar.
      g.beginPath();
      g.moveTo(-9, -7);
      g.lineTo(-9, 3);
      g.moveTo(0, -7);
      g.lineTo(0, 6);
      g.moveTo(9, -7);
      g.lineTo(9, 3);
      strokes(g, DARK, 1);
      roundedBox(g, -13, -10, 26, 4.4, 2.2);
      solid(g, MID);
      roundedBox(g, -4.5, -14, 9, 5, 2.4);
      solid(g, LIGHT);
      disc(g, -9, 4, 3, WARM);
      disc(g, 0, 7, 3.2, WARM);
      disc(g, 9, 4, 3, WARM);
      break;
    }
    case 3: {
      // Sonar Array: a dish on a stalk, listening to the right.
      g.beginPath();
      g.moveTo(-5.5, 11);
      g.lineTo(-3.4, 5);
      g.lineTo(3.4, 5);
      g.lineTo(5.5, 11);
      g.closePath();
      solid(g, DARK);
      g.beginPath();
      g.moveTo(0, 5);
      g.lineTo(0, -2);
      strokes(g, MID, 2);
      g.beginPath();
      g.arc(4, -4, 10, Math.PI * 0.62, Math.PI * 1.38);
      strokes(g, LIGHT, 3.2);
      g.beginPath();
      g.moveTo(-5, -4);
      g.lineTo(5, -4);
      strokes(g, MID, 1.2);
      disc(g, 6, -4, 2, CYAN);
      g.strokeStyle = 'rgba(95, 242, 228, 0.7)';
      g.lineWidth = 1.1;
      g.beginPath();
      g.arc(6, -4, 5.6, -0.6, 0.6);
      g.moveTo(6 + Math.cos(-0.5) * 9.4, -4 + Math.sin(-0.5) * 9.4);
      g.arc(6, -4, 9.4, -0.5, 0.5);
      g.stroke();
      break;
    }
    case 4: {
      // Specimen Lab: a capsule with a row of lit windows and a hatch.
      roundedBox(g, -3.4, -11, 6.8, 5, 1.6);
      solid(g, MID);
      roundedBox(g, -14, -7.5, 28, 15, 7.5);
      solid(g, LIGHT);
      g.fillStyle = MID;
      g.fillRect(-12, 3, 24, 1.6);
      disc(g, -7, -0.6, 2.9, '#27c5d2');
      disc(g, 0, -0.6, 2.9, '#27c5d2');
      disc(g, 7, -0.6, 2.9, '#27c5d2');
      break;
    }
    case 5: {
      // Deep Rover: a cab on caterpillar tracks, with a lamp on a boom.
      g.beginPath();
      g.moveTo(5, -5);
      g.lineTo(10, -10);
      strokes(g, MID, 1.6);
      roundedBox(g, -9, -7, 16, 10, 3);
      solid(g, LIGHT);
      roundedBox(g, -1, -5, 6, 4.6, 1.4);
      g.fillStyle = '#27c5d2';
      g.fill();
      roundedBox(g, -13, 3, 26, 9, 4.5);
      solid(g, DARK);
      disc(g, -8, 7.5, 2.3, MID, false);
      disc(g, 0, 7.5, 2.3, MID, false);
      disc(g, 8, 7.5, 2.3, MID, false);
      disc(g, 10.4, -10.4, 2.3, WARM);
      break;
    }
    case 6: {
      // Thermal Probe: a slim dart with a hot sensor at its nose.
      g.beginPath();
      g.moveTo(-9, 0);
      g.lineTo(-15, -6.5);
      g.lineTo(-11, 0);
      g.lineTo(-15, 6.5);
      g.closePath();
      solid(g, DARK);
      g.beginPath();
      g.moveTo(-12, 0);
      g.bezierCurveTo(-10, -5.6, 5, -5.2, 12, 0);
      g.bezierCurveTo(5, 5.2, -10, 5.6, -12, 0);
      g.closePath();
      solid(g, LIGHT);
      g.fillStyle = MID;
      g.fillRect(-3.4, -4.4, 2.4, 8.8);
      disc(g, 12, 0, 2.7, '#ff7a4a');
      break;
    }
    case 7: {
      // Abyss Station: a windowed dome standing on three legs.
      g.beginPath();
      g.moveTo(-9, 4);
      g.lineTo(-13, 13);
      g.moveTo(0, 4);
      g.lineTo(0, 13);
      g.moveTo(9, 4);
      g.lineTo(13, 13);
      strokes(g, DARK, 2);
      g.beginPath();
      g.moveTo(0, -9);
      g.lineTo(0, -14);
      strokes(g, MID, 1.4);
      g.beginPath();
      g.arc(0, 2, 11.5, Math.PI, TAU);
      g.closePath();
      solid(g, LIGHT);
      roundedBox(g, -14, 1, 28, 4.4, 2);
      solid(g, MID);
      roundedBox(g, -7.4, -5.4, 4.6, 4.6, 1.4);
      g.fillStyle = '#27c5d2';
      g.fill();
      roundedBox(g, 2.8, -5.4, 4.6, 4.6, 1.4);
      g.fill();
      disc(g, 0, -15, 1.8, '#ff7a8a');
      break;
    }
    case 8: {
      // Silt Harvester: a boxy hull pushing a toothed scoop wheel.
      g.beginPath();
      g.moveTo(-13, 9);
      g.lineTo(4, 9);
      strokes(g, DARK, 2.4);
      roundedBox(g, -10, -12, 4.4, 7, 1.4);
      solid(g, DARK);
      roundedBox(g, -12, -6.5, 17, 13, 3);
      solid(g, LIGHT);
      roundedBox(g, -4, -4, 6, 5, 1.4);
      g.fillStyle = WARM;
      g.fill();
      g.beginPath();
      for (let k = 0; k < 6; k++) {
        const angle = (k / 6) * TAU + 0.3;
        g.moveTo(9 + Math.cos(angle) * 5, 3 + Math.sin(angle) * 5);
        g.lineTo(9 + Math.cos(angle) * 9, 3 + Math.sin(angle) * 9);
      }
      strokes(g, MID, 1.8);
      disc(g, 9, 3, 5.6, DARK);
      disc(g, 9, 3, 2, MID, false);
      break;
    }
    case 9: {
      // Trench Crawler: a low body gripping the rock with jointed legs.
      g.beginPath();
      for (let side = -1; side <= 1; side += 2) {
        g.moveTo(side * 4, 0);
        g.lineTo(side * 10, -6);
        g.lineTo(side * 14, 9);
        g.moveTo(side * 2, 2);
        g.lineTo(side * 6, 4);
        g.lineTo(side * 8, 13);
      }
      strokes(g, DARK, 1.9);
      g.beginPath();
      g.ellipse(0, -2, 9, 6, 0, 0, TAU);
      solid(g, LIGHT);
      disc(g, 5, -2, 2.5, '#0d2238');
      disc(g, 5.4, -2.4, 1.1, CYAN, false);
      break;
    }
    case 10: {
      // Pressure Forge: a squat furnace with a glowing mouth and a stack.
      roundedBox(g, 4, -14, 4.6, 10, 1.2);
      solid(g, DARK);
      g.beginPath();
      g.moveTo(-9, -6);
      g.lineTo(9, -6);
      g.lineTo(12, 11);
      g.lineTo(-12, 11);
      g.closePath();
      solid(g, MID);
      roundedBox(g, -6, -2, 12, 9, 2.4);
      const fire = g.createLinearGradient(0, -2, 0, 7);
      fire.addColorStop(0, '#ffe08a');
      fire.addColorStop(1, '#ff6a2a');
      solid(g, '#000');
      g.fillStyle = fire;
      g.fill();
      break;
    }
    default: {
      // Leviathan Listener: a hub with hydrophones out on spokes, inside a faint ring.
      g.strokeStyle = 'rgba(219, 232, 244, 0.5)';
      g.lineWidth = 1;
      g.beginPath();
      g.arc(0, 0, 13, 0, TAU);
      g.stroke();
      g.beginPath();
      for (let k = 0; k < 6; k++) {
        const angle = (k / 6) * TAU - Math.PI / 2;
        g.moveTo(0, 0);
        g.lineTo(Math.cos(angle) * 13, Math.sin(angle) * 13);
      }
      strokes(g, MID, 1.3);
      for (let k = 0; k < 6; k++) {
        const angle = (k / 6) * TAU - Math.PI / 2;
        disc(g, Math.cos(angle) * 13, Math.sin(angle) * 13, 2.1, LIGHT);
      }
      disc(g, 0, 0, 4.4, LIGHT);
      disc(g, 0, 0, 2, '#27c5d2', false);
      break;
    }
  }
}

export class Fleet {
  private sprites: (HTMLCanvasElement | null)[] = new Array<HTMLCanvasElement | null>(TIERS).fill(null);
  private key = '';

  private sprite(stage: Stage, tier: number, zone: number): HTMLCanvasElement {
    const scale = stage.unit * stage.ratio;
    const key = `${scale.toFixed(3)}:${zone}`;
    if (key !== this.key) {
      this.key = key;
      this.sprites.fill(null);
    }
    const index = Math.max(0, Math.min(TIERS - 1, Math.round(tier)));
    let sprite = this.sprites[index] ?? null;
    if (!sprite) {
      const sheet = makeSheet(HALF_WIDTH * 2 * scale, HALF_HEIGHT * 2 * scale);
      const g = sheet.g;
      g.setTransform(scale, 0, 0, scale, HALF_WIDTH * scale, HALF_HEIGHT * scale);
      paintCraft(g, index);
      if (zone >= 2) {
        // A little of the dark settles on the paintwork down here.
        g.globalCompositeOperation = 'source-atop';
        g.fillStyle = `rgba(4, 10, 32, ${zone >= 3 ? 0.3 : 0.22})`;
        g.fillRect(-HALF_WIDTH, -HALF_HEIGHT, HALF_WIDTH * 2, HALF_HEIGHT * 2);
        g.globalCompositeOperation = 'source-over';
      }
      sprite = sheet.canvas;
      this.sprites[index] = sprite;
    }
    return sprite;
  }

  /** Draws scanning beams, then the craft, and queues their lights. Leaves the CSS-pixel transform set. */
  draw(g: CanvasRenderingContext2D, stage: Stage, drones: readonly DroneView[], creatures: readonly CreatureView[], zone: number, time: number): void {
    if (drones.length === 0) return;
    const ratio = stage.ratio;
    const unit = stage.unit;
    const glows = stage.glows;
    const lights = stage.lights;
    const wobble = stage.motion;

    // Beams first, so the craft sit on top of where they start.
    g.setTransform(ratio, 0, 0, ratio, 0, 0);
    g.lineCap = 'round';
    for (const drone of drones) {
      if (drone.targetId === null) continue;
      let target: CreatureView | null = null;
      for (const creature of creatures) {
        if (creature.id === drone.targetId) {
          target = creature;
          break;
        }
      }
      if (!target || target.alpha < 0.05) continue;
      const y = drone.y + Math.sin(time * 1.6 + drone.phase) * 1.6 * unit * wobble;
      const fade = Math.min(1, target.alpha * 1.4);
      g.globalAlpha = 0.26 * fade;
      g.strokeStyle = CYAN;
      g.lineWidth = 3.4 * unit;
      g.beginPath();
      g.moveTo(drone.x, y);
      g.lineTo(target.x, target.y);
      g.stroke();
      g.globalAlpha = 0.85 * fade;
      g.strokeStyle = '#e6fffb';
      g.lineWidth = unit;
      g.stroke();
      // A pulse running down the beam, and a pool of light where it lands.
      const along = fract(time * 2.6 + drone.phase);
      lights.push(glows.get(GLOW_SOFT, 174, 100, 6 * unit * ratio), (drone.x + (target.x - drone.x) * along) * ratio, (y + (target.y - y) * along) * ratio, fade * 0.9);
      lights.push(glows.get(GLOW_SOFT, 174, 100, 13 * unit * ratio), target.x * ratio, target.y * ratio, fade * 0.5);
    }
    g.globalAlpha = 1;

    g.setTransform(1, 0, 0, 1, 0, 0);
    const scale = unit * ratio;
    for (const drone of drones) {
      const sprite = this.sprite(stage, drone.tier, zone);
      const cx = drone.x * ratio;
      const cy = (drone.y + Math.sin(time * 1.6 + drone.phase) * 1.6 * unit * wobble) * ratio;
      g.drawImage(sprite, Math.round(cx - sprite.width * 0.5), Math.round(cy - sprite.height * 0.5));
      const lamps = LAMPS[Math.max(0, Math.min(TIERS - 1, Math.round(drone.tier)))] as readonly number[];
      for (let i = 0; i < lamps.length; i += 4) {
        const blinking = lamps[i + 3] === 1;
        let level: number;
        if (blinking) {
          const cycle = fract(time * 0.7 + drone.phase * 0.37);
          level = cycle < 0.2 ? Math.sin((cycle / 0.2) * Math.PI) : 0;
        } else {
          level = 0.62 + 0.3 * Math.sin(time * 2.1 + drone.phase + i);
        }
        if (level <= 0.02) continue;
        lights.push(glows.get(blinking ? GLOW_CORE : GLOW_SOFT, lamps[i + 2] as number, 100, (blinking ? 6 : 7.5) * scale), cx + (lamps[i] as number) * scale, cy + (lamps[i + 1] as number) * scale, level * (drone.targetId !== null && !blinking ? 1 : 0.85));
      }
    }
    g.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  /** Draws one tier's craft centred in a canvas, for reference sheets. */
  static paint(g: CanvasRenderingContext2D, tier: number): void {
    paintCraft(g, tier);
  }
}
