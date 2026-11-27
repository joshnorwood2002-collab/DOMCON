// The portal builds talk to third-party SDKs that cannot be loaded in tests.
// These tests swap each SDK for a small stand-in and check the contract that
// matters: the game starts with or without the SDK, pauses for adverts, pays
// rewards only for adverts watched to the end, and can never be left frozen.

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Page } from 'playwright';
import { game, startHarness, type Harness } from './helpers.ts';

const CRAZY_STUB = `
  window.__sdk = { calls: [], adMode: 'finish' };
  window.CrazyGames = { SDK: {
    init: async () => { window.__sdk.calls.push('init'); },
    game: {
      gameplayStart() { window.__sdk.calls.push('gameplayStart'); },
      gameplayStop() { window.__sdk.calls.push('gameplayStop'); },
      loadingStart() { window.__sdk.calls.push('loadingStart'); },
      loadingStop() { window.__sdk.calls.push('loadingStop'); },
      happytime() { window.__sdk.calls.push('happytime'); },
      settings: { muteAudio: false },
      addSettingsChangeListener() {},
    },
    ad: {
      requestAd(type, callbacks) {
        window.__sdk.calls.push('ad:' + type);
        if (window.__sdk.adMode === 'finish') { callbacks.adStarted(); setTimeout(() => callbacks.adFinished(), 60); }
        else if (window.__sdk.adMode === 'error') { setTimeout(() => callbacks.adError('No ad available'), 10); }
      },
    },
    data: {
      store: {},
      getItem(key) { return this.store[key] ?? null; },
      setItem(key, value) { window.__sdk.calls.push('data.set'); this.store[key] = value; },
      removeItem(key) { delete this.store[key]; },
    },
  } };
`;

const GD_STUB = `
  window.__sdk = { calls: [], adMode: 'finish' };
  const fire = (name) => window.GD_OPTIONS.onEvent({ name });
  window.gdsdk = {
    AdType: { Interstitial: 'interstitial', Rewarded: 'rewarded', Display: 'display' },
    showAd(type) {
      window.__sdk.calls.push('ad:' + (type || 'interstitial'));
      if (window.__sdk.adMode === 'hang') return new Promise(() => {});
      return new Promise((resolve) => {
        fire('SDK_GAME_PAUSE');
        fire('IMPRESSION');
        setTimeout(() => { if (type === 'rewarded') fire('SDK_REWARDED_WATCH_COMPLETE'); fire('SDK_GAME_START'); resolve(); }, 60);
      });
    },
  };
  setTimeout(() => fire('SDK_READY'), 20);
`;

const calls = (page: Page): Promise<string[]> => page.evaluate(() => (window as unknown as { __sdk: { calls: string[] } }).__sdk.calls.slice());
const setAdMode = (page: Page, mode: string): Promise<void> =>
  page.evaluate((value) => {
    (window as unknown as { __sdk: { adMode: string } }).__sdk.adMode = value;
  }, mode);
const sonarActive = (page: Page): Promise<boolean> => game<boolean>(page, 'g.state.sonarUntil > g.state.clock');

/** Makes Sonar Burst available and idle, as if it had never been used. */
async function readySonar(page: Page): Promise<void> {
  await game(page, '(g.state.maxStepEver = Math.max(g.state.maxStepEver, 5), g.state.sonarUntil = 0, g.state.sonarReadyAt = 0, true)');
}

let crazy: Harness;
let distribution: Harness;
before(async () => {
  crazy = await startHarness('crazygames');
  process.env['GF_GD_GAME_ID'] = 'test-game-id';
  distribution = await startHarness('gamedistribution');
});
after(async () => {
  await crazy.close();
  await distribution.close();
});

test('CrazyGames build: SDK lifecycle, rewarded adverts, interstitials and saves', async () => {
  const context = await crazy.browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.route('**/crazygames-sdk-v3.js', (route) => route.fulfill({ contentType: 'text/javascript', body: CRAZY_STUB }));
  await page.goto(`${crazy.url}?e2e=1`);
  await page.waitForFunction(() => document.documentElement.classList.contains('game-ready'));

  const boot = await calls(page);
  assert.deepEqual(boot.slice(0, 3), ['init', 'loadingStart', 'loadingStop'], 'the SDK is started before anything else is reported');
  assert.equal(await game<boolean>(page, 'g.host.hasAds'), true);

  // The first input reports that play has begun.
  await page.mouse.click(640, 300);
  assert.ok((await calls(page)).includes('gameplayStart'));

  // A rewarded advert watched to the end starts the boost, with play paused around it.
  await readySonar(page);
  await game(page, '(g.host.startSonar(), true)');
  await page.waitForFunction(() => {
    const g = (window as unknown as { __glowfathom: { state: { sonarUntil: number; clock: number } } }).__glowfathom;
    return g.state.sonarUntil > g.state.clock;
  });
  const afterAd = await calls(page);
  const adAt = afterAd.indexOf('ad:rewarded');
  assert.ok(adAt > 0, 'a rewarded advert was requested');
  assert.equal(afterAd[adAt - 1], 'gameplayStop');
  assert.equal(afterAd[adAt + 1], 'gameplayStart');

  // No advert available: the boost is still granted when it has recharged, and refused when it has not.
  await setAdMode(page, 'error');
  await readySonar(page);
  await game(page, '(g.host.startSonar(), true)');
  await page.waitForTimeout(150);
  assert.equal(await sonarActive(page), true, 'falls back to the free boost');
  await game(page, '(g.state.sonarUntil = 0, g.state.sonarReadyAt = g.state.clock + 999, true)');
  await game(page, '(g.host.startSonar(), true)');
  await page.waitForTimeout(150);
  assert.equal(await sonarActive(page), false, 'no advert and not recharged means no boost');

  // An advert that never reports back must not freeze the game for good... the adapter's watchdog covers that;
  // here we check the game is still advancing after the error path.
  const clockBefore = await game<number>(page, 'g.state.clock');
  await page.waitForTimeout(400);
  assert.ok((await game<number>(page, 'g.state.clock')) > clockBefore, 'the game keeps running');

  // Entering a new zone is a natural break: celebrate, and show an interstitial once enough time has been played
  // in this visit (adverts are held back for the first two minutes of every visit).
  await setAdMode(page, 'finish');
  await game(page, '(g.advance(130), true)');
  await game(page, `(() => { const s = g.state; s.depthStep = 19; s.maxStepEver = 19; s.stats.maxStepThisRun = 19; s.hullZone = 1; s.survey = 1e30; s.stats.playSeconds = 5000; g.host.dive(); return true; })()`);
  await page.waitForTimeout(250);
  const afterZone = await calls(page);
  assert.equal(await game<number>(page, 'g.state.depthStep'), 20);
  assert.ok(afterZone.includes('happytime'));
  assert.ok(afterZone.includes('ad:midgame'));

  // A second zone entry straight afterwards must not show another advert so soon.
  const midgameCount = afterZone.filter((call) => call === 'ad:midgame').length;
  await game(page, `(() => { const s = g.state; s.depthStep = 51; s.maxStepEver = 51; s.stats.maxStepThisRun = 51; s.hullZone = 2; s.survey = 1e60; g.host.dive(); return true; })()`);
  await page.waitForTimeout(250);
  assert.equal((await calls(page)).filter((call) => call === 'ad:midgame').length, midgameCount, 'interstitials are spaced out');

  // Saves go to the portal's storage and to localStorage, so progress survives even if the SDK is blocked next time.
  await game(page, '(g.save(), true)');
  assert.ok((await calls(page)).includes('data.set'));
  await page.unroute('**/crazygames-sdk-v3.js');
  await page.route('**/crazygames-sdk-v3.js', (route) => route.abort());
  await page.reload();
  await page.waitForFunction(() => document.documentElement.classList.contains('game-ready'));
  assert.equal(await game<number>(page, 'g.state.depthStep'), 52, 'progress survives a reload with the SDK blocked');
  assert.equal(await game<boolean>(page, 'g.host.hasAds'), false);
  await readySonar(page);
  await game(page, '(g.host.startSonar(), true)');
  assert.equal(await sonarActive(page), true, 'boosts are simply free when adverts are unavailable');
  assert.deepEqual(errors, []);
  await context.close();
});

test('CrazyGames build: an advert that never answers is treated as busy, not as a freeze', async () => {
  const context = await crazy.browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  await page.route('**/crazygames-sdk-v3.js', (route) => route.fulfill({ contentType: 'text/javascript', body: CRAZY_STUB }));
  await page.goto(`${crazy.url}?e2e=1`);
  await page.waitForFunction(() => document.documentElement.classList.contains('game-ready'));
  await setAdMode(page, 'hang');
  await readySonar(page);
  await game(page, '(g.host.startSonar(), true)');
  await page.waitForTimeout(300);
  // The advert has not started, so the simulation must still be running underneath.
  const clockBefore = await game<number>(page, 'g.state.clock');
  await page.waitForTimeout(400);
  assert.ok((await game<number>(page, 'g.state.clock')) > clockBefore);
  assert.equal(await sonarActive(page), false, 'no reward without a finished advert');
  await context.close();
});

test('GameDistribution build: adverts pause play, rewards need a completed view', async () => {
  const context = await distribution.browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.route('**/main.min.js', (route) => route.fulfill({ contentType: 'text/javascript', body: GD_STUB }));
  await page.goto(`${distribution.url}?e2e=1`);
  await page.waitForFunction(() => document.documentElement.classList.contains('game-ready'));
  assert.equal(await page.evaluate(() => (window as unknown as { GD_OPTIONS: { gameId: string } }).GD_OPTIONS.gameId), 'test-game-id');
  assert.equal(await game<boolean>(page, 'g.host.hasAds'), true);

  await readySonar(page);
  await game(page, '(g.host.startSonar(), true)');
  await page.waitForFunction(() => {
    const g = (window as unknown as { __glowfathom: { state: { sonarUntil: number; clock: number } } }).__glowfathom;
    return g.state.sonarUntil > g.state.clock;
  });
  assert.ok((await calls(page)).includes('ad:rewarded'));

  // After the advert the game must be running again.
  const clockBefore = await game<number>(page, 'g.state.clock');
  await page.waitForTimeout(400);
  assert.ok((await game<number>(page, 'g.state.clock')) > clockBefore);
  assert.deepEqual(errors, []);
  await context.close();
});

test('portal builds make no request beyond their own SDK and carry no outbound links', async () => {
  for (const [harness, allowed] of [
    [crazy, 'sdk.crazygames.com'],
    [distribution, 'html5.api.gamedistribution.com'],
  ] as const) {
    const context = await harness.browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    const outside: string[] = [];
    page.on('request', (request) => {
      const url = request.url();
      if (!url.startsWith(harness.url) && !url.startsWith('data:') && !url.startsWith('blob:')) outside.push(url);
    });
    await page.route((url) => !url.href.startsWith(harness.url), (route) => route.abort());
    await page.goto(`${harness.url}?e2e=1`);
    await page.waitForFunction(() => document.documentElement.classList.contains('game-ready'), undefined, { timeout: 20_000 });
    assert.ok(outside.length <= 1 && outside.every((url) => url.includes(allowed)), `unexpected requests: ${outside.join(', ')}`);
    assert.equal(await game<string>(page, 'g.host.tipUrl'), '', 'no tip link in a portal build');
    assert.equal(await page.locator('a[href^="http"]').count(), 0, 'no outbound links anywhere on the page');
    await context.close();
  }
});
