// Shared setup for the browser tests: builds the web target once, serves it
// from a local port, and opens pages with the game's test hooks switched on.

import { chromium, type Browser, type BrowserContextOptions, type Page } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTarget, serveDirectory, type Target } from '../scripts/build.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ARTIFACTS = path.join(here, 'artifacts');

export interface Harness {
  browser: Browser;
  url: string;
  close(): Promise<void>;
}

const built = new Map<Target, Promise<string>>();

/** Builds a target once per test process and serves it. */
export async function startHarness(target: Target = 'web'): Promise<Harness> {
  let pending = built.get(target);
  if (!pending) {
    pending = buildTarget(target, { dev: false, zip: false });
    built.set(target, pending);
  }
  const directory = await pending;
  const server = await serveDirectory(directory);
  const browser = await chromium.launch();
  return {
    browser,
    url: server.url,
    async close() {
      await browser.close();
      await server.close();
    },
  };
}

export interface GamePage {
  page: Page;
  /** Console errors and uncaught exceptions seen so far. */
  errors: string[];
  /** Requests made to anywhere other than the local server. */
  externalRequests: string[];
}

export async function openGame(harness: Harness, options: BrowserContextOptions = {}, query = 'e2e=1'): Promise<GamePage> {
  const context = await harness.browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, ...options });
  const page = await context.newPage();
  const errors: string[] = [];
  const externalRequests: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('request', (request) => {
    if (!request.url().startsWith(harness.url) && !request.url().startsWith('data:') && !request.url().startsWith('blob:')) externalRequests.push(request.url());
  });
  await page.goto(`${harness.url}?${query}`);
  await page.waitForFunction(() => document.documentElement.classList.contains('game-ready'), undefined, { timeout: 15_000 });
  return { page, errors, externalRequests };
}

/** Reads a value out of the running game through its test hook. */
export function game<T>(page: Page, expression: string): Promise<T> {
  return page.evaluate(`(() => { const g = window.__glowfathom; return (${expression}); })()`) as Promise<T>;
}

/** Taps the centre of a creature that is currently on screen. Returns false when none is tappable. */
export async function tapCreature(page: Page, kind: 'normal' | 'shoal' = 'normal'): Promise<boolean> {
  const point = await page.evaluate((wanted) => {
    const g = (window as unknown as { __glowfathom: { session: { scene(): { width: number; height: number; creatures: { x: number; y: number; kind: string; fleeing: boolean; alpha: number }[] } } } }).__glowfathom;
    const scene = g.session.scene();
    const canvas = document.querySelector('canvas');
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const target = scene.creatures.find((creature) => creature.kind === wanted && !creature.fleeing && creature.alpha > 0.5 && creature.x > 30 && creature.x < scene.width - 30 && creature.y > 30 && creature.y < scene.height - 30);
    return target ? { x: rect.left + target.x, y: rect.top + target.y } : null;
  }, kind);
  if (!point) return false;
  await page.mouse.click(point.x, point.y);
  return true;
}
