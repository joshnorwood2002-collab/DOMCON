// A headless player. It plays the real rules (actions.ts) one second at a
// time with simple, human-like habits, so pacing can be measured and tuned
// without anyone sitting through hours of play. Used by the balance tests and
// by `node src/game/sim.ts` for a printed timeline.

import { GENERATORS, INSTITUTE, RARITIES, SPECIES, TOTAL_STEPS, ZONES, type Rarity, type SpeciesDef } from './content.ts';
import {
  buyGenerator,
  buyHull,
  buyInstitute,
  buyResearch,
  checkAchievements,
  completeScan,
  completeShoalScan,
  currentZone,
  dive,
  publish,
  registerTap,
  runAutomation,
  scheduleNextShoal,
  sonarReady,
  startSonar,
  tick,
} from './actions.ts';
import {
  COMBO_WINDOW,
  SHOAL_DURATION,
  SHOAL_SIZE,
  atSeaFloor,
  availableResearch,
  canPublish,
  depthOfStep,
  diveBlock,
  fleetRate,
  generatorCost,
  generatorUnlocked,
  getModifiers,
  hullCost,
  hullLocked,
  hullNeeded,
  instituteCost,
  instituteVisible,
  milestoneMultiplier,
  passiveRate,
  rarityWeights,
  renownOnPublish,
  surveyTarget,
} from './economy.ts';
import { mulberry32, weightedPick, type Rng } from '../core/rng.ts';
import { createState, type GameState } from './state.ts';

export interface BotProfile {
  name: string;
  /** Taps per second, given the second of the session and of the current expedition. */
  tapsPerSecond(second: number, runSecond: number): number;
  /** Whether the bot bothers with the free Sonar Burst. */
  usesSonar: boolean;
  /** The bot publishes once the next dive is this many seconds away. */
  stallSeconds: number;
  /** Never publish an expedition shorter than this. */
  minRunSeconds: number;
}

/** Plays attentively for the first few minutes of every quarter hour, then mostly watches. */
export const CASUAL: BotProfile = {
  name: 'casual',
  tapsPerSecond: (second) => (second % 900 < 240 ? 2.2 : 0.35),
  usesSonar: true,
  stallSeconds: 420,
  minRunSeconds: 600,
};

/** Taps at an even, unhurried rate. Used as the reference player when survey sizes are fitted. */
export const STEADY: BotProfile = {
  name: 'steady',
  tapsPerSecond: () => 1,
  usesSonar: true,
  stallSeconds: 420,
  minRunSeconds: 600,
};

/** Taps hard the whole time and uses every boost. */
export const ACTIVE: BotProfile = {
  name: 'active',
  tapsPerSecond: () => 4,
  usesSonar: true,
  stallSeconds: 300,
  minRunSeconds: 480,
};

/** Taps only for the first minute of each expedition, then just buys things. */
export const IDLE: BotProfile = {
  name: 'idle',
  tapsPerSecond: (_second, runSecond) => (runSecond < 60 ? 2 : 0),
  usesSonar: false,
  stallSeconds: 900,
  minRunSeconds: 900,
};

export interface SimEvent {
  /** Seconds since the simulation began. */
  t: number;
  kind: 'generator' | 'zone' | 'hull' | 'publish' | 'floor' | 'research' | 'institute';
  detail: string;
  value?: number;
}

export interface SimResult {
  state: GameState;
  events: SimEvent[];
  seconds: number;
  /** Longest wait between purchases (seconds), split by phase of the session. */
  longestGapFirstTenMinutes: number;
  longestGapOverall: number;
  purchases: number;
  /** Second at which each dive index was first reached (index = dive index). */
  firstReach: number[];
  /** Lifetime lumens when each dive index was first reached. */
  lumensAtReach: number[];
}

export interface SimOptions {
  profile: BotProfile;
  maxSeconds: number;
  seed?: number;
  /** Stop early when this returns true (checked once a second). */
  stopWhen?: (state: GameState, events: SimEvent[]) => boolean;
  /** Start from an existing state instead of a new game. */
  from?: GameState;
  /** Never publish; used to see where a single expedition slows to a halt. */
  noPublish?: boolean;
  /** Extra condition on diving, used by the fitting script to force a schedule. */
  diveGate?: (state: GameState, second: number) => boolean;
}

function pickSpecies(state: GameState, rng: Rng, knownOnly: boolean): SpeciesDef | null {
  const zone = currentZone(state);
  const weights = rarityWeights(state);
  const pool = SPECIES.filter((species) => species.zone === zone && (!knownOnly || (state.codex[species.id] ?? 0) > 0));
  if (pool.length === 0) return null;
  const perRarity: Record<Rarity, number> = { common: 0, uncommon: 0, rare: 0, legendary: 0 };
  for (const species of pool) perRarity[species.rarity] += 1;
  return weightedPick(
    rng,
    pool.map((species) => ({ value: species, weight: weights[species.rarity] / perRarity[species.rarity] })),
  );
}

/** Extra lumens per second that one more unit of a generator would add. */
function marginalRate(state: GameState, gen: number): number {
  const def = GENERATORS[gen];
  if (!def) return 0;
  const count = state.generators[gen] ?? 0;
  const mods = getModifiers(state);
  const perUnitNow = count * milestoneMultiplier(count);
  const perUnitNext = (count + 1) * milestoneMultiplier(count + 1);
  const fleet = fleetRate(state);
  const scale = fleet > 0 && count > 0 ? 1 : 1;
  // Global multipliers cancel out when comparing generators, so only the parts that differ are needed.
  return def.baseRate * (perUnitNext - perUnitNow) * (mods.genMult[gen] ?? 1) * scale;
}

const INSTITUTE_PRIORITY = ['titanium', 'foam', 'autopilot', 'grant', 'patron', 'crew', 'seed', 'manager', 'press', 'night', 'bulk', 'taxonomy', 'eyes', 'echo'];

function spendRenown(state: GameState, events: SimEvent[], t: number): void {
  // Blueprints first, then cheapest-first among the rest, weighted toward income.
  for (let guard = 0; guard < 200; guard++) {
    let bought = false;
    const grantLevel = state.institute['grant'] ?? 0;
    for (const id of grantLevel < 2 ? ['grant'] : ['titanium', 'foam', 'autopilot']) {
      const upgrade = INSTITUTE.find((entry) => entry.id === id);
      if (upgrade && instituteVisible(state, upgrade) && instituteCost(state, upgrade) <= state.renown) {
        if (buyInstitute(state, id)) {
          events.push({ t, kind: 'institute', detail: id });
          bought = true;
        }
      }
    }
    const candidates = INSTITUTE.filter((upgrade) => instituteVisible(state, upgrade) && instituteCost(state, upgrade) <= state.renown).sort((a, b) => {
      const weight = (id: string): number => (id === 'grant' ? 0.45 : id === 'patron' ? 0.8 : 1 + INSTITUTE_PRIORITY.indexOf(id) * 0.05);
      return instituteCost(state, a) * weight(a.id) - instituteCost(state, b) * weight(b.id);
    });
    const next = candidates[0];
    if (next && buyInstitute(state, next.id)) {
      events.push({ t, kind: 'institute', detail: next.id });
      bought = true;
    }
    if (!bought) break;
  }
}

export function simulate(options: SimOptions): SimResult {
  const rng = mulberry32(options.seed ?? 12345);
  const state = options.from ?? createState(options.seed ?? 12345, 0);
  const profile = options.profile;
  const events: SimEvent[] = [];
  const seenGenerators = new Set<number>(state.generators.flatMap((count, index) => (count > 0 ? [index] : [])));
  let target: SpeciesDef | null = null;
  let tapsLeft = 0;
  let streak = 0;
  let tapCarry = 0;
  let autoCarry = 0;
  let fleetTarget: SpeciesDef | null = null;
  let fleetTapsLeft = 0;
  let lastPurchaseAt = 0;
  let longestGapFirstTen = 0;
  let longestGapOverall = 0;
  let purchases = 0;
  let floorLogged = state.finished;
  const firstReach: number[] = [0];
  const lumensAtReach: number[] = [0];
  let earningRate = 0;
  let lumensBefore = state.lifetimeLumens;

  const notePurchase = (t: number): void => {
    const gap = t - lastPurchaseAt;
    if (t <= 600) longestGapFirstTen = Math.max(longestGapFirstTen, gap);
    longestGapOverall = Math.max(longestGapOverall, gap);
    lastPurchaseAt = t;
    purchases += 1;
  };

  let t = 0;
  for (; t < options.maxSeconds; t++) {
    tick(state, 1);
    // Smoothed lumens per second from every source, for judging how long the next goal will take.
    earningRate += ((state.lifetimeLumens - lumensBefore) - earningRate) * 0.05;
    lumensBefore = state.lifetimeLumens;

    // --- tapping
    const rate = profile.tapsPerSecond(t, state.stats.runSeconds);
    if (rate < 1 / COMBO_WINDOW) streak = 0;
    tapCarry += rate;
    while (tapCarry >= 1) {
      tapCarry -= 1;
      if (!target) {
        target = pickSpecies(state, rng, false);
        tapsLeft = target ? RARITIES[target.rarity].taps : 0;
      }
      if (!target) break;
      streak += 1;
      registerTap(state, streak);
      tapsLeft -= 1;
      if (tapsLeft <= 0) {
        completeScan(state, target.id, { streak });
        target = null;
      }
    }

    // --- the fleet's own scans
    const interval = getModifiers(state).autoScanInterval;
    if (interval > 0) {
      autoCarry += 1 / interval;
      while (autoCarry >= 1) {
        autoCarry -= 1;
        if (!fleetTarget) {
          fleetTarget = pickSpecies(state, rng, true);
          fleetTapsLeft = fleetTarget ? RARITIES[fleetTarget.rarity].taps : 0;
        }
        if (!fleetTarget) break;
        fleetTapsLeft -= 1;
        if (fleetTapsLeft <= 0) {
          completeScan(state, fleetTarget.id, { byFleet: true });
          fleetTarget = null;
        }
      }
    }

    // --- shoals
    if (state.clock >= state.nextShoalAt) {
      const caught = Math.min(SHOAL_SIZE, Math.floor(rate * SHOAL_DURATION * 0.55));
      for (let i = 1; i <= caught; i++) completeShoalScan(state, streak, i);
      scheduleNextShoal(state, rng());
    }

    // --- boosts
    if (profile.usesSonar && sonarReady(state) && passiveRate(state) > 0) startSonar(state, { cooldown: true });

    // --- spending (a person makes a handful of decisions a second at most)
    for (let decisions = 0; decisions < 3; decisions++) {
      const zoneNeeded = hullNeeded(state);
      const hullWanted = zoneNeeded !== null && !hullLocked(state, zoneNeeded);
      // Once the survey is half done, stop buying fleet units and save for the hull.
      const saving = hullWanted && state.survey >= surveyTarget(state) * 0.5 && hullCost(state, zoneNeeded as number) > state.lumens;
      if (hullWanted && hullCost(state, zoneNeeded as number) <= state.lumens && buyHull(state).ok) {
        events.push({ t, kind: 'hull', detail: (ZONES[zoneNeeded as number] as (typeof ZONES)[number]).hullName });
        notePurchase(t);
        continue;
      }
      if (diveBlock(state) === null && (options.diveGate?.(state, t) ?? true)) {
        const result = dive(state);
        if (result.ok) {
          if (firstReach[state.depthStep] === undefined) {
            firstReach[state.depthStep] = t;
            lumensAtReach[state.depthStep] = state.lifetimeLumens;
          }
          notePurchase(t);
          if (result.enteredZone !== null) {
            events.push({ t, kind: 'zone', detail: (ZONES[result.enteredZone] as (typeof ZONES)[number]).name, value: result.enteredZone });
          }
          if (result.reachedFloor && !floorLogged) {
            floorLogged = true;
            events.push({ t, kind: 'floor', detail: `${depthOfStep(TOTAL_STEPS)} m` });
          }
          continue;
        }
      }
      const research = availableResearch(state)[0];
      if (research && research.cost <= state.lumens * (saving ? 0.2 : 1) && buyResearch(state, research.id)) {
        events.push({ t, kind: 'research', detail: research.id });
        notePurchase(t);
        continue;
      }
      if (saving) break;
      // Best value fleet unit that is affordable right now.
      let best = -1;
      let bestPayback = Infinity;
      for (let gen = 0; gen < GENERATORS.length; gen++) {
        if (!generatorUnlocked(state, gen)) continue;
        const cost = generatorCost(state, gen, 1);
        if (cost > state.lumens) continue;
        const gain = marginalRate(state, gen);
        const payback = gain > 0 ? cost / gain : Infinity;
        if (payback < bestPayback) {
          bestPayback = payback;
          best = gen;
        }
      }
      if (best >= 0 && buyGenerator(state, best, 1) > 0) {
        if (!seenGenerators.has(best)) {
          seenGenerators.add(best);
          events.push({ t, kind: 'generator', detail: (GENERATORS[best] as (typeof GENERATORS)[number]).name, value: best });
        }
        notePurchase(t);
        continue;
      }
      break;
    }

    const automated = runAutomation(state);
    if (automated.dived > 0 && firstReach[state.depthStep] === undefined) {
      firstReach[state.depthStep] = t;
      lumensAtReach[state.depthStep] = state.lifetimeLumens;
    }
    if (t % 5 === 0) checkAchievements(state);

    // --- publishing
    if (!options.noPublish && canPublish(state) && state.stats.runSeconds >= profile.minRunSeconds) {
      const zoneNeeded = hullNeeded(state);
      const blocked = zoneNeeded !== null && hullLocked(state, zoneNeeded) && diveBlock(state) === 'hull';
      const toEarn = Math.max(0, surveyTarget(state) - state.survey) + (zoneNeeded !== null && !hullLocked(state, zoneNeeded) ? Math.max(0, hullCost(state, zoneNeeded) - state.lumens) : 0);
      const wait = atSeaFloor(state) ? Infinity : earningRate > 0 ? toEarn / earningRate : Infinity;
      if (blocked || wait > profile.stallSeconds) {
        const gain = renownOnPublish(state);
        const result = publish(state);
        if (result) {
          events.push({ t, kind: 'publish', detail: `#${state.prestiges} at ${depthOfStep(result.depthStep)} m after ${Math.round(result.runSeconds / 60)} min`, value: gain });
          spendRenown(state, events, t);
          target = null;
          fleetTarget = null;
          streak = 0;
          earningRate = 0;
        }
      }
    }

    if (options.stopWhen?.(state, events)) {
      t++;
      break;
    }
  }

  return { state, events, seconds: t, longestGapFirstTenMinutes: longestGapFirstTen, longestGapOverall, purchases, firstReach, lumensAtReach };
}

function formatClock(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}m` : `${m}m${String(s).padStart(2, '0')}s`;
}

// `node src/game/sim.ts [casual|active|idle] [hours]` prints a timeline.
if (typeof process !== 'undefined' && process.argv[1] && process.argv[1].endsWith('sim.ts')) {
  const profiles: Record<string, BotProfile> = { casual: CASUAL, steady: STEADY, active: ACTIVE, idle: IDLE };
  const profile = profiles[process.argv[2] ?? 'casual'] ?? CASUAL;
  const hours = Number(process.argv[3] ?? 30);
  const verbose = process.argv.includes('--verbose');
  const result = simulate({ profile, maxSeconds: hours * 3600, stopWhen: (state) => state.finished && state.prestiges >= 1 && atSeaFloor(state) });
  for (const event of result.events) {
    if (!verbose && (event.kind === 'research' || event.kind === 'institute')) continue;
    console.log(`${formatClock(event.t).padStart(8)}  ${event.kind.padEnd(9)} ${event.detail}${event.value !== undefined && event.kind === 'publish' ? `  (+${event.value} renown)` : ''}`);
  }
  const s = result.state;
  console.log(
    `\n${profile.name}: stopped at ${formatClock(result.seconds)} | depth ${depthOfStep(s.depthStep)} m (step ${s.depthStep}/${TOTAL_STEPS}) | publishes ${s.prestiges} | renown total ${s.renownTotal} | ` +
      `species ${Object.keys(s.codex).length}/${SPECIES.length} | achievements ${Object.keys(s.achievements).length} | purchases ${result.purchases} | ` +
      `longest gap first 10 min ${result.longestGapFirstTenMinutes}s, overall ${formatClock(result.longestGapOverall)}`,
  );
}
