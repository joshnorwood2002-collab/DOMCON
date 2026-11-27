// Makes the pictures and videos the storefronts ask for, from the game itself:
// covers composed with the game's own renderer, screenshots of real play, and
// two short silent gameplay videos. Output goes to game/store/.
//
//   npm run store-assets                everything (several minutes)
//   npm run store-assets -- covers      just the covers
//   npm run store-assets -- screenshots just the screenshots
//   npm run store-assets -- videos      just the videos (needs ffmpeg)
//
// Sizes follow CrazyGames' rules, the strictest of the storefronts: covers at
// 1920x1080, 800x1200 and 800x800 carrying only the game's title, and videos
// of 15 to 20 seconds at 1080p in landscape (16:9) and portrait (2:3), silent,
// opening on the cover. itch.io's 630x500 cover is made too.

import * as esbuild from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import { localDay, surveyTarget } from '../src/game/economy.ts';
import { exportCode } from '../src/game/save.ts';
import { STEADY, simulate } from '../src/game/sim.ts';
import { createState, type GameState } from '../src/game/state.ts';
import { buildTarget, loadConfig, serveDirectory } from './build.ts';
import type { CastMember, PictureSpec } from './store-stage.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(root, 'store');
const SEED = 20261;

// ---------------------------------------------------------------- covers

/** The animals on the covers, placed for each shape below. A mix of zones, chosen for colour and glow. */
const STARS = {
  star: 'z2s8', // The Drowned Star
  manta: 'z0s7', // Dawn Manta
  angler: 'z2s7', // Crown Angler
  sailfin: 'z0s8', // The Gilded Sailfin
  comb: 'z1s5', // Comb Glimmer
} as const;

interface CoverShape {
  file: string;
  width: number;
  height: number;
  ratio: number;
  unit: number;
  title: NonNullable<PictureSpec['title']>;
  cast: readonly CastMember[];
}

function coverSpec(shape: CoverShape, title: string): PictureSpec {
  return {
    width: shape.width,
    height: shape.height,
    ratio: shape.ratio,
    unit: shape.unit,
    // The Twilight Reach: dark enough for the glow to show, light enough to stay blue at thumbnail size.
    zone: 1,
    progress: 0.35,
    time: 41.3,
    seed: SEED,
    cast: shape.cast,
    title: { ...shape.title, text: title },
  };
}

const COVERS: readonly CoverShape[] = [
  {
    file: 'cover-1920x1080.png',
    width: 640,
    height: 360,
    ratio: 3,
    unit: 1.9,
    title: { text: '', x: 0.57, y: 0.2, size: 0.092 },
    cast: [
      { species: STARS.angler, x: 0.5, y: 0.53, size: 1.2, dir: -1, phase: 1.1 },
      { species: STARS.star, x: 0.84, y: 0.6, size: 1.3, phase: 0.4 },
      { species: STARS.manta, x: 0.64, y: 0.84, size: 1.15, dir: -1, phase: 2.2 },
      { species: STARS.sailfin, x: 0.27, y: 0.8, size: 0.95, dir: 1, phase: 0.3 },
      { species: STARS.comb, x: 0.7, y: 0.42, size: 0.85, phase: 0.8 },
    ],
  },
  {
    file: 'cover-800x1200.png',
    width: 400,
    height: 600,
    ratio: 2,
    unit: 2,
    title: { text: '', x: 0.5, y: 0.085, size: 0.118 },
    cast: [
      { species: STARS.star, x: 0.72, y: 0.62, size: 1.3, phase: 0.4 },
      { species: STARS.angler, x: 0.36, y: 0.57, size: 1.1, dir: -1, phase: 1.1 },
      { species: STARS.manta, x: 0.36, y: 0.8, size: 1.1, dir: 1, phase: 2.2 },
      { species: STARS.sailfin, x: 0.72, y: 0.9, size: 0.9, dir: -1, phase: 0.3 },
      { species: STARS.comb, x: 0.82, y: 0.42, size: 0.75, phase: 0.8 },
    ],
  },
  {
    file: 'cover-800x800.png',
    width: 400,
    height: 400,
    ratio: 2,
    unit: 1.6,
    title: { text: '', x: 0.5, y: 0.13, size: 0.118 },
    cast: [
      { species: STARS.star, x: 0.76, y: 0.62, size: 1.25, phase: 0.4 },
      { species: STARS.angler, x: 0.4, y: 0.64, size: 1.1, dir: -1, phase: 1.1 },
      { species: STARS.manta, x: 0.4, y: 0.85, size: 1.0, dir: 1, phase: 2.2 },
      { species: STARS.sailfin, x: 0.86, y: 0.33, size: 0.8, dir: -1, phase: 0.3 },
    ],
  },
  {
    file: 'cover-630x500.png',
    width: 420,
    height: 333.34,
    ratio: 1.5,
    unit: 1.5,
    title: { text: '', x: 0.55, y: 0.17, size: 0.105 },
    cast: [
      { species: STARS.star, x: 0.82, y: 0.62, size: 1.2, phase: 0.4 },
      { species: STARS.angler, x: 0.5, y: 0.56, size: 1.1, dir: -1, phase: 1.1 },
      { species: STARS.manta, x: 0.58, y: 0.83, size: 1.0, dir: -1, phase: 2.2 },
      { species: STARS.sailfin, x: 0.24, y: 0.84, size: 0.9, dir: 1, phase: 0.3 },
    ],
  },
];

/** Opens a blank page that can draw pictures with the game's renderer. */
async function openStage(browser: Browser): Promise<Page> {
  const bundle = await esbuild.build({
    entryPoints: [path.join(root, 'scripts', 'store-stage.ts')],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: ['es2020'],
    logLevel: 'warning',
  });
  const script = bundle.outputFiles[0];
  if (!script) throw new Error('The stage script did not build');
  const page = await browser.newPage();
  await page.setContent('<!doctype html><meta charset="utf-8"><title>stage</title>');
  await page.addScriptTag({ content: script.text });
  return page;
}

async function drawPicture(stage: Page, spec: PictureSpec): Promise<Buffer> {
  const dataUrl = await stage.evaluate((given) => window.drawPicture(given), spec);
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
}

async function makeCovers(browser: Browser, title: string): Promise<void> {
  const stage = await openStage(browser);
  for (const shape of COVERS) {
    await writeFile(path.join(OUT, shape.file), await drawPicture(stage, coverSpec(shape, title)));
    console.log(`  ${shape.file}`);
  }
  await stage.close();
}

// ---------------------------------------------------------------- the game, under direction

/**
 * A point in a playthrough. The game's state at that point comes from the
 * headless player in src/game/sim.ts, which plays the real rules, so every
 * number on screen is one a player would really see there.
 */
interface Moment {
  /** Dives made: 0 is the surface, 181 the sea floor. */
  step: number;
  /** How full the survey bar is, 0 to 1. */
  survey: number;
  tab: 'fleet' | 'research' | 'codex' | 'institute' | 'goals';
}

const MOMENTS = {
  shallows: { step: 2, survey: 0.55, tab: 'fleet' },
  twilight: { step: 27, survey: 0.4, tab: 'codex' },
  midnight: { step: 61, survey: 0.6, tab: 'fleet' },
  abyss: { step: 104, survey: 0.3, tab: 'institute' },
  trench: { step: 152, survey: 0.75, tab: 'goals' },
} as const satisfies Record<string, Moment>;

/** Plays one long simulated game and keeps the state on first arriving at each depth asked for. */
function playthrough(steps: readonly number[]): Map<number, GameState> {
  const reached = new Map<number, GameState>();
  simulate({
    profile: STEADY,
    seed: SEED,
    maxSeconds: 24 * 3600,
    stopWhen: (state) => {
      for (const step of steps) {
        if (!reached.has(step) && state.depthStep >= step) reached.set(step, structuredClone(state));
      }
      return reached.size === steps.length;
    },
  });
  for (const step of steps) {
    if (!reached.has(step)) throw new Error(`The simulated player never reached dive ${step}`);
  }
  return reached;
}

interface Studio {
  page: Page;
  /** Moves the game's clock on. Time passes only when this is called, so every run draws the same pictures. */
  run(seconds: number): Promise<void>;
  close(): Promise<void>;
}

async function openStudio(browser: Browser, url: string, width: number, height: number, scale: number): Promise<Studio> {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale });
  const page = await context.newPage();
  await page.clock.install({ time: new Date('2026-06-01T12:00:00') });
  await page.goto(`${url}?e2e=1`);
  await page.waitForFunction(() => document.documentElement.classList.contains('game-ready'), undefined, { timeout: 30_000 });
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 250);
  const run = async (seconds: number): Promise<void> => {
    // In steps of a second at most: a longer jump would be treated by the game as time away.
    for (let left = seconds; left > 1e-6; left -= 1) await page.clock.runFor(Math.round(Math.min(1, left) * 1000));
  };
  // The title card has gone after a few seconds.
  await run(4);
  return { page, run, close: () => context.close() };
}

/** Presses a control at its centre. Raw mouse input, so it does not wait on the page's (stopped) clock. */
async function press(page: Page, testId: string): Promise<boolean> {
  const box = await page.evaluate((id) => {
    const node = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    if (!node || node.offsetParent === null || (node as HTMLButtonElement).disabled) return null;
    const rect = node.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }, testId);
  if (!box) return false;
  await page.mouse.click(box.x, box.y);
  return true;
}

/** Taps a creature on screen. Prefers the kind asked for, then ones part-way through a scan. */
async function tapCreature(page: Page, prefer: 'normal' | 'shoal' = 'normal'): Promise<boolean> {
  const point = await page.evaluate((wanted) => {
    interface Seen {
      x: number;
      y: number;
      kind: string;
      fleeing: boolean;
      alpha: number;
      tapsLeft: number;
      tapsTotal: number;
    }
    const game = (window as unknown as { __glowfathom: { session: { scene(): { width: number; height: number; creatures: Seen[] } } } }).__glowfathom;
    const scene = game.session.scene();
    const canvas = document.querySelector('canvas');
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const visible = scene.creatures.filter((creature) => !creature.fleeing && creature.alpha > 0.6 && creature.x > 40 && creature.x < scene.width - 40 && creature.y > 70 && creature.y < scene.height - 90);
    const score = (creature: Seen): number => (creature.kind === wanted ? 10 : 0) + (creature.tapsLeft < creature.tapsTotal ? 5 : 0);
    visible.sort((a, b) => score(b) - score(a));
    const target = visible[0];
    return target ? { x: rect.left + target.x, y: rect.top + target.y } : null;
  }, prefer);
  if (!point) return false;
  await page.mouse.click(point.x, point.y);
  return true;
}

/** Loads a state into the open game through its own save import, then lets the water fill with life. */
async function arrange(studio: Studio, source: GameState, moment: Moment): Promise<void> {
  const { page } = studio;
  const { now, offset } = await page.evaluate(() => ({ now: Date.now(), offset: new Date().getTimezoneOffset() }));
  const state = structuredClone(source);
  state.tutorial = 99;
  // Today's gift already collected and no boost half-run: nothing on screen that depends on when this was made.
  state.dailyDay = localDay(now, offset);
  state.sonarUntil = 0;
  state.sonarReadyAt = 0;
  state.frenzyUntil = 0;
  state.nextShoalAt = state.clock + 9999;
  state.survey = surveyTarget(state) * moment.survey;
  state.settings = { ...state.settings, reducedMotion: false, scientific: false };
  const loaded = await page.evaluate((code) => (window as unknown as { __glowfathom: { host: { importSave(text: string): boolean } } }).__glowfathom.host.importSave(code), exportCode(state, now));
  if (!loaded) throw new Error('The game refused the prepared state');
  await studio.run(0.3);
  await press(page, `tab-${moment.tab}`);
  await studio.run(5);
  // Deep water is sparsely populated; wait for a lively moment before the camera rolls.
  for (let i = 0; i < 40; i++) {
    const inView = await page.evaluate(() => {
      const game = (window as unknown as { __glowfathom: { session: { scene(): { width: number; creatures: { x: number; fleeing: boolean; alpha: number }[] } } } }).__glowfathom;
      const scene = game.session.scene();
      return scene.creatures.filter((creature) => !creature.fleeing && creature.alpha > 0.8 && creature.x > 60 && creature.x < scene.width - 60).length;
    });
    if (inView >= 5) break;
    await studio.run(0.5);
  }
}

// ---------------------------------------------------------------- screenshots

type States = ReadonlyMap<number, GameState>;

function stateAt(states: States, step: number): GameState {
  const state = states.get(step);
  if (!state) throw new Error(`No simulated state for dive ${step}`);
  return state;
}

/** Makes a glimmer shoal arrive in `seconds`. */
async function callShoal(page: Page, seconds: number): Promise<void> {
  await page.evaluate((delay) => {
    const game = (window as unknown as { __glowfathom: { state: { nextShoalAt: number; clock: number } } }).__glowfathom;
    game.state.nextShoalAt = game.state.clock + delay;
  }, seconds);
}

async function makeScreenshots(browser: Browser, url: string, states: States): Promise<void> {
  const studio = await openStudio(browser, url, 1280, 720, 1);
  const { page } = studio;
  const shots: readonly [name: string, moment: Moment, act: () => Promise<void>][] = [
    [
      'screenshot-1.png',
      MOMENTS.shallows,
      async () => {
        // Mid-scan: a tap has just landed and its reward is rising.
        for (let i = 0; i < 3; i++) {
          await tapCreature(page);
          await studio.run(0.22);
        }
      },
    ],
    [
      'screenshot-2.png',
      MOMENTS.twilight,
      async () => {
        // A glimmer shoal crossing, with a few of its fish already caught.
        await callShoal(page, 0);
        await studio.run(3.2);
        for (let i = 0; i < 4; i++) {
          await tapCreature(page, 'shoal');
          await studio.run(0.18);
        }
      },
    ],
    [
      'screenshot-3.png',
      MOMENTS.midnight,
      async () => {
        await press(page, 'sonar-button');
        await studio.run(1.6);
        await tapCreature(page);
        await studio.run(0.2);
      },
    ],
    [
      'screenshot-4.png',
      MOMENTS.abyss,
      async () => {
        await tapCreature(page);
        await studio.run(0.25);
      },
    ],
    [
      'screenshot-5.png',
      MOMENTS.trench,
      async () => {
        for (let i = 0; i < 2; i++) {
          await tapCreature(page);
          await studio.run(0.2);
        }
      },
    ],
  ];
  for (const [name, moment, act] of shots) {
    await arrange(studio, stateAt(states, moment.step), moment);
    await act();
    await page.screenshot({ path: path.join(OUT, name) });
    console.log(`  ${name}`);
  }
  await studio.close();
}

// ---------------------------------------------------------------- videos

const FPS = 30;
/**
 * Game time per video frame. The browser draws every 16 ms, so 32 ms is exactly two drawn frames
 * and motion comes out perfectly even; 33.3 would be two on most frames and three on some.
 */
const FRAME_MS = 32;

interface Scene {
  state: GameState;
  moment: Moment;
  seconds: number;
  /** One-off preparation after the state is loaded and before the first frame. */
  before?(studio: Studio): Promise<void>;
  /** Called before each frame is drawn, to send that frame's input. */
  act(studio: Studio, frame: number): Promise<void>;
}

const every = (frame: number, period: number, offset = 0): boolean => frame >= offset && (frame - offset) % period === 0;

function scenes(states: States): Scene[] {
  // The first minute of a new game: a handful of lumens, no fleet yet, the first survey nearly done.
  const firstMinute = createState(SEED, 0);
  firstMinute.lumens = 7;
  let bought = false;
  let firstDive = false;
  let secondDive = false;
  return [
    {
      state: firstMinute,
      moment: { step: 0, survey: 0.9, tab: 'fleet' },
      seconds: 5,
      async act(studio, frame) {
        // Scan by hand, buy the first buoy as soon as it can be afforded, then make the first dive.
        if (!bought && frame >= 50 && frame % 4 === 0) bought = await press(studio.page, 'gen-0-buy');
        else if (!firstDive && frame >= 92 && frame % 4 === 2) firstDive = await press(studio.page, 'dive-button');
        else if (every(frame, 8, 5)) await tapCreature(studio.page);
      },
    },
    {
      // A fleet at work in the Twilight Reach: scanning alongside it, then diving on.
      state: stateAt(states, MOMENTS.twilight.step),
      moment: { ...MOMENTS.twilight, survey: 0.94, tab: 'fleet' },
      seconds: 4.5,
      async act(studio, frame) {
        if (!secondDive && frame >= 70 && frame % 4 === 2) secondDive = await press(studio.page, 'dive-button');
        else if (every(frame, 7, 4)) await tapCreature(studio.page);
      },
    },
    {
      // The dark: a sonar burst, and the rarer animals it lights up.
      state: stateAt(states, MOMENTS.midnight.step),
      moment: { ...MOMENTS.midnight, tab: 'codex' },
      seconds: 4,
      async act(studio, frame) {
        if (frame === 8) await press(studio.page, 'sonar-button');
        else if (every(frame, 8, 30)) await tapCreature(studio.page);
      },
    },
    {
      // The trench, with the whole fleet out and a glimmer shoal streaming through the black.
      state: stateAt(states, MOMENTS.trench.step),
      moment: { ...MOMENTS.trench, tab: 'fleet' },
      seconds: 4,
      before: (studio) => callShoal(studio.page, 0),
      async act(studio, frame) {
        if (every(frame, 4, 24)) await tapCreature(studio.page, 'shoal');
        else if (every(frame, 9, 3) && frame < 24) await tapCreature(studio.page);
      },
    },
  ];
}

async function makeVideo(browser: Browser, url: string, states: States, file: string, width: number, height: number, scale: number, cover: CoverShape, title: string): Promise<void> {
  const frames = await mkdtemp(path.join(os.tmpdir(), 'glowfathom-video-'));
  try {
    let index = 0;
    const framePath = (): string => path.join(frames, `frame-${String(index++).padStart(5, '0')}.jpg`);

    // The storefront asks for the cover as the opening frame: the cover's composition, drawn at the video's size.
    const stage = await openStage(browser);
    const opening = path.join(frames, 'opening.png');
    await writeFile(opening, await drawPicture(stage, { ...coverSpec(cover, title), ratio: (width * scale) / cover.width }));
    await stage.close();
    const openingJpeg = path.join(frames, 'opening.jpg');
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', opening, '-q:v', '2', openingJpeg]);
    const openingBytes = await readFile(openingJpeg);
    for (let i = 0; i < Math.round(FPS * 0.6); i++) await writeFile(framePath(), openingBytes);

    const studio = await openStudio(browser, url, width, height, scale);
    for (const scene of scenes(states)) {
      await arrange(studio, scene.state, scene.moment);
      await scene.before?.(studio);
      const count = Math.round(scene.seconds * FPS);
      for (let frame = 0; frame < count; frame++) {
        await scene.act(studio, frame);
        await studio.page.clock.runFor(FRAME_MS);
        await studio.page.screenshot({ path: framePath(), type: 'jpeg', quality: 93 });
      }
    }
    await studio.close();

    execFileSync('ffmpeg', [
      '-loglevel', 'error', '-y',
      '-framerate', String(FPS),
      '-i', path.join(frames, 'frame-%05d.jpg'),
      '-an',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '21',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      path.join(OUT, file),
    ]);
    console.log(`  ${file} (${(index / FPS).toFixed(1)} s)`);
  } finally {
    await rm(frames, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- run

const wanted = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
const want = (part: string): boolean => wanted.length === 0 || wanted.includes(part);

await mkdir(OUT, { recursive: true });
const config = await loadConfig();
const title = config.title.toUpperCase();
const browser = await chromium.launch();
const work = await mkdtemp(path.join(os.tmpdir(), 'glowfathom-store-'));
let server: { url: string; close: () => Promise<void> } | null = null;
try {
  if (want('covers')) {
    console.log('covers');
    await makeCovers(browser, title);
  }
  if (want('screenshots') || want('videos')) {
    console.log('playing a simulated game to the depths the pictures show');
    const states = playthrough(Object.values(MOMENTS).map((moment) => moment.step));
    // A build of its own, so the release folders are left alone.
    process.env['GF_DIST'] = work;
    server = await serveDirectory(await buildTarget('web', { dev: false, zip: false }));
    if (want('screenshots')) {
      console.log('screenshots');
      await makeScreenshots(browser, server.url, states);
    }
    if (want('videos')) {
      console.log('videos');
      const landscape = COVERS.find((shape) => shape.file === 'cover-1920x1080.png');
      const portrait = COVERS.find((shape) => shape.file === 'cover-800x1200.png');
      if (!landscape || !portrait) throw new Error('The covers the videos open on are missing');
      // Side by side: each has its own page and its own clock.
      await Promise.all([
        makeVideo(browser, server.url, states, 'preview-landscape.mp4', 1280, 720, 1.5, landscape, title),
        makeVideo(browser, server.url, states, 'preview-portrait.mp4', 540, 810, 2, portrait, title),
      ]);
    }
  }
} finally {
  await server?.close();
  await browser.close();
  await rm(work, { recursive: true, force: true });
}
