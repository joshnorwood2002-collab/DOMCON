// One-line announcements for controls that have just appeared, so a new
// button or fleet row never turns up unexplained.

import { formatDuration } from '../core/format.ts';
import { sonarUnlocked } from '../game/actions.ts';
import { GENERATORS } from '../game/content.ts';
import { SONAR_MULT, SONAR_SECONDS, generatorUnlocked } from '../game/economy.ts';
import type { GameState } from '../game/state.ts';
import type { UiContext } from './types.ts';

export interface Announcer {
  update(state: GameState): void;
  /** Call when a different save has been loaded, so what it already has is not announced as new. */
  reset(): void;
}

export function createAnnouncer(ctx: UiContext): Announcer {
  /** Fleet units unlocked at the last look; -1 until the first look at a save. */
  let unitsSeen = -1;
  let sonarSeen = false;

  function unlockedUnits(state: GameState): number {
    let count = 0;
    for (const def of GENERATORS) {
      if (generatorUnlocked(state, def.id)) count++;
    }
    return count;
  }

  return {
    update(state) {
      const units = unlockedUnits(state);
      const sonar = sonarUnlocked(state);
      if (unitsSeen >= 0) {
        if (units > unitsSeen) {
          const newest = GENERATORS[units - 1];
          if (newest) ctx.toast(`New fleet unit: ${newest.name}`, 'good');
        }
        if (sonar && !sonarSeen) ctx.toast(`Sonar Burst unlocked: all income x${SONAR_MULT} for ${formatDuration(SONAR_SECONDS)}`, 'good');
      }
      unitsSeen = units;
      sonarSeen = sonar;
    },
    reset() {
      unitsSeen = -1;
      sonarSeen = false;
    },
  };
}
