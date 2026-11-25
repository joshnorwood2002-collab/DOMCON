// The live scene: creatures that swim across the play area, the taps that
// scan them, the timed shoal event and the fleet's own scanning. It owns no
// drawing and no DOM, so it runs the same in the browser and in tests.

import type { CreatureView, DroneView, SceneView } from '../contracts.ts';
import { clamp, pick, randRange, weightedPick, type Rng } from '../core/rng.ts';
import {
  completeScan,
  completeShoalScan,
  currentZone,
  registerTap,
  scheduleNextShoal,
  tapsNeeded,
  type ScanOutcome,
} from '../game/actions.ts';
import { GENERATORS, RARITIES, SPECIES, ZONES, type Archetype, type Rarity, type SpeciesDef } from '../game/content.ts';
import {
  COMBO_WINDOW,
  SHOAL_DURATION,
  SHOAL_SIZE,
  atSeaFloor,
  depthOfStep,
  frenzyActive,
  getModifiers,
  rarityWeights,
  sonarActive,
} from '../game/economy.ts';
import type { GameState } from '../game/state.ts';

interface Creature {
  id: number;
  species: SpeciesDef;
  kind: 'normal' | 'shoal';
  x: number;
  y: number;
  dir: 1 | -1;
  size: number;
  phase: number;
  tapsLeft: number;
  tapsTotal: number;
  hitFlash: number;
  alpha: number;
  fleeing: boolean;
  targeted: boolean;
  /** Horizontal speed in px/s (always positive; `dir` gives the sign). */
  speed: number;
  baseY: number;
  bobAmp: number;
  bobRate: number;
  /** Tap radius in px. */
  radius: number;
  /** True once told to leave (zone change or dive): fades out without a reward. */
  leaving: boolean;
  targetedFor: number;
}

interface Drone {
  id: number;
  x: number;
  y: number;
  tier: number;
  targetId: number | null;
  phase: number;
  beamFor: number;
}

export interface SessionEvents {
  /** A tap landed on a creature that still needs more taps. */
  hit(creature: CreatureView, streak: number): void;
  /** A tap landed on open water. */
  miss(x: number, y: number): void;
  /** A scan finished. `byFleet` scans were made by the fleet, not the player. */
  scan(creature: CreatureView, outcome: ScanOutcome, streak: number, byFleet: boolean): void;
  shoalScan(creature: CreatureView, lumens: number, frenzyStarted: boolean, caught: number, streak: number): void;
  shoalStart(): void;
  shoalEnd(caught: number, total: number): void;
  /** A legendary creature has just swum into view. */
  legendary(species: SpeciesDef): void;
}

/** Cruising speed range in px/s at unit scale. */
const SPEEDS: Readonly<Record<Archetype, readonly [number, number]>> = {
  fish: [42, 78],
  lantern: [46, 72],
  eel: [30, 52],
  jelly: [12, 24],
  angler: [22, 38],
  ray: [34, 56],
  comb: [10, 20],
  squid: [38, 66],
};

const SIZE_BY_RARITY: Readonly<Record<Rarity, number>> = { common: 1, uncommon: 1.18, rare: 1.42, legendary: 2 };
const LEGENDARY_COOLDOWN = 40;
const EDGE_MARGIN = 150;
/** Seconds a shoal spends arriving before the last one has entered. */
const SHOAL_SPAWN_WINDOW = 4.5;
const MAX_DRONES = 6;

export class Session {
  width = 800;
  height = 450;
  unit = 1;
  /** Pixels at the top and bottom of the play area that the interface covers. */
  safeTop = 64;
  safeBottom = 96;
  viewZone: number;
  time = 0;
  streak = 0;
  diveRush = 0;
  shoalActive = false;

  private creatures: Creature[] = [];
  private drones: Drone[] = [];
  private nextId = 1;
  private lastHitAt = -Infinity;
  private spawnIn = 0;
  private autoCarry = 0;
  private legendaryIn = 12;
  private shoalEndsAt = 0;
  private shoalSpawned = 0;
  private shoalCaught = 0;
  private shoalNextSpawn = 0;
  private shoalDir: 1 | -1 = 1;
  private shoalLane = 0.5;

  private readonly getState: () => GameState;
  private readonly rng: Rng;
  private readonly events: SessionEvents;

  constructor(getState: () => GameState, rng: Rng, events: SessionEvents) {
    this.getState = getState;
    this.rng = rng;
    this.events = events;
    this.viewZone = currentZone(getState());
    this.populate();
  }

  // ---------------------------------------------------------------- layout

  resize(width: number, height: number): void {
    const first = this.width === 800 && this.height === 450 && this.time === 0;
    const scaleX = width / this.width;
    const scaleY = height / this.height;
    this.width = Math.max(120, width);
    this.height = Math.max(120, height);
    this.unit = clamp(Math.min(this.width, this.height * 1.25) / 620, 0.62, 1.35);
    for (const creature of this.creatures) {
      creature.x *= scaleX;
      creature.baseY = this.clampLane(creature.baseY * scaleY);
      creature.y = creature.baseY;
    }
    for (const drone of this.drones) {
      drone.x *= scaleX;
      drone.y *= scaleY;
    }
    if (first) {
      this.creatures = [];
      this.populate();
    }
  }

  setSafeArea(top: number, bottom: number): void {
    this.safeTop = Math.max(0, top);
    this.safeBottom = Math.max(0, bottom);
  }

  private clampLane(y: number): number {
    const top = this.safeTop + 26 * this.unit;
    const bottom = this.height - this.safeBottom - 26 * this.unit;
    return bottom > top ? clamp(y, top, bottom) : this.height / 2;
  }

  private capacity(): number {
    return Math.round(clamp(5 + (this.width * this.height) / 75_000, 6, 13));
  }

  // ---------------------------------------------------------------- zones

  /** Shows a zone the player has already reached. Returns the zone now on screen. */
  setViewZone(zone: number): number {
    const target = Math.round(clamp(zone, 0, currentZone(this.getState())));
    if (target !== this.viewZone) {
      this.viewZone = target;
      this.dismissAll();
      this.spawnIn = 0.15;
    }
    return this.viewZone;
  }

  /** Call after every successful dive. Keeps the view on the sub unless the player chose to look elsewhere. */
  afterDive(enteredZone: number | null): void {
    this.diveRush = 1;
    if (enteredZone !== null) {
      this.viewZone = enteredZone;
      this.dismissAll();
      this.spawnIn = 0.3;
      this.legendaryIn = Math.max(this.legendaryIn, 10);
    }
  }

  /** Call when the expedition restarts or a save is loaded. */
  reset(): void {
    this.viewZone = currentZone(this.getState());
    this.creatures = [];
    this.streak = 0;
    this.shoalActive = false;
    this.autoCarry = 0;
    this.populate();
  }

  private dismissAll(): void {
    for (const creature of this.creatures) {
      creature.leaving = true;
      creature.fleeing = true;
    }
    this.shoalActive = false;
  }

  // ---------------------------------------------------------------- spawning

  private populate(): void {
    const count = Math.ceil(this.capacity() * 0.7);
    for (let i = 0; i < count; i++) this.spawn(true);
  }

  private chooseSpecies(): SpeciesDef | null {
    const state = this.getState();
    const pool = SPECIES.filter((species) => species.zone === this.viewZone);
    if (pool.length === 0) return null;
    const weights = rarityWeights(state);
    const legendaryOnScreen = this.creatures.some((creature) => creature.species.rarity === 'legendary' && !creature.fleeing);
    const options: { weight: number; value: Rarity }[] = (Object.keys(RARITIES) as Rarity[])
      .filter((rarity) => pool.some((species) => species.rarity === rarity))
      .filter((rarity) => rarity !== 'legendary' || (this.legendaryIn <= 0 && !legendaryOnScreen))
      .map((rarity) => ({ weight: weights[rarity], value: rarity }));
    if (options.length === 0) return null;
    // New players should meet every common species quickly, so undiscovered ones are favoured a little.
    const rarity = weightedPick(this.rng, options);
    const candidates = pool.filter((species) => species.rarity === rarity);
    const fresh = candidates.filter((species) => (state.codex[species.id] ?? 0) === 0);
    return pick(this.rng, fresh.length > 0 && this.rng() < 0.6 ? fresh : candidates);
  }

  private spawn(anywhere: boolean): void {
    const species = this.chooseSpecies();
    if (!species) return;
    const [slow, fast] = SPEEDS[species.archetype];
    const dir: 1 | -1 = this.rng() < 0.5 ? 1 : -1;
    const size = SIZE_BY_RARITY[species.rarity] * randRange(this.rng, 0.9, 1.1);
    const baseY = this.clampLane(randRange(this.rng, this.safeTop, this.height - this.safeBottom));
    const creature: Creature = {
      id: this.nextId++,
      species,
      kind: 'normal',
      x: anywhere ? randRange(this.rng, this.width * 0.08, this.width * 0.92) : dir === 1 ? -EDGE_MARGIN * this.unit : this.width + EDGE_MARGIN * this.unit,
      y: baseY,
      dir,
      size,
      phase: this.rng() * 20,
      tapsLeft: tapsNeeded(species),
      tapsTotal: tapsNeeded(species),
      hitFlash: 0,
      alpha: 0,
      fleeing: false,
      targeted: false,
      speed: randRange(this.rng, slow, fast) * this.unit * (species.rarity === 'legendary' ? 0.6 : 1),
      baseY,
      bobAmp: randRange(this.rng, 4, 14) * this.unit * (species.archetype === 'jelly' || species.archetype === 'comb' ? 1.8 : 1),
      bobRate: randRange(this.rng, 0.5, 1.2),
      radius: Math.max(30, 34 * this.unit * Math.pow(size, 0.85)),
      leaving: false,
      targetedFor: 0,
    };
    this.creatures.push(creature);
    if (species.rarity === 'legendary') {
      this.legendaryIn = LEGENDARY_COOLDOWN;
      this.events.legendary(species);
    }
  }

  private shoalSpecies(): SpeciesDef | null {
    const commons = SPECIES.filter((species) => species.zone === this.viewZone && species.rarity === 'common');
    return commons.find((species) => species.archetype === 'fish' || species.archetype === 'lantern') ?? commons[0] ?? null;
  }

  private spawnShoalMember(): void {
    const species = this.shoalSpecies();
    if (!species) return;
    const lane = this.clampLane(this.height * this.shoalLane + randRange(this.rng, -0.16, 0.16) * this.height);
    // Fast enough to cross the whole play area before the event ends.
    const crossing = Math.max(3.5, SHOAL_DURATION - SHOAL_SPAWN_WINDOW - 1);
    const creature: Creature = {
      id: this.nextId++,
      species,
      kind: 'shoal',
      x: this.shoalDir === 1 ? -60 * this.unit : this.width + 60 * this.unit,
      y: lane,
      dir: this.shoalDir,
      size: 0.72,
      phase: this.rng() * 20,
      tapsLeft: 1,
      tapsTotal: 1,
      hitFlash: 0,
      alpha: 0,
      fleeing: false,
      targeted: false,
      speed: ((this.width + 120 * this.unit) / crossing) * randRange(this.rng, 0.9, 1.12),
      baseY: lane,
      bobAmp: randRange(this.rng, 8, 20) * this.unit,
      bobRate: randRange(this.rng, 1.4, 2.4),
      radius: Math.max(34, 40 * this.unit),
      leaving: false,
      targetedFor: 0,
    };
    this.creatures.push(creature);
  }

  // ---------------------------------------------------------------- frame update

  update(dt: number): void {
    if (!(dt > 0)) return;
    const state = this.getState();
    this.time += dt;
    this.diveRush = Math.max(0, this.diveRush - dt * 1.25);
    this.legendaryIn -= dt;
    if (this.time - this.lastHitAt > COMBO_WINDOW) this.streak = 0;
    // The sub can never be shown deeper than it has dived (after publishing, say).
    if (this.viewZone > currentZone(state)) this.setViewZone(currentZone(state));

    this.updateShoal(state, dt);

    // Keep the water populated.
    const alive = this.creatures.filter((creature) => creature.kind === 'normal' && !creature.fleeing).length;
    this.spawnIn -= dt;
    if (alive < this.capacity() && this.spawnIn <= 0) {
      this.spawn(false);
      this.spawnIn = randRange(this.rng, 0.35, 1.1) * (alive < this.capacity() / 2 ? 0.4 : 1);
    }

    for (const creature of this.creatures) {
      const pace = creature.fleeing ? 4.2 : 1;
      creature.x += creature.dir * creature.speed * pace * dt;
      const rush = creature.leaving || creature.kind === 'shoal' ? 0 : this.diveRush;
      creature.baseY -= rush * 220 * this.unit * dt;
      creature.y = creature.baseY + Math.sin((this.time + creature.phase) * creature.bobRate) * creature.bobAmp;
      creature.hitFlash = Math.max(0, creature.hitFlash - dt * 3.5);
      creature.targetedFor = Math.max(0, creature.targetedFor - dt);
      creature.targeted = creature.targetedFor > 0;
      const fadeTarget = creature.fleeing ? 0 : 1;
      const fadeRate = creature.fleeing ? (creature.leaving ? 5 : 2.4) : 2.2;
      creature.alpha += clamp(fadeTarget - creature.alpha, -fadeRate * dt, fadeRate * dt);
    }
    const limit = EDGE_MARGIN * this.unit + 40;
    this.creatures = this.creatures.filter(
      (creature) => !(creature.fleeing && creature.alpha <= 0.01) && creature.x > -limit && creature.x < this.width + limit && creature.baseY > -limit,
    );

    this.updateFleet(state, dt);
  }

  private updateShoal(state: GameState, dt: number): void {
    if (!this.shoalActive) {
      // Not in the first moments of a new game, and only where the sub actually is.
      if (state.maxStepEver >= 2 && state.clock >= state.nextShoalAt && this.viewZone === currentZone(state)) {
        this.shoalActive = true;
        this.shoalEndsAt = this.time + SHOAL_DURATION;
        this.shoalSpawned = 0;
        this.shoalCaught = 0;
        this.shoalNextSpawn = 0;
        this.shoalDir = this.rng() < 0.5 ? 1 : -1;
        this.shoalLane = randRange(this.rng, 0.35, 0.65);
        this.events.shoalStart();
      }
      return;
    }
    this.shoalNextSpawn -= dt;
    while (this.shoalSpawned < SHOAL_SIZE && this.shoalNextSpawn <= 0) {
      this.spawnShoalMember();
      this.shoalSpawned += 1;
      this.shoalNextSpawn += SHOAL_SPAWN_WINDOW / SHOAL_SIZE;
    }
    const remaining = this.creatures.some((creature) => creature.kind === 'shoal' && !creature.fleeing);
    if (this.time >= this.shoalEndsAt || (this.shoalSpawned >= SHOAL_SIZE && !remaining)) {
      this.shoalActive = false;
      for (const creature of this.creatures) {
        if (creature.kind === 'shoal') {
          creature.fleeing = true;
          creature.leaving = true;
        }
      }
      scheduleNextShoal(state, this.rng());
      this.events.shoalEnd(this.shoalCaught, SHOAL_SIZE);
    }
  }

  private updateFleet(state: GameState, dt: number): void {
    // One small craft on screen for each of the best fleet tiers owned.
    const tiers: number[] = [];
    for (let gen = GENERATORS.length - 1; gen >= 0 && tiers.length < MAX_DRONES; gen--) {
      if ((state.generators[gen] ?? 0) > 0) tiers.push(gen);
    }
    while (this.drones.length < tiers.length) {
      this.drones.push({
        id: this.nextId++,
        x: randRange(this.rng, 0.2, 0.8) * this.width,
        y: randRange(this.rng, 0.3, 0.7) * this.height,
        tier: 0,
        targetId: null,
        phase: this.rng() * 30,
        beamFor: 0,
      });
    }
    if (this.drones.length > tiers.length) this.drones.length = tiers.length;
    this.drones.forEach((drone, index) => {
      drone.tier = tiers[index] ?? 0;
      drone.beamFor = Math.max(0, drone.beamFor - dt);
      if (drone.beamFor <= 0) drone.targetId = null;
      // A slow figure-of-eight patrol, each craft on its own path.
      const t = this.time * 0.11 + drone.phase;
      const homeX = this.width * (0.5 + 0.36 * Math.sin(t * 1.3 + index));
      const homeY = this.clampLane(this.height * (0.5 + 0.26 * Math.sin(t * 2.1 + index * 1.7)));
      drone.x += (homeX - drone.x) * Math.min(1, dt * 0.9);
      drone.y += (homeY - drone.y) * Math.min(1, dt * 0.9);
    });

    const interval = getModifiers(state).autoScanInterval;
    if (interval <= 0 || this.drones.length === 0) {
      this.autoCarry = 0;
      return;
    }
    this.autoCarry += dt / interval;
    while (this.autoCarry >= 1) {
      this.autoCarry -= 1;
      // The fleet only studies species the player has already identified.
      const known = this.creatures.filter(
        (creature) => creature.kind === 'normal' && !creature.fleeing && creature.alpha > 0.6 && (state.codex[creature.species.id] ?? 0) > 0 && creature.x > 20 && creature.x < this.width - 20,
      );
      const target = known.find((creature) => creature.targeted) ?? (known.length > 0 ? pick(this.rng, known) : null);
      if (!target) continue;
      let nearest: Drone | null = null;
      let best = Infinity;
      for (const drone of this.drones) {
        const distance = Math.hypot(drone.x - target.x, drone.y - target.y);
        if (distance < best) {
          best = distance;
          nearest = drone;
        }
      }
      if (nearest) {
        nearest.targetId = target.id;
        nearest.beamFor = Math.min(0.7, interval * 0.9);
      }
      target.targetedFor = Math.max(0.5, interval * 1.2);
      target.targeted = true;
      target.tapsLeft -= 1;
      target.hitFlash = Math.max(target.hitFlash, 0.6);
      if (target.tapsLeft <= 0) {
        const outcome = completeScan(state, target.species.id, { byFleet: true });
        target.fleeing = true;
        if (outcome) this.events.scan(target, outcome, 0, true);
      }
    }
  }

  // ---------------------------------------------------------------- input

  /** A tap or click at play-area coordinates. Returns true when it hit a creature. */
  tap(x: number, y: number): boolean {
    const state = this.getState();
    let target: Creature | null = null;
    let best = Infinity;
    for (const creature of this.creatures) {
      if (creature.fleeing || creature.alpha < 0.25) continue;
      const distance = Math.hypot(creature.x - x, creature.y - y);
      // Shoal fish are quick, so they win ties; otherwise the nearest creature under the finger.
      const score = distance - (creature.kind === 'shoal' ? 12 : 0);
      if (distance <= creature.radius && score < best) {
        best = score;
        target = creature;
      }
    }
    if (!target) {
      this.events.miss(x, y);
      return false;
    }
    this.streak = this.time - this.lastHitAt <= COMBO_WINDOW ? this.streak + 1 : 1;
    this.lastHitAt = this.time;
    registerTap(state, this.streak);
    target.tapsLeft -= 1;
    target.hitFlash = 1;
    if (target.tapsLeft > 0) {
      this.events.hit(target, this.streak);
      return true;
    }
    target.fleeing = true;
    if (target.kind === 'shoal') {
      this.shoalCaught += 1;
      const result = completeShoalScan(state, this.streak, this.shoalCaught);
      this.events.shoalScan(target, result.lumens, result.frenzyStarted, this.shoalCaught, this.streak);
    } else {
      const outcome = completeScan(state, target.species.id, { streak: this.streak });
      if (outcome) this.events.scan(target, outcome, this.streak, false);
    }
    return true;
  }

  // ---------------------------------------------------------------- view

  scene(): SceneView {
    const state = this.getState();
    const zone = ZONES[this.viewZone] as (typeof ZONES)[number];
    const subDepth = depthOfStep(state.depthStep);
    const here = this.viewZone === currentZone(state);
    const creatures: readonly CreatureView[] = this.creatures;
    const drones: readonly DroneView[] = this.drones;
    return {
      width: this.width,
      height: this.height,
      unit: this.unit,
      viewZone: this.viewZone,
      depthMetres: here ? subDepth : (zone.topDepth + zone.bottomDepth) / 2,
      zoneProgress: here ? clamp((subDepth - zone.topDepth) / (zone.bottomDepth - zone.topDepth), 0, 1) : 0.5,
      atFloor: here && atSeaFloor(state),
      creatures,
      drones,
      shoalActive: this.shoalActive,
      sonarActive: sonarActive(state),
      frenzyActive: frenzyActive(state),
      diveRush: this.diveRush,
      time: this.time,
      streak: this.streak,
    };
  }

  /** Number of creatures in the water, for tests. */
  get population(): number {
    return this.creatures.length;
  }
}
