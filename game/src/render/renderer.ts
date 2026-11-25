// PLACEHOLDER renderer: plain shapes so the game can run end to end while the
// real one is being built. Implements the Renderer contract exactly.
import type { FloatStyle, Renderer, SceneView } from '../contracts.ts';
import type { SpeciesDef } from '../game/content.ts';

export function createRenderer(canvas: HTMLCanvasElement, _seed: number): Renderer {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is not available');
  let width = 1;
  let height = 1;
  let ratio = 1;
  const texts: { x: number; y: number; text: string; age: number }[] = [];
  const hueOf = (species: SpeciesDef): number => (species.zone * 70 + species.name.length * 23) % 360;
  return {
    resize(w, h, pixelRatio) {
      width = w;
      height = h;
      ratio = pixelRatio;
      canvas.width = Math.round(w * pixelRatio);
      canvas.height = Math.round(h * pixelRatio);
    },
    draw(scene: SceneView) {
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.fillStyle = ['#1b8fb8', '#0a2f63', '#040c26', '#02040d', '#020108'][scene.viewZone] ?? '#000';
      ctx.fillRect(0, 0, width, height);
      for (const creature of scene.creatures) {
        ctx.globalAlpha = creature.alpha;
        ctx.fillStyle = `hsl(${creature.kind === 'shoal' ? 48 : hueOf(creature.species)}, 80%, ${55 + creature.hitFlash * 30}%)`;
        ctx.beginPath();
        ctx.ellipse(creature.x, creature.y, 22 * scene.unit * creature.size, 12 * scene.unit * creature.size, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#9fe';
      for (const drone of scene.drones) ctx.fillRect(drone.x - 4, drone.y - 4, 8, 8);
      ctx.fillStyle = '#fff';
      ctx.font = '14px sans-serif';
      for (const text of texts) {
        text.age += 1 / 60;
        ctx.globalAlpha = Math.max(0, 1 - text.age);
        ctx.fillText(text.text, text.x, text.y - text.age * 30);
      }
      ctx.globalAlpha = 1;
      while (texts.length > 0 && (texts[0] as { age: number }).age >= 1) texts.shift();
    },
    scanPulse() {},
    ripple() {},
    burst() {},
    floatText(x: number, y: number, text: string, _style: FloatStyle) {
      texts.push({ x, y, text, age: 0 });
    },
    setReducedMotion() {},
    hueOf,
    drawPortrait(target, species, silhouette) {
      const g = target.getContext('2d');
      if (!g) return;
      g.clearRect(0, 0, target.width, target.height);
      g.fillStyle = silhouette ? '#123' : `hsl(${hueOf(species)}, 80%, 60%)`;
      g.beginPath();
      g.ellipse(target.width / 2, target.height / 2, target.width * 0.35, target.height * 0.2, 0, 0, Math.PI * 2);
      g.fill();
    },
  };
}
