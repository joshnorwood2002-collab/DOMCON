// Everything that changes the game state. Each action checks that it is
// allowed, applies it, and reports what happened so the UI can react.

import {
  ACHIEVEMENTS,
  GENERATORS,
  INSTITUTE,
  RARITIES,
  RESEARCH,
  SPECIES_BY_ID,
  TOTAL_STEPS,
  type AchievementDef,
  type AchievementMetric,
  type SpeciesDef,
} from './content.ts';
import {
  AUTO_BUY_FRACTION,
  FRENZY_CATCHES,
  FRENZY_SECONDS,
  SONAR_COOLDOWN,
  SONAR_SECONDS,
  SONAR_UNLOCK_STEP,
  canPublish,
  dailyAvailable,
  dailyReward,
  dailyStreakAfterClaim,
  discoveryBonus,
  diveBlock,
  generatorCost,
  generatorUnlocked,
  getModifiers,
  hullCost,
  hullLocked,
  hullNeeded,
  instituteCost,
  instituteVisible,
  invalidateModifiers,
  maxAffordable,
  offlineReport,
  passiveRate,
  renownOnPublish,
  researchVisible,
  scanReward,
  shoalDelay,
  sonarActive,
  speciesFound,
  speciesStudyLevel,
  surveyComplete,
  surveyTarget,
  totalStudyLevels,
  zoneOfStep,
  type OfflineReport,
} from './economy.ts';
import type { GameState } from './state.ts';

/** Adds lumens to the balance and to the running totals. */
export function earn(state: GameState, amount: number): void {
  if (!(amount > 0) || !Number.isFinite(amount)) return;
  state.lumens += amount;
  state.runLumens += amount;
  state.lifetimeLumens += amount;
  // Everything earned at this depth counts towards its survey.
  state.survey += amount;
}

function spend(state: GameState, amount: number): boolean {
  if (!(amount >= 0) || state.lumens < amount) return false;
  state.lumens -= amount;
  return true;
}

// ---------------------------------------------------------------- time

/** Advances the simulation by `dt` seconds of open-game play. */
export function tick(state: GameState, dt: number): void {
  if (!(dt > 0)) return;
  earn(state, passiveRate(state) * dt);
  state.clock += dt;
  state.stats.playSeconds += dt;
  state.stats.runSeconds += dt;
}

/** Credits offline income for the time since the last save and returns the report, if any. */
export function applyOffline(state: GameState, nowMs: number): OfflineReport | null {
  const report = offlineReport(state, nowMs);
  state.lastSeen = nowMs;
  if (!report) return null;
  earn(state, report.lumens);
  return report;
}

// ---------------------------------------------------------------- fleet

/** Buys up to `quantity` units; returns how many were bought. */
export function buyGenerator(state: GameState, gen: number, quantity = 1): number {
  if (!generatorUnlocked(state, gen)) return 0;
  const wanted = Math.min(Math.max(0, Math.floor(quantity)), maxAffordable(state, gen));
  if (wanted <= 0) return 0;
  if (!spend(state, generatorCost(state, gen, wanted))) return 0;
  state.generators[gen] = (state.generators[gen] ?? 0) + wanted;
  return wanted;
}

export function buyResearch(state: GameState, id: string): boolean {
  const research = RESEARCH.find((entry) => entry.id === id);
  if (!research || !researchVisible(state, research)) return false;
  if (!spend(state, research.cost)) return false;
  state.research[id] = true;
  invalidateModifiers(state);
  return true;
}

// ---------------------------------------------------------------- diving

export type DiveResult =
  | { ok: true; enteredZone: number | null; reachedFloor: boolean }
  | { ok: false; reason: 'floor' | 'survey' | 'hull' };

/** Descends one step once the survey of the current depth is finished. Diving is free. */
export function dive(state: GameState): DiveResult {
  const block = diveBlock(state);
  if (block !== null) return { ok: false, reason: block };
  const zoneBefore = currentZone(state);
  // Lumens earned beyond the target carry over, so a windfall can fund several dives in a row.
  state.survey = Math.max(0, state.survey - surveyTarget(state));
  state.depthStep += 1;
  state.stats.maxStepThisRun = Math.max(state.stats.maxStepThisRun, state.depthStep);
  state.maxStepEver = Math.max(state.maxStepEver, state.depthStep);
  const reachedFloor = state.depthStep >= TOTAL_STEPS;
  if (reachedFloor) state.finished = true;
  const zoneAfter = currentZone(state);
  return { ok: true, enteredZone: zoneAfter !== zoneBefore ? zoneAfter : null, reachedFloor };
}

export function currentZone(state: GameState): number {
  return zoneOfStep(state.depthStep);
}

export type HullResult = { ok: true; zone: number } | { ok: false; reason: 'none' | 'blueprint' | 'lumens' };

/** Builds the hull for the next zone, if one is needed. */
export function buyHull(state: GameState): HullResult {
  const zone = hullNeeded(state);
  if (zone === null) return { ok: false, reason: 'none' };
  if (hullLocked(state, zone)) return { ok: false, reason: 'blueprint' };
  if (!spend(state, hullCost(state, zone))) return { ok: false, reason: 'lumens' };
  state.hullZone = zone;
  return { ok: true, zone };
}

// ---------------------------------------------------------------- scanning

export interface ScanOutcome {
  lumens: number;
  /** True when this was the first ever scan of the species. */
  discovered: boolean;
  discoveryBonus: number;
  /** New study level if this scan raised it, else null. */
  studyLevelUp: number | null;
  species: SpeciesDef;
}

/**
 * Finishes a scan of one creature.
 * `byFleet` scans (automatic ones) cannot discover a species and build no streak.
 */
export function completeScan(state: GameState, speciesId: string, options: { streak?: number; byFleet?: boolean } = {}): ScanOutcome | null {
  const species = SPECIES_BY_ID.get(speciesId);
  if (!species) return null;
  const known = (state.codex[speciesId] ?? 0) > 0;
  if (options.byFleet && !known) return null;
  const levelBefore = speciesStudyLevel(state, speciesId);
  // The fleet's own scans are already paid for through its per-second income (see autoScanRate),
  // so they advance the codex study but pay nothing extra.
  const lumens = options.byFleet ? 0 : scanReward(state, species.rarity, options.streak ?? 0);
  earn(state, lumens);
  const bonus = known ? 0 : discoveryBonus(state);
  if (bonus > 0) earn(state, bonus);
  state.codex[speciesId] = (state.codex[speciesId] ?? 0) + getModifiers(state).studySpeed;
  state.stats.scans += 1;
  const levelAfter = speciesStudyLevel(state, speciesId);
  return {
    lumens,
    discovered: !known,
    discoveryBonus: bonus,
    studyLevelUp: levelAfter > levelBefore ? levelAfter : null,
    species,
  };
}

/** Records a manual tap that hit a creature, and the streak it belongs to. */
export function registerTap(state: GameState, streak: number): void {
  state.stats.taps += 1;
  if (streak > state.stats.bestCombo) state.stats.bestCombo = streak;
}

/** Finishes a scan of one shoal creature. `caughtThisShoal` counts this one. */
export function completeShoalScan(state: GameState, streak: number, caughtThisShoal: number): { lumens: number; frenzyStarted: boolean } {
  const lumens = scanReward(state, 'common', streak, true);
  earn(state, lumens);
  state.stats.shoalsCaught += 1;
  state.stats.scans += 1;
  let frenzyStarted = false;
  const mods = getModifiers(state);
  if (mods.frenzyMult > 0 && caughtThisShoal === FRENZY_CATCHES) {
    state.frenzyUntil = state.clock + FRENZY_SECONDS;
    frenzyStarted = true;
  }
  return { lumens, frenzyStarted };
}

/** Schedules the next shoal after the current one, using a random number in [0, 1). */
export function scheduleNextShoal(state: GameState, roll: number): void {
  state.nextShoalAt = state.clock + shoalDelay(state, roll);
}

// ---------------------------------------------------------------- boosts

export function sonarUnlocked(state: GameState): boolean {
  return state.maxStepEver >= SONAR_UNLOCK_STEP;
}

export function sonarReady(state: GameState): boolean {
  return sonarUnlocked(state) && !sonarActive(state) && state.clock >= state.sonarReadyAt;
}

/**
 * Starts a Sonar Burst. In builds with adverts the caller shows a rewarded ad
 * first and passes `cooldown: false`; without adverts the burst is free but
 * has to recharge.
 */
export function startSonar(state: GameState, options: { cooldown: boolean }): boolean {
  if (!sonarUnlocked(state) || sonarActive(state)) return false;
  if (options.cooldown && state.clock < state.sonarReadyAt) return false;
  state.sonarUntil = state.clock + SONAR_SECONDS;
  state.sonarReadyAt = options.cooldown ? state.clock + SONAR_COOLDOWN : state.sonarUntil;
  return true;
}

// ---------------------------------------------------------------- publishing (prestige)

export interface PublishResult {
  renown: number;
  runSeconds: number;
  depthStep: number;
}

/** Ends the expedition: banks Renown and resets everything that is not permanent. */
export function publish(state: GameState): PublishResult | null {
  if (!canPublish(state)) return null;
  const renown = renownOnPublish(state);
  const result: PublishResult = { renown, runSeconds: state.stats.runSeconds, depthStep: state.stats.maxStepThisRun };
  state.renown += renown;
  state.renownTotal += renown;
  state.prestiges += 1;
  if (state.stats.fastestRunSeconds === 0 || state.stats.runSeconds < state.stats.fastestRunSeconds) {
    state.stats.fastestRunSeconds = state.stats.runSeconds;
  }
  resetExpedition(state);
  return result;
}

/** Puts the run-scoped parts of the state back to the start of an expedition. */
export function resetExpedition(state: GameState): void {
  state.lumens = 0;
  state.runLumens = 0;
  state.depthStep = 0;
  state.survey = 0;
  state.hullZone = 0;
  state.research = {};
  state.sonarUntil = 0;
  state.sonarReadyAt = 0;
  state.frenzyUntil = 0;
  state.stats.runSeconds = 0;
  state.stats.maxStepThisRun = 0;
  invalidateModifiers(state);
  // A published explorer always has at least one buoy waiting, so a new expedition never starts from a dead stop.
  const seedBuoys = Math.max(state.prestiges > 0 ? 1 : 0, getModifiers(state).seedBuoys);
  state.generators = GENERATORS.map((_, index) => (index === 0 ? seedBuoys : 0));
  state.nextShoalAt = state.clock + 60;
}

export function buyInstitute(state: GameState, id: string): boolean {
  const upgrade = INSTITUTE.find((entry) => entry.id === id);
  if (!upgrade || !instituteVisible(state, upgrade)) return false;
  const cost = instituteCost(state, upgrade);
  if (!Number.isFinite(cost) || state.renown < cost) return false;
  state.renown -= cost;
  state.institute[id] = (state.institute[id] ?? 0) + 1;
  invalidateModifiers(state);
  // Seed Fleet takes effect straight away as well as on later expeditions.
  if (upgrade.effect.kind === 'seedBuoys') {
    state.generators[0] = (state.generators[0] ?? 0) + upgrade.effect.value;
  }
  return true;
}

// ---------------------------------------------------------------- automation

/** Autopilot and Fleet Manager. Call a few times a second; returns what it did. */
export function runAutomation(state: GameState): { dived: number; hull: boolean; bought: number } {
  const mods = getModifiers(state);
  const done = { dived: 0, hull: false, bought: 0 };
  if (mods.autoDive) {
    // Several dives may be waiting after a windfall or a spell offline.
    for (let i = 0; i < 12; i++) {
      const zone = hullNeeded(state);
      if (zone !== null && surveyComplete(state)) {
        if (hullLocked(state, zone) || !buyHull(state).ok) break;
        done.hull = true;
      }
      if (!dive(state).ok) break;
      done.dived += 1;
    }
  }
  if (mods.autoBuy) {
    // Dearest first, so new tiers are picked up as soon as they are cheap.
    for (let gen = GENERATORS.length - 1; gen >= 0 && done.bought < 4; gen--) {
      if (!generatorUnlocked(state, gen)) continue;
      if (generatorCost(state, gen, 1) <= state.lumens * AUTO_BUY_FRACTION) {
        done.bought += buyGenerator(state, gen, 1);
      }
    }
  }
  return done;
}

// ---------------------------------------------------------------- achievements

export function metricValue(state: GameState, metric: AchievementMetric): number {
  switch (metric) {
    case 'depthStep':
      return state.maxStepEver;
    case 'fleetTotal':
      return state.generators.reduce((sum, count) => sum + count, 0);
    case 'speciesFound':
      return speciesFound(state);
    case 'scans':
      return state.stats.scans;
    case 'lifetimeLumens':
      return state.lifetimeLumens;
    case 'prestiges':
      return state.prestiges;
    case 'shoalsCaught':
      return state.stats.shoalsCaught;
    case 'studyLevels':
      return totalStudyLevels(state);
    case 'bestCombo':
      return state.stats.bestCombo;
  }
}

/** Unlocks any achievements whose targets are now met and returns them. */
export function checkAchievements(state: GameState): AchievementDef[] {
  const unlocked: AchievementDef[] = [];
  for (const achievement of ACHIEVEMENTS) {
    if (state.achievements[achievement.id]) continue;
    if (metricValue(state, achievement.metric) >= achievement.target) {
      state.achievements[achievement.id] = true;
      unlocked.push(achievement);
    }
  }
  return unlocked;
}

/** How many taps a creature of this species needs. */
export function tapsNeeded(species: SpeciesDef): number {
  return RARITIES[species.rarity].taps;
}

// ---------------------------------------------------------------- daily gift

/** Claims today's gift. `today` is economy.localDay() for the player's clock. */
export function claimDaily(state: GameState, today: number): { lumens: number; streak: number } | null {
  if (!dailyAvailable(state, today)) return null;
  const lumens = dailyReward(state, today);
  const streak = dailyStreakAfterClaim(state, today);
  state.dailyStreak = streak;
  state.dailyDay = today;
  earn(state, lumens);
  return { lumens, streak };
}
