// The interface: the page layout, the layer over the play area, the side
// panel and the dialogs. Everything is plain DOM, built once; update() then
// changes only the nodes whose values have changed.

import type { Ui, UiHost } from '../contracts.ts';
import { formatNumber } from '../core/format.ts';
import { diveBlock, passiveRate } from '../game/economy.ts';
import type { GameState } from '../game/state.ts';
import { createAnnouncer } from './announce.ts';
import { createDialogs } from './dialogs.ts';
import { el, isControl, isTextField, liveAttr, liveClass } from './dom.ts';
import { createOverlay } from './overlay.ts';
import { createPanel } from './panel.ts';
import { TAB_IDS, type Tick, type UiContext } from './types.ts';

/** A play area at least this big gets the roomier arrangement of its overlays. */
const ROOMY_WIDTH = 720;
const ROOMY_HEIGHT = 320;
/** A play area at least this big has room for two discovery cards at once. */
const TWO_CARDS_WIDTH = 560;
const TWO_CARDS_HEIGHT = 380;
/** A play area narrower than this (the smallest phones) gets tighter spacing along its top and bottom rows. */
const TIGHT_WIDTH = 370;
/** A play area shorter than this shows two toasts at once instead of three. */
const TWO_TOASTS_HEIGHT = 300;

/** True when the browser is drawing a focus ring on `node`, which means it was reached with the keyboard. */
function focusShowsRing(node: Element): boolean {
  try {
    return node.matches(':focus-visible');
  } catch {
    // An older browser without :focus-visible: assume the keyboard, the safer reading.
    return true;
  }
}

export function createUi(root: HTMLElement, host: UiHost): Ui {
  root.textContent = '';
  root.classList.add('gf');

  const stage = el('div', 'gf-stage');
  const canvas = el('canvas', 'gf-canvas');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'The sea. Tap the glowing creatures to scan them.');

  let refreshing = false;
  let lastState: GameState | null = null;

  const ctx: UiContext = {
    host,
    num: (value) => formatNumber(value, false, host.state.settings.scientific),
    rate: (value) => formatNumber(value, true, host.state.settings.scientific),
    selectTab: (tab) => panel.select(tab),
    toast: (message, kind = 'info') => overlay.toast(message, kind),
    refresh: () => update(),
    openSettings: () => dialogs.showSettings(),
    askPublish: () => dialogs.confirmPublish(),
  };

  const overlay = createOverlay(ctx);
  const panel = createPanel(ctx);
  const dialogs = createDialogs(ctx, [stage, panel.element]);
  const announcer = createAnnouncer(ctx);

  stage.append(canvas, overlay.element);
  root.append(stage, panel.element, dialogs.element);

  const setReduced = liveClass(root, 'gf-reduced');
  const setRoomy = liveClass(root, 'gf-roomy');
  const setTight = liveClass(root, 'gf-tight');
  const setZone = liveAttr(stage, 'data-zone');

  /** Picks the overlay arrangement that suits the play area's current size. */
  function fitOverlays(): void {
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    setRoomy(width >= ROOMY_WIDTH && height >= ROOMY_HEIGHT);
    setTight(width < TIGHT_WIDTH);
    overlay.setLimits(height < TWO_TOASTS_HEIGHT ? 2 : 3, width >= TWO_CARDS_WIDTH && height >= TWO_CARDS_HEIGHT ? 2 : 1);
  }
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(fitOverlays).observe(stage);
  else window.addEventListener('resize', fitOverlays);

  function update(): void {
    if (refreshing) return;
    refreshing = true;
    try {
      const state = host.state;
      if (state !== lastState) {
        // A save was imported or the game was reset: nothing remembered about the old one still holds.
        if (lastState) panel.reset();
        announcer.reset();
        lastState = state;
      }
      setReduced(state.settings.reducedMotion);
      setZone(String(host.viewZone));
      const tick: Tick = { state, rate: passiveRate(state) };
      overlay.update(tick);
      panel.update(tick);
      dialogs.update(tick);
      announcer.update(state);
    } finally {
      refreshing = false;
    }
  }

  window.addEventListener('keydown', (event) => {
    if (dialogs.handleKey(event)) return;
    if (event.ctrlKey || event.metaKey || event.altKey || isTextField(event.target)) return;
    const key = event.key;

    if (key.length === 1 && key >= '1' && key <= '5') {
      const tab = TAB_IDS[Number(key) - 1];
      if (tab) {
        event.preventDefault();
        panel.select(tab);
      }
      return;
    }

    if (key === 'm' || key === 'M') {
      if (event.repeat) return;
      const settings = host.state.settings;
      const silence = settings.music || settings.sfx;
      host.updateSettings({ music: !silence, sfx: !silence });
      overlay.toast(silence ? 'Sound off' : 'Sound on', 'info');
      return;
    }

    if (key === ' ' || key === 'Enter') {
      const focused = document.activeElement;
      const onControl = focused instanceof HTMLElement && isControl(focused);
      // A control reached with the keyboard keeps its own Space and Enter.
      if (onControl && focusShowsRing(focused)) return;
      event.preventDefault();
      // A button that merely kept focus after a mouse click must not fire again on key-up.
      if (onControl) focused.blur();
      if (!event.repeat && diveBlock(host.state) === null) host.dive();
    }
  });

  fitOverlays();
  update();

  return {
    canvas,
    update,
    toast: (message, kind = 'info') => overlay.toast(message, kind),
    setHint: (text) => overlay.setHint(text),
    showOffline: (report) => dialogs.showOffline(report),
    showZoneIntro: (zone) => dialogs.showZoneIntro(zone),
    showPublished: (result) => dialogs.showPublished(result),
    showAchievement(achievement) {
      panel.noteAchievement();
      overlay.showAchievement(achievement);
    },
    showDiscovery(species) {
      panel.noteDiscovery(species);
      overlay.showDiscovery(species);
    },
    showFinale: () => dialogs.showFinale(),
    get modalOpen() {
      return dialogs.open;
    },
    playInsets() {
      fitOverlays();
      return overlay.insets(stage.getBoundingClientRect());
    },
  };
}
