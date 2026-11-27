import { safeLocalStorage, type AdResult, type Platform } from './types.ts';

const NO_ADS: AdResult = { completed: false, failure: 'unsupported' };

/** Self-hosted, itch.io and plain portal builds: no SDK, no adverts, saves in localStorage. */
export function createStandalonePlatform(id: 'web' | 'itch' | 'portal'): Platform {
  return {
    id,
    hasAds: false,
    init: () => Promise.resolve(),
    loadingStart: () => {},
    loadingStop: () => {},
    gameplayStart: () => {},
    gameplayStop: () => {},
    happyMoment: () => {},
    showInterstitial: () => Promise.resolve(NO_ADS),
    showRewarded: () => Promise.resolve(NO_ADS),
    storageGet: (key) => safeLocalStorage.get(key),
    storageSet: (key, value) => safeLocalStorage.set(key, value),
    storageCandidates: (key) => [safeLocalStorage.get(key)],
    storageRemove: (key) => safeLocalStorage.remove(key),
  };
}
