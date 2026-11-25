// Entry point: loads the save, starts the platform adapter, and runs the loop
// that advances the rules, the live scene, the picture and the interface.

import './ui/styles.css';

import { createAudio } from './audio/audio.ts';
import type { AudioEngine, CreatureView, Renderer, Ui, UiHost } from './contracts.ts';
import { formatDuration, formatNumber } from './core/format.ts';
import { mulberry32 } from './core/rng.ts';
import {
  applyOffline,
  buyGenerator,
  buyHull,
  buyInstitute,
  buyResearch,
  checkAchievements,
  claimDaily,
  currentZone,
  dive,
  earn,
  publish,
  runAutomation,
  sonarReady,
  startSonar,
  tick,
} from './game/actions.ts';
import { RARITIES, ZONES, type SpeciesDef } from './game/content.ts';
import { SHOAL_SIZE, diveBlock, getModifiers, hullCost, hullNeeded, invalidateModifiers, localDay, maxAffordable, type OfflineReport } from './game/economy.ts';
import { clearSaves, exportCode, importCode, loadGame, saveGame, type SaveStorage } from './game/save.ts';
import { createState, type GameState, type Settings } from './game/state.ts';
import { Session, type SessionEvents } from './live/session.ts';
import { createPlatform, type Platform } from './platform/index.ts';
import { createRenderer } from './render/renderer.ts';
import { createUi } from './ui/ui.ts';

const AUTOSAVE_SECONDS = 15;
/** A gap this long with the tab hidden is paid as offline income instead of being simulated. */
const OFFLINE_GAP_SECONDS = 60;
/** Adverts at natural breaks: never in the opening minutes, and never close together. */
const FIRST_INTERSTITIAL_AFTER_SECONDS = 240;
const INTERSTITIAL_SPACING_SECONDS = 210;
const PLATFORM_INIT_TIMEOUT_MS = 4000;

const HINTS: readonly string[] = [
  'Tap the glowing creatures to scan them',
  'Buy a Glow Buoy: it earns lumens while you rest',
  'Fill the survey bar, then dive deeper',
  'Research makes every scan worth more',
];

function withTimeout(promise: Promise<void>, ms: number): Promise<void> {
  return Promise.race([promise.catch(() => {}), new Promise<void>((resolve) => setTimeout(resolve, ms))]);
}

async function start(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) throw new Error('Missing #app element');

  // ---------------------------------------------------------------- platform and save
  const platform: Platform = createPlatform();
  let paused = false;
  let hostMuted = false;
  let audio: AudioEngine | null = null;
  const syncAudioSuspend = (): void => audio?.setSuspended(hostMuted || document.hidden);
  platform.loadingStart();
  await withTimeout(
    platform.init({
      setPaused: (value) => {
        paused = value;
      },
      setMuted: (value) => {
        hostMuted = value;
        syncAudioSuspend();
      },
    }),
    PLATFORM_INIT_TIMEOUT_MS,
  );

  const storage: SaveStorage = {
    get: (key) => platform.storageGet(key),
    set: (key, value, urgent) => platform.storageSet(key, value, urgent),
    remove: (key) => platform.storageRemove(key),
  };

  const loaded = loadGame(storage, Date.now());
  let state: GameState = loaded ?? createState(1 + Math.floor(Math.random() * 2_000_000_000), Date.now());
  if (!loaded && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) state.settings.reducedMotion = true;
  let pendingOffline: OfflineReport | null = loaded ? applyOffline(state, Date.now()) : null;
  let offlineDoubled = false;

  const fmt = (value: number): string => formatNumber(value, false, state.settings.scientific);
  const today = (): number => localDay(Date.now(), new Date().getTimezoneOffset());
  const save = (urgent = false): void => saveGame(storage, state, Date.now(), urgent);

  // ---------------------------------------------------------------- adverts
  let lastInterstitialAt = -Infinity;
  let adBusy = false;

  async function maybeInterstitial(): Promise<void> {
    if (!platform.hasAds || adBusy) return;
    if (state.stats.playSeconds < FIRST_INTERSTITIAL_AFTER_SECONDS) return;
    if (state.stats.playSeconds - lastInterstitialAt < INTERSTITIAL_SPACING_SECONDS) return;
    adBusy = true;
    lastInterstitialAt = state.stats.playSeconds;
    platform.gameplayStop();
    try {
      await platform.showInterstitial();
    } finally {
      adBusy = false;
      paused = false;
      platform.gameplayStart();
    }
  }

  /** Runs `reward` once a rewarded advert has been watched to the end. Returns whether it ran. */
  async function afterRewardedAd(reward: () => void): Promise<boolean> {
    if (!platform.hasAds || adBusy) return false;
    adBusy = true;
    platform.gameplayStop();
    try {
      const result = await platform.showRewarded();
      if (result.completed) reward();
      return result.completed;
    } finally {
      adBusy = false;
      paused = false;
      platform.gameplayStart();
    }
  }

  // ---------------------------------------------------------------- scene events
  let ui: Ui;
  let renderer: Renderer;

  const describeGain = (lumens: number): string => `+${fmt(lumens)}`;

  const events: SessionEvents = {
    hit(creature, streak) {
      renderer.scanPulse(creature.x, creature.y, renderer.hueOf(creature.species));
      audio?.play('tap', { pitch: 1 + Math.min(streak, 30) * 0.012 });
    },
    miss(x, y) {
      renderer.ripple(x, y);
    },
    scan(creature, outcome, streak, byFleet) {
      const hue = renderer.hueOf(creature.species);
      const rarity = creature.species.rarity;
      if (byFleet) {
        renderer.burst(creature.x, creature.y, hue, 0.6);
      } else {
        const strength = rarity === 'legendary' ? 4 : rarity === 'rare' ? 2.6 : rarity === 'uncommon' ? 1.6 : 1;
        renderer.scanPulse(creature.x, creature.y, hue);
        renderer.burst(creature.x, creature.y, hue, strength);
        renderer.floatText(creature.x, creature.y - 18, describeGain(outcome.lumens + outcome.discoveryBonus), strength > 2 ? 'big' : 'gain');
        audio?.play(rarity === 'common' ? 'scan' : 'scanRare', { pitch: 1 + Math.min(streak, 30) * 0.012, intensity: Math.min(1, strength / 4 + 0.3) });
        announceCombo(creature, streak);
      }
      if (outcome.discovered) {
        renderer.floatText(creature.x, creature.y - 44, 'New species!', 'discover');
        audio?.play('discover');
        ui.showDiscovery(outcome.species);
      } else if (outcome.studyLevelUp !== null) {
        audio?.play('studyUp');
        ui.toast(`${outcome.species.name}: study level ${outcome.studyLevelUp}`, 'good');
      }
    },
    shoalScan(creature, lumens, frenzyStarted, caught, streak) {
      renderer.scanPulse(creature.x, creature.y, 48);
      renderer.burst(creature.x, creature.y, 48, 1.8);
      renderer.floatText(creature.x, creature.y - 18, describeGain(lumens), 'big');
      audio?.play('scanRare', { pitch: 1 + caught * 0.05 });
      announceCombo(creature, streak);
      if (frenzyStarted) {
        audio?.play('frenzy');
        ui.toast('Feeding frenzy! All income tripled for 20 seconds', 'rare');
      }
    },
    shoalStart() {
      audio?.play('shoal');
      ui.toast('A glimmer shoal is passing. Tap them!', 'rare');
    },
    shoalEnd(caught, total) {
      if (caught > 0) ui.toast(`Shoal scanned: ${caught} of ${total}`, caught >= total - 2 ? 'good' : 'info');
    },
    legendary(species: SpeciesDef) {
      audio?.play('zone', { pitch: 0.7, intensity: 0.6 });
      ui.toast(`${RARITIES[species.rarity].label} sighting: something vast is drifting past`, 'rare');
    },
  };

  let lastComboShown = 0;
  function announceCombo(creature: CreatureView, streak: number): void {
    const cap = getModifiers(state).comboCap;
    if (cap <= 0 || streak < 5) {
      if (streak < 5) lastComboShown = 0;
      return;
    }
    const shown = Math.min(streak, cap);
    if (shown % 5 === 0 && shown !== lastComboShown) {
      lastComboShown = shown;
      renderer.floatText(creature.x, creature.y - 62, `Combo x${(1 + shown * 0.1).toFixed(1)}`, 'combo');
    }
  }

  const session = new Session(() => state, mulberry32((state.seed ^ 0x5eed) >>> 0), events);

  // ---------------------------------------------------------------- what the interface may do
  function afterDive(enteredZone: number | null, reachedFloor: boolean): void {
    session.afterDive(enteredZone);
    if (enteredZone !== null) {
      audio?.play('zone');
      audio?.setZone(session.viewZone);
      ui.showZoneIntro(enteredZone);
      platform.happyMoment();
      save();
      void maybeInterstitial();
    } else {
      audio?.play('dive');
    }
    if (reachedFloor) {
      ui.showFinale();
      platform.happyMoment();
    }
  }

  function replaceState(next: GameState): void {
    state = next;
    invalidateModifiers(state);
    pendingOffline = null;
    session.reset();
    audio?.setZone(session.viewZone);
    audio?.setMusicEnabled(state.settings.music);
    audio?.setSfxEnabled(state.settings.sfx);
    renderer.setReducedMotion(state.settings.reducedMotion);
    save(true);
    ui.update();
  }

  const host: UiHost = {
    get state() {
      return state;
    },
    get hasAds() {
      return platform.hasAds;
    },
    tipUrl: __TIP_URL__,
    version: __VERSION__,
    get viewZone() {
      return session.viewZone;
    },
    buyGenerator(gen, quantity) {
      const wanted = quantity === 'max' ? maxAffordable(state, gen) : quantity;
      if (buyGenerator(state, gen, wanted) > 0) audio?.play('buy');
      else audio?.play('error');
      ui.update();
    },
    buyResearch(id) {
      if (buyResearch(state, id)) audio?.play('research');
      else audio?.play('error');
      ui.update();
    },
    dive() {
      const result = dive(state);
      if (result.ok) {
        afterDive(result.enteredZone, result.reachedFloor);
      } else {
        audio?.play('error');
        if (result.reason === 'survey') ui.toast('Finish surveying this depth first', 'warn');
        else if (result.reason === 'hull') ui.toast('The hull cannot take the next zone yet', 'warn');
      }
      ui.update();
    },
    buyHull() {
      const result = buyHull(state);
      if (result.ok) {
        audio?.play('hull');
        ui.toast(`${(ZONES[result.zone] as (typeof ZONES)[number]).hullName} fitted`, 'good');
      } else {
        audio?.play('error');
        if (result.reason === 'blueprint') ui.toast('The Institute has no blueprint for that hull yet. Publish to earn Renown.', 'warn');
        else if (result.reason === 'lumens') {
          const zone = hullNeeded(state);
          if (zone !== null) ui.toast(`Needs ${fmt(hullCost(state, zone))} lumens`, 'warn');
        }
      }
      ui.update();
    },
    startSonar() {
      if (platform.hasAds) {
        void afterRewardedAd(() => {
          if (startSonar(state, { cooldown: false })) audio?.play('sonar');
        }).then((watched) => {
          if (watched) return;
          // No advert was available: fall back to the free burst if it has recharged.
          if (sonarReady(state) && startSonar(state, { cooldown: true })) audio?.play('sonar');
          else ui.toast('No advert is available right now. Try again in a moment.', 'warn');
          ui.update();
        });
        return;
      }
      if (startSonar(state, { cooldown: true })) audio?.play('sonar');
      else audio?.play('error');
      ui.update();
    },
    publish() {
      const result = publish(state);
      if (!result) {
        audio?.play('error');
        return;
      }
      session.reset();
      audio?.play('publish');
      audio?.setZone(session.viewZone);
      platform.happyMoment();
      ui.showPublished(result);
      save(true);
      ui.update();
      void maybeInterstitial();
    },
    buyInstitute(id) {
      if (buyInstitute(state, id)) audio?.play('research');
      else audio?.play('error');
      ui.update();
    },
    setViewZone(zone) {
      session.setViewZone(zone);
      audio?.setZone(session.viewZone);
      audio?.play('ui');
      ui.update();
    },
    claimDaily() {
      const gift = claimDaily(state, today());
      if (gift) {
        audio?.play('daily');
        ui.toast(`Daily gift: +${fmt(gift.lumens)} lumens (day ${gift.streak} streak)`, 'good');
        save();
      }
      ui.update();
    },
    doubleOffline() {
      const report = pendingOffline;
      if (!report || offlineDoubled) return;
      void afterRewardedAd(() => {
        offlineDoubled = true;
        earn(state, report.lumens);
        audio?.play('daily');
        ui.toast(`Doubled: +${fmt(report.lumens)} lumens`, 'good');
        ui.update();
      });
    },
    updateSettings(patch: Partial<Settings>) {
      Object.assign(state.settings, patch);
      audio?.setMusicEnabled(state.settings.music);
      audio?.setSfxEnabled(state.settings.sfx);
      renderer.setReducedMotion(state.settings.reducedMotion);
      save();
      ui.update();
    },
    exportSave: () => exportCode(state, Date.now()),
    importSave(text) {
      const imported = importCode(text, Date.now());
      if (!imported) return false;
      replaceState(imported);
      return true;
    },
    hardReset() {
      clearSaves(storage);
      replaceState(createState(1 + Math.floor(Math.random() * 2_000_000_000), Date.now()));
    },
    drawPortrait(canvas, species, silhouette) {
      renderer.drawPortrait(canvas, species, silhouette);
    },
  };

  // ---------------------------------------------------------------- build the screen
  ui = createUi(root, host);
  renderer = createRenderer(ui.canvas, state.seed);
  renderer.setReducedMotion(state.settings.reducedMotion);
  audio = createAudio();
  audio.setMusicEnabled(state.settings.music);
  audio.setSfxEnabled(state.settings.sfx);
  audio.setZone(session.viewZone);
  syncAudioSuspend();

  function fitCanvas(): void {
    const rect = ui.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    renderer.resize(width, height, Math.min(2, window.devicePixelRatio || 1));
    session.resize(width, height);
    const insets = ui.playInsets();
    session.setSafeArea(insets.top, insets.bottom);
  }
  fitCanvas();
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(fitCanvas).observe(ui.canvas);
  window.addEventListener('resize', fitCanvas);

  let playing = false;
  function firstGesture(): void {
    audio?.unlock();
    if (!playing) {
      playing = true;
      platform.gameplayStart();
    }
  }
  window.addEventListener('pointerdown', firstGesture, { passive: true });
  window.addEventListener('keydown', firstGesture);

  ui.canvas.addEventListener('pointerdown', (event) => {
    if (paused || ui.modalOpen) return;
    const rect = ui.canvas.getBoundingClientRect();
    session.tap(event.clientX - rect.left, event.clientY - rect.top);
    event.preventDefault();
  });
  // Stop long-presses and double-taps from selecting text or zooming the page mid-game.
  ui.canvas.addEventListener('contextmenu', (event) => event.preventDefault());

  platform.loadingStop();
  document.documentElement.classList.add('game-ready');
  if (pendingOffline) ui.showOffline(pendingOffline);
  ui.update();

  // ---------------------------------------------------------------- the loop
  let lastFrame = performance.now();
  let hiddenAt = 0;
  let sinceUi = 0;
  let sinceSave = 0;
  let sinceSecond = 0;
  let sinceAutomation = 0;

  function updateHint(): void {
    if (state.tutorial === 0 && state.stats.scans >= 3) state.tutorial = 1;
    if (state.tutorial === 1 && (state.generators[0] ?? 0) >= 1) state.tutorial = 2;
    if (state.tutorial === 2 && state.maxStepEver >= 1) state.tutorial = 3;
    if (state.tutorial === 3 && Object.keys(state.research).length >= 1) state.tutorial = 4;
    if (state.prestiges > 0) state.tutorial = Math.max(state.tutorial, HINTS.length);
    ui.setHint(HINTS[state.tutorial] ?? null);
  }

  function advance(dt: number): void {
    tick(state, dt);
    session.update(Math.min(dt, 0.25));

    sinceAutomation += dt;
    if (sinceAutomation >= 0.25) {
      sinceAutomation = 0;
      const zoneBefore = currentZone(state);
      const floorBefore = state.finished;
      const done = runAutomation(state);
      if (done.dived > 0) {
        const zoneAfter = currentZone(state);
        afterDive(zoneAfter !== zoneBefore ? zoneAfter : null, state.finished && !floorBefore);
      }
    }

    sinceSecond += dt;
    if (sinceSecond >= 1) {
      sinceSecond = 0;
      for (const achievement of checkAchievements(state)) {
        audio?.play('achievement');
        ui.showAchievement(achievement);
      }
      updateHint();
    }

    sinceSave += dt;
    if (sinceSave >= AUTOSAVE_SECONDS) {
      sinceSave = 0;
      save();
    }
  }

  function frame(now: number): void {
    const elapsed = Math.max(0, (now - lastFrame) / 1000);
    lastFrame = now;
    if (!paused) {
      // A long gap means the tab was in the background; frames that are merely slow are capped so nothing jumps.
      advance(elapsed > 1 ? elapsed : Math.min(elapsed, 0.1));
    }
    renderer.draw(session.scene());
    sinceUi += elapsed;
    if (sinceUi >= 0.1) {
      sinceUi = 0;
      ui.update();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // ---------------------------------------------------------------- leaving and coming back
  document.addEventListener('visibilitychange', () => {
    syncAudioSuspend();
    if (document.hidden) {
      hiddenAt = Date.now();
      save(true);
      if (playing) platform.gameplayStop();
      return;
    }
    const awaySeconds = hiddenAt ? (Date.now() - hiddenAt) / 1000 : 0;
    hiddenAt = 0;
    lastFrame = performance.now();
    if (playing) platform.gameplayStart();
    if (awaySeconds >= OFFLINE_GAP_SECONDS) {
      const report = applyOffline(state, Date.now());
      if (report) {
        pendingOffline = report;
        offlineDoubled = false;
        ui.showOffline(report);
      }
    } else if (awaySeconds > 0) {
      // Short absences are simply played through.
      tick(state, awaySeconds);
      state.lastSeen = Date.now();
    }
    ui.update();
  });
  window.addEventListener('pagehide', () => save(true));

  // ---------------------------------------------------------------- test hooks
  // Only with ?e2e in the address: lets the browser tests reach inside without a debug build.
  if (new URLSearchParams(window.location.search).has('e2e')) {
    (window as unknown as { __glowfathom: unknown }).__glowfathom = {
      get state() {
        return state;
      },
      session,
      host,
      grant: (lumens: number) => earn(state, lumens),
      advance: (seconds: number) => {
        for (let done = 0; done < seconds; done += 0.25) advance(0.25);
        ui.update();
      },
      save: () => save(true),
      describe: () => ({
        lumens: state.lumens,
        depthStep: state.depthStep,
        block: diveBlock(state),
        population: session.population,
        shoalSize: SHOAL_SIZE,
        playSeconds: formatDuration(state.stats.playSeconds),
      }),
    };
  }
}

start().catch((error: unknown) => {
  console.error(error);
  const root = document.getElementById('app');
  if (root && !root.hasChildNodes()) {
    const message = document.createElement('p');
    message.className = 'boot-error';
    message.textContent = 'Glowfathom could not start. Reload the page to try again.';
    root.appendChild(message);
  }
});
