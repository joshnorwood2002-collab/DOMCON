import { createCrazyGamesPlatform } from './crazygames.ts';
import { createGameDistributionPlatform } from './gamedistribution.ts';
import { createStandalonePlatform } from './standalone.ts';
import type { Platform } from './types.ts';

export type { AdResult, Platform, PlatformHooks } from './types.ts';

/** The build defines __PLATFORM__, so the unused adapters are dropped from each bundle. */
export function createPlatform(): Platform {
  if (__PLATFORM__ === 'crazygames') return createCrazyGamesPlatform();
  if (__PLATFORM__ === 'gamedistribution') return createGameDistributionPlatform(__GD_GAME_ID__);
  return createStandalonePlatform(__PLATFORM__);
}
