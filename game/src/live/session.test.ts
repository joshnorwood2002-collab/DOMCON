import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CreatureView } from '../contracts.ts';
import { mulberry32 } from '../core/rng.ts';
import type { ScanOutcome } from '../game/actions.ts';
import { COMBO_WINDOW, SHOAL_DURATION, SHOAL_SIZE, invalidateModifiers, surveyTarget } from '../game/economy.ts';
import { createState, type GameState } from '../game/state.ts';
import { Session, type SessionEvents } from './session.ts';

interface Log {
  hits: number;
  misses: number;
  scans: { creature: CreatureView; outcome: ScanOutcome; byFleet: boolean; streak: number }[];
  shoalScans: number;
  shoalStarts: number;
  shoalEnds: { caught: number; total: number }[];
  legendaries: number;
}

function harness(state: GameState = createState(1), seed = 5): { session: Session; log: Log; state: GameState } {
  const log: Log = { hits: 0, misses: 0, scans: [], shoalScans: 0, shoalStarts: 0, shoalEnds: [], legendaries: 0 };
  const events: SessionEvents = {
    hit: () => {
      log.hits += 1;
    },
    miss: () => {
      log.misses += 1;
    },
    scan: (creature, outcome, streak, byFleet) => {
      log.scans.push({ creature, outcome, byFleet, streak });
    },
    shoalScan: () => {
      log.shoalScans += 1;
    },
    shoalStart: () => {
      log.shoalStarts += 1;
    },
    shoalEnd: (caught, total) => {
      log.shoalEnds.push({ caught, total });
    },
    legendary: () => {
      log.legendaries += 1;
    },
  };
  const session = new Session(() => state, mulberry32(seed), events);
  session.resize(900, 500);
  return { session, log, state };
}

function run(session: Session, seconds: number, step = 0.05): void {
  for (let elapsed = 0; elapsed < seconds; elapsed += step) session.update(step);
}

/** A creature that can be tapped right now, preferring ones that need a single tap. */
function tappable(session: Session, kind: 'normal' | 'shoal' = 'normal'): CreatureView | undefined {
  const scene = session.scene();
  const candidates = scene.creatures.filter((creature) => creature.kind === kind && !creature.fleeing && creature.alpha > 0.5 && creature.x > 0 && creature.x < scene.width);
  return candidates.find((creature) => creature.tapsLeft === 1) ?? candidates[0];
}

test('the water has creatures in it from the very first frame', () => {
  const { session } = harness();
  assert.ok(session.population >= 4);
  const scene = session.scene();
  assert.equal(scene.viewZone, 0);
  assert.equal(scene.depthMetres, 0);
  for (const creature of scene.creatures) {
    assert.equal(creature.species.zone, 0);
    assert.ok(creature.x >= 0 && creature.x <= 900, 'starting creatures are on screen');
  }
});

test('the population stays topped up and bounded', () => {
  const { session } = harness();
  run(session, 60);
  assert.ok(session.population >= 5 && session.population <= 40, `population ${session.population}`);
  const { session: small } = harness();
  small.resize(360, 300);
  run(small, 30);
  assert.ok(small.population >= 3 && small.population <= 30);
});

test('tapping a creature scans it; tapping open water is a miss', () => {
  const { session, log, state } = harness();
  run(session, 1.5);
  const target = tappable(session)!;
  assert.ok(target, 'something is tappable');
  const taps = target.tapsLeft;
  for (let i = 0; i < taps; i++) assert.equal(session.tap(target.x, target.y), true);
  assert.equal(log.scans.length, 1);
  assert.equal(log.hits, taps - 1);
  assert.equal(log.scans[0]!.outcome.discovered, true);
  assert.equal(log.scans[0]!.byFleet, false);
  assert.ok(state.lumens > 0);
  assert.equal(state.stats.taps, taps);
  assert.equal(state.stats.scans, 1);
  assert.equal(session.tap(target.x, target.y), false, 'a scanned creature cannot be scanned again');
  assert.equal(session.tap(-500, -500), false);
  assert.equal(log.misses, 2);
});

test('quick hits build a streak and a pause ends it', () => {
  const { session } = harness();
  run(session, 1.5);
  for (let i = 0; i < 4; i++) {
    const target = tappable(session);
    if (target) session.tap(target.x, target.y);
    run(session, 0.3);
  }
  assert.ok(session.streak >= 3, `streak ${session.streak}`);
  run(session, COMBO_WINDOW + 0.2);
  assert.equal(session.streak, 0);
});

test('a shoal arrives when due, can be scanned, and schedules the next one', () => {
  const state = createState(1);
  state.maxStepEver = 5;
  state.clock = 500;
  state.nextShoalAt = 400;
  const { session, log } = harness(state);
  run(session, 0.2);
  assert.equal(log.shoalStarts, 1);
  assert.equal(session.scene().shoalActive, true);
  let caught = 0;
  for (let elapsed = 0; elapsed < SHOAL_DURATION + 2; elapsed += 0.1) {
    session.update(0.1);
    const fish = tappable(session, 'shoal');
    if (fish && session.tap(fish.x, fish.y)) caught += 1;
  }
  assert.ok(caught >= 5, `caught ${caught}`);
  assert.equal(log.shoalScans, caught);
  assert.deepEqual(log.shoalEnds, [{ caught, total: SHOAL_SIZE }]);
  assert.equal(session.scene().shoalActive, false);
  assert.ok(state.nextShoalAt > state.clock, 'the next shoal is in the future');
  assert.equal(state.stats.shoalsCaught, caught);
});

test('no shoal in the opening seconds of a new game', () => {
  const state = createState(1);
  state.clock = 999;
  state.nextShoalAt = 0;
  const { session, log } = harness(state);
  run(session, 3);
  assert.equal(log.shoalStarts, 0);
});

test('the fleet studies known species by itself and never discovers or pays', () => {
  const state = createState(1);
  state.generators[1] = 6;
  state.research['auto1'] = true;
  invalidateModifiers(state);
  const { session, log } = harness(state);
  run(session, 30);
  assert.equal(log.scans.length, 0, 'nothing is known yet, so the fleet has nothing to study');
  assert.equal(state.lumens, 0);
  for (const id of ['z0s0', 'z0s1', 'z0s2', 'z0s3', 'z0s4']) state.codex[id] = 1;
  run(session, 60);
  const fleetScans = log.scans.filter((scan) => scan.byFleet);
  assert.ok(fleetScans.length >= 3, `fleet scans ${fleetScans.length}`);
  for (const scan of fleetScans) {
    assert.equal(scan.outcome.discovered, false);
    assert.equal(scan.outcome.lumens, 0);
  }
  assert.equal(state.lumens, 0);
  assert.equal(session.scene().drones.length, 1, 'one craft per fleet tier owned');
});

test('the view follows the sub into a new zone and can revisit old ones', () => {
  const state = createState(1);
  state.depthStep = 20;
  state.maxStepEver = 20;
  state.hullZone = 1;
  const { session } = harness(state);
  assert.equal(session.viewZone, 1);
  assert.equal(session.setViewZone(0), 0);
  run(session, 3);
  assert.ok(session.scene().creatures.some((creature) => creature.species.zone === 0 && !creature.fleeing));
  assert.equal(session.scene().depthMetres, 100, 'a revisited zone shows its middle depth');
  assert.equal(session.setViewZone(4), 1, 'cannot look deeper than the sub has gone');
  session.afterDive(null);
  assert.equal(session.scene().diveRush, 1);
  state.depthStep = 52;
  state.hullZone = 2;
  session.afterDive(2);
  assert.equal(session.viewZone, 2);
  run(session, 3);
  assert.ok(session.scene().creatures.filter((creature) => !creature.fleeing).every((creature) => creature.species.zone === 2));
  assert.equal(session.scene().diveRush, 0);
  // After publishing the sub is back at the surface.
  state.depthStep = 0;
  state.hullZone = 0;
  session.reset();
  assert.equal(session.viewZone, 0);
  assert.equal(session.scene().atFloor, false);
});

test('creatures keep clear of the interface at the top and bottom', () => {
  const { session } = harness();
  session.setSafeArea(80, 110);
  session.resize(900, 500);
  run(session, 40);
  for (const creature of session.scene().creatures) {
    if (creature.fleeing) continue;
    assert.ok(creature.y > 80 - 30 && creature.y < 500 - 110 + 30, `creature at y=${creature.y}`);
  }
});

test('the scene reports the sea floor once the sub is there', () => {
  const state = createState(1);
  state.depthStep = 181;
  state.maxStepEver = 181;
  state.hullZone = 4;
  state.survey = surveyTarget(state);
  const { session } = harness(state);
  const scene = session.scene();
  assert.equal(scene.atFloor, true);
  assert.equal(scene.depthMetres, 10900);
  assert.equal(scene.zoneProgress, 1);
});

test('leaving the zone in the middle of a shoal ends it instead of banking another', () => {
  const state = createState(1);
  state.depthStep = 20;
  state.maxStepEver = 20;
  state.hullZone = 1;
  state.clock = 500;
  state.nextShoalAt = 400;
  const { session, log } = harness(state);
  run(session, 0.5);
  assert.equal(log.shoalStarts, 1);
  // Flip to the shallows and back, over and over, as fast as the interface allows.
  for (let flip = 0; flip < 12; flip++) {
    session.setViewZone(0);
    run(session, 0.3);
    session.setViewZone(1);
    run(session, 2);
  }
  assert.equal(log.shoalStarts, 1, 'no new shoal can be conjured by switching zones');
  assert.equal(log.shoalEnds.length, 1);
  assert.ok(state.nextShoalAt > state.clock, 'the next shoal is properly in the future');
});

test('the fleet leaves alone any creature the player has started scanning', () => {
  const state = createState(1);
  state.generators[1] = 6;
  state.research['auto1'] = true;
  state.research['auto2'] = true;
  state.research['auto3'] = true;
  state.research['auto4'] = true;
  invalidateModifiers(state);
  for (const id of Array.from({ length: 9 }, (_, index) => `z0s${index}`)) state.codex[id] = 1;
  const { session, log } = harness(state, 11);
  let checked = 0;
  for (let elapsed = 0; elapsed < 240 && checked < 6; elapsed += 0.1) {
    session.update(0.1);
    const scene = session.scene();
    const target = scene.creatures.find((creature) => creature.kind === 'normal' && !creature.fleeing && creature.tapsTotal > 1 && creature.tapsLeft === creature.tapsTotal && creature.alpha > 0.7 && creature.x > 60 && creature.x < scene.width - 60);
    if (!target) continue;
    const id = target.id;
    assert.equal(session.tap(target.x, target.y), true);
    // Give the fleet plenty of time to finish it off, if it were allowed to.
    for (let wait = 0; wait < 6; wait += 0.1) session.update(0.1);
    assert.ok(!log.scans.some((scan) => scan.byFleet && scan.creature.id === id), 'the fleet did not take the scan');
    checked += 1;
  }
  assert.ok(checked >= 3, `only found ${checked} multi-tap creatures to test`);
  assert.ok(log.scans.some((scan) => scan.byFleet), 'the fleet is still scanning other creatures');
});
