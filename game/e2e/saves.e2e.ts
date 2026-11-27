// Ways a player could lose progress without doing anything wrong, each
// reproduced in a real browser.

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { BrowserContext, Page } from 'playwright';
import { game, startHarness, type Harness } from './helpers.ts';

let web: Harness;
let crazy: Harness;
before(async () => {
  web = await startHarness('web');
  crazy = await startHarness('crazygames');
});
after(async () => {
  await web.close();
  await crazy.close();
});

async function open(context: BrowserContext, url: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${url}?e2e=1`);
  await page.waitForFunction(() => document.documentElement.classList.contains('game-ready'), undefined, { timeout: 20_000 });
  return page;
}

/** Plays forward: lumens, a fleet and some depth, then saves. */
const PROGRESS = `(() => { const s = g.state; g.grant(1e9); g.host.buyGenerator(0, 40); s.depthStep = 12; s.maxStepEver = 12; s.stats.maxStepThisRun = 12; g.advance(30); g.save(); return true; })()`;

const stored = (page: Page, key = 'glowfathom.save'): Promise<string | null> => page.evaluate((k) => window.localStorage.getItem(k), key);
const depth = (page: Page): Promise<number> => game<number>(page, 'g.state.depthStep');
const toasts = (page: Page): Promise<string> => page.evaluate(() => [...document.querySelectorAll('[data-testid="toast"]')].map((node) => node.textContent ?? '').join(' | '));

test('a second tab cannot overwrite newer progress with its older copy', async () => {
  const context = await web.browser.newContext({ viewport: { width: 1280, height: 720 } });
  const first = await open(context, web.url);
  await game(first, '(g.grant(500), g.host.buyGenerator(0, 3), g.save(), true)');
  const second = await open(context, web.url);
  await game(second, PROGRESS);
  assert.equal(await depth(second), 12);
  await second.close();

  // The first tab is still open with its old state. Its next save must give way.
  assert.equal(await depth(first), 0);
  await game(first, '(g.save(), true)');
  assert.equal(await depth(first), 12, 'the older tab picked up the newer progress');
  assert.match(await toasts(first), /newer progress/i);
  await game(first, '(g.advance(2), g.save(), true)');
  const reopened = await open(context, web.url);
  assert.equal(await depth(reopened), 12, 'nothing was lost');
  assert.ok((await game<number>(reopened, 'g.state.generators[0]')) >= 40);
  await context.close();
});

test('the player is told when progress cannot be saved', async () => {
  const context = await web.browser.newContext({ viewport: { width: 1280, height: 720 } });
  // Make every write fail, as a full or blocked storage would.
  await context.addInitScript(() => {
    Storage.prototype.setItem = function setItem(): void {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    };
  });
  const page = await open(context, web.url);
  await game(page, '(g.grant(500), g.host.buyGenerator(0, 3), g.save(), true)');
  assert.match(await toasts(page), /cannot be saved/i);
  // The game itself carries on.
  const clock = await game<number>(page, 'g.state.clock');
  await page.waitForTimeout(300);
  assert.ok((await game<number>(page, 'g.state.clock')) > clock);
  await context.close();
});

test('a save that cannot be read is set aside, not overwritten', async () => {
  const context = await web.browser.newContext({ viewport: { width: 1280, height: 720 } });
  const fromTheFuture = JSON.stringify({ v: 99, t: Date.now(), c: 0, s: '{"lumens":123456}' });
  await context.addInitScript((value) => {
    if (!window.localStorage.getItem('glowfathom.save')) window.localStorage.setItem('glowfathom.save', value);
  }, fromTheFuture);
  const page = await open(context, web.url);
  assert.equal(await depth(page), 0, 'a new game starts');
  assert.equal(await stored(page, 'glowfathom.save.unreadable'), fromTheFuture, 'the unreadable save is kept');
  assert.match(await toasts(page), /could not be read/i);
  await game(page, '(g.save(), true)');
  assert.equal(await stored(page, 'glowfathom.save.unreadable'), fromTheFuture, 'and it survives later saves');
  await context.close();
});

test('the backup copy is refreshed at the start of every visit', async () => {
  const context = await web.browser.newContext({ viewport: { width: 1280, height: 720 } });
  const first = await open(context, web.url);
  await game(first, PROGRESS);
  await first.close();
  const second = await open(context, web.url);
  const backup = JSON.parse((await stored(second, 'glowfathom.save.backup')) ?? '{}') as { s?: string };
  assert.ok(backup.s, 'a backup exists after one short visit');
  assert.equal((JSON.parse(backup.s) as { depthStep: number }).depthStep, 12);
  // Damage the main copy: the next visit must come back at the backup, not at zero.
  await second.evaluate(() => window.localStorage.setItem('glowfathom.save', '{"cut short'));
  await second.close();
  const third = await context.newPage();
  await third.addInitScript(() => {});
  await third.goto(`${web.url}?e2e=1`);
  await third.waitForFunction(() => document.documentElement.classList.contains('game-ready'));
  assert.equal(await depth(third), 12);
  await context.close();
});

const SLOW_SDK = (delayMs: number, syncedSave: string | null): string => `
  window.__sdk = { calls: [] };
  window.CrazyGames = { SDK: {
    init: () => new Promise((resolve) => setTimeout(() => { window.__sdk.calls.push('init-done'); resolve(); }, ${delayMs})),
    game: { gameplayStart() {}, gameplayStop() {}, loadingStart() {}, loadingStop() {}, happytime() {}, settings: { muteAudio: false }, addSettingsChangeListener() {} },
    ad: { requestAd(type, callbacks) { setTimeout(() => callbacks.adError('No ad available'), 5); } },
    data: {
      store: { ${syncedSave ? `'glowfathom.save': ${JSON.stringify(syncedSave)}` : ''} },
      getItem(key) { return this.store[key] ?? null; },
      setItem(key, value) { window.__sdk.calls.push('data.set'); this.store[key] = value; },
      removeItem(key) { delete this.store[key]; },
    },
  } };
`;
const syncedDepth = (page: Page): Promise<number | null> =>
  page.evaluate(() => {
    const text = (window as unknown as { CrazyGames: { SDK: { data: { store: Record<string, string> } } } }).CrazyGames.SDK.data.store['glowfathom.save'];
    return text ? (JSON.parse((JSON.parse(text) as { s: string }).s) as { depthStep: number }).depthStep : null;
  });

test('a slow portal login cannot replace the synced save with a new game', async () => {
  // Make a real save to stand in for the one synced to the player's portal account.
  const seedContext = await web.browser.newContext();
  const seedPage = await open(seedContext, web.url);
  await game(seedPage, PROGRESS);
  const synced = await stored(seedPage);
  await seedContext.close();
  assert.ok(synced);

  // A fresh device: nothing local, and the SDK takes longer to start than the game will wait.
  const context = await crazy.browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  await page.route('**/crazygames-sdk-v3.js', (route) => route.fulfill({ contentType: 'text/javascript', body: SLOW_SDK(9_500, synced) }));
  await page.goto(`${crazy.url}?e2e=1`);
  await page.waitForFunction(() => document.documentElement.classList.contains('game-ready'), undefined, { timeout: 20_000 });
  assert.equal(await depth(page), 0, 'the game starts on local data while the SDK is still starting');
  await game(page, '(g.save(), true)');
  await page.waitForFunction(() => (window as unknown as { __sdk: { calls: string[] } }).__sdk.calls.includes('init-done'), undefined, { timeout: 15_000 });
  await page.waitForTimeout(200);
  assert.equal(await depth(page), 12, 'the synced save was picked up when the SDK finally started');
  await game(page, '(g.save(), true)');
  assert.equal(await syncedDepth(page), 12, 'and the synced copy still holds the real progress');
  await context.close();
});

test('newer local progress beats an older synced copy', async () => {
  const seedContext = await web.browser.newContext();
  const seedPage = await open(seedContext, web.url);
  await game(seedPage, '(g.grant(500), g.host.buyGenerator(0, 3), g.save(), true)');
  const olderSynced = await stored(seedPage);
  await seedPage.waitForTimeout(20);
  await game(seedPage, PROGRESS);
  const newerLocal = await stored(seedPage);
  await seedContext.close();
  assert.ok(olderSynced && newerLocal);

  const context = await crazy.browser.newContext({ viewport: { width: 1280, height: 720 } });
  await context.addInitScript((value) => {
    if (!window.localStorage.getItem('glowfathom.save')) window.localStorage.setItem('glowfathom.save', value);
  }, newerLocal);
  const page = await context.newPage();
  await page.route('**/crazygames-sdk-v3.js', (route) => route.fulfill({ contentType: 'text/javascript', body: SLOW_SDK(0, olderSynced) }));
  await page.goto(`${crazy.url}?e2e=1`);
  await page.waitForFunction(() => document.documentElement.classList.contains('game-ready'), undefined, { timeout: 20_000 });
  assert.equal(await depth(page), 12, 'the game opens on the newer of the two copies');
  await context.close();
});

test('no advert is requested before the player has touched the game', async () => {
  // A returning player whose saved game crosses into a new zone the moment it loads.
  const seedContext = await web.browser.newContext();
  const seedPage = await open(seedContext, web.url);
  await game(seedPage, `(() => { const s = g.state; s.depthStep = 19; s.maxStepEver = 19; s.stats.maxStepThisRun = 19; s.hullZone = 1; s.survey = 1e30; s.stats.playSeconds = 5000; s.institute.autopilot = 1; g.save(); return true; })()`);
  const saved = await stored(seedPage);
  await seedContext.close();
  assert.ok(saved);

  const context = await crazy.browser.newContext({ viewport: { width: 1280, height: 720 } });
  await context.addInitScript((value) => {
    if (!window.localStorage.getItem('glowfathom.save')) window.localStorage.setItem('glowfathom.save', value);
  }, saved);
  const page = await context.newPage();
  await page.route('**/crazygames-sdk-v3.js', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `
        window.__sdk = { calls: [] };
        const note = (name) => () => { window.__sdk.calls.push(name); };
        window.CrazyGames = { SDK: {
          init: async () => {},
          game: { gameplayStart: note('gameplayStart'), gameplayStop: note('gameplayStop'), loadingStart() {}, loadingStop() {}, happytime() {}, settings: { muteAudio: false }, addSettingsChangeListener() {} },
          ad: { requestAd(type, callbacks) { window.__sdk.calls.push('ad:' + type); callbacks.adStarted(); setTimeout(() => callbacks.adFinished(), 30); } },
          data: { getItem() { return null; }, setItem() {}, removeItem() {} },
        } };`,
    }),
  );
  await page.goto(`${crazy.url}?e2e=1`);
  await page.waitForFunction(() => document.documentElement.classList.contains('game-ready'), undefined, { timeout: 20_000 });
  await page.waitForTimeout(1200);
  assert.ok((await depth(page)) >= 20, 'autopilot crossed into the next zone by itself');
  const calls = await page.evaluate(() => (window as unknown as { __sdk: { calls: string[] } }).__sdk.calls.slice());
  assert.deepEqual(calls.filter((call) => call.startsWith('ad:')), [], 'no advert without a gesture');
  assert.ok(!calls.includes('gameplayStart'), 'and play is not reported as started');
  await context.close();
});
