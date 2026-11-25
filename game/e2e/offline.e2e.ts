import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { game, openGame, startHarness, type Harness } from './helpers.ts';

let harness: Harness;
before(async () => {
  harness = await startHarness('web');
});
after(async () => {
  await harness.close();
});

/** Fires the browser's own "tab hidden" and "tab shown" signals. */
async function setHidden(page: import('playwright').Page, hidden: boolean): Promise<void> {
  await page.evaluate((value) => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => value });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (value ? 'hidden' : 'visible') });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

test('time with the tab hidden pays offline income for that time only', async () => {
  const { page, errors } = await openGame(harness);
  // A fleet, and a long stretch of open play before the tab is hidden.
  await game(page, '(g.grant(1e6), g.host.buyGenerator(0, 30), g.host.buyGenerator(0, 30), true)');
  await game(page, '(g.advance(600), true)');
  const rate = await game<number>(page, 'g.state.generators[0]');
  assert.ok(rate >= 30);

  await page.clock.install();
  await setHidden(page, true);
  const lumensAtHide = await game<number>(page, 'g.state.lumens');
  await page.clock.fastForward(30 * 60 * 1000);
  await setHidden(page, false);
  const earned = (await game<number>(page, 'g.state.lumens')) - lumensAtHide;

  // Half an hour away at 50% efficiency is 15 minutes of fleet income. The ten minutes
  // played before hiding must not be counted again.
  const perSecond = await game<number>(page, 'g.state.generators[0] * 0.3 * 8'); // 60 buoys at 0.3 each, x8 from three ownership milestones
  const expected = perSecond * 30 * 60 * 0.5;
  // A few achievements add a little on top, so allow some headroom above but nothing like double.
  assert.ok(earned > expected * 0.95 && earned < expected * 1.25, `earned ${earned.toFixed(0)}, expected about ${expected.toFixed(0)}`);
  assert.deepEqual(errors, []);
});

/** The same checksum the save format uses (FNV-1a). */
function checksum(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

test('reopening a saved game pays offline income once, capped at the limit', async () => {
  const first = await openGame(harness);
  await game(first.page, '(g.grant(1e6), g.host.buyGenerator(0, 30), g.save(), true)');
  const saved = await first.page.evaluate(() => window.localStorage.getItem('glowfathom.save'));
  assert.ok(saved, 'a save was written');
  const lumensSaved = await game<number>(first.page, 'g.state.lumens');
  await first.page.context().close();

  // The same save, last seen three days ago, opened in a fresh browser.
  const envelope = JSON.parse(saved) as { v: number; t: number; c: number; s: string };
  const body = JSON.parse(envelope.s) as { lastSeen: number };
  body.lastSeen = Date.now() - 3 * 86_400_000;
  const text = JSON.stringify(body);
  const aged = JSON.stringify({ ...envelope, s: text, c: checksum(text) });

  const context = await harness.browser.newContext({ viewport: { width: 1280, height: 720 } });
  await context.addInitScript((value) => {
    if (!window.localStorage.getItem('glowfathom.save')) window.localStorage.setItem('glowfathom.save', value);
  }, aged);
  const page = await context.newPage();
  await page.goto(`${harness.url}?e2e=1`);
  await page.waitForFunction(() => document.documentElement.classList.contains('game-ready'));
  const gained = (await game<number>(page, 'g.state.lumens')) - lumensSaved;
  const perSecond = 30 * 0.3 * 4; // 30 buoys with two ownership milestones
  const cap = perSecond * 2 * 3600 * 0.5; // only two hours count, at half efficiency
  assert.ok(gained > cap * 0.95 && gained < cap * 1.25, `gained ${gained.toFixed(0)}, cap about ${cap.toFixed(0)}`);

  // Reloading straight away must not pay it again.
  await page.reload();
  await page.waitForFunction(() => document.documentElement.classList.contains('game-ready'));
  const afterReload = (await game<number>(page, 'g.state.lumens')) - lumensSaved;
  assert.ok(afterReload < gained * 1.02, `paid again on reload: ${afterReload.toFixed(0)} after ${gained.toFixed(0)}`);
  await context.close();
});
