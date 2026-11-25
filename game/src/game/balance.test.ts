// Pacing tests. Nobody can sit through hours of play in CI, so simulated
// players (sim.ts) play the real rules and these tests hold the results to the
// windows the game was designed around. If a content or tuning change makes
// the game drag, rush or stall, one of these fails.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TOTAL_STEPS } from './content.ts';
import { PRESTIGE_MIN_STEP } from './economy.ts';
import { ACTIVE, CASUAL, IDLE, STEADY, simulate, type SimResult } from './sim.ts';

const MINUTE = 60;
const HOUR = 3600;

function reached(result: SimResult, step: number): number {
  const second = result.firstReach[step];
  assert.ok(second !== undefined, `dive ${step} was never reached`);
  return second;
}

function publishes(result: SimResult): { t: number; depth: number }[] {
  return result.events
    .filter((event) => event.kind === 'publish')
    .map((event) => ({ t: event.t, depth: Number(/at (\d+) m/.exec(event.detail)?.[1] ?? 0) }));
}

test('the opening minutes of a first expedition unfold on schedule', () => {
  const result = simulate({ profile: STEADY, maxSeconds: 30 * MINUTE, noPublish: true, stopWhen: (state) => state.depthStep >= PRESTIGE_MIN_STEP });
  const firstBuoy = result.events.find((event) => event.kind === 'generator');
  assert.ok(firstBuoy && firstBuoy.t <= 15, `first fleet unit within 15 seconds (got ${firstBuoy?.t})`);
  assert.ok(reached(result, 1) >= 20 && reached(result, 1) <= 75, `first dive at ${reached(result, 1)}s`);
  assert.ok(reached(result, 3) <= 2.5 * MINUTE, `Scout Drone depth at ${reached(result, 3)}s`);
  assert.ok(reached(result, 20) >= 5 * MINUTE && reached(result, 20) <= 11 * MINUTE, `Twilight Reach at ${reached(result, 20)}s`);
  assert.ok(reached(result, PRESTIGE_MIN_STEP) >= 10 * MINUTE && reached(result, PRESTIGE_MIN_STEP) <= 20 * MINUTE, `publishing unlocks at ${reached(result, PRESTIGE_MIN_STEP)}s`);
  assert.ok(result.longestGapFirstTenMinutes <= 40, `never more than 40 seconds without something to buy early on (got ${result.longestGapFirstTenMinutes})`);
  // No single depth should take wildly longer than the one before it.
  for (let step = 2; step < PRESTIGE_MIN_STEP; step++) {
    const here = reached(result, step + 1) - reached(result, step);
    assert.ok(here <= 90, `depth ${step} took ${here}s`);
  }
});

test('a first expedition slows down enough that publishing becomes the better move', () => {
  const result = simulate({ profile: STEADY, maxSeconds: 3 * HOUR, noPublish: true });
  assert.ok(result.state.depthStep >= PRESTIGE_MIN_STEP + 4, `reached dive ${result.state.depthStep}`);
  assert.ok(result.state.depthStep < 60, `a single expedition should stall well before the Midnight Drift is crossed (reached ${result.state.depthStep})`);
});

for (const [profile, minHours, maxHours] of [
  [CASUAL, 2.5, 7],
  [STEADY, 2.5, 8],
  [ACTIVE, 1.5, 5],
  [IDLE, 5, 30],
] as const) {
  test(`a ${profile.name} player reaches the sea floor in ${minHours}-${maxHours} hours`, () => {
    const result = simulate({ profile, maxSeconds: maxHours * HOUR + 60, stopWhen: (state) => state.finished });
    assert.ok(result.state.finished, `${profile.name} never reached the floor (deepest dive ${result.state.maxStepEver} of ${TOTAL_STEPS})`);
    const floorAt = reached(result, TOTAL_STEPS);
    assert.ok(floorAt >= minHours * HOUR, `${profile.name} finished too fast: ${(floorAt / HOUR).toFixed(2)}h`);
    assert.ok(floorAt <= maxHours * HOUR, `${profile.name} finished too slowly: ${(floorAt / HOUR).toFixed(2)}h`);

    const runs = publishes(result);
    assert.ok(runs.length >= 6 && runs.length <= 24, `${profile.name} published ${runs.length} times`);
    // Every expedition must get at least as deep as the one before: the prestige loop never stalls.
    for (let i = 1; i < runs.length; i++) {
      assert.ok(runs[i]!.depth >= runs[i - 1]!.depth, `${profile.name} expedition ${i + 1} went shallower (${runs[i]!.depth} m after ${runs[i - 1]!.depth} m)`);
    }
    // Zones arrive in order, each later than the last.
    const zoneTimes = [20, 52, 92, 132].map((step) => reached(result, step));
    for (let i = 1; i < zoneTimes.length; i++) assert.ok(zoneTimes[i]! > zoneTimes[i - 1]!);
    assert.ok(Object.keys(result.state.codex).length >= 9, 'at least the first zone gets catalogued');
  });
}

test('tapping helps but does not dwarf an idle fleet', () => {
  const active = simulate({ profile: ACTIVE, maxSeconds: 12 * HOUR, stopWhen: (state) => state.finished });
  const idle = simulate({ profile: IDLE, maxSeconds: 40 * HOUR, stopWhen: (state) => state.finished });
  const ratio = reached(idle, TOTAL_STEPS) / reached(active, TOTAL_STEPS);
  assert.ok(ratio >= 1.5 && ratio <= 8, `idle takes ${ratio.toFixed(1)}x as long as active`);
});
