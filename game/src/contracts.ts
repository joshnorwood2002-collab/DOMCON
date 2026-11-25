// The seams between the game's parts. The rules (src/game) know nothing about
// the screen; the live session (src/live) turns rules into creatures that move
// and can be tapped; the renderer, the interface and the audio engine each
// implement one interface from this file and never import each other.
// main.ts wires them together.

import type { PublishResult } from './game/actions.ts';
import type { AchievementDef, SpeciesDef } from './game/content.ts';
import type { OfflineReport } from './game/economy.ts';
import type { GameState, Settings } from './game/state.ts';

// ---------------------------------------------------------------- the live scene

/** One swimming creature, positioned in play-area CSS pixels. */
export interface CreatureView {
  readonly id: number;
  readonly species: SpeciesDef;
  /** 'shoal' creatures belong to the timed bonus event: small, quick, one tap each. */
  readonly kind: 'normal' | 'shoal';
  readonly x: number;
  readonly y: number;
  /** 1 faces right, -1 faces left. */
  readonly dir: 1 | -1;
  /** Drawing scale: 1 is the species' natural size at the current screen size. */
  readonly size: number;
  /** Per-creature animation offset in seconds, so they do not move in step. */
  readonly phase: number;
  readonly tapsLeft: number;
  readonly tapsTotal: number;
  /** Jumps to 1 when hit and decays to 0; drives the hit flash. */
  readonly hitFlash: number;
  /** 0 to 1; creatures fade in on arrival and out when leaving. */
  readonly alpha: number;
  /** True once scanned: the creature darts away. */
  readonly fleeing: boolean;
  /** True while the fleet is scanning it. */
  readonly targeted: boolean;
}

/** One of the small fleet craft that drift around and scan by themselves. Decorative apart from the beam. */
export interface DroneView {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  /** Fleet tier (index into GENERATORS) this craft represents, for its look. */
  readonly tier: number;
  /** Creature it is scanning right now, if any. */
  readonly targetId: number | null;
  readonly phase: number;
}

/** Everything the renderer needs for one frame. */
export interface SceneView {
  /** Play-area size in CSS pixels. */
  readonly width: number;
  readonly height: number;
  /** Size multiplier for this screen: about 0.7 on a small phone, 1 on a laptop, 1.3 on a big monitor. */
  readonly unit: number;
  /** Zone whose water and creatures are on screen (0 = Sunlit Shallows ... 4 = Hadal Trench). */
  readonly viewZone: number;
  readonly depthMetres: number;
  /** How far through the shown zone the sub is, 0 (top) to 1 (bottom). */
  readonly zoneProgress: number;
  /** True when the sub is resting on the sea floor at the very bottom. */
  readonly atFloor: boolean;
  readonly creatures: readonly CreatureView[];
  readonly drones: readonly DroneView[];
  readonly shoalActive: boolean;
  readonly sonarActive: boolean;
  readonly frenzyActive: boolean;
  /** 1 just after a dive, easing to 0: the water should rush upward past the camera. */
  readonly diveRush: number;
  /** Seconds since the session started, for animation. */
  readonly time: number;
  readonly streak: number;
}

export type FloatStyle = 'gain' | 'big' | 'combo' | 'discover' | 'fleet';

export interface Renderer {
  resize(width: number, height: number, pixelRatio: number): void;
  draw(scene: SceneView): void;
  /** A ring where a tap landed on a creature. */
  scanPulse(x: number, y: number, hue: number): void;
  /** A soft ripple where a tap hit only water. */
  ripple(x: number, y: number): void;
  /** Sparks for a finished scan; `strength` is 1 for a common creature, up to 4 for a legendary. */
  burst(x: number, y: number, hue: number, strength: number): void;
  /** Rising text such as "+1.2K". */
  floatText(x: number, y: number, text: string, style: FloatStyle): void;
  setReducedMotion(reduced: boolean): void;
  /** The main body colour of a species as an HSL hue (0-360), for matching effects. */
  hueOf(species: SpeciesDef): number;
  /**
   * Draws one species into a small canvas for the codex.
   * `silhouette` draws an unknown species as a dark shape with no detail.
   */
  drawPortrait(canvas: HTMLCanvasElement, species: SpeciesDef, silhouette: boolean): void;
}

// ---------------------------------------------------------------- audio

export type Sfx =
  | 'tap'
  | 'scan'
  | 'scanRare'
  | 'discover'
  | 'buy'
  | 'research'
  | 'dive'
  | 'zone'
  | 'hull'
  | 'shoal'
  | 'frenzy'
  | 'sonar'
  | 'publish'
  | 'achievement'
  | 'studyUp'
  | 'daily'
  | 'error'
  | 'ui';

export interface AudioEngine {
  /** Call from a user gesture: browsers refuse to start audio before one. Safe to call repeatedly. */
  unlock(): void;
  setMusicEnabled(on: boolean): void;
  setSfxEnabled(on: boolean): void;
  /** Silences everything while an advert plays or the tab is hidden. */
  setSuspended(suspended: boolean): void;
  /** The ambient bed changes character with the zone on screen. */
  setZone(zone: number): void;
  /** `pitch` is a multiplier (1 = normal); `intensity` 0-1 scales loudness and brightness. */
  play(sfx: Sfx, options?: { pitch?: number; intensity?: number }): void;
}

// ---------------------------------------------------------------- interface

/** What the interface may ask the game to do. Every method is safe to call at any time. */
export interface UiHost {
  /** The live game state. Read it; never write to it. The object is replaced on import or reset, so do not cache it. */
  readonly state: GameState;
  /** True when this build can show rewarded adverts. When false, boosts are free on a cooldown. */
  readonly hasAds: boolean;
  /** Tip jar link, or '' when this build must not show outbound links. */
  readonly tipUrl: string;
  readonly version: string;
  /** Zone currently on screen (the player may revisit shallower zones). */
  readonly viewZone: number;
  buyGenerator(gen: number, quantity: number | 'max'): void;
  buyResearch(id: string): void;
  dive(): void;
  buyHull(): void;
  startSonar(): void;
  /** Ends the expedition. The interface must have asked the player to confirm first. */
  publish(): void;
  buyInstitute(id: string): void;
  setViewZone(zone: number): void;
  claimDaily(): void;
  /** Doubles the offline income just reported, after a rewarded advert. */
  doubleOffline(): void;
  updateSettings(patch: Partial<Settings>): void;
  exportSave(): string;
  /** Returns false when the text is not a valid save. */
  importSave(text: string): boolean;
  hardReset(): void;
  drawPortrait(canvas: HTMLCanvasElement, species: SpeciesDef, silhouette: boolean): void;
}

export type ToastKind = 'info' | 'good' | 'rare' | 'warn';

export interface Ui {
  /** The canvas the renderer draws into. The interface owns the page layout and sizes this element. */
  readonly canvas: HTMLCanvasElement;
  /** Refreshes every number and button from host.state. Called about ten times a second. */
  update(): void;
  toast(message: string, kind?: ToastKind): void;
  /** One short line of guidance for new players near the play area, or null to hide it. */
  setHint(text: string | null): void;
  showOffline(report: OfflineReport): void;
  showZoneIntro(zone: number): void;
  showPublished(result: PublishResult): void;
  showAchievement(achievement: AchievementDef): void;
  showDiscovery(species: SpeciesDef): void;
  showFinale(): void;
  /** True while a modal dialog is open; the game keeps running but ignores taps on the water. */
  readonly modalOpen: boolean;
  /** Pixels at the top and bottom of the canvas that the interface draws over, so creatures can keep clear. */
  playInsets(): { top: number; bottom: number };
}
