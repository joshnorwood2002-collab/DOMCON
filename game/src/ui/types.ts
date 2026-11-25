// Shared shapes for the interface modules.

import type { ToastKind, UiHost } from '../contracts.ts';
import type { GameState } from '../game/state.ts';

export const TAB_IDS = ['fleet', 'research', 'codex', 'institute', 'goals'] as const;
export type TabId = (typeof TAB_IDS)[number];

/** What every part of the interface can reach. */
export interface UiContext {
  readonly host: UiHost;
  /** A whole number in the player's chosen notation: 1.23K or 1.23e3. */
  num(value: number): string;
  /** Like num, but keeps one decimal under 100, for per-second rates. */
  rate(value: number): string;
  selectTab(tab: TabId): void;
  toast(message: string, kind?: ToastKind): void;
  /** Redraws the interface now instead of waiting for the next regular refresh. */
  refresh(): void;
  openSettings(): void;
  /** Opens the "are you sure" dialog that leads to publishing. */
  askPublish(): void;
}

/** Values worked out once per refresh and shared by every part. */
export interface Tick {
  readonly state: GameState;
  /** Lumens per second with nobody touching the game. */
  readonly rate: number;
}

/** One tab's contents. Built the first time its tab is opened and kept from then on. */
export interface View {
  readonly element: HTMLElement;
  /** Called on every refresh while the tab is open. */
  update(tick: Tick): void;
  /** Called when the player leaves the tab. */
  left?(): void;
  /** Called when a different save has been loaded, so anything remembered about the old one is dropped. */
  reset?(): void;
}
