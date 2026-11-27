// One interface for every place the game can be hosted. The game code never
// touches a portal SDK directly; it talks to a Platform, and the build picks
// which implementation to compile in.

export type AdFailure = 'unavailable' | 'cooldown' | 'error' | 'unsupported';

export interface AdResult {
  /** True when the ad played to the end (for rewarded ads: the reward is earned). */
  completed: boolean;
  failure?: AdFailure;
}

export interface PlatformHooks {
  /** The host needs the simulation and input paused (an ad is on screen). */
  setPaused(paused: boolean): void;
  /** The host needs audio muted (an ad is playing, or the player muted from the host's own controls). */
  setMuted(muted: boolean): void;
  /**
   * The host's own storage has only now become readable (a portal SDK that
   * finished starting after the game had already begun). The game should check
   * whether a better save is waiting there before it writes anything.
   */
  storageReady?(): void;
  /** A rewarded advert that had been given up on was watched to the end after all. */
  lateReward?(): void;
}

export interface Platform {
  readonly id: 'web' | 'itch' | 'portal' | 'crazygames' | 'gamedistribution';
  /**
   * True when the host can show real adverts. When false, the boosts that a
   * portal build puts behind a rewarded ad are simply free on a cooldown.
   */
  readonly hasAds: boolean;
  init(hooks: PlatformHooks): Promise<void>;
  loadingStart(): void;
  loadingStop(): void;
  /** The player is actively playing. Portals use this to time ads and measure sessions. */
  gameplayStart(): void;
  gameplayStop(): void;
  /** A celebratory moment (major unlock). Some portals answer with confetti. */
  happyMoment(): void;
  /** A full-screen advert at a natural break. Resolves when the game may continue. */
  showInterstitial(): Promise<AdResult>;
  /** An advert the player chose to watch in return for a reward. */
  showRewarded(): Promise<AdResult>;
  /** Key/value storage. Portals that sync saves to player accounts are used when present. */
  storageGet(key: string): string | null;
  /**
   * `urgent` bypasses write throttling; use it when the page is about to be hidden.
   * Returns false when the value could not be stored anywhere.
   */
  storageSet(key: string, value: string, urgent?: boolean): boolean;
  /** Every copy of a key this host can see, in no particular order. */
  storageCandidates(key: string): (string | null)[];
  storageRemove(key: string): void;
}

/** localStorage wrapped so that private-mode or sandboxed iframes cannot crash the game. */
export const safeLocalStorage = {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): boolean {
    try {
      window.localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  },
  remove(key: string): void {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Storage is unavailable; nothing to remove.
    }
  },
};
