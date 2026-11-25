import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { game, openGame, startHarness, tapCreature, type Harness } from './helpers.ts';

let harness: Harness;
before(async () => {
  harness = await startHarness('web');
});
after(async () => {
  await harness.close();
});

test('the game boots, creatures can be scanned, and progress survives a reload', async () => {
  const { page, errors, externalRequests } = await openGame(harness);
  assert.ok((await game<number>(page, 'g.session.population')) >= 4, 'the water is populated on the first frame');

  let scans = 0;
  for (let attempt = 0; attempt < 60 && scans < 6; attempt++) {
    if (await tapCreature(page)) scans = await game<number>(page, 'g.state.stats.scans');
    await page.waitForTimeout(80);
  }
  assert.ok(scans >= 6, `expected at least 6 scans, got ${scans}`);
  assert.ok((await game<number>(page, 'g.state.lumens')) > 0, 'scanning earns lumens');

  // Enough lumens for a few buoys, bought through the same path the interface uses.
  await game(page, 'g.grant(500)');
  await game(page, 'g.host.buyGenerator(0, 3)');
  assert.equal(await game<number>(page, 'g.state.generators[0]'), 3);

  await game(page, 'g.save()');
  const before = await game<{ lumens: number; scans: number }>(page, '({ lumens: g.state.lumens, scans: g.state.stats.scans })');
  await page.reload();
  await page.waitForFunction(() => document.documentElement.classList.contains('game-ready'));
  assert.equal(await game<number>(page, 'g.state.generators[0]'), 3, 'fleet survives a reload');
  assert.equal(await game<number>(page, 'g.state.stats.scans'), before.scans, 'scan count survives a reload');
  assert.ok((await game<number>(page, 'g.state.lumens')) >= before.lumens - 1, 'lumens survive a reload');

  assert.deepEqual(errors, [], 'no console errors');
  assert.deepEqual(externalRequests, [], 'the web build makes no outside requests');
});
