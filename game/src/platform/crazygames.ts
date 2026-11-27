import { safeLocalStorage, type AdFailure, type AdResult, type Platform, type PlatformHooks } from './types.ts';

// CrazyGames HTML5 SDK v3. The script tag is added to index.html by the build
// (https://sdk.crazygames.com/crazygames-sdk-v3.js). Everything here degrades
// to "no ads, localStorage saves" if the script is blocked or fails to start,
// so an ad blocker can never stop the game from running.

interface CrazyAdCallbacks {
  adStarted(): void;
  adFinished(): void;
  adError(error: unknown): void;
}

interface CrazySdk {
  init(): Promise<void>;
  game: {
    gameplayStart(): unknown;
    gameplayStop(): unknown;
    loadingStart(): unknown;
    loadingStop(): unknown;
    happytime(): unknown;
    settings?: { muteAudio?: boolean };
    addSettingsChangeListener?(listener: () => void): void;
  };
  ad: { requestAd(type: 'midgame' | 'rewarded', callbacks: CrazyAdCallbacks): void };
  data: {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
  };
}

/** The SDK asks games not to hammer its synced storage, so writes are spaced out. */
const WRITE_INTERVAL_MS = 20_000;
/** If the SDK never calls back, release the game rather than leave it frozen. */
const AD_WATCHDOG_MS = 90_000;

function failureFrom(error: unknown): AdFailure {
  const text = typeof error === 'string' ? error : JSON.stringify(error ?? '');
  if (/too soon/i.test(text)) return 'cooldown';
  if (/no ad|unfilled|not available/i.test(text)) return 'unavailable';
  return 'error';
}

export function createCrazyGamesPlatform(): Platform {
  let sdk: CrazySdk | null = null;
  let hooks: PlatformHooks | null = null;
  let adPlaying = false;
  let adInFlight = false;
  const lastWrite = new Map<string, number>();
  const pendingWrite = new Map<string, { value: string; timer: ReturnType<typeof setTimeout> }>();

  const safely = (action: () => unknown): void => {
    try {
      const result = action();
      if (result instanceof Promise) result.catch(() => {});
    } catch {
      // A portal SDK failure must never break the game.
    }
  };

  const hostMuted = (): boolean => sdk?.game.settings?.muteAudio === true;
  const syncMute = (): void => hooks?.setMuted(adPlaying || hostMuted());

  function requestAd(type: 'midgame' | 'rewarded'): Promise<AdResult> {
    const activeSdk = sdk;
    if (!activeSdk) return Promise.resolve({ completed: false, failure: 'unavailable' });
    if (adInFlight) return Promise.resolve({ completed: false, failure: 'cooldown' });
    adInFlight = true;
    return new Promise<AdResult>((resolve) => {
      let settled = false;
      const finish = (result: AdResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(watchdog);
        adInFlight = false;
        adPlaying = false;
        hooks?.setPaused(false);
        syncMute();
        resolve(result);
      };
      const watchdog = setTimeout(() => finish({ completed: false, failure: 'error' }), AD_WATCHDOG_MS);
      try {
        activeSdk.ad.requestAd(type, {
          adStarted: () => {
            adPlaying = true;
            hooks?.setPaused(true);
            syncMute();
          },
          adFinished: () => finish({ completed: true }),
          adError: (error) => finish({ completed: false, failure: failureFrom(error) }),
        });
      } catch {
        finish({ completed: false, failure: 'error' });
      }
    });
  }

  function writeNow(key: string, value: string): boolean {
    const pending = pendingWrite.get(key);
    if (pending) {
      clearTimeout(pending.timer);
      pendingWrite.delete(key);
    }
    lastWrite.set(key, Date.now());
    // Always keep a local copy: it is the fallback if the SDK is blocked next time.
    const local = safeLocalStorage.set(key, value);
    const activeSdk = sdk;
    if (activeSdk) safely(() => activeSdk.data.setItem(key, value));
    return local || activeSdk !== null;
  }

  function syncedCopy(key: string): string | null {
    try {
      const synced = sdk?.data.getItem(key);
      return typeof synced === 'string' && synced.length > 0 ? synced : null;
    } catch {
      return null;
    }
  }

  return {
    id: 'crazygames',
    get hasAds() {
      return sdk !== null;
    },
    async init(platformHooks) {
      hooks = platformHooks;
      try {
        const candidate = (window as unknown as { CrazyGames?: { SDK?: CrazySdk } }).CrazyGames?.SDK;
        if (!candidate) return;
        await candidate.init();
        sdk = candidate;
        safely(() => candidate.game.addSettingsChangeListener?.(syncMute));
        syncMute();
        // If the SDK was slow, the game may already be running on local data: let it look at the synced copy.
        hooks.storageReady?.();
      } catch {
        sdk = null;
      }
    },
    loadingStart: () => safely(() => sdk?.game.loadingStart()),
    loadingStop: () => safely(() => sdk?.game.loadingStop()),
    gameplayStart: () => safely(() => sdk?.game.gameplayStart()),
    gameplayStop: () => safely(() => sdk?.game.gameplayStop()),
    happyMoment: () => safely(() => sdk?.game.happytime()),
    showInterstitial: () => requestAd('midgame'),
    showRewarded: () => requestAd('rewarded'),
    storageGet(key) {
      const pending = pendingWrite.get(key);
      if (pending) return pending.value;
      // The local copy is written on every save, so it is never older than the synced one from this device.
      return safeLocalStorage.get(key) ?? syncedCopy(key);
    },
    storageCandidates(key) {
      return [pendingWrite.get(key)?.value ?? null, syncedCopy(key), safeLocalStorage.get(key)];
    },
    storageSet(key, value, urgent = false) {
      const elapsed = Date.now() - (lastWrite.get(key) ?? 0);
      if (urgent || elapsed >= WRITE_INTERVAL_MS) return writeNow(key, value);
      // Keep the freshest value locally right away; sync it to the host later.
      const local = safeLocalStorage.set(key, value);
      const existing = pendingWrite.get(key);
      if (existing) {
        existing.value = value;
        return true;
      }
      const timer = setTimeout(() => {
        const queued = pendingWrite.get(key);
        if (queued) writeNow(key, queued.value);
      }, WRITE_INTERVAL_MS - elapsed);
      pendingWrite.set(key, { value, timer });
      return local || sdk !== null;
    },
    storageRemove(key) {
      const pending = pendingWrite.get(key);
      if (pending) {
        clearTimeout(pending.timer);
        pendingWrite.delete(key);
      }
      lastWrite.delete(key);
      safeLocalStorage.remove(key);
      const activeSdk = sdk;
      if (activeSdk) safely(() => activeSdk.data.removeItem(key));
    },
  };
}
