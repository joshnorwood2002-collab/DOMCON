// Static game content: zones, fleet, research, institute upgrades, species and
// achievements. Nothing here reads or changes game state; the formulas that
// combine these tables live in economy.ts.

// ---------------------------------------------------------------- zones

export interface ZoneDef {
  readonly id: number;
  readonly name: string;
  readonly topDepth: number;
  readonly bottomDepth: number;
  /** Metres gained per dive while inside this zone. */
  readonly stepMetres: number;
  readonly blurb: string;
  /** Name of the pressure hull needed to enter (zone 0 needs none). */
  readonly hullName: string;
}

export const ZONES: readonly ZoneDef[] = [
  { id: 0, name: 'Sunlit Shallows', topDepth: 0, bottomDepth: 200, stepMetres: 10, hullName: 'Fibreglass Hull', blurb: 'Warm water, bright colours, and enough light to read by.' },
  { id: 1, name: 'Twilight Reach', topDepth: 200, bottomDepth: 1000, stepMetres: 25, hullName: 'Steel Hull', blurb: 'The last blue glow of the sun. Things here start making their own light.' },
  { id: 2, name: 'Midnight Drift', topDepth: 1000, bottomDepth: 4000, stepMetres: 75, hullName: 'Alloy Hull', blurb: 'No sunlight has ever reached this far. Every glow is alive.' },
  { id: 3, name: 'Abyssal Plain', topDepth: 4000, bottomDepth: 6000, stepMetres: 50, hullName: 'Titanium Sphere', blurb: 'A cold, slow desert of silt, crossed by patient giants.' },
  { id: 4, name: 'Hadal Trench', topDepth: 6000, bottomDepth: 10900, stepMetres: 100, hullName: 'Foam-Core Sphere', blurb: 'The deepest cut in the world. Almost nobody has seen what lives here.' },
];

/** Dive index at which each zone begins; the last entry is the sea floor. */
export const ZONE_START_STEP: readonly number[] = (() => {
  const starts = [0];
  for (const zone of ZONES) {
    starts.push((starts[starts.length - 1] as number) + Math.round((zone.bottomDepth - zone.topDepth) / zone.stepMetres));
  }
  return starts;
})();

export const TOTAL_STEPS: number = ZONE_START_STEP[ZONES.length] as number;

// ---------------------------------------------------------------- fleet

export interface GeneratorDef {
  readonly id: number;
  readonly name: string;
  readonly plural: string;
  readonly description: string;
  readonly baseCost: number;
  /** Lumens per second from one unit before any multiplier. */
  readonly baseRate: number;
  /** Deepest dive index the player must have reached, in any expedition, to unlock it. */
  readonly unlockStep: number;
}

export const GENERATORS: readonly GeneratorDef[] = [
  { id: 0, name: 'Glow Buoy', plural: 'Glow Buoys', baseCost: 12, baseRate: 0.3, unlockStep: 0, description: 'A drifting float that logs whatever swims past.' },
  { id: 1, name: 'Scout Drone', plural: 'Scout Drones', baseCost: 130, baseRate: 2, unlockStep: 3, description: 'A fist-sized camera that follows the shoals.' },
  { id: 2, name: 'Lantern Rig', plural: 'Lantern Rigs', baseCost: 1_500, baseRate: 15, unlockStep: 9, description: 'Soft lamps that draw curious animals close.' },
  { id: 3, name: 'Sonar Array', plural: 'Sonar Arrays', baseCost: 18_000, baseRate: 120, unlockStep: 16, description: 'Maps every echo in the water column.' },
  { id: 4, name: 'Specimen Lab', plural: 'Specimen Labs', baseCost: 230_000, baseRate: 1_000, unlockStep: 24, description: 'Catalogues samples the moment they come aboard.' },
  { id: 5, name: 'Deep Rover', plural: 'Deep Rovers', baseCost: 3_200_000, baseRate: 9_000, unlockStep: 34, description: 'A tracked crawler built for the dark.' },
  { id: 6, name: 'Thermal Probe', plural: 'Thermal Probes', baseCost: 48_000_000, baseRate: 85_000, unlockStep: 46, description: 'Reads the heat signatures of hidden life.' },
  { id: 7, name: 'Abyss Station', plural: 'Abyss Stations', baseCost: 750_000_000, baseRate: 850_000, unlockStep: 60, description: 'A permanent outpost bolted to the plain.' },
  { id: 8, name: 'Silt Harvester', plural: 'Silt Harvesters', baseCost: 12e9, baseRate: 9e6, unlockStep: 76, description: 'Sifts the sea floor one careful scoop at a time.' },
  { id: 9, name: 'Trench Crawler', plural: 'Trench Crawlers', baseCost: 200e9, baseRate: 95e6, unlockStep: 96, description: 'Clings to the trench wall and never sleeps.' },
  { id: 10, name: 'Pressure Forge', plural: 'Pressure Forges', baseCost: 3.6e12, baseRate: 1.1e9, unlockStep: 120, description: 'Builds instruments where they will be used: at the bottom.' },
  { id: 11, name: 'Leviathan Listener', plural: 'Leviathan Listeners', baseCost: 68e12, baseRate: 13e9, unlockStep: 146, description: 'Hears things that have no name yet.' },
];

/** Each extra unit of a generator costs this much more than the last. */
export const GENERATOR_COST_GROWTH = 1.14;

/** Owning this many of one generator doubles that generator's output (each threshold stacks). */
export const FLEET_MILESTONES: readonly number[] = [10, 25, 50, 100, 150, 200, 250, 300, 400, 500];

// ---------------------------------------------------------------- effects

/** Everything an upgrade can do. economy.ts folds these into one Modifiers record. */
export type Effect =
  | { readonly kind: 'tapMult'; readonly value: number }
  | { readonly kind: 'globalMult'; readonly value: number }
  | { readonly kind: 'genMult'; readonly gen: number; readonly value: number }
  /** Each tap also yields this fraction of fleet income per second. */
  | { readonly kind: 'resonance'; readonly value: number }
  /** Longest scan streak that still raises the combo bonus (each step is +10%). */
  | { readonly kind: 'comboCap'; readonly value: number }
  /** Shoals arrive this many times as often. */
  | { readonly kind: 'shoalRate'; readonly value: number }
  | { readonly kind: 'shoalMult'; readonly value: number }
  | { readonly kind: 'frenzy'; readonly value: number }
  /** The fleet scans one on-screen creature on its own every `value` seconds. */
  | { readonly kind: 'autoScanInterval'; readonly value: number }
  | { readonly kind: 'diveDiscount'; readonly value: number }
  | { readonly kind: 'generatorDiscount'; readonly value: number }
  | { readonly kind: 'offlineHours'; readonly value: number }
  | { readonly kind: 'offlineEfficiency'; readonly value: number }
  | { readonly kind: 'codexBonus'; readonly value: number }
  | { readonly kind: 'rareChance'; readonly value: number }
  | { readonly kind: 'renownMult'; readonly value: number }
  | { readonly kind: 'studySpeed'; readonly value: number }
  | { readonly kind: 'seedBuoys'; readonly value: number }
  | { readonly kind: 'unlockZone'; readonly value: number }
  | { readonly kind: 'autoDive' }
  | { readonly kind: 'autoBuy' };

// ---------------------------------------------------------------- research

/** Research is bought with lumens and lasts for the current expedition only. */
export interface ResearchDef {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly cost: number;
  readonly effect: Effect;
  /** Shown once the player has dived this deep in the current expedition. */
  readonly requiresStep?: number;
  /** Shown once the player owns this many of a generator. */
  readonly requiresGenerator?: { readonly gen: number; readonly count: number };
  readonly group: 'scanner' | 'analysis' | 'shoal' | 'automation' | 'fleet';
}

const GENERATOR_UPGRADE_NAMES: readonly (readonly [string, string])[] = [
  ['Brighter Bulbs', 'Solar Skins'],
  ['Wider Lenses', 'Shoal Tracking'],
  ['Warm Filaments', 'Lure Patterns'],
  ['Phased Pings', 'Echo Mapping'],
  ['Flash Freezers', 'Gene Readers'],
  ['Wide Tracks', 'Silt Skis'],
  ['Fine Thermistors', 'Vent Charts'],
  ['Second Shift', 'Pressure Docks'],
  ['Finer Sieves', 'Tidal Scoops'],
  ['Barbed Grips', 'Cliff Lamps'],
  ['Hotter Coals', 'Diamond Anvils'],
  ['Longer Ears', 'Whale Grammar'],
];

function generatorResearch(): ResearchDef[] {
  const list: ResearchDef[] = [];
  for (const gen of GENERATORS) {
    const names = GENERATOR_UPGRADE_NAMES[gen.id] as readonly [string, string];
    list.push({
      id: `gen${gen.id}a`,
      name: names[0],
      description: `${gen.plural} work twice as fast.`,
      cost: gen.baseCost * 12,
      effect: { kind: 'genMult', gen: gen.id, value: 2 },
      requiresGenerator: { gen: gen.id, count: 10 },
      group: 'fleet',
    });
    list.push({
      id: `gen${gen.id}b`,
      name: names[1],
      description: `${gen.plural} work three times as fast.`,
      cost: gen.baseCost * 900,
      effect: { kind: 'genMult', gen: gen.id, value: 3 },
      requiresGenerator: { gen: gen.id, count: 40 },
      group: 'fleet',
    });
  }
  return list;
}

export const RESEARCH: readonly ResearchDef[] = [
  // Scanner: makes each tap worth more.
  { id: 'scan1', group: 'scanner', name: 'Polished Lens', description: 'Your scans are worth twice as much.', cost: 60, effect: { kind: 'tapMult', value: 2 } },
  { id: 'scan2', group: 'scanner', name: 'Twin Emitters', description: 'Your scans are worth twice as much again.', cost: 750, effect: { kind: 'tapMult', value: 2 }, requiresStep: 4 },
  { id: 'scan3', group: 'scanner', name: 'Phase Array', description: 'Your scans are worth three times as much.', cost: 18_000, effect: { kind: 'tapMult', value: 3 }, requiresStep: 13 },
  { id: 'scan4', group: 'scanner', name: 'Coherent Beam', description: 'Your scans are worth three times as much.', cost: 800_000, effect: { kind: 'tapMult', value: 3 }, requiresStep: 22 },
  { id: 'scan5', group: 'scanner', name: 'Deepfield Lidar', description: 'Your scans are worth four times as much.', cost: 60_000_000, effect: { kind: 'tapMult', value: 4 }, requiresStep: 36 },
  { id: 'scan6', group: 'scanner', name: 'Abyssal Optics', description: 'Your scans are worth five times as much.', cost: 9e9, effect: { kind: 'tapMult', value: 5 }, requiresStep: 56 },
  { id: 'scan7', group: 'scanner', name: 'Hadal Lens', description: 'Your scans are worth six times as much.', cost: 4e12, effect: { kind: 'tapMult', value: 6 }, requiresStep: 84 },
  { id: 'res1', group: 'scanner', name: 'Resonance', description: 'Each scan also earns 1% of what your fleet makes in a second.', cost: 4_000, effect: { kind: 'resonance', value: 0.01 }, requiresStep: 8 },
  { id: 'res2', group: 'scanner', name: 'Harmonic Lock', description: 'Each scan earns a further 2% of your fleet income.', cost: 2_500_000, effect: { kind: 'resonance', value: 0.02 }, requiresStep: 28 },
  { id: 'res3', group: 'scanner', name: 'Standing Wave', description: 'Each scan earns a further 3% of your fleet income.', cost: 7e9, effect: { kind: 'resonance', value: 0.03 }, requiresStep: 52 },
  { id: 'combo1', group: 'scanner', name: 'Steady Hands', description: 'Scan streaks build a combo worth up to double.', cost: 300, effect: { kind: 'comboCap', value: 10 }, requiresStep: 2 },
  { id: 'combo2', group: 'scanner', name: 'Rhythm', description: 'Combos now build up to triple.', cost: 70_000, effect: { kind: 'comboCap', value: 20 }, requiresStep: 15 },
  { id: 'combo3', group: 'scanner', name: 'Flow State', description: 'Combos now build up to four times.', cost: 140_000_000, effect: { kind: 'comboCap', value: 30 }, requiresStep: 40 },

  // Analysis: multiplies everything.
  { id: 'glob1', group: 'analysis', name: 'Field Notes', description: 'All lumens income +50%.', cost: 2_200, effect: { kind: 'globalMult', value: 1.5 }, requiresStep: 6 },
  { id: 'glob2', group: 'analysis', name: 'Cross-Referencing', description: 'All lumens income +50%.', cost: 110_000, effect: { kind: 'globalMult', value: 1.5 }, requiresStep: 18 },
  { id: 'glob3', group: 'analysis', name: 'Peer Review', description: 'All lumens income doubled.', cost: 14_000_000, effect: { kind: 'globalMult', value: 2 }, requiresStep: 30 },
  { id: 'glob4', group: 'analysis', name: 'Machine Vision', description: 'All lumens income doubled.', cost: 6e9, effect: { kind: 'globalMult', value: 2 }, requiresStep: 50 },
  { id: 'glob5', group: 'analysis', name: 'Grand Synthesis', description: 'All lumens income x2.5.', cost: 3e12, effect: { kind: 'globalMult', value: 2.5 }, requiresStep: 80 },
  { id: 'glob6', group: 'analysis', name: 'Unified Catalogue', description: 'All lumens income tripled.', cost: 2e15, effect: { kind: 'globalMult', value: 3 }, requiresStep: 118 },

  // Shoals: the timed bonus event.
  { id: 'shoal1', group: 'shoal', name: 'Shoal Spotter', description: 'Glimmer shoals turn up 40% more often.', cost: 5_000, effect: { kind: 'shoalRate', value: 1.4 }, requiresStep: 11 },
  { id: 'shoal2', group: 'shoal', name: 'Wide Sweep', description: 'Shoal scans are worth three times as much.', cost: 450_000, effect: { kind: 'shoalMult', value: 3 }, requiresStep: 20 },
  { id: 'shoal3', group: 'shoal', name: 'Feeding Frenzy', description: 'Scan 8 of a shoal to triple all income for 20 seconds.', cost: 35_000_000, effect: { kind: 'frenzy', value: 3 }, requiresStep: 33 },

  // Automation: lets the fleet scan creatures by itself.
  { id: 'auto1', group: 'automation', name: 'Target Lock', description: 'Your fleet scans a creature by itself every 4 seconds.', cost: 1_400, effect: { kind: 'autoScanInterval', value: 4 }, requiresGenerator: { gen: 1, count: 5 } },
  { id: 'auto2', group: 'automation', name: 'Swarm Logic', description: 'Automatic scans now happen every 2 seconds.', cost: 240_000, effect: { kind: 'autoScanInterval', value: 2 }, requiresGenerator: { gen: 3, count: 5 } },
  { id: 'auto3', group: 'automation', name: 'Hive Mind', description: 'Automatic scans now happen every second.', cost: 75_000_000, effect: { kind: 'autoScanInterval', value: 1 }, requiresGenerator: { gen: 5, count: 5 } },
  { id: 'auto4', group: 'automation', name: 'Total Coverage', description: 'Automatic scans now happen twice a second.', cost: 5e10, effect: { kind: 'autoScanInterval', value: 0.5 }, requiresGenerator: { gen: 7, count: 5 } },

  ...generatorResearch(),
];

// ---------------------------------------------------------------- institute

/** Institute upgrades are bought with Renown and are kept forever. */
export interface InstituteDef {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly maxLevel: number;
  readonly baseCost: number;
  readonly costGrowth: number;
  /** Effect of ONE level; economy.ts decides how levels stack. */
  readonly effect: Effect;
  /** Hidden until the player has finished this many expeditions. */
  readonly requiresPrestiges?: number;
}

export const INSTITUTE: readonly InstituteDef[] = [
  { id: 'grant', name: 'Grant Funding', description: 'All lumens income doubles with every level.', maxLevel: 200, baseCost: 2, costGrowth: 1.8, effect: { kind: 'globalMult', value: 2 } },
  { id: 'patron', name: 'Deep Patron', description: 'Your scans are worth x2.5 per level.', maxLevel: 200, baseCost: 1, costGrowth: 2.4, effect: { kind: 'tapMult', value: 2.5 } },
  { id: 'crew', name: 'Veteran Crew', description: 'Depth surveys need 12% fewer lumens per level.', maxLevel: 12, baseCost: 2, costGrowth: 2.1, effect: { kind: 'diveDiscount', value: 0.88 } },
  { id: 'seed', name: 'Seed Fleet', description: 'Start every expedition with 5 more Glow Buoys.', maxLevel: 6, baseCost: 1, costGrowth: 2.6, effect: { kind: 'seedBuoys', value: 5 } },
  { id: 'night', name: 'Night Shift', description: 'Offline time counts for 2 more hours and 10% more income.', maxLevel: 5, baseCost: 3, costGrowth: 3, effect: { kind: 'offlineHours', value: 2 } },
  { id: 'autopilot', name: 'Autopilot', description: 'The sub dives by itself as soon as a survey is finished.', maxLevel: 1, baseCost: 4, costGrowth: 1, effect: { kind: 'autoDive' } },
  { id: 'manager', name: 'Fleet Manager', description: 'Buys fleet units for you whenever they are cheap.', maxLevel: 1, baseCost: 25, costGrowth: 1, effect: { kind: 'autoBuy' }, requiresPrestiges: 1 },
  { id: 'titanium', name: 'Titanium Sphere', description: 'Blueprints for a hull that survives the Abyssal Plain.', maxLevel: 1, baseCost: 12, costGrowth: 1, effect: { kind: 'unlockZone', value: 3 } },
  { id: 'foam', name: 'Foam-Core Sphere', description: 'Blueprints for a hull that survives the Hadal Trench.', maxLevel: 1, baseCost: 900, costGrowth: 1, effect: { kind: 'unlockZone', value: 4 }, requiresPrestiges: 2 },
  { id: 'taxonomy', name: 'Taxonomist', description: 'Each codex study level is worth 1% more.', maxLevel: 6, baseCost: 4, costGrowth: 2.8, effect: { kind: 'codexBonus', value: 0.01 }, requiresPrestiges: 1 },
  { id: 'eyes', name: 'Keen Eyes', description: 'Rare and legendary creatures appear 30% more often per level.', maxLevel: 5, baseCost: 3, costGrowth: 3, effect: { kind: 'rareChance', value: 1.3 } },
  { id: 'echo', name: 'Echo Memory', description: 'Codex studies fill twice as fast.', maxLevel: 1, baseCost: 40, costGrowth: 1, effect: { kind: 'studySpeed', value: 2 }, requiresPrestiges: 1 },
  { id: 'press', name: 'University Press', description: 'Earn 25% more Renown per level.', maxLevel: 8, baseCost: 5, costGrowth: 2.5, effect: { kind: 'renownMult', value: 0.25 }, requiresPrestiges: 1 },
  { id: 'bulk', name: 'Bulk Requisition', description: 'Fleet units cost 8% less per level.', maxLevel: 5, baseCost: 8, costGrowth: 3, effect: { kind: 'generatorDiscount', value: 0.92 }, requiresPrestiges: 1 },
];

// ---------------------------------------------------------------- species

export type Rarity = 'common' | 'uncommon' | 'rare' | 'legendary';
export type Archetype = 'fish' | 'lantern' | 'eel' | 'jelly' | 'angler' | 'ray' | 'comb' | 'squid';

export interface RarityDef {
  /** Relative chance of spawning within a zone. */
  readonly weight: number;
  /** Taps needed to finish a scan. */
  readonly taps: number;
  /** Reward multiplier for a finished scan. */
  readonly value: number;
  /** Finished scans needed for study levels 1 to 5. */
  readonly study: readonly [number, number, number, number, number];
  readonly label: string;
}

export const RARITIES: Readonly<Record<Rarity, RarityDef>> = {
  common: { weight: 70, taps: 1, value: 1, study: [1, 10, 50, 250, 1000], label: 'Common' },
  uncommon: { weight: 22, taps: 2, value: 3, study: [1, 6, 30, 120, 500], label: 'Uncommon' },
  rare: { weight: 7, taps: 4, value: 10, study: [1, 4, 12, 45, 160], label: 'Rare' },
  legendary: { weight: 1, taps: 8, value: 50, study: [1, 2, 5, 15, 50], label: 'Legendary' },
};

export const MAX_STUDY_LEVEL = 5;

export interface SpeciesDef {
  readonly id: string;
  readonly name: string;
  readonly zone: number;
  readonly rarity: Rarity;
  readonly archetype: Archetype;
  readonly note: string;
}

type SpeciesRow = readonly [name: string, rarity: Rarity, archetype: Archetype, note: string];

const SPECIES_ROWS: readonly (readonly SpeciesRow[])[] = [
  [
    ['Coral Darter', 'common', 'fish', 'Never swims in a straight line if a wiggle will do.'],
    ['Sunstripe Minnow', 'common', 'fish', 'Travels in shoals so tight they cast one shadow.'],
    ['Reef Lancer', 'common', 'fish', 'Fast, nosy, and first to inspect anything new.'],
    ['Kelp Ribbon', 'common', 'eel', 'Hides by pretending to be a strand of weed.'],
    ['Pearl Drifter', 'common', 'jelly', 'Goes wherever the current is going.'],
    ['Amber Fantail', 'uncommon', 'fish', 'Fans its tail when it thinks it is being watched.'],
    ['Glass Skimmer', 'uncommon', 'ray', 'Glides just under the surface, chasing sun flecks.'],
    ['Dawn Manta', 'rare', 'ray', 'Seen at first light, and gone by the time you look twice.'],
    ['The Gilded Sailfin', 'legendary', 'fish', 'Sailors swore it was a sunbeam that learned to swim.'],
  ],
  [
    ['Lantern Smelt', 'common', 'lantern', 'Carries a row of tiny lights along each flank.'],
    ['Dusk Hatchet', 'common', 'fish', 'Thin as a coin, and nearly as shiny.'],
    ['Veil Jelly', 'common', 'jelly', 'Trails a curtain of stinging threads behind it.'],
    ['Ribbon Wraith', 'common', 'eel', 'Ties itself in loose knots while it rests.'],
    ['Silver Needle', 'common', 'fish', 'Hangs head-up in the gloom, waiting.'],
    ['Comb Glimmer', 'uncommon', 'comb', 'Its rainbow is not light of its own, just beating hairs.'],
    ['Blink Squid', 'uncommon', 'squid', 'Flashes once, then is somewhere else.'],
    ['Violet Siphon', 'rare', 'jelly', 'A colony of thousands that moves as one animal.'],
    ['The Twilight Oar', 'legendary', 'eel', 'Longer than the sub. Possibly longer than the story.'],
  ],
  [
    ['Ember Angler', 'common', 'angler', 'Fishes with a lamp grown from its own spine.'],
    ['Ghost Lantern', 'common', 'lantern', 'Blinks in patterns nobody has decoded.'],
    ['Gloom Squid', 'common', 'squid', 'Wears a cloak of webbed arms.'],
    ['Prism Comb', 'common', 'comb', 'Scatters your lamp back at you in every colour.'],
    ['Pale Gulper', 'common', 'eel', 'Mostly mouth, with a little eel attached.'],
    ['Starback Ray', 'uncommon', 'ray', 'Its back looks like a night sky nobody has seen.'],
    ['Cinder Jelly', 'uncommon', 'jelly', 'Glows red, the colour that hides best down here.'],
    ['Crown Angler', 'rare', 'angler', 'Three lures. Greedy, or just thorough.'],
    ['The Drowned Star', 'legendary', 'jelly', 'A bell as wide as a house, pulsing once a minute.'],
  ],
  [
    ['Ash Ray', 'common', 'ray', 'Leaves slow trails in silt that last for years.'],
    ['Bone Eel', 'common', 'eel', 'Pale enough to count its vertebrae.'],
    ['Wisp Comb', 'common', 'comb', 'So fragile a careless current would unmake it.'],
    ['Hollow Angler', 'common', 'angler', 'Its lamp is the only light for a mile.'],
    ['Deep Lantern', 'common', 'lantern', 'Signals to others that may never answer.'],
    ['Glass Squid', 'uncommon', 'squid', 'Transparent, apart from the eyes.'],
    ['Spectre Jelly', 'uncommon', 'jelly', 'Drifts a hand above the mud, tasting it.'],
    ['Abyss Monarch', 'rare', 'ray', 'Other animals move aside for it. So does the silt.'],
    ['The Patient One', 'legendary', 'squid', 'It has been waiting here. It will keep waiting.'],
  ],
  [
    ['Trench Sprite', 'common', 'fish', 'Small, soft, and entirely at home under a tonne per thumbnail.'],
    ['Null Eel', 'common', 'eel', 'Has no eyes and does not seem to miss them.'],
    ['Rift Jelly', 'common', 'jelly', 'Rides warm water rising from the cracks.'],
    ['Echo Comb', 'common', 'comb', 'Its shimmer repeats, like something calling back.'],
    ['Pressure Angler', 'common', 'angler', 'Built like a fist. Lit like a chapel.'],
    ['Vent Squid', 'uncommon', 'squid', 'Warms its arms at the vents between hunts.'],
    ['Scar Ray', 'uncommon', 'ray', 'Each mark on its back is a rockfall it survived.'],
    ['Hadal Seraph', 'rare', 'jelly', 'Six slow wings and no hurry at all.'],
    ['The Floor Warden', 'legendary', 'eel', 'The last thing down here. It was expecting you.'],
  ],
];

export const SPECIES: readonly SpeciesDef[] = SPECIES_ROWS.flatMap((rows, zone) =>
  rows.map(([name, rarity, archetype, note], index) => ({
    id: `z${zone}s${index}`,
    name,
    zone,
    rarity,
    archetype,
    note,
  })),
);

export const SPECIES_BY_ID: ReadonlyMap<string, SpeciesDef> = new Map(SPECIES.map((species) => [species.id, species]));

export function speciesInZone(zone: number): readonly SpeciesDef[] {
  return SPECIES.filter((species) => species.zone === zone);
}

// ---------------------------------------------------------------- achievements

export type AchievementMetric =
  | 'depthStep'
  | 'fleetTotal'
  | 'speciesFound'
  | 'scans'
  | 'lifetimeLumens'
  | 'prestiges'
  | 'shoalsCaught'
  | 'studyLevels'
  | 'bestCombo';

export interface AchievementDef {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly metric: AchievementMetric;
  readonly target: number;
}

function ladder(metric: AchievementMetric, prefix: string, rows: readonly (readonly [number, string, string])[]): AchievementDef[] {
  return rows.map(([target, name, description], index) => ({ id: `${prefix}${index}`, name, description, metric, target }));
}

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  ...ladder('depthStep', 'depth', [
    [5, 'Wet Feet', 'Dive to 50 m.'],
    [20, 'Out of the Sun', 'Reach the Twilight Reach at 200 m.'],
    [36, 'Blue to Black', 'Dive to 600 m.'],
    [52, 'Lights Out', 'Reach the Midnight Drift at 1,000 m.'],
    [72, 'Long Way Up', 'Dive to 2,500 m.'],
    [92, 'Flat Earth', 'Reach the Abyssal Plain at 4,000 m.'],
    [112, 'Silt Walker', 'Dive to 5,000 m.'],
    [132, 'Over the Edge', 'Reach the Hadal Trench at 6,000 m.'],
    [162, 'Deeper Than Everest Is Tall', 'Dive to 9,000 m.'],
    [181, 'The Floor', 'Touch the bottom of the trench at 10,900 m.'],
  ]),
  ...ladder('fleetTotal', 'fleet', [
    [10, 'Small Crew', 'Own 10 fleet units.'],
    [50, 'Flotilla', 'Own 50 fleet units.'],
    [150, 'Armada', 'Own 150 fleet units.'],
    [400, 'Busy Water', 'Own 400 fleet units.'],
    [800, 'Standing Room Only', 'Own 800 fleet units.'],
    [1500, 'The Sea Is Mostly Robots', 'Own 1,500 fleet units.'],
  ]),
  ...ladder('speciesFound', 'found', [
    [5, 'First Pages', 'Discover 5 species.'],
    [12, 'Field Guide', 'Discover 12 species.'],
    [20, 'Naturalist', 'Discover 20 species.'],
    [30, 'Curator', 'Discover 30 species.'],
    [40, 'Almost Everything', 'Discover 40 species.'],
    [45, 'Complete Codex', 'Discover every species.'],
  ]),
  ...ladder('scans', 'scans', [
    [50, 'Warming Up', 'Finish 50 scans.'],
    [500, 'Sharp Eye', 'Finish 500 scans.'],
    [5_000, 'Tireless', 'Finish 5,000 scans.'],
    [50_000, 'Seen It All', 'Finish 50,000 scans.'],
  ]),
  ...ladder('lifetimeLumens', 'lumens', [
    [1e4, 'Pocket Change', 'Earn 10 thousand lumens in total.'],
    [1e7, 'Well Lit', 'Earn 10 million lumens in total.'],
    [1e10, 'Lighthouse', 'Earn 10 billion lumens in total.'],
    [1e14, 'Small Sun', 'Earn 100 trillion lumens in total.'],
    [1e18, 'Brighter Than Day', 'Earn a quintillion lumens in total.'],
    [1e22, 'Outshone the Stars', 'Earn 10 sextillion lumens in total.'],
  ]),
  ...ladder('prestiges', 'publish', [
    [1, 'Published', 'Surface and publish your first expedition.'],
    [3, 'Cited', 'Publish 3 expeditions.'],
    [7, 'Tenured', 'Publish 7 expeditions.'],
    [15, 'Emeritus', 'Publish 15 expeditions.'],
  ]),
  ...ladder('shoalsCaught', 'shoal', [
    [1, 'Glimmer', 'Scan a creature from a glimmer shoal.'],
    [60, 'Net Worth', 'Scan 60 shoal creatures.'],
    [600, 'Shoal Whisperer', 'Scan 600 shoal creatures.'],
  ]),
  ...ladder('studyLevels', 'study', [
    [20, 'Homework', 'Reach 20 codex study levels in total.'],
    [80, 'Thesis', 'Reach 80 codex study levels in total.'],
    [160, 'Life Work', 'Reach 160 codex study levels in total.'],
    [225, 'Nothing Left to Learn', 'Fully study every species.'],
  ]),
  ...ladder('bestCombo', 'combo', [
    [10, 'On a Roll', 'Build a 10-scan streak.'],
    [20, 'In the Zone', 'Build a 20-scan streak.'],
    [30, 'Unbroken', 'Build a 30-scan streak.'],
  ]),
];

/** Each achievement adds this much to all income (additive with the others). */
export const ACHIEVEMENT_BONUS = 0.02;
