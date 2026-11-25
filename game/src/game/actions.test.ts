import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyOffline,
  buyGenerator,
  buyHull,
  buyInstitute,
  buyResearch,
  checkAchievements,
  claimDaily,
  completeScan,
  completeShoalScan,
  currentZone,
  dive,
  earn,
  publish,
  registerTap,
  resetExpedition,
  runAutomation,
  scheduleNextShoal,
  sonarReady,
  sonarUnlocked,
  startSonar,
  tick,
} from './actions.ts';
import { ACHIEVEMENTS, GENERATORS, TOTAL_STEPS } from './content.ts';
import {
  FRENZY_CATCHES,
  PRESTIGE_MIN_STEP,
  SHOAL_INTERVAL,
  SONAR_COOLDOWN,
  SONAR_SECONDS,
  SONAR_UNLOCK_STEP,
  canPublish,
  frenzyActive,
  generatorCost,
  getModifiers,
  hullCost,
  invalidateModifiers,
  passiveRate,
  renownOnPublish,
  scanReward,
  sonarActive,
  speciesStudyLevel,
  surveyTarget,
  tapValue,
} from './economy.ts';
import { createState, type GameState } from './state.ts';

/** Puts the sub at a dive index with the hull and history that implies. */
function at(step: number, state: GameState = createState(1)): GameState {
  state.depthStep = step;
  state.maxStepEver = Math.max(state.maxStepEver, step);
  state.stats.maxStepThisRun = Math.max(state.stats.maxStepThisRun, step);
  state.hullZone = currentZone(state);
  return state;
}

test('earning counts towards the balance, the totals and the survey', () => {
  const state = createState(1);
  earn(state, 50);
  earn(state, -5);
  earn(state, Number.NaN);
  earn(state, Number.POSITIVE_INFINITY);
  assert.equal(state.lumens, 50);
  assert.equal(state.runLumens, 50);
  assert.equal(state.lifetimeLumens, 50);
  assert.equal(state.survey, 50);
});

test('time passing pays the fleet and advances the clocks', () => {
  const state = createState(1);
  state.generators[0] = 10;
  const rate = passiveRate(state);
  tick(state, 2);
  assert.ok(Math.abs(state.lumens - rate * 2) < 1e-9);
  assert.equal(state.clock, 2);
  assert.equal(state.stats.playSeconds, 2);
  assert.equal(state.stats.runSeconds, 2);
  tick(state, 0);
  tick(state, -3);
  assert.equal(state.clock, 2);
});

test('fleet units are bought only when unlocked and affordable', () => {
  const state = createState(1);
  assert.equal(buyGenerator(state, 0), 0, 'no lumens yet');
  state.lumens = 100;
  assert.equal(buyGenerator(state, 1), 0, 'the Scout Drone is still locked');
  assert.equal(buyGenerator(state, 0, 3), 3);
  assert.equal(state.generators[0], 3);
  assert.ok(state.lumens < 100 && state.lumens >= 0);
  const left = state.lumens;
  assert.equal(buyGenerator(state, 0, 1000), buyGeneratorCount(left), 'asking for too many buys as many as can be paid for');
  assert.ok(state.lumens >= 0);
  function buyGeneratorCount(lumens: number): number {
    const probe = createState(1);
    probe.generators[0] = 3;
    probe.lumens = lumens;
    let count = 0;
    while (generatorCost(probe, 0, count + 1) <= lumens) count++;
    return count;
  }
});

test('research is bought once, when visible and affordable', () => {
  const state = createState(1);
  assert.equal(buyResearch(state, 'scan1'), false);
  state.lumens = 1000;
  assert.equal(buyResearch(state, 'glob1'), false, 'not visible before 60 m');
  assert.equal(buyResearch(state, 'nonsense'), false);
  assert.equal(buyResearch(state, 'scan1'), true);
  assert.equal(state.lumens, 940);
  assert.equal(getModifiers(state).tapMult, 2, 'the effect applies at once');
  assert.equal(buyResearch(state, 'scan1'), false, 'cannot be bought twice');
});

test('diving is free once the survey is done, and spare progress carries over', () => {
  const state = createState(1);
  assert.deepEqual(dive(state), { ok: false, reason: 'survey' });
  const first = surveyTarget(state);
  earn(state, first + 40);
  const lumensBefore = state.lumens;
  const result = dive(state);
  assert.deepEqual(result, { ok: true, enteredZone: null, reachedFloor: false });
  assert.equal(state.depthStep, 1);
  assert.equal(state.lumens, lumensBefore, 'a dive costs nothing');
  assert.equal(state.survey, 40);
  assert.equal(state.maxStepEver, 1);
  assert.equal(state.stats.maxStepThisRun, 1);
});

test('a zone boundary needs a hull, which needs lumens and sometimes a blueprint', () => {
  const state = at(19);
  state.survey = surveyTarget(state);
  assert.deepEqual(dive(state), { ok: false, reason: 'hull' });
  assert.deepEqual(buyHull(state), { ok: false, reason: 'lumens' });
  state.lumens = hullCost(state, 1);
  assert.deepEqual(buyHull(state), { ok: true, zone: 1 });
  assert.equal(state.lumens, 0);
  assert.deepEqual(buyHull(state), { ok: false, reason: 'none' });
  assert.deepEqual(dive(state), { ok: true, enteredZone: 1, reachedFloor: false });
  assert.equal(currentZone(state), 1);

  const deep = at(91);
  deep.lumens = hullCost(deep, 3) * 2;
  assert.deepEqual(buyHull(deep), { ok: false, reason: 'blueprint' });
  deep.renown = 100;
  assert.equal(buyInstitute(deep, 'titanium'), true);
  assert.deepEqual(buyHull(deep), { ok: true, zone: 3 });
});

test('the last dive reaches the floor and the sub can go no further', () => {
  const state = at(TOTAL_STEPS - 1);
  state.survey = surveyTarget(state);
  assert.deepEqual(dive(state), { ok: true, enteredZone: null, reachedFloor: true });
  assert.equal(state.finished, true);
  state.survey = 1e300;
  assert.deepEqual(dive(state), { ok: false, reason: 'floor' });
});

test('a first scan discovers the species and pays a bonus; later scans study it', () => {
  const state = createState(1);
  const reward = scanReward(state, 'common');
  const first = completeScan(state, 'z0s0')!;
  assert.equal(first.discovered, true);
  assert.equal(first.lumens, reward);
  assert.ok(first.discoveryBonus > 0);
  assert.equal(first.studyLevelUp, 1);
  assert.equal(state.codex['z0s0'], 1);
  assert.equal(state.stats.scans, 1);
  const second = completeScan(state, 'z0s0')!;
  assert.equal(second.discovered, false);
  assert.equal(second.discoveryBonus, 0);
  assert.equal(second.studyLevelUp, null);
  for (let i = 0; i < 8; i++) completeScan(state, 'z0s0');
  assert.equal(speciesStudyLevel(state, 'z0s0'), 2);
  assert.equal(completeScan(state, 'no-such-species'), null);
});

test('the fleet cannot discover species and its scans pay nothing extra', () => {
  const state = createState(1);
  assert.equal(completeScan(state, 'z0s1', { byFleet: true }), null);
  assert.equal(state.codex['z0s1'], undefined);
  completeScan(state, 'z0s1');
  const lumens = state.lumens;
  const outcome = completeScan(state, 'z0s1', { byFleet: true })!;
  assert.equal(outcome.lumens, 0);
  assert.equal(state.lumens, lumens);
  assert.equal(state.codex['z0s1'], 2, 'but it still counts towards study');
});

test('streaks are recorded and raise rewards once the combo is researched', () => {
  const state = createState(1);
  registerTap(state, 3);
  registerTap(state, 2);
  assert.equal(state.stats.taps, 2);
  assert.equal(state.stats.bestCombo, 3);
  // Discover the species first: a discovery raises the codex bonus, which would blur the comparison.
  completeScan(state, 'z0s0');
  const plain = completeScan(state, 'z0s0', { streak: 10 })!.lumens;
  state.research['combo1'] = true;
  invalidateModifiers(state);
  const boosted = completeScan(state, 'z0s0', { streak: 10 })!.lumens;
  assert.ok(Math.abs(boosted - plain * 2) < 1e-9);
});

test('shoal scans pay well and the eighth starts a frenzy once researched', () => {
  const state = createState(1);
  const one = completeShoalScan(state, 0, 1);
  assert.equal(one.lumens, tapValue(state) * 5);
  assert.equal(one.frenzyStarted, false);
  assert.equal(completeShoalScan(state, 0, FRENZY_CATCHES).frenzyStarted, false, 'no frenzy without the research');
  state.research['shoal3'] = true;
  invalidateModifiers(state);
  assert.equal(completeShoalScan(state, 0, FRENZY_CATCHES - 1).frenzyStarted, false);
  assert.equal(completeShoalScan(state, 0, FRENZY_CATCHES).frenzyStarted, true);
  assert.equal(frenzyActive(state), true);
  assert.equal(completeShoalScan(state, 0, FRENZY_CATCHES + 1).frenzyStarted, false, 'only once per shoal');
  assert.equal(state.stats.shoalsCaught, 5);
  scheduleNextShoal(state, 0.5);
  assert.ok(Math.abs(state.nextShoalAt - (state.clock + SHOAL_INTERVAL)) < 1e-9);
});

test('sonar unlocks with depth, runs for a while and then recharges', () => {
  const state = createState(1);
  assert.equal(sonarUnlocked(state), false);
  assert.equal(startSonar(state, { cooldown: true }), false);
  state.maxStepEver = SONAR_UNLOCK_STEP;
  assert.equal(sonarReady(state), true);
  assert.equal(startSonar(state, { cooldown: true }), true);
  assert.equal(sonarActive(state), true);
  assert.equal(startSonar(state, { cooldown: true }), false, 'cannot stack');
  state.clock += SONAR_SECONDS + 1;
  assert.equal(sonarActive(state), false);
  assert.equal(sonarReady(state), false, 'still recharging');
  assert.equal(startSonar(state, { cooldown: false }), true, 'an advert skips the recharge');
  state.clock += SONAR_COOLDOWN + SONAR_SECONDS;
  assert.equal(sonarReady(state), true);
});

test('publishing banks renown and resets only what belongs to the expedition', () => {
  const state = at(PRESTIGE_MIN_STEP - 1);
  assert.equal(canPublish(state), false);
  assert.equal(publish(state), null);
  at(PRESTIGE_MIN_STEP + 6, state);
  state.lumens = 5e6;
  state.runLumens = 9e6;
  state.lifetimeLumens = 9e6;
  state.survey = 123;
  state.generators[0] = 40;
  state.generators[3] = 7;
  state.research['scan1'] = true;
  state.codex['z0s0'] = 25;
  state.achievements['depth0'] = true;
  state.stats.runSeconds = 900;
  state.sonarUntil = state.clock + 100;
  invalidateModifiers(state);
  const expected = renownOnPublish(state);
  assert.ok(expected >= 1);
  const result = publish(state)!;
  assert.equal(result.renown, expected);
  assert.equal(result.depthStep, PRESTIGE_MIN_STEP + 6);
  assert.equal(result.runSeconds, 900);
  assert.equal(state.renown, expected);
  assert.equal(state.renownTotal, expected);
  assert.equal(state.prestiges, 1);
  assert.equal(state.stats.fastestRunSeconds, 900);
  // Reset:
  assert.equal(state.lumens, 0);
  assert.equal(state.runLumens, 0);
  assert.equal(state.depthStep, 0);
  assert.equal(state.survey, 0);
  assert.equal(state.hullZone, 0);
  assert.deepEqual(state.research, {});
  assert.equal(state.stats.runSeconds, 0);
  assert.equal(state.stats.maxStepThisRun, 0);
  assert.equal(sonarActive(state), false);
  assert.deepEqual(state.generators, GENERATORS.map((_, index) => (index === 0 ? 1 : 0)), 'one buoy is left so the next expedition can start');
  assert.equal(getModifiers(state).tapMult, 1, 'research effects are gone');
  // Kept:
  assert.equal(state.lifetimeLumens, 9e6);
  assert.equal(state.codex['z0s0'], 25);
  assert.equal(state.achievements['depth0'], true);
  assert.equal(state.maxStepEver, PRESTIGE_MIN_STEP + 6);
  assert.equal(canPublish(state), false, 'nothing to publish straight after publishing');
});

test('a brand-new game starts with no free buoy', () => {
  const state = createState(1);
  resetExpedition(state);
  assert.equal(state.generators[0], 0);
});

test('institute upgrades cost renown, stack by level and stop at their maximum', () => {
  const state = createState(1);
  assert.equal(buyInstitute(state, 'grant'), false);
  state.renown = 1000;
  assert.equal(buyInstitute(state, 'manager'), false, 'hidden until the first expedition is published');
  assert.equal(buyInstitute(state, 'nonsense'), false);
  assert.equal(buyInstitute(state, 'grant'), true);
  assert.equal(buyInstitute(state, 'grant'), true);
  assert.equal(state.institute['grant'], 2);
  assert.equal(getModifiers(state).globalMult, 4);
  assert.equal(buyInstitute(state, 'autopilot'), true);
  assert.equal(buyInstitute(state, 'autopilot'), false, 'already at its maximum');
  const buoys = state.generators[0] ?? 0;
  assert.equal(buyInstitute(state, 'seed'), true);
  assert.equal(state.generators[0], buoys + 5, 'Seed Fleet delivers straight away');
  assert.ok(state.renown < 1000 && state.renown >= 0);
});

test('autopilot dives and fits hulls; the fleet manager buys cheap units', () => {
  const state = at(19);
  state.survey = surveyTarget(state) * 50;
  state.lumens = hullCost(state, 1) * 10;
  assert.deepEqual(runAutomation(state), { dived: 0, hull: false, bought: 0 }, 'nothing happens without the upgrades');
  state.institute['autopilot'] = 1;
  invalidateModifiers(state);
  const done = runAutomation(state);
  assert.equal(done.hull, true);
  assert.ok(done.dived >= 1 && done.dived <= 12);
  assert.equal(state.depthStep, 19 + done.dived);
  assert.equal(state.hullZone, 1);

  const blocked = at(91);
  blocked.survey = surveyTarget(blocked) * 5;
  blocked.lumens = 1e30;
  blocked.institute['autopilot'] = 1;
  invalidateModifiers(blocked);
  assert.equal(runAutomation(blocked).dived, 0, 'autopilot stops where a blueprint is missing');

  const managed = createState(1);
  managed.lumens = 1e6;
  managed.institute['manager'] = 1;
  invalidateModifiers(managed);
  const bought = runAutomation(managed).bought;
  assert.ok(bought >= 1 && bought <= 4);
});

test('achievements unlock once when their target is met', () => {
  const state = createState(1);
  assert.deepEqual(checkAchievements(state), []);
  state.maxStepEver = 5;
  state.stats.scans = 50;
  const unlocked = checkAchievements(state).map((achievement) => achievement.id);
  assert.deepEqual(unlocked.sort(), ['depth0', 'scans0']);
  assert.deepEqual(checkAchievements(state), []);
  state.maxStepEver = TOTAL_STEPS;
  state.lifetimeLumens = 1e300;
  state.prestiges = 1000;
  state.stats.scans = 1e9;
  state.stats.shoalsCaught = 1e9;
  state.stats.bestCombo = 1e9;
  state.generators = GENERATORS.map(() => 1000);
  for (const id of Array.from({ length: 5 }, (_, zone) => Array.from({ length: 9 }, (_, index) => `z${zone}s${index}`)).flat()) state.codex[id] = 1e6;
  checkAchievements(state);
  assert.equal(Object.keys(state.achievements).length, ACHIEVEMENTS.length, 'every achievement can be earned');
});

test('offline income is credited once on return', () => {
  const state = createState(1, 1_000_000);
  state.generators[0] = 20;
  const report = applyOffline(state, 1_000_000 + 1_800_000)!;
  assert.ok(report.lumens > 0);
  assert.equal(state.lumens, report.lumens);
  assert.equal(state.lastSeen, 1_000_000 + 1_800_000);
  assert.equal(applyOffline(state, 1_000_000 + 1_800_000 + 5_000), null);
});

test('the daily gift pays once a day', () => {
  const state = createState(1);
  state.maxStepEver = 20;
  state.generators[0] = 10;
  assert.equal(claimDaily(createState(1), 20_000), null);
  const gift = claimDaily(state, 20_000)!;
  assert.ok(gift.lumens > 0);
  assert.equal(gift.streak, 1);
  assert.equal(state.lumens, gift.lumens);
  assert.equal(claimDaily(state, 20_000), null);
  assert.equal(claimDaily(state, 20_001)!.streak, 2);
});
