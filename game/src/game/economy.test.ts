import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ACHIEVEMENTS,
  FLEET_MILESTONES,
  GENERATORS,
  INSTITUTE,
  RARITIES,
  RESEARCH,
  SPECIES,
  TOTAL_STEPS,
  ZONES,
  ZONE_START_STEP,
  speciesInZone,
  type Rarity,
} from './content.ts';
import {
  BASE_OFFLINE_EFFICIENCY,
  BASE_OFFLINE_HOURS,
  DAILY_UNLOCK_STEP,
  PRESTIGE_MIN_STEP,
  SONAR_MULT,
  achievementMultiplier,
  availableResearch,
  codexMultiplier,
  dailyAvailable,
  dailyReward,
  dailyStreakAfterClaim,
  depthMultiplier,
  depthOfStep,
  diveBlock,
  fleetRate,
  generatorCost,
  generatorRate,
  getModifiers,
  globalMultiplier,
  hullCost,
  hullLocked,
  hullNeeded,
  instituteCost,
  invalidateModifiers,
  localDay,
  maxAffordable,
  milestoneMultiplier,
  nextMilestone,
  nextStudyTarget,
  offlineReport,
  passiveRate,
  renownAtStep,
  scanReward,
  studyLevel,
  surveyProgress,
  surveyTarget,
  tapValue,
  zoneOfStep,
} from './economy.ts';
import { mulberry32 } from '../core/rng.ts';
import { createState } from './state.ts';
import { SURVEY_TARGETS } from './surveys.ts';

function close(actual: number, expected: number, tolerance = 1e-9): void {
  assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `expected ${expected}, got ${actual}`);
}

// ---------------------------------------------------------------- content integrity

test('ids are unique in every content table', () => {
  for (const [name, ids] of [
    ['research', RESEARCH.map((entry) => entry.id)],
    ['institute', INSTITUTE.map((entry) => entry.id)],
    ['achievements', ACHIEVEMENTS.map((entry) => entry.id)],
    ['species', SPECIES.map((entry) => entry.id)],
  ] as const) {
    assert.equal(new Set(ids).size, ids.length, `duplicate id in ${name}`);
  }
  assert.equal(new Set(SPECIES.map((species) => species.name)).size, SPECIES.length, 'species names are unique');
});

test('every zone has nine species: five common, two uncommon, one rare, one legendary', () => {
  assert.equal(SPECIES.length, 45);
  for (const zone of ZONES) {
    const counts: Record<Rarity, number> = { common: 0, uncommon: 0, rare: 0, legendary: 0 };
    for (const species of speciesInZone(zone.id)) counts[species.rarity] += 1;
    assert.deepEqual(counts, { common: 5, uncommon: 2, rare: 1, legendary: 1 }, zone.name);
  }
});

test('fleet tiers get dearer, stronger and deeper in order', () => {
  for (let i = 1; i < GENERATORS.length; i++) {
    const previous = GENERATORS[i - 1]!;
    const current = GENERATORS[i]!;
    assert.equal(current.id, i);
    assert.ok(current.baseCost > previous.baseCost * 5, `${current.name} cost`);
    assert.ok(current.baseRate > previous.baseRate * 4, `${current.name} rate`);
    assert.ok(current.unlockStep > previous.unlockStep, `${current.name} unlock`);
    // Higher tiers pay back more slowly per unit; that is what keeps lower tiers worth buying.
    assert.ok(current.baseCost / current.baseRate > previous.baseCost / previous.baseRate, `${current.name} payback`);
  }
  assert.ok(GENERATORS[GENERATORS.length - 1]!.unlockStep < TOTAL_STEPS);
});

test('research and achievements refer to things that exist and can be reached', () => {
  for (const research of RESEARCH) {
    assert.ok(research.cost > 0);
    if (research.requiresStep !== undefined) assert.ok(research.requiresStep >= 0 && research.requiresStep < TOTAL_STEPS, research.id);
    if (research.requiresGenerator) assert.ok(GENERATORS[research.requiresGenerator.gen], research.id);
    if (research.effect.kind === 'genMult') assert.ok(GENERATORS[research.effect.gen], research.id);
  }
  for (const achievement of ACHIEVEMENTS) {
    if (achievement.metric === 'depthStep') assert.ok(achievement.target <= TOTAL_STEPS, achievement.id);
    if (achievement.metric === 'speciesFound') assert.ok(achievement.target <= SPECIES.length, achievement.id);
    if (achievement.metric === 'studyLevels') assert.ok(achievement.target <= SPECIES.length * 5, achievement.id);
  }
  for (const rarity of Object.values(RARITIES)) {
    for (let i = 1; i < rarity.study.length; i++) assert.ok(rarity.study[i]! > rarity.study[i - 1]!);
  }
});

// ---------------------------------------------------------------- depth

test('dive indexes map onto the five zones and their depths', () => {
  assert.deepEqual([...ZONE_START_STEP], [0, 20, 52, 92, 132, 181]);
  assert.equal(TOTAL_STEPS, 181);
  assert.equal(depthOfStep(0), 0);
  assert.equal(depthOfStep(1), 10);
  assert.equal(depthOfStep(20), 200);
  assert.equal(depthOfStep(52), 1000);
  assert.equal(depthOfStep(92), 4000);
  assert.equal(depthOfStep(132), 6000);
  assert.equal(depthOfStep(181), 10900);
  assert.equal(depthOfStep(999), 10900);
  assert.equal(zoneOfStep(19), 0);
  assert.equal(zoneOfStep(20), 1);
  assert.equal(zoneOfStep(51), 1);
  assert.equal(zoneOfStep(52), 2);
  assert.equal(zoneOfStep(131), 3);
  assert.equal(zoneOfStep(132), 4);
  assert.equal(zoneOfStep(181), 4);
  for (let step = 1; step <= TOTAL_STEPS; step++) {
    assert.ok(depthOfStep(step) > depthOfStep(step - 1), `depth rises at dive ${step}`);
    assert.ok(depthMultiplier(step) > depthMultiplier(step - 1), `income rises at dive ${step}`);
  }
});

test('the generated survey table covers every dive and only ever grows', () => {
  assert.equal(SURVEY_TARGETS.length, TOTAL_STEPS);
  for (let step = 0; step < SURVEY_TARGETS.length; step++) {
    const value = SURVEY_TARGETS[step]!;
    assert.ok(Number.isFinite(value) && value > 0, `survey ${step}`);
    if (step > 0) assert.ok(value > SURVEY_TARGETS[step - 1]!, `survey ${step} is larger than the one before`);
  }
  assert.ok(SURVEY_TARGETS[0]! < 2000, 'the first dive is close at hand');
  assert.ok(SURVEY_TARGETS[TOTAL_STEPS - 1]! < 1e120, 'numbers stay far inside what a double can hold');
});

test('the survey bar fills with what is earned at this depth', () => {
  const state = createState(1);
  assert.equal(diveBlock(state), 'survey');
  assert.equal(surveyProgress(state), 0);
  state.survey = surveyTarget(state) / 2;
  close(surveyProgress(state), 0.5, 1e-3);
  state.survey = surveyTarget(state) * 3;
  assert.equal(surveyProgress(state), 1);
  assert.equal(diveBlock(state), null);
  state.depthStep = TOTAL_STEPS;
  assert.equal(diveBlock(state), 'floor');
  assert.equal(surveyProgress(state), 1);
});

test('a new hull is needed exactly at each zone boundary', () => {
  const state = createState(1);
  state.depthStep = 18;
  assert.equal(hullNeeded(state), null);
  state.depthStep = 19;
  assert.equal(hullNeeded(state), 1);
  state.hullZone = 1;
  assert.equal(hullNeeded(state), null);
  state.depthStep = 91;
  state.hullZone = 2;
  assert.equal(hullNeeded(state), 3);
  assert.equal(hullLocked(state, 3), true, 'the Abyssal hull needs an Institute blueprint');
  state.institute['titanium'] = 1;
  invalidateModifiers(state);
  assert.equal(hullLocked(state, 3), false);
  assert.equal(hullLocked(state, 4), true);
  assert.ok(hullCost(state, 1) < hullCost(state, 2) && hullCost(state, 2) < hullCost(state, 3) && hullCost(state, 3) < hullCost(state, 4));
  assert.equal(hullCost(state, 0), Infinity);
  state.depthStep = TOTAL_STEPS;
  assert.equal(hullNeeded(state), null);
});

// ---------------------------------------------------------------- fleet

test('fleet prices rise by 14% a unit and bulk prices add up', () => {
  const state = createState(1);
  assert.equal(generatorCost(state, 0), 12);
  state.generators[0] = 10;
  close(generatorCost(state, 0), Math.ceil(12 * Math.pow(1.14, 10)));
  const state2 = createState(1);
  let sum = 0;
  for (let i = 0; i < 7; i++) {
    sum += 12 * Math.pow(1.14, i);
  }
  close(generatorCost(state2, 0, 7), Math.ceil(sum));
  assert.equal(generatorCost(state2, 99), Infinity);
});

test('maxAffordable agrees with generatorCost for any balance', () => {
  const rng = mulberry32(7);
  for (let trial = 0; trial < 400; trial++) {
    const state = createState(1);
    const gen = Math.floor(rng() * GENERATORS.length);
    state.generators[gen] = Math.floor(rng() * 120);
    state.lumens = Math.pow(10, rng() * 30);
    const quantity = maxAffordable(state, gen);
    if (quantity > 0) assert.ok(generatorCost(state, gen, quantity) <= state.lumens, `can pay for ${quantity}`);
    assert.ok(generatorCost(state, gen, quantity + 1) > state.lumens, `cannot pay for ${quantity + 1}`);
  }
});

test('owning more of a unit doubles its output at each milestone', () => {
  assert.equal(milestoneMultiplier(0), 1);
  assert.equal(milestoneMultiplier(9), 1);
  assert.equal(milestoneMultiplier(10), 2);
  assert.equal(milestoneMultiplier(25), 4);
  assert.equal(milestoneMultiplier(100), 16);
  assert.equal(nextMilestone(0), 10);
  assert.equal(nextMilestone(10), 25);
  assert.equal(nextMilestone(FLEET_MILESTONES[FLEET_MILESTONES.length - 1]!), null);
  const state = createState(1);
  state.generators[0] = 9;
  const before = generatorRate(state, 0);
  state.generators[0] = 10;
  close(generatorRate(state, 0), (before / 9) * 10 * 2);
});

// ---------------------------------------------------------------- multipliers

test('research and institute upgrades fold into one set of modifiers', () => {
  const state = createState(1);
  assert.equal(getModifiers(state).tapMult, 1);
  state.research['scan1'] = true;
  assert.equal(getModifiers(state).tapMult, 1, 'modifiers are cached until invalidated');
  invalidateModifiers(state);
  assert.equal(getModifiers(state).tapMult, 2);
  state.research['scan2'] = true;
  state.research['glob1'] = true;
  state.institute['grant'] = 3;
  state.institute['patron'] = 2;
  state.institute['crew'] = 2;
  state.institute['night'] = 2;
  invalidateModifiers(state);
  const mods = getModifiers(state);
  close(mods.tapMult, 2 * 2 * 2.5 * 2.5);
  close(mods.globalMult, 1.5 * 8);
  close(mods.diveDiscount, 0.88 * 0.88);
  assert.equal(mods.offlineHours, BASE_OFFLINE_HOURS + 4);
  close(mods.offlineEfficiency, BASE_OFFLINE_EFFICIENCY + 0.2);
  assert.equal(mods.unlockedZone, 2);
});

test('every income source scales with the global multiplier', () => {
  const state = createState(1);
  state.generators[0] = 5;
  state.generators[1] = 2;
  const fleetBefore = fleetRate(state);
  const tapBefore = tapValue(state);
  close(fleetBefore, 5 * 0.3 + 2 * 2);
  assert.equal(tapBefore, 1);
  state.depthStep = 20;
  close(fleetRate(state), fleetBefore * depthMultiplier(20));
  close(tapValue(state), tapBefore * depthMultiplier(20));
  state.achievements['depth0'] = true;
  state.codex['z0s0'] = 1;
  close(globalMultiplier(state), depthMultiplier(20) * achievementMultiplier(state) * codexMultiplier(state));
  // Boosts apply live but never to offline income.
  state.sonarUntil = state.clock + 10;
  close(globalMultiplier(state), globalMultiplier(state, false) * SONAR_MULT);
  close(passiveRate(state, false) * SONAR_MULT, passiveRate(state));
});

test('scan rewards follow rarity, streaks and shoals', () => {
  const state = createState(1);
  state.research['combo1'] = true;
  state.research['shoal2'] = true;
  invalidateModifiers(state);
  const base = tapValue(state);
  close(scanReward(state, 'common'), base);
  close(scanReward(state, 'legendary'), base * RARITIES.legendary.value);
  close(scanReward(state, 'common', 5), base * 1.5);
  close(scanReward(state, 'common', 500), base * 2, 1e-9);
  close(scanReward(state, 'rare', 0, true), base * 5 * 3);
});

test('study levels follow the thresholds for each rarity', () => {
  assert.equal(studyLevel('common', 0), 0);
  assert.equal(studyLevel('common', 1), 1);
  assert.equal(studyLevel('common', 9), 1);
  assert.equal(studyLevel('common', 10), 2);
  assert.equal(studyLevel('common', 1000), 5);
  assert.equal(studyLevel('legendary', 50), 5);
  assert.equal(nextStudyTarget('common', 0), 1);
  assert.equal(nextStudyTarget('common', 10), 50);
  assert.equal(nextStudyTarget('common', 5000), null);
});

test('research appears as its conditions are met, cheapest first', () => {
  const state = createState(1);
  const atStart = availableResearch(state).map((entry) => entry.id);
  assert.deepEqual(atStart, ['scan1']);
  state.stats.maxStepThisRun = 6;
  state.generators[1] = 5;
  const later = availableResearch(state);
  assert.ok(later.some((entry) => entry.id === 'glob1'));
  assert.ok(later.some((entry) => entry.id === 'auto1'));
  for (let i = 1; i < later.length; i++) assert.ok(later[i]!.cost >= later[i - 1]!.cost);
  state.research['scan1'] = true;
  assert.ok(!availableResearch(state).some((entry) => entry.id === 'scan1'));
});

// ---------------------------------------------------------------- prestige, offline, daily

test('renown depends only on how deep the expedition went', () => {
  const state = createState(1);
  assert.equal(renownAtStep(state, PRESTIGE_MIN_STEP - 1), 0);
  assert.ok(renownAtStep(state, PRESTIGE_MIN_STEP) >= 1);
  for (let step = PRESTIGE_MIN_STEP + 1; step <= TOTAL_STEPS; step++) {
    assert.ok(renownAtStep(state, step) >= renownAtStep(state, step - 1));
  }
  const plain = renownAtStep(state, 100);
  state.institute['press'] = 4;
  invalidateModifiers(state);
  close(renownAtStep(state, 100), Math.floor((plain / 1) * 2), 0.01);
  const upgrade = INSTITUTE.find((entry) => entry.id === 'grant')!;
  state.institute['grant'] = 0;
  const first = instituteCost(state, upgrade);
  state.institute['grant'] = 5;
  assert.ok(instituteCost(state, upgrade) > first);
  state.institute['autopilot'] = 1;
  assert.equal(instituteCost(state, INSTITUTE.find((entry) => entry.id === 'autopilot')!), Infinity);
});

test('offline income is capped, discounted and ignores short absences', () => {
  const state = createState(1, 1_000_000);
  state.generators[0] = 10;
  const rate = passiveRate(state, false);
  assert.equal(offlineReport(state, 1_000_000 + 30_000), null);
  assert.equal(offlineReport(state, 999_000), null, 'a clock set backwards pays nothing');
  const oneHour = offlineReport(state, 1_000_000 + 3_600_000)!;
  close(oneHour.lumens, rate * 3600 * BASE_OFFLINE_EFFICIENCY);
  const week = offlineReport(state, 1_000_000 + 7 * 86_400_000)!;
  close(week.countedSeconds, BASE_OFFLINE_HOURS * 3600);
  close(week.lumens, rate * BASE_OFFLINE_HOURS * 3600 * BASE_OFFLINE_EFFICIENCY);
  state.generators[0] = 0;
  assert.equal(offlineReport(state, 1_000_000 + 3_600_000), null, 'nothing to report without a fleet');
});

test('the daily gift unlocks with depth, once a day, and builds a streak', () => {
  const state = createState(1);
  assert.equal(dailyAvailable(state, 20_000), false);
  state.maxStepEver = DAILY_UNLOCK_STEP;
  assert.equal(dailyAvailable(state, 20_000), true);
  assert.equal(dailyStreakAfterClaim(state, 20_000), 1);
  state.dailyDay = 20_000;
  state.dailyStreak = 1;
  assert.equal(dailyAvailable(state, 20_000), false);
  assert.equal(dailyStreakAfterClaim(state, 20_001), 2);
  assert.equal(dailyStreakAfterClaim(state, 20_003), 1, 'a missed day restarts the streak');
  state.generators[2] = 20;
  const plain = dailyReward(state, 20_003);
  close(dailyReward(state, 20_001), plain * 1.1);
  assert.equal(localDay(0, 0), 0);
  assert.equal(localDay(86_400_000 - 1, 0), 0);
  assert.equal(localDay(86_400_000, 0), 1);
  assert.equal(localDay(86_400_000, 60), 0, 'an hour behind UTC is still the previous day');
});
