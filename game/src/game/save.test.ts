import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TOTAL_STEPS } from './content.ts';
import { BACKUP_KEY, SAVE_KEY, clearSaves, deserialize, exportCode, importCode, loadGame, sanitize, saveGame, serialize, type SaveStorage } from './save.ts';
import { createState } from './state.ts';

function memoryStorage(): SaveStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get: (key) => data.get(key) ?? null,
    set: (key, value) => {
      data.set(key, value);
      return true;
    },
    remove: (key) => {
      data.delete(key);
    },
  };
}

function played() {
  const state = createState(4242, 1_000);
  state.lumens = 1.5e9;
  state.runLumens = 2e9;
  state.lifetimeLumens = 7e9;
  state.depthStep = 37;
  state.maxStepEver = 60;
  state.hullZone = 1;
  state.survey = 12345.5;
  state.generators[0] = 80;
  state.generators[4] = 12;
  state.research['scan1'] = true;
  state.research['glob1'] = true;
  state.codex['z0s0'] = 300;
  state.codex['z1s8'] = 2;
  state.renown = 14;
  state.renownTotal = 40;
  state.prestiges = 2;
  state.institute['grant'] = 3;
  state.achievements['depth0'] = true;
  state.stats.taps = 5000;
  state.stats.scans = 3100;
  state.stats.maxStepThisRun = 37;
  state.clock = 9000;
  state.sonarUntil = 9100;
  state.nextShoalAt = 9050;
  state.tutorial = 4;
  state.dailyDay = 20_500;
  state.dailyStreak = 3;
  state.settings.music = false;
  state.settings.scientific = true;
  return state;
}

test('a save round-trips exactly', () => {
  const state = played();
  const restored = deserialize(serialize(state, 5_000), 6_000)!;
  assert.deepEqual(restored, { ...state, lastSeen: 5_000 });
});

test('a damaged or foreign save is refused', () => {
  const text = serialize(played(), 5_000);
  assert.equal(deserialize(null, 1), null);
  assert.equal(deserialize('', 1), null);
  assert.equal(deserialize('not json', 1), null);
  assert.equal(deserialize('{"hello":"world"}', 1), null);
  assert.equal(deserialize(text.replace('1500000000', '9500000000'), 1), null, 'an edited body fails its checksum');
  const fromTheFuture = JSON.parse(text) as { v: number };
  fromTheFuture.v = 999;
  assert.equal(deserialize(JSON.stringify(fromTheFuture), 1), null);
});

test('nonsense values are replaced with safe ones', () => {
  const state = sanitize(
    {
      seed: -5,
      lumens: Number.NaN,
      runLumens: 'lots',
      lifetimeLumens: -100,
      depthStep: 5000,
      maxStepEver: 3,
      hullZone: 0,
      survey: Number.POSITIVE_INFINITY,
      generators: [1.9, -4, 'x', 1e12],
      research: { scan1: true, madeUp: true, glob1: 'yes' },
      codex: { z0s0: 12.7, z9s9: 50, z0s1: -3 },
      renown: 50,
      renownTotal: 5,
      prestiges: -1,
      institute: { grant: 2.6, autopilot: 40, madeUp: 9 },
      achievements: { depth0: true, cheat: true },
      stats: { taps: -9, scans: 1e400, maxStepThisRun: 2 },
      sonarUntil: 1e15,
      lastSeen: 9e15,
      tutorial: 'done',
      finished: 'yes',
      dailyStreak: -2,
      settings: { music: 0, sfx: false },
    },
    1_000_000,
  );
  assert.ok(state.seed >= 1);
  assert.equal(state.lumens, 0);
  assert.equal(state.runLumens, 0);
  assert.equal(state.lifetimeLumens, 0);
  assert.equal(state.depthStep, TOTAL_STEPS);
  assert.equal(state.maxStepEver, TOTAL_STEPS, 'the deepest dive ever covers the current depth');
  assert.equal(state.hullZone, 4, 'the hull covers wherever the sub is');
  assert.equal(state.survey, 0);
  assert.equal(state.generators.length, 12);
  assert.deepEqual(state.generators.slice(0, 4), [1, 0, 0, 1e6]);
  assert.deepEqual(state.research, { scan1: true });
  assert.deepEqual(state.codex, { z0s0: 12 });
  assert.equal(state.renownTotal, 50);
  assert.equal(state.prestiges, 0);
  assert.deepEqual(state.institute, { grant: 2, autopilot: 1 });
  assert.deepEqual(state.achievements, { depth0: true });
  assert.equal(state.stats.taps, 0);
  assert.equal(state.stats.scans, 0);
  assert.equal(state.stats.maxStepThisRun, TOTAL_STEPS);
  assert.ok(state.sonarUntil <= state.clock + 3600);
  assert.equal(state.lastSeen, 1_000_000, 'a clock from the future cannot bank offline income');
  assert.equal(state.tutorial, 0);
  assert.equal(state.finished, true, 'the floor was reached');
  assert.equal(state.dailyStreak, 0);
  assert.deepEqual(state.settings, { music: true, sfx: false, scientific: false, reducedMotion: false });
  for (const value of [state.lumens, state.clock, state.survey, state.renown, state.nextShoalAt]) assert.ok(Number.isFinite(value));
});

test('anything at all sanitises to a playable state', () => {
  for (const junk of [null, undefined, 42, 'text', [], [1, 2, 3], { generators: 'none', stats: 5, settings: [] }]) {
    const state = sanitize(junk, 10);
    assert.equal(state.depthStep, 0);
    assert.equal(state.generators.length, 12);
    assert.equal(state.lumens, 0);
  }
});

test('export codes carry a whole save and reject anything else', () => {
  const state = played();
  const code = exportCode(state, 5_000);
  assert.match(code, /^GF1\.[A-Za-z0-9+/=]+$/);
  assert.deepEqual(importCode(`  ${code}\n`, 6_000), { ...state, lastSeen: 5_000 });
  assert.equal(importCode('', 1), null);
  assert.equal(importCode('GF1.', 1), null);
  assert.equal(importCode('GF1.!!!not-base64!!!', 1), null);
  assert.equal(importCode(code.slice(0, -12), 1), null);
  assert.equal(importCode(code.replace('GF1.', 'XX9.'), 1), null);
});

test('loading falls back to the backup when the main save is damaged', () => {
  const storage = memoryStorage();
  assert.equal(loadGame(storage, 1), null);
  const state = played();
  for (let i = 0; i < 8; i++) saveGame(storage, state, 5_000 + i);
  assert.ok(storage.data.has(SAVE_KEY));
  assert.ok(storage.data.has(BACKUP_KEY), 'a backup is written every few saves');
  assert.equal(loadGame(storage, 9_000)!.lumens, state.lumens);
  storage.data.set(SAVE_KEY, '{"broken":');
  assert.equal(loadGame(storage, 9_000)!.lumens, state.lumens);
  clearSaves(storage);
  assert.equal(loadGame(storage, 9_000), null);
});
