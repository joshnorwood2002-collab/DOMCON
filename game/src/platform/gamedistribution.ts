import { safeLocalStorage, type AdResult, type Platform, type PlatformHooks } from './types.ts';

// GameDistribution HTML5 SDK. The SDK is configured through a global
// GD_OPTIONS object that must exist before its script loads, and it reports
// back through named events. As with every adapter, a blocked or broken SDK
// degrades to "no ads" and never stops the game.

interface GdEvent {
  name: string;
}

interface GdSdk {
  showAd(type?: string): Promise<unknown>;
  AdType?: { Interstitial?: string; Rewarded?: string };
}

const SDK_URL = 'https://html5.api.gamedistribution.com/main.min.js';
/** The SDK can leave a showAd() promise pending forever when no ad loads. */
const NO_IMPRESSION_TIMEOUT_MS = 6_000;
const AD_WATCHDOG_MS = 90_000;
const READY_TIMEOUT_MS = 8_000;

export function createGameDistributionPlatform(gameId: string): Platform {
  let hooks: PlatformHooks | null = null;
  let ready = false;
  let impression = false;
  let rewardEarned = false;
  let adInFlight = false;

  const sdk = (): GdSdk | null => (window as unknown as { gdsdk?: GdSdk }).gdsdk ?? null;

  function release(): void {
    hooks?.setPaused(false);
    hooks?.setMuted(false);
  }

  async function show(kind: 'interstitial' | 'rewarded'): Promise<AdResult> {
    const active = sdk();
    if (!ready || !active) return { completed: false, failure: 'unavailable' };
    if (adInFlight) return { completed: false, failure: 'cooldown' };
    adInFlight = true;
    impression = false;
    rewardEarned = false;
    const type = kind === 'rewarded' ? (active.AdType?.Rewarded ?? 'rewarded') : (active.AdType?.Interstitial ?? 'interstitial');
    try {
      const outcome = await new Promise<AdResult>((resolve) => {
        let settled = false;
        const settle = (result: AdResult): void => {
          if (settled) return;
          settled = true;
          clearTimeout(noImpression);
          clearTimeout(watchdog);
          resolve(result);
        };
        const noImpression = setTimeout(() => {
          if (!impression) settle({ completed: false, failure: 'unavailable' });
        }, NO_IMPRESSION_TIMEOUT_MS);
        const watchdog = setTimeout(() => settle({ completed: false, failure: 'error' }), AD_WATCHDOG_MS);
        active.showAd(type).then(
          () => settle(kind === 'rewarded' ? { completed: rewardEarned, ...(rewardEarned ? {} : { failure: 'unavailable' as const }) } : { completed: impression }),
          (error: unknown) => settle({ completed: false, failure: /too soon/i.test(String(error)) ? 'cooldown' : 'error' }),
        );
      });
      return outcome;
    } finally {
      adInFlight = false;
      // The SDK is meant to pair every pause with a resume, but does not always.
      release();
    }
  }

  return {
    id: 'gamedistribution',
    get hasAds() {
      return ready;
    },
    init(platformHooks) {
      hooks = platformHooks;
      if (!gameId) return Promise.resolve();
      return new Promise<void>((resolve) => {
        const done = (): void => {
          clearTimeout(timeout);
          resolve();
        };
        const timeout = setTimeout(done, READY_TIMEOUT_MS);
        (window as unknown as { GD_OPTIONS: unknown }).GD_OPTIONS = {
          gameId,
          onEvent(event: GdEvent) {
            switch (event.name) {
              case 'SDK_READY':
                ready = true;
                done();
                break;
              case 'SDK_GAME_PAUSE':
                hooks?.setPaused(true);
                hooks?.setMuted(true);
                break;
              case 'SDK_GAME_START':
                release();
                break;
              case 'SDK_REWARDED_WATCH_COMPLETE':
                rewardEarned = true;
                break;
              case 'IMPRESSION':
                impression = true;
                break;
              default:
                break;
            }
          },
        };
        const script = document.createElement('script');
        script.src = SDK_URL;
        script.async = true;
        script.onerror = done;
        document.head.appendChild(script);
      });
    },
    loadingStart: () => {},
    loadingStop: () => {},
    gameplayStart: () => {},
    gameplayStop: () => {},
    happyMoment: () => {},
    showInterstitial: () => show('interstitial'),
    showRewarded: () => show('rewarded'),
    storageGet: (key) => safeLocalStorage.get(key),
    storageSet: (key, value) => {
      safeLocalStorage.set(key, value);
    },
    storageRemove: (key) => safeLocalStorage.remove(key),
  };
}
