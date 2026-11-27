// Runs in the browser, for scripts/store-assets.ts only: draws hand-composed
// pictures with the game's own renderer, so the store covers show exactly the
// art the game has. Nothing in this file ships in the game.

import type { CreatureView, DroneView, SceneView } from '../src/contracts.ts';
import { SPECIES_BY_ID } from '../src/game/content.ts';
import { createRenderer } from '../src/render/renderer.ts';

export interface CastMember {
  /** Species id, such as z2s0. */
  species: string;
  /** Position as a fraction of the picture's width and height. */
  x: number;
  y: number;
  size: number;
  dir?: 1 | -1;
  phase?: number;
  kind?: 'normal' | 'shoal';
}

export interface PictureSpec {
  /** Size in CSS pixels; the finished picture is `ratio` times this in each direction. */
  width: number;
  height: number;
  ratio: number;
  /** Scale of the sub and creatures. The game uses about 1; covers use more so they read at thumbnail size. */
  unit: number;
  zone: number;
  /** How far down the zone, 0 to 1. Changes the water's colour. */
  progress: number;
  time: number;
  seed: number;
  cast: readonly CastMember[];
  drones?: readonly { x: number; y: number; tier: number }[];
  sonar?: boolean;
  title?: {
    text: string;
    /** Centre of the title, as fractions of the picture. */
    x: number;
    y: number;
    /** Height of the letters as a fraction of the picture's width. */
    size: number;
  };
}

declare global {
  interface Window {
    drawPicture(spec: PictureSpec): string;
  }
}

function drawTitle(g: CanvasRenderingContext2D, spec: PictureSpec, title: NonNullable<PictureSpec['title']>): void {
  const size = title.size * spec.width;
  const x = title.x * spec.width;
  const y = title.y * spec.height;
  g.save();
  g.setTransform(spec.ratio, 0, 0, spec.ratio, 0, 0);
  g.font = `900 ${size}px "Inter Display", Inter, system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.letterSpacing = `${size * 0.06}px`;
  // Canvas letter spacing trails the last letter too; shift by half of it to keep the word centred.
  const cx = x + size * 0.03;

  // A dark halo so the word reads over bright water, then a cyan glow, then the letters.
  g.lineJoin = 'round';
  g.shadowColor = 'rgba(2, 10, 30, 0.9)';
  g.shadowBlur = size * 0.5;
  g.strokeStyle = 'rgba(2, 12, 34, 0.55)';
  g.lineWidth = size * 0.16;
  g.strokeText(title.text, cx, y);
  g.shadowColor = 'rgba(64, 232, 226, 0.95)';
  g.shadowBlur = size * 0.36;
  g.strokeStyle = 'rgba(8, 44, 72, 0.9)';
  g.lineWidth = size * 0.09;
  g.strokeText(title.text, cx, y);
  g.shadowBlur = size * 0.18;
  const fill = g.createLinearGradient(0, y - size * 0.5, 0, y + size * 0.5);
  fill.addColorStop(0, '#ffffff');
  fill.addColorStop(0.5, '#d9fffb');
  fill.addColorStop(1, '#5ff2e4');
  g.fillStyle = fill;
  g.fillText(title.text, cx, y);
  g.shadowColor = 'rgba(0, 0, 0, 0)';
  g.shadowBlur = 0;
  g.fillText(title.text, cx, y);
  g.restore();
}

window.drawPicture = (spec) => {
  const canvas = document.createElement('canvas');
  const renderer = createRenderer(canvas, spec.seed);
  renderer.resize(spec.width, spec.height, spec.ratio);

  const creatures: CreatureView[] = spec.cast.map((member, index) => {
    const species = SPECIES_BY_ID.get(member.species);
    if (!species) throw new Error(`Unknown species ${member.species}`);
    return {
      id: index + 1,
      species,
      kind: member.kind ?? 'normal',
      x: member.x * spec.width,
      y: member.y * spec.height,
      dir: member.dir ?? -1,
      size: member.size,
      phase: member.phase ?? index * 1.7,
      tapsLeft: 1,
      tapsTotal: 1,
      hitFlash: 0,
      alpha: 1,
      fleeing: false,
      targeted: false,
    };
  });
  const drones: DroneView[] = (spec.drones ?? []).map((drone, index) => ({
    id: index + 1,
    x: drone.x * spec.width,
    y: drone.y * spec.height,
    tier: drone.tier,
    targetId: null,
    phase: index * 2.3,
  }));

  // A few seconds of frames first, so bubbles, drifting specks and light shafts are all in mid-flow.
  // Kept under the renderer's warm-up length so its frame-rate governor never trims detail here.
  const frames = 170;
  for (let frame = 0; frame <= frames; frame++) {
    const scene: SceneView = {
      width: spec.width,
      height: spec.height,
      unit: spec.unit,
      viewZone: spec.zone,
      depthMetres: 0,
      zoneProgress: spec.progress,
      atFloor: false,
      creatures,
      drones,
      shoalActive: false,
      sonarActive: spec.sonar === true,
      frenzyActive: false,
      diveRush: 0,
      time: spec.time - (frames - frame) / 60,
      streak: 0,
    };
    renderer.draw(scene);
  }

  const g = canvas.getContext('2d');
  if (g && spec.title) drawTitle(g, spec, spec.title);
  return canvas.toDataURL('image/png');
};
