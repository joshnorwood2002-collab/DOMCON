// Saving and loading. A save is the GameState as JSON inside a small envelope
// with a checksum. Loading never trusts what it reads: every field is checked
// and anything missing or nonsensical falls back to a safe default, so an old
// or damaged save can never crash the game or hand out impossible numbers.

import { ACHIEVEMENTS, GENERATORS, INSTITUTE, RESEARCH, SPECIES, TOTAL_STEPS, ZONES } from './content.ts';
import { zoneOfStep } from './economy.ts';
import { SAVE_VERSION, createState, type GameState } from './state.ts';

export const SAVE_KEY = 'glowfathom.save';
export const BACKUP_KEY = 'glowfathom.save.backup';
const EXPORT_PREFIX = 'GF1.';
/** Largest value any counter may hold; keeps a tampered save away from Infinity and NaN. */
const MAX_NUMBER = 1e300;

interface Envelope {
  v: number;
  /** Wall-clock time the save was written, ms since epoch. */
  t: number;
  /** FNV-1a checksum of the state JSON. */
  c: number;
  s: string;
}

function checksum(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function serialize(state: GameState, nowMs: number): string {
  const body = JSON.stringify({ ...state, lastSeen: nowMs });
  const envelope: Envelope = { v: SAVE_VERSION, t: nowMs, c: checksum(body), s: body };
  return JSON.stringify(envelope);
}

function num(value: unknown, fallback: number, min = 0, max = MAX_NUMBER): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function int(value: unknown, fallback: number, min = 0, max = MAX_NUMBER): number {
  return Math.floor(num(value, fallback, min, max));
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Rebuilds a valid GameState from untrusted data. */
export function sanitize(raw: unknown, nowMs: number): GameState {
  const input = record(raw);
  const state = createState(int(input['seed'], Math.floor(Math.random() * 2 ** 31), 1, 2 ** 31), nowMs);
  const stats = record(input['stats']);
  const settings = record(input['settings']);

  state.clock = num(input['clock'], 0);
  state.lumens = num(input['lumens'], 0);
  state.runLumens = num(input['runLumens'], 0);
  state.lifetimeLumens = Math.max(num(input['lifetimeLumens'], 0), state.runLumens);
  state.depthStep = int(input['depthStep'], 0, 0, TOTAL_STEPS);
  state.survey = num(input['survey'], 0);
  state.maxStepEver = Math.max(int(input['maxStepEver'], 0, 0, TOTAL_STEPS), state.depthStep);
  // The hull must cover wherever the sub already is.
  state.hullZone = Math.max(int(input['hullZone'], 0, 0, ZONES.length - 1), zoneOfStep(state.depthStep));

  const generators = Array.isArray(input['generators']) ? (input['generators'] as unknown[]) : [];
  state.generators = GENERATORS.map((_, index) => int(generators[index], 0, 0, 1e6));

  const research = record(input['research']);
  for (const entry of RESEARCH) if (research[entry.id] === true) state.research[entry.id] = true;

  const codex = record(input['codex']);
  for (const species of SPECIES) {
    const scans = int(codex[species.id], 0, 0, 1e12);
    if (scans > 0) state.codex[species.id] = scans;
  }

  state.renown = num(input['renown'], 0);
  state.renownTotal = Math.max(num(input['renownTotal'], 0), state.renown);
  state.prestiges = int(input['prestiges'], 0, 0, 1e9);

  const institute = record(input['institute']);
  for (const upgrade of INSTITUTE) {
    const level = int(institute[upgrade.id], 0, 0, upgrade.maxLevel);
    if (level > 0) state.institute[upgrade.id] = level;
  }

  const achievements = record(input['achievements']);
  for (const achievement of ACHIEVEMENTS) if (achievements[achievement.id] === true) state.achievements[achievement.id] = true;

  state.stats.taps = int(stats['taps'], 0);
  state.stats.scans = int(stats['scans'], 0);
  state.stats.shoalsCaught = int(stats['shoalsCaught'], 0);
  state.stats.bestCombo = int(stats['bestCombo'], 0, 0, 1e6);
  state.stats.playSeconds = num(stats['playSeconds'], 0);
  state.stats.runSeconds = num(stats['runSeconds'], 0);
  state.stats.maxStepThisRun = Math.max(int(stats['maxStepThisRun'], 0, 0, TOTAL_STEPS), state.depthStep);
  state.stats.fastestRunSeconds = num(stats['fastestRunSeconds'], 0);

  // Timers are measured against the game clock; never let one sit absurdly far in the future.
  const horizon = state.clock + 3600;
  state.sonarUntil = num(input['sonarUntil'], 0, 0, horizon);
  state.sonarReadyAt = num(input['sonarReadyAt'], 0, 0, horizon);
  state.frenzyUntil = num(input['frenzyUntil'], 0, 0, horizon);
  state.nextShoalAt = num(input['nextShoalAt'], state.clock + 60, 0, horizon);

  // A clock set backwards must not turn into an enormous offline payout later.
  state.lastSeen = Math.min(num(input['lastSeen'], nowMs, 0, Number.MAX_SAFE_INTEGER), nowMs);
  state.tutorial = int(input['tutorial'], 0, 0, 100);
  state.finished = bool(input['finished'], false) || state.maxStepEver >= TOTAL_STEPS;
  state.dailyDay = int(input['dailyDay'], 0, 0, 1e7);
  state.dailyStreak = int(input['dailyStreak'], 0, 0, 1e4);

  state.settings.music = bool(settings['music'], true);
  state.settings.sfx = bool(settings['sfx'], true);
  state.settings.scientific = bool(settings['scientific'], false);
  state.settings.reducedMotion = bool(settings['reducedMotion'], false);
  return state;
}

/** Parses a stored save. Returns null when the text is not a save at all or fails its checksum. */
export function deserialize(text: string | null, nowMs: number): GameState | null {
  if (!text) return null;
  try {
    const envelope = JSON.parse(text) as Partial<Envelope>;
    if (typeof envelope !== 'object' || envelope === null || typeof envelope.s !== 'string') return null;
    if (typeof envelope.c !== 'number' || checksum(envelope.s) !== envelope.c) return null;
    if (typeof envelope.v !== 'number' || envelope.v > SAVE_VERSION) return null;
    // Version 1 is the only format so far; future versions migrate here before sanitising.
    return sanitize(JSON.parse(envelope.s), nowMs);
  } catch {
    return null;
  }
}

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(encoded: string): string {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** A copy-and-paste code for moving a save between browsers or devices. */
export function exportCode(state: GameState, nowMs: number): string {
  return EXPORT_PREFIX + toBase64(serialize(state, nowMs));
}

export function importCode(code: string, nowMs: number): GameState | null {
  const trimmed = code.trim();
  if (!trimmed.startsWith(EXPORT_PREFIX)) return null;
  try {
    return deserialize(fromBase64(trimmed.slice(EXPORT_PREFIX.length)), nowMs);
  } catch {
    return null;
  }
}

export interface SaveStorage {
  get(key: string): string | null;
  set(key: string, value: string, urgent?: boolean): void;
  remove(key: string): void;
}

/** Loads the main save, falling back to the backup copy if the main one is damaged. */
export function loadGame(storage: SaveStorage, nowMs: number): GameState | null {
  return deserialize(storage.get(SAVE_KEY), nowMs) ?? deserialize(storage.get(BACKUP_KEY), nowMs);
}

let savesSinceBackup = 0;

export function saveGame(storage: SaveStorage, state: GameState, nowMs: number, urgent = false): void {
  const text = serialize(state, nowMs);
  storage.set(SAVE_KEY, text, urgent);
  // Refresh the backup now and then, so a write cut short by a closing tab cannot destroy both copies.
  savesSinceBackup += 1;
  if (savesSinceBackup >= 8) {
    savesSinceBackup = 0;
    storage.set(BACKUP_KEY, text, false);
  }
}

export function clearSaves(storage: SaveStorage): void {
  storage.remove(SAVE_KEY);
  storage.remove(BACKUP_KEY);
}
