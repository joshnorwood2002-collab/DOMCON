import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { openGame, startHarness, tapCreature, type Harness } from './helpers.ts';

let harness: Harness;
before(async () => {
  harness = await startHarness('web');
});
after(async () => {
  await harness.close();
});

interface Measurement {
  peak: number;
  rms: number;
  length: number;
  finite: boolean;
}

/** Counts the audio contexts the page creates and keeps hold of them. */
const WATCH_CONTEXTS = `
  window.__contexts = [];
  const Original = window.AudioContext;
  window.AudioContext = class extends Original {
    constructor(...args) {
      super(...args);
      window.__contexts.push(this);
    }
  };
`;

const contextStates = (page: import('playwright').Page): Promise<string[]> => page.evaluate('window.__contexts.map((context) => context.state)') as Promise<string[]>;

test('no sound is set up before the first press, and one press starts it', async () => {
  const context = await harness.browser.newContext({ viewport: { width: 1280, height: 720 } });
  await context.addInitScript(WATCH_CONTEXTS);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(`${harness.url}?e2e=1`);
  await page.waitForFunction(() => document.documentElement.classList.contains('game-ready'));
  await page.waitForTimeout(600);
  assert.deepEqual(await contextStates(page), [], 'browsers forbid sound before a gesture, so nothing is created until one');

  await page.mouse.click(640, 300);
  await page.waitForFunction('window.__contexts.length === 1 && window.__contexts[0].state === "running"', undefined, { timeout: 5000 });
  for (let i = 0; i < 12; i++) {
    await tapCreature(page);
    await page.waitForTimeout(40);
  }
  assert.deepEqual(await contextStates(page), ['running'], 'every later press reuses the one context');

  // A hidden tab goes silent and stops using the processor; coming back restarts it.
  const setHidden = (hidden: boolean): Promise<void> =>
    page.evaluate((value) => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => value });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (value ? 'hidden' : 'visible') });
      document.dispatchEvent(new Event('visibilitychange'));
    }, hidden);
  await setHidden(true);
  await page.waitForFunction('window.__contexts[0].state === "suspended"', undefined, { timeout: 5000 });
  await setHidden(false);
  await page.waitForFunction('window.__contexts[0].state === "running"', undefined, { timeout: 5000 });

  // With music and effects both switched off there is nothing to play, so the clock stops too.
  await page.evaluate('window.__glowfathom.host.updateSettings({ music: false, sfx: false })');
  await page.waitForFunction('window.__contexts[0].state === "suspended"', undefined, { timeout: 5000 });
  await page.evaluate('window.__glowfathom.host.updateSettings({ sfx: true })');
  await page.waitForFunction('window.__contexts[0].state === "running"', undefined, { timeout: 5000 });

  assert.deepEqual(errors, []);
  await context.close();
});

test('every sound is audible, ends, and cannot clip even when all play at once', async () => {
  const { page, errors } = await openGame(harness);
  const levels = (await page.evaluate('window.__glowfathom.measureAudio()')) as Record<string, Measurement>;
  const names = Object.keys(levels);
  assert.equal(names.filter((name) => !name.startsWith('ambient-') && name !== 'pile-up').length, 18, 'one measurement per effect');

  for (const [name, level] of Object.entries(levels)) {
    assert.ok(level.finite, `${name} renders real numbers`);
    assert.ok(level.peak < 0.95, `${name} stays clear of clipping (peak ${level.peak.toFixed(3)})`);
    if (name.startsWith('ambient-')) {
      assert.ok(level.rms > 0.004, `${name} can be heard (rms ${level.rms.toFixed(4)})`);
      assert.ok(level.peak < 0.25, `${name} stays in the background (peak ${level.peak.toFixed(3)})`);
    } else if (name !== 'pile-up') {
      assert.ok(level.peak > 0.04, `${name} can be heard (peak ${level.peak.toFixed(3)})`);
      assert.ok(level.peak < 0.6, `${name} is not startling (peak ${level.peak.toFixed(3)})`);
      assert.ok(level.length < 3.6, `${name} ends (${level.length.toFixed(2)} s)`);
    }
  }
  // Short, frequent sounds must stay short or rapid tapping turns to mush.
  for (const name of ['tap', 'ui', 'scan', 'buy', 'error']) assert.ok((levels[name] as Measurement).length < 0.4, `${name} is short`);
  assert.deepEqual(errors, []);
});
