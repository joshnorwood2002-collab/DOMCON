// Plays the game through its real buttons, the way a person would, on a
// desktop-sized window and on a phone. The other browser tests reach into the
// game through its test hook; these make sure the controls themselves work.

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { devices, type Page } from 'playwright';
import { game, openGame, startHarness, tapCreature, type Harness } from './helpers.ts';

let harness: Harness;
before(async () => {
  harness = await startHarness('web');
});
after(async () => {
  await harness.close();
});

const hook = (id: string): string => `[data-testid="${id}"]`;
const text = async (page: Page, id: string): Promise<string> => ((await page.textContent(hook(id))) ?? '').trim();

test('a new player can scan, buy, research, dive and manage a save with the buttons alone', async () => {
  const { page, errors } = await openGame(harness);
  page.setDefaultTimeout(8000);

  // Scan creatures until the first buoy is affordable.
  for (let attempt = 0; attempt < 150 && (await game<number>(page, 'g.state.lumens')) < 12; attempt++) {
    await tapCreature(page);
    await page.waitForTimeout(60);
  }
  assert.ok((await game<number>(page, 'g.state.lumens')) >= 12, 'tapping alone earns the first buoy');
  await page.click(hook('gen-0-buy'));
  assert.equal(await game<number>(page, 'g.state.generators[0]'), 1, 'the buy button buys a buoy');
  await page.waitForFunction(`document.querySelector('${hook('rate-value')}').textContent.trim() !== '+0/s'`);

  // Ten at a time.
  await game(page, 'g.grant(20000)');
  await page.click(hook('buy-amount-10'));
  await page.click(hook('gen-0-buy'));
  assert.equal(await game<number>(page, 'g.state.generators[0]'), 11, 'x10 buys ten');

  // Research.
  await page.click(hook('tab-research'));
  await page.click(hook('research-scan1-buy'));
  assert.equal(await game<boolean>(page, 'Boolean(g.state.research.scan1)'), true, 'the research button researches');

  // Dive: the grant above filled the survey, so the button is live.
  await page.click(hook('dive-button'));
  assert.equal(await game<number>(page, 'g.state.depthStep'), 1);
  await page.waitForFunction(`document.querySelector('${hook('depth-value')}').textContent.trim() === '10 m'`);

  // Settings: a switch, then a round trip through export and import.
  await page.click(hook('settings-button'));
  await page.click(hook('setting-music'));
  assert.equal(await game<boolean>(page, 'g.state.settings.music'), false, 'the music switch switches');
  await page.click(hook('export-button'));
  const code = await page.inputValue(hook('export-code'));
  assert.match(code, /^GF1\./, 'export shows a save code');
  const exported = await game<{ lumens: number; buoys: number }>(page, '({ lumens: g.state.lumens, buoys: g.state.generators[0] })');

  await page.fill(hook('import-input'), 'not a save');
  await page.click(hook('import-button'));
  assert.match(await text(page, 'import-message'), /not a valid save code/, 'a bad code is refused with a reason');

  await game(page, 'g.grant(1e9)');
  await page.fill(hook('import-input'), code);
  await page.click(hook('import-button'));
  await page.waitForSelector(hook('dialog'), { state: 'hidden' });
  const imported = await game<{ lumens: number; buoys: number; music: boolean }>(page, '({ lumens: g.state.lumens, buoys: g.state.generators[0], music: g.state.settings.music })');
  assert.equal(imported.buoys, exported.buoys);
  assert.ok(imported.lumens < 1e8, 'importing replaced the richer game');
  assert.equal(imported.music, false, 'settings travel with the save');

  // Reset needs a second, separate press, and backing out changes nothing.
  await page.click(hook('settings-button'));
  await page.click(hook('reset-button'));
  await page.click(hook('reset-cancel'));
  assert.equal(await game<number>(page, 'g.state.generators[0]'), 11, 'backing out of a reset keeps the game');
  await page.click(hook('reset-button'));
  await page.click(hook('reset-confirm'));
  await page.waitForSelector(hook('dialog'), { state: 'hidden' });
  assert.equal(await game<number>(page, 'g.state.generators[0]'), 0, 'reset starts again');
  assert.equal(await game<number>(page, 'g.state.depthStep'), 0);

  assert.deepEqual(errors, []);
  await page.context().close();
});

test('publishing asks first, pays Renown, and the Institute spends it', async () => {
  const { page, errors } = await openGame(harness);
  page.setDefaultTimeout(8000);
  // Down to the depth where publishing opens, through the same calls the buttons make.
  await page.evaluate(`(() => {
    const g = window.__glowfathom;
    for (let i = 0; i < 80 && g.state.depthStep < 30; i++) {
      g.grant(1e40);
      g.host.buyHull();
      g.host.dive();
    }
    g.advance(1);
  })()`);
  assert.ok((await game<number>(page, 'g.state.depthStep')) >= 28, 'deep enough to publish');
  // Arriving in a new zone opens an introduction; dismiss whatever is showing.
  for (let i = 0; i < 6 && (await page.locator(hook('dialog')).isVisible()); i++) {
    await page.click(hook('dialog-close'));
    await page.waitForTimeout(350);
  }
  assert.equal(await page.locator(hook('dialog')).isVisible(), false, 'every announcement can be closed');

  await page.click(hook('tab-institute'));
  await page.click(hook('publish-button'));
  await page.click(hook('publish-cancel'));
  await page.waitForSelector(hook('dialog'), { state: 'hidden' });
  assert.equal(await game<number>(page, 'g.state.prestiges'), 0, 'backing out publishes nothing');

  await page.click(hook('publish-button'));
  await page.click(hook('publish-confirm'));
  await page.click(hook('published-continue'));
  await page.waitForSelector(hook('dialog'), { state: 'hidden' });
  const after = await game<{ prestiges: number; depthStep: number; renown: number }>(page, '({ prestiges: g.state.prestiges, depthStep: g.state.depthStep, renown: g.state.renown })');
  assert.equal(after.prestiges, 1);
  assert.equal(after.depthStep, 0, 'the expedition starts again at the surface');
  assert.ok(after.renown >= 4, `publishing paid Renown (${after.renown})`);

  await page.click(hook('institute-grant-buy'));
  assert.equal(await game<number>(page, 'g.state.institute.grant'), 1, 'Renown buys a permanent upgrade');
  assert.ok((await game<number>(page, 'g.state.renown')) < after.renown);

  assert.deepEqual(errors, []);
  await page.context().close();
});

for (const [label, device] of [
  ['an upright phone', devices['iPhone 13']],
  ['a small upright phone', devices['iPhone SE']],
  ['a phone on its side', devices['iPhone 13 landscape']],
] as const) {
  test(`${label}: nothing spills off the screen and the main controls work by touch`, async () => {
    const { page, errors } = await openGame(harness, { ...device });
    page.setDefaultTimeout(8000);
    // The title card clears on the first touch or after a moment.
    await page.waitForTimeout(600);

    let scanned = 0;
    for (let attempt = 0; attempt < 80 && scanned < 3; attempt++) {
      const point = await page.evaluate(() => {
        const g = (window as unknown as { __glowfathom: { session: { scene(): { width: number; height: number; creatures: { x: number; y: number; kind: string; fleeing: boolean; alpha: number }[] } } } }).__glowfathom;
        const scene = g.session.scene();
        const rect = (document.querySelector('canvas') as HTMLCanvasElement).getBoundingClientRect();
        const target = scene.creatures.find((creature) => creature.kind === 'normal' && !creature.fleeing && creature.alpha > 0.5 && creature.x > 30 && creature.x < scene.width - 30 && creature.y > 30 && creature.y < scene.height - 30);
        return target ? { x: rect.left + target.x, y: rect.top + target.y } : null;
      });
      if (point) await page.touchscreen.tap(point.x, point.y);
      await page.waitForTimeout(70);
      scanned = await game<number>(page, 'g.state.stats.scans');
    }
    assert.ok(scanned >= 3, `creatures can be scanned by touch (${scanned})`);

    await game(page, 'g.grant(5000)');
    await page.locator(hook('gen-0-buy')).tap();
    assert.equal(await game<number>(page, 'g.state.generators[0]'), 1, 'the buy button works by touch');
    await page.locator(hook('dive-button')).tap();
    assert.equal(await game<number>(page, 'g.state.depthStep'), 1, 'the dive button works by touch');

    for (const tab of ['research', 'codex', 'institute', 'goals', 'fleet']) {
      await page.locator(hook(`tab-${tab}`)).tap();
      assert.equal(await page.getAttribute(hook(`tab-${tab}`), 'aria-selected'), 'true', `${tab} tab opens`);
    }

    const layout = await page.evaluate(() => {
      const tooSmall: string[] = [];
      for (const id of ['settings-button', 'dive-button', 'gen-0-buy', 'tab-fleet', 'tab-research', 'tab-codex', 'tab-institute', 'tab-goals']) {
        const rect = (document.querySelector(`[data-testid="${id}"]`) as HTMLElement).getBoundingClientRect();
        if (rect.width < 40 || rect.height < 40) tooSmall.push(`${id} ${Math.round(rect.width)}x${Math.round(rect.height)}`);
      }
      const root = document.documentElement;
      return { tooSmall, wide: root.scrollWidth > window.innerWidth, tall: root.scrollHeight > window.innerHeight };
    });
    assert.deepEqual(layout.tooSmall, [], 'every main control is big enough for a thumb');
    assert.equal(layout.wide, false, 'the page never scrolls sideways');
    assert.equal(layout.tall, false, 'the page itself never scrolls; only the lists do');

    // The settings dialog fits, and its Done button can be reached.
    await page.locator(hook('settings-button')).tap();
    const done = await page.locator(hook('settings-done')).boundingBox();
    const viewport = page.viewportSize();
    assert.ok(done && viewport && done.y + done.height <= viewport.height && done.y >= 0, 'the dialog fits on the screen');
    await page.locator(hook('settings-done')).tap();
    await page.waitForSelector(hook('dialog'), { state: 'hidden' });

    assert.deepEqual(errors, []);
    await page.context().close();
  });
}
