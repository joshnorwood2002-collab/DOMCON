// Works out how many lumens each depth's survey should need, so that the game
// unfolds on a chosen schedule, and writes the result to src/game/surveys.ts.
//
//   node scripts/fit-surveys.ts          fit and write the table
//   node scripts/fit-surveys.ts --dry    fit and print only
//
// Two design decisions drive everything:
//   1. targetSeconds(): how long a first-time player should spend at each of
//      the first depths (the "head"). The simulator's casual player is run
//      and the surveys are sized to make that schedule come true.
//   2. WALL_SLOPE: past the head, each survey takes this many times longer
//      than the one before for a player whose income has stopped being
//      boosted by publishing. That steady slowdown is what makes publishing
//      (the prestige loop) worthwhile, and it sets how many expeditions the
//      whole game takes.

import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOTAL_STEPS } from '../src/game/content.ts';
import { TUNING, rebuildSurveyTable } from '../src/game/economy.ts';
import { STEADY, simulate } from '../src/game/sim.ts';
import { createState } from '../src/game/state.ts';

/** Seconds a first-time player should spend at dive index `step` before diving again. */
export function targetSeconds(step: number): number {
  if (step === 0) return 40; // the first dive, after a handful of buoys
  if (step < 20) return 12 + (step - 1) * 1.1; // the Shallows: 12s rising to 32s
  if (step < 28) return 34 + (step - 20) * 3; // upper Twilight: 34s rising to 55s
  return 62 * Math.pow(WALL_SLOPE, step - 28); // then the pace drags until publishing is the better move
}

export const HEAD_STEPS = 40;
export const WALL_SLOPE = 1.22;
/** Pace of the reference run used to measure how income grows with depth. */
const REFERENCE_SECONDS_PER_STEP = 45;

const TINY = Array.from({ length: TOTAL_STEPS }, () => 1e-6);

function useSurveys(surveys: readonly number[]): void {
  TUNING.surveys = surveys;
  rebuildSurveyTable();
}

/** Sizes of the first HEAD_STEPS surveys that make a first expedition follow targetSeconds(). */
function fitHead(log: boolean): number[] {
  const times = [0];
  for (let step = 0; step < HEAD_STEPS; step++) times.push((times[step] as number) + targetSeconds(step));
  const total = times[HEAD_STEPS] as number;

  // Pass 1: let the player dive exactly on schedule and record what was earned at each depth.
  useSurveys(TINY);
  const forced = simulate({
    profile: STEADY,
    maxSeconds: Math.ceil(total) + 5,
    noPublish: true,
    diveGate: (state, second) => state.depthStep < HEAD_STEPS && second >= (times[state.depthStep + 1] as number),
    stopWhen: (state) => state.depthStep >= HEAD_STEPS,
  });
  let head = Array.from({ length: HEAD_STEPS }, (_, step) => {
    const from = forced.lumensAtReach[step] ?? 0;
    const to = forced.lumensAtReach[step + 1] ?? from;
    return Math.max(1, to - from);
  });

  // Later passes: play by the real rules (hulls now cost lumens) and correct each survey by how far off it was.
  for (let pass = 0; pass < 12; pass++) {
    useSurveys(head);
    const real = simulate({ profile: STEADY, maxSeconds: Math.ceil(total * 3), noPublish: true, stopWhen: (state) => state.depthStep >= HEAD_STEPS });
    let worst = 0;
    const next = head.slice();
    for (let step = 0; step < HEAD_STEPS; step++) {
      const from = real.firstReach[step];
      const to = real.firstReach[step + 1];
      if (from === undefined || to === undefined) continue;
      const ratio = targetSeconds(step) / Math.max(1, to - from);
      worst = Math.max(worst, Math.abs(Math.log(ratio)));
      next[step] = (head[step] as number) * Math.pow(Math.min(2, Math.max(0.5, ratio)), 0.7);
    }
    if (log) console.error(`head pass ${pass + 1}: dive ${real.state.depthStep} at ${real.seconds}s (target ${Math.round(total)}s); worst depth off by x${Math.exp(worst).toFixed(2)}`);
    if (worst < 0.08) break;
    head = next;
  }
  return head;
}

/**
 * Lumens earned at each depth by a player who dives every
 * REFERENCE_SECONDS_PER_STEP seconds and never publishes. Its shape shows how
 * fast income grows with depth when nothing but the dive schedule limits it.
 */
function referenceEarnings(): number[] {
  useSurveys(TINY);
  const start = createState(12345, 0);
  // The reference player has both late-zone blueprints, so only the schedule gates it.
  start.institute = { titanium: 1, foam: 1 };
  const run = simulate({
    profile: STEADY,
    from: start,
    maxSeconds: TOTAL_STEPS * REFERENCE_SECONDS_PER_STEP + 60,
    noPublish: true,
    diveGate: (state, second) => second >= (state.depthStep + 1) * REFERENCE_SECONDS_PER_STEP,
    stopWhen: (state) => state.depthStep >= TOTAL_STEPS,
  });
  const earned: number[] = [];
  for (let step = 0; step < TOTAL_STEPS; step++) {
    const from = run.lumensAtReach[step] ?? 0;
    const to = run.lumensAtReach[step + 1];
    earned.push(to === undefined ? Number.NaN : Math.max(1, to - from));
  }
  return earned;
}

export function fitSurveys(log = false): number[] {
  const head = fitHead(log);
  const earned = referenceEarnings();
  const table = head.slice();
  const anchorEarned = earned[HEAD_STEPS - 1] as number;
  const anchorSurvey = head[HEAD_STEPS - 1] as number;
  for (let step = HEAD_STEPS; step < TOTAL_STEPS; step++) {
    const shape = (earned[step] as number) / anchorEarned;
    if (!Number.isFinite(shape)) throw new Error(`reference run never reached dive ${step + 1}`);
    table.push(anchorSurvey * shape * Math.pow(WALL_SLOPE, step - (HEAD_STEPS - 1)));
  }
  return tidy(smooth(table));
}

/**
 * Evens out the table in log space (a short moving average), so that one
 * lucky or unlucky stretch of the reference run does not leave a cliff or a
 * plateau in the game. The first few depths are left exactly as fitted.
 */
function smooth(table: readonly number[]): number[] {
  const logs = table.map((value) => Math.log(value));
  const radius = 2;
  return logs.map((value, index) => {
    if (index < 4) return Math.exp(value);
    let sum = 0;
    let count = 0;
    for (let offset = -radius; offset <= radius; offset++) {
      const neighbour = logs[index + offset];
      if (neighbour !== undefined && index + offset >= 3) {
        sum += neighbour;
        count += 1;
      }
    }
    return Math.exp(sum / count);
  });
}

/** Rounds to three figures and makes every survey at least 8% bigger than the last. */
function tidy(table: readonly number[]): number[] {
  const out: number[] = [];
  for (const value of table) {
    const previous = out[out.length - 1] ?? 0;
    out.push(Number(Math.max(value, previous * 1.08).toPrecision(3)));
  }
  return out;
}

if (process.argv[1]?.endsWith('fit-surveys.ts')) {
  const table = fitSurveys(true);
  const lines: string[] = [];
  for (let i = 0; i < table.length; i += 8) lines.push('  ' + table.slice(i, i + 8).map((value) => value.toExponential(2).replace('e+', 'e')).join(', ') + ',');
  const source =
    `// GENERATED by scripts/fit-surveys.ts - do not edit by hand.\n` +
    `// Lumens to earn at each depth before the next dive unlocks (index = dive index).\n` +
    `// Head: first ${HEAD_STEPS} depths fitted to the first-expedition schedule. Tail: income shape x ${WALL_SLOPE} per depth.\n` +
    `export const SURVEY_TARGETS: readonly number[] = [\n${lines.join('\n')}\n];\n`;
  if (process.argv.includes('--dry')) {
    console.log(source);
  } else {
    const target = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/game/surveys.ts');
    await writeFile(target, source);
    console.error(`wrote ${table.length} survey targets to ${path.relative(process.cwd(), target)}`);
  }
}
