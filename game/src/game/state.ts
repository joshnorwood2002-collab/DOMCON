// The whole saved game in one plain, JSON-serialisable object.

import { GENERATORS } from './content.ts';

export const SAVE_VERSION = 1;

export interface Settings {
  music: boolean;
  sfx: boolean;
  /** Show 1.23e9 instead of 1.23B. */
  scientific: boolean;
  /** Fewer particles and no screen shake. Defaults to the system preference. */
  reducedMotion: boolean;
}

export interface Stats {
  taps: number;
  /** Finished scans, by hand or by the fleet. */
  scans: number;
  shoalsCaught: number;
  bestCombo: number;
  /** Seconds played with the game open, all expeditions. */
  playSeconds: number;
  /** Seconds played in the current expedition. */
  runSeconds: number;
  /** Deepest dive index reached in the current expedition. */
  maxStepThisRun: number;
  /** Shortest expedition so far, in seconds (0 until one is published). */
  fastestRunSeconds: number;
}

export interface GameState {
  version: number;
  /** Seeds the look of this player's creatures. */
  seed: number;
  /** Seconds of simulated play. Boost and event timers are measured against it. */
  clock: number;
  lumens: number;
  /** Lumens earned in the current expedition. */
  runLumens: number;
  lifetimeLumens: number;
  /** Number of dives made in the current expedition; see depthOfStep(). */
  depthStep: number;
  /** Lumens earned since arriving at the current depth; fills the survey bar that unlocks the next dive. */
  survey: number;
  maxStepEver: number;
  /** Deepest zone the current hull can enter. Resets each expedition. */
  hullZone: number;
  /** Units owned of each generator, indexed like GENERATORS. */
  generators: number[];
  /** Research bought in the current expedition. */
  research: Record<string, true>;
  /** Finished scans per species id. Kept forever. */
  codex: Record<string, number>;
  renown: number;
  renownTotal: number;
  prestiges: number;
  /** Institute upgrade levels by id. Kept forever. */
  institute: Record<string, number>;
  achievements: Record<string, true>;
  stats: Stats;
  /** Sonar Burst (x2 income) is active until this clock time. */
  sonarUntil: number;
  /** Sonar Burst can be started again at this clock time. */
  sonarReadyAt: number;
  /** Feeding Frenzy is active until this clock time. */
  frenzyUntil: number;
  nextShoalAt: number;
  /** Wall-clock time (ms since epoch) when the game was last saved; drives offline income. */
  lastSeen: number;
  /** How far through the first-minutes guidance the player is. */
  tutorial: number;
  /** True once the sea floor has been reached in any expedition. */
  finished: boolean;
  /** Local calendar day (days since 1970) on which the daily gift was last claimed; 0 = never. */
  dailyDay: number;
  /** Consecutive days the gift has been claimed. */
  dailyStreak: number;
  settings: Settings;
}

export function createState(seed = 1, nowMs = 0): GameState {
  return {
    version: SAVE_VERSION,
    seed,
    clock: 0,
    lumens: 0,
    runLumens: 0,
    lifetimeLumens: 0,
    depthStep: 0,
    survey: 0,
    maxStepEver: 0,
    hullZone: 0,
    generators: GENERATORS.map(() => 0),
    research: {},
    codex: {},
    renown: 0,
    renownTotal: 0,
    prestiges: 0,
    institute: {},
    achievements: {},
    stats: {
      taps: 0,
      scans: 0,
      shoalsCaught: 0,
      bestCombo: 0,
      playSeconds: 0,
      runSeconds: 0,
      maxStepThisRun: 0,
      fastestRunSeconds: 0,
    },
    sonarUntil: 0,
    sonarReadyAt: 0,
    frenzyUntil: 0,
    nextShoalAt: 75,
    lastSeen: nowMs,
    tutorial: 0,
    finished: false,
    dailyDay: 0,
    dailyStreak: 0,
    settings: { music: true, sfx: true, scientific: false, reducedMotion: false },
  };
}

export function cloneState(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state)) as GameState;
}
