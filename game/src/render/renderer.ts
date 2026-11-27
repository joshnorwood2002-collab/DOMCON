// The renderer: turns one SceneView into one frame on a 2D canvas. It owns no
// game state. The picture is built back to front:
//
//   water and bottom silhouettes   (backdrop.ts, mostly copied from sheets)
//   sonar sweep, shoal shimmer     (effects.ts)
//   the submarine                  (sub.ts)
//   creature auras, then bodies    (creatures.ts, looks.ts)
//   the fleet and its beams        (fleet.ts)
//   every light, in one pass       (kit.ts SpriteQueue)
//   rings, beams, near snow, sparks, floating text, frenzy glow
//
// A small governor watches the frame rate and trims decoration, never
// gameplay, if a device cannot keep up.

import type { CreatureView, FloatStyle, Renderer, SceneView } from '../contracts.ts';
import type { SpeciesDef } from '../game/content.ts';
import { Backdrop } from './backdrop.ts';
import { beginCreatures, drawCreature, drawRings, extent, queueGlimmer, queuePortraitGlow, queueRarity } from './creatures.ts';
import { Effects } from './effects.ts';
import { Fleet } from './fleet.ts';
import { GLOW_AURA, clamp, fract, makeSheet, makeStage, type Sheet } from './kit.ts';
import { GLIMMER_LOOK, lookOf, type Look } from './looks.ts';
import { Submarine } from './sub.ts';

/** Frames are averaged over windows this long before the governor judges them. */
const WINDOW_FRAMES = 45;
/** A window averaging worse than this many milliseconds a frame (about 49 a second) counts as slow. */
const SLOW_MS = 20.5;
const FAST_MS = 17.6;
/** Fast windows in a row (about half a minute) before detail is cautiously restored. */
const RESTORE_AFTER = 40;
const MAX_DETAIL = 2;

/** The moment of each archetype's motion that makes the best still picture, as a phase of its beat. */
const PORTRAIT_PHASE: Readonly<Record<SpeciesDef['archetype'], number>> = {
  fish: 0.9,
  lantern: 0.9,
  angler: 0.7,
  eel: 0.6,
  jelly: 4.5,
  ray: 0.55,
  comb: 2.1,
  squid: 3.7,
};

export function createRenderer(canvas: HTMLCanvasElement, seed: number): Renderer {
  // The water covers every pixel every frame, so the canvas never needs to be see-through.
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Canvas 2D is not available');
  const ctx: CanvasRenderingContext2D = context;

  let width = 1;
  let height = 1;
  let ratio = 1;
  let reduced = false;
  let lastTime = -1;
  let lastScene: SceneView | null = null;

  const stage = makeStage();
  const backdrop = new Backdrop(seed);
  const sub = new Submarine();
  const fleet = new Fleet();
  const effects = new Effects(seed);

  // ---------------------------------------------------------------- frame-rate governor
  let detail = MAX_DETAIL;
  let lastStamp = 0;
  let windowSum = 0;
  let windowFrames = 0;
  let slowWindows = 0;
  let fastWindows = 0;
  let warmup = 180;
  /** Set after a restore attempt: if the very next windows are slow again, stop trying for a while. */
  let probation = 0;
  let restoreHold = 0;

  function setDetail(level: number): void {
    detail = clamp(level, 0, MAX_DETAIL);
    // Left on the element for tests and bug reports; nothing in the game reads it.
    canvas.dataset['renderDetail'] = String(detail);
  }
  setDetail(MAX_DETAIL);

  function govern(): void {
    const now = performance.now();
    const elapsed = now - lastStamp;
    lastStamp = now;
    if (warmup > 0) {
      warmup--;
      return;
    }
    // Long gaps are a hidden tab or a one-off hitch, not the steady rate.
    if (elapsed <= 0 || elapsed > 120) return;
    windowSum += elapsed;
    if (++windowFrames < WINDOW_FRAMES) return;
    const average = windowSum / windowFrames;
    windowSum = 0;
    windowFrames = 0;
    if (restoreHold > 0) restoreHold--;
    if (average > SLOW_MS) {
      fastWindows = 0;
      if (++slowWindows >= 2 && detail > 0) {
        if (probation > 0) restoreHold = 160;
        setDetail(detail - 1);
        slowWindows = 0;
      }
    } else {
      slowWindows = 0;
      if (probation > 0) probation--;
      if (average < FAST_MS && detail < MAX_DETAIL && restoreHold === 0 && ++fastWindows >= RESTORE_AFTER) {
        setDetail(detail + 1);
        fastWindows = 0;
        probation = 6;
      }
    }
  }

  // ---------------------------------------------------------------- one frame

  function render(scene: SceneView, dt: number): void {
    const unit = scene.unit;
    const time = scene.time;
    const zone = clamp(Math.round(scene.viewZone), 0, 4);
    const rush = reduced ? 0 : clamp(scene.diveRush, 0, 1);
    const creatures = scene.creatures;

    stage.ratio = ratio;
    stage.unit = unit;
    stage.motion = reduced ? 0.55 : 1;
    stage.detail = detail;
    effects.setUnit(unit);

    backdrop.update(zone, scene.zoneProgress, scene.atFloor, scene.sonarActive, unit, rush, dt, stage.motion);
    sub.place(width, height, unit, time, rush, stage.motion);

    // The shoal's lane: the middle of the shoal fish still in the water.
    let laneSum = 0;
    let laneCount = 0;
    for (let i = 0; i < creatures.length; i++) {
      const creature = creatures[i] as CreatureView;
      if (creature.kind === 'shoal' && !creature.fleeing) {
        laneSum += creature.y;
        laneCount++;
      }
    }
    effects.update(dt, scene.frenzyActive, scene.shoalActive, laneCount > 0 ? laneSum / laneCount : 0);

    backdrop.drawBack(ctx, stage, time, rush);
    effects.drawUnder(ctx, stage, width, height, time, scene.sonarActive, sub.x, sub.y);
    sub.draw(ctx, stage, zone, time, rush, effects.scanFlash, scene.sonarActive);
    stage.lights.flush(ctx);

    // Creatures: halos first, then bodies with the big ones at the back, then every light at once.
    beginCreatures(ctx, stage);
    const sonarRadius = effects.sonarRadius(width, height, time, scene.sonarActive, unit);
    for (let i = 0; i < creatures.length; i++) {
      const creature = creatures[i] as CreatureView;
      if (creature.alpha <= 0.01) continue;
      const scale = unit * creature.size;
      const seedling = fract(creature.id * 0.6180339887);
      if (creature.kind === 'shoal') {
        queueGlimmer(GLIMMER_LOOK, creature.x, creature.y, creature.dir, scale, time + creature.phase, creature.alpha, seedling);
      } else {
        const look = lookOf(creature.species);
        queueRarity(look, look.tier, creature.x, creature.y, creature.dir, scale, time + creature.phase, creature.alpha, seedling);
      }
      if (sonarRadius > 0 && !creature.fleeing) {
        // The sonar ring lights up each creature as it sweeps over.
        const behind = sonarRadius - Math.hypot(creature.x - sub.x, creature.y - sub.y);
        const span = 90 * unit;
        if (behind > 0 && behind < span) {
          stage.auras.push(stage.glows.get(GLOW_AURA, 174, 100, 44 * scale * ratio), creature.x * ratio, creature.y * ratio, creature.alpha * (1 - behind / span) * 0.9);
        }
      }
    }
    stage.auras.flush(ctx);
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < creatures.length; i++) {
        const creature = creatures[i] as CreatureView;
        if (creature.alpha <= 0.01) continue;
        const shoal = creature.kind === 'shoal';
        const look: Look = shoal ? GLIMMER_LOOK : lookOf(creature.species);
        const layer = shoal ? 2 : look.tier >= 2 ? 0 : 1;
        if (layer !== pass) continue;
        const flee = creature.fleeing ? clamp(1 - creature.alpha, 0, 1) : 0;
        drawCreature(look, creature.x, creature.y, creature.dir, unit * creature.size, time + creature.phase, creature.alpha, creature.hitFlash, flee, true);
      }
    }
    fleet.draw(ctx, stage, scene.drones, creatures, zone, time);
    stage.lights.flush(ctx);

    // Rings sit in screen space, so a fleeing, stretching creature does not warp them.
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    for (let i = 0; i < creatures.length; i++) {
      const creature = creatures[i] as CreatureView;
      if (creature.fleeing || creature.kind === 'shoal') continue;
      const tapped = creature.tapsTotal > 1 && creature.tapsLeft < creature.tapsTotal;
      if (!creature.targeted && !tapped) continue;
      const radius = Math.max(30, 34 * unit * Math.pow(creature.size, 0.85)) + 5 * unit;
      drawRings(ctx, creature.x, creature.y, radius, unit, time, creature.alpha, creature.targeted, creature.tapsLeft, creature.tapsTotal, lookOf(creature.species).tier);
    }

    effects.drawBeams(ctx, stage, sub.noseX, sub.noseY);
    backdrop.drawFront(ctx, time, rush);
    effects.drawOver(ctx, stage);
    effects.drawTop(ctx, stage, width, height, time, zone);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  // ---------------------------------------------------------------- portraits

  let scratch: Sheet | null = null;

  function drawPortrait(target: HTMLCanvasElement, species: SpeciesDef, silhouette: boolean): void {
    const g = target.getContext('2d');
    if (!g) return;
    const w = target.width;
    const h = target.height;
    if (w < 2 || h < 2) return;
    const look = lookOf(species);
    const zone = clamp(Math.round(species.zone), 0, 4);

    // Backdrop: the zone's water, lighter in the middle.
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, w, h);
    const [centre, edge] = Backdrop.portraitColours(zone);
    const water = g.createRadialGradient(w * 0.5, h * 0.42, 0, w * 0.5, h * 0.5, Math.hypot(w, h) * 0.62);
    water.addColorStop(0, centre);
    water.addColorStop(1, edge);
    g.fillStyle = water;
    g.fillRect(0, 0, w, h);
    if (silhouette) {
      // An unknown species gets murkier water.
      g.fillStyle = 'rgba(2, 6, 18, 0.5)';
      g.fillRect(0, 0, w, h);
    }

    // Fit the animal's whole reach inside the frame, with a margin.
    const [left, right, up, down] = extent(look);
    const scale = Math.min((w * 0.86) / (left + right), (h * 0.82) / (up + down));
    const x = w * 0.5 + ((left - right) * scale) / 2;
    const y = h * 0.5 + ((up - down) * scale) / 2;
    const pose = PORTRAIT_PHASE[look.archetype] / look.beat;

    // Borrow the frame's stage for a moment; portraits are drawn in device pixels.
    const savedRatio = stage.ratio;
    const savedUnit = stage.unit;
    const savedMotion = stage.motion;
    const savedDetail = stage.detail;
    stage.ratio = 1;
    stage.unit = 1;
    stage.motion = 1;
    stage.detail = MAX_DETAIL;
    try {
      if (silhouette) {
        if (!scratch || scratch.canvas.width !== w || scratch.canvas.height !== h) scratch = makeSheet(w, h);
        const s = scratch.g;
        s.setTransform(1, 0, 0, 1, 0, 0);
        s.globalCompositeOperation = 'source-over';
        s.globalAlpha = 1;
        s.clearRect(0, 0, w, h);
        beginCreatures(s, stage);
        drawCreature(look, x, y, 1, scale, pose, 1, 0, 0, false);
        stage.lights.discard();
        // Flatten whatever was drawn to one dark colour, keeping only its shape.
        s.setTransform(1, 0, 0, 1, 0, 0);
        s.globalCompositeOperation = 'source-in';
        s.fillStyle = '#050b1a';
        s.fillRect(0, 0, w, h);
        s.globalCompositeOperation = 'source-over';
        // A faint rim of light, then the shape twice more so glassy animals come out solid.
        g.shadowColor = 'rgba(150, 214, 255, 0.55)';
        g.shadowBlur = Math.max(2, w / 34);
        g.drawImage(scratch.canvas, 0, 0);
        g.shadowColor = 'rgba(0, 0, 0, 0)';
        g.shadowBlur = 0;
        g.drawImage(scratch.canvas, 0, 0);
        g.drawImage(scratch.canvas, 0, 0);
      } else {
        beginCreatures(g, stage);
        queuePortraitGlow(look, w * 0.5, h * 0.5, Math.min(w, h) * 0.62);
        stage.auras.flush(g);
        drawCreature(look, x, y, 1, scale, pose, 1, 0, 0, true);
        stage.lights.flush(g);
      }
    } finally {
      stage.auras.discard();
      stage.lights.discard();
      stage.ratio = savedRatio;
      stage.unit = savedUnit;
      stage.motion = savedMotion;
      stage.detail = savedDetail;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
    }
  }

  // ---------------------------------------------------------------- the contract

  return {
    resize(nextWidth: number, nextHeight: number, pixelRatio: number): void {
      const scale = pixelRatio > 0 ? pixelRatio : 1;
      const backingWidth = Math.max(1, Math.round(nextWidth * scale));
      const backingHeight = Math.max(1, Math.round(nextHeight * scale));
      const changed = canvas.width !== backingWidth || canvas.height !== backingHeight;
      width = nextWidth;
      height = nextHeight;
      ratio = scale;
      // Setting the size clears the canvas, so only do it when the size is really different.
      if (changed) {
        canvas.width = backingWidth;
        canvas.height = backingHeight;
      }
      backdrop.resize(nextWidth, nextHeight, scale);
      // Repaint straight away so a resize never shows an empty canvas for a frame.
      if (changed && lastScene) render(lastScene, 0);
    },

    draw(scene: SceneView): void {
      govern();
      let dt = lastTime < 0 ? 0 : scene.time - lastTime;
      lastTime = scene.time;
      if (!(dt > 0)) dt = 0;
      else if (dt > 0.1) dt = 0.1;
      lastScene = scene;
      render(scene, dt);
    },

    scanPulse(x: number, y: number, hue: number): void {
      effects.scanPulse(x, y, hue);
    },

    ripple(x: number, y: number): void {
      effects.ripple(x, y);
    },

    burst(x: number, y: number, hue: number, strength: number): void {
      effects.burst(x, y, hue, strength);
    },

    floatText(x: number, y: number, text: string, style: FloatStyle): void {
      effects.floatText(x, y, text, style);
    },

    setReducedMotion(value: boolean): void {
      reduced = value;
      effects.setReduced(value);
    },

    hueOf(species: SpeciesDef): number {
      const hue = lookOf(species).hue % 360;
      return hue < 0 ? hue + 360 : hue;
    },

    drawPortrait,
  };
}
