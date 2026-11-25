// Blocking dialogs: offline income, a new zone, a published expedition, the
// publish confirmation, the finale and settings. One shows at a time and any
// others wait their turn. Focus moves in when a dialog opens and goes back to
// where it was when the dialog closes.

import { formatDepth, formatDuration, formatPercent } from '../core/format.ts';
import type { PublishResult } from '../game/actions.ts';
import { SPECIES, TOTAL_STEPS, ZONES, speciesInZone } from '../game/content.ts';
import { TUNING, depthOfStep, getModifiers, renownOnPublish, speciesFound, type OfflineReport } from '../game/economy.ts';
import type { GameState, Settings } from '../game/state.ts';
import { button, el, hook, liveAttr, liveText } from './dom.ts';
import { icon, type IconName } from './icons.ts';
import type { Tick, UiContext } from './types.ts';

type Kind = 'offline' | 'zone' | 'published' | 'confirm' | 'finale' | 'settings';

/** A dialog that has only just appeared ignores stray taps for this long, so a double-click cannot dismiss it unread. */
const OPEN_GUARD_MS = 350;
/** How long a zone introduction stays up before it leaves by itself. */
const ZONE_INTRO_MS = 7000;

interface Filled {
  /** The control that takes focus when the dialog opens. */
  focus: HTMLElement | null;
  /** Keeps the contents in step with the game while the dialog is open. */
  sync?: (state: GameState) => void;
}

interface Spec {
  kind: Kind;
  eyebrow: string;
  title: string;
  fill(body: HTMLElement, actions: HTMLElement): Filled;
  /** Closes by itself after this many milliseconds. */
  lingerMs?: number;
  /** A tap anywhere on the dialog closes it, not only a tap outside. */
  tapAnywhere?: boolean;
  /** Tints the dialog with a zone's colours. */
  zone?: number;
}

interface Open {
  spec: Spec;
  sync: ((state: GameState) => void) | undefined;
  timer: number;
  openedAt: number;
  returnTo: HTMLElement | null;
}

export interface Dialogs {
  readonly element: HTMLElement;
  /** True while a dialog is on screen. */
  readonly open: boolean;
  update(tick: Tick): void;
  /** Deals with a key press while a dialog is open. Returns true when a dialog was open. */
  handleKey(event: KeyboardEvent): boolean;
  showOffline(report: OfflineReport): void;
  showZoneIntro(zone: number): void;
  showPublished(result: PublishResult): void;
  showFinale(): void;
  showSettings(): void;
  confirmPublish(): void;
}

/** `behind` lists the parts of the page that must not take focus or clicks while a dialog is open. */
export function createDialogs(ctx: UiContext, behind: readonly HTMLElement[]): Dialogs {
  const { host } = ctx;

  const layer = el('div', 'gf-modal');
  layer.hidden = true;
  const dialog = hook(el('div', 'gf-dialog'), 'dialog');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'gf-dialog-title');
  dialog.tabIndex = -1;

  const closeButton = button('gf-dialog-x', 'dialog-close');
  closeButton.setAttribute('aria-label', 'Close');
  closeButton.appendChild(icon('close'));
  const eyebrow = el('p', 'gf-dialog-eyebrow');
  const setEyebrow = liveText(eyebrow);
  const title = el('h2', 'gf-dialog-title');
  title.id = 'gf-dialog-title';
  const setTitle = liveText(title);
  const body = el('div', 'gf-dialog-body');
  const actions = el('div', 'gf-dialog-actions');
  const timerBar = el('div', 'gf-dialog-timer');
  timerBar.appendChild(el('span'));
  dialog.append(closeButton, eyebrow, title, body, actions, timerBar);
  layer.appendChild(dialog);

  let current: Open | null = null;
  const waiting: Spec[] = [];
  let pressedOutside = false;

  function show(spec: Spec, returnTo?: HTMLElement | null): void {
    if (current) {
      // One at a time: the newest of each kind waits for the dialog on screen to close.
      const stale = waiting.findIndex((queued) => queued.kind === spec.kind);
      if (stale >= 0) waiting.splice(stale, 1);
      waiting.push(spec);
      return;
    }
    const focused = document.activeElement;
    const opener = returnTo !== undefined ? returnTo : focused instanceof HTMLElement && focused !== document.body ? focused : null;

    body.textContent = '';
    actions.textContent = '';
    layer.setAttribute('data-kind', spec.kind);
    if (spec.zone === undefined) dialog.removeAttribute('data-zone');
    else dialog.setAttribute('data-zone', String(spec.zone));
    setEyebrow(spec.eyebrow);
    eyebrow.hidden = spec.eyebrow === '';
    setTitle(spec.title);
    const filled = spec.fill(body, actions);
    actions.hidden = actions.childElementCount === 0;
    timerBar.hidden = spec.lingerMs === undefined;
    if (spec.lingerMs !== undefined) timerBar.style.setProperty('--linger', `${spec.lingerMs}ms`);

    for (const node of behind) node.inert = true;
    layer.hidden = false;
    body.scrollTop = 0;
    current = {
      spec,
      sync: filled.sync,
      timer: spec.lingerMs === undefined ? 0 : window.setTimeout(close, spec.lingerMs),
      openedAt: performance.now(),
      returnTo: opener,
    };
    filled.sync?.(host.state);
    (filled.focus ?? dialog).focus({ preventScroll: true });
  }

  function close(): void {
    const closing = current;
    if (!closing) return;
    window.clearTimeout(closing.timer);
    current = null;
    layer.hidden = true;
    for (const node of behind) node.inert = false;
    body.textContent = '';
    actions.textContent = '';
    const next = waiting.shift();
    if (next) show(next, closing.returnTo);
    else if (closing.returnTo && document.contains(closing.returnTo)) closing.returnTo.focus({ preventScroll: true });
    else if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  }

  closeButton.addEventListener('click', close);
  layer.addEventListener('pointerdown', (event) => {
    pressedOutside = event.target === layer;
  });
  layer.addEventListener('click', (event) => {
    if (!current || performance.now() - current.openedAt < OPEN_GUARD_MS) return;
    // Only a press that both started and ended outside counts, so dragging a text selection out of the box is safe.
    const outside = event.target === layer && pressedOutside;
    const onControl = event.target instanceof Element && event.target.closest('button, a, textarea, input') !== null;
    if (outside || (current.spec.tapAnywhere === true && !onControl)) close();
  });

  /** Keeps Tab inside the dialog. */
  function trapTab(event: KeyboardEvent): void {
    const stops = Array.from(dialog.querySelectorAll<HTMLElement>('button, a[href], textarea, input, select')).filter(
      (node) => !node.hasAttribute('disabled') && node.offsetParent !== null,
    );
    const first = stops[0];
    const last = stops[stops.length - 1];
    if (!first || !last) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const focused = document.activeElement;
    const inside = dialog.contains(focused);
    if (event.shiftKey && (focused === first || !inside)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (focused === last || !inside)) {
      event.preventDefault();
      first.focus();
    }
  }

  // ---------------------------------------------------------------- building blocks
  function action(label: string, className: string, testId: string, onClick: () => void): HTMLButtonElement {
    const control = button(`gf-btn ${className}`, testId);
    control.textContent = label;
    control.addEventListener('click', onClick);
    return control;
  }

  function facts(rows: readonly (readonly [string, string])[]): HTMLElement {
    const list = el('dl', 'gf-facts');
    for (const [label, value] of rows) {
      const row = el('div', 'gf-fact');
      row.append(el('dt', '', label), el('dd', '', value));
      list.appendChild(row);
    }
    return list;
  }

  /** The big number at the top of a dialog. Returns the setter for its value. */
  function prize(parent: HTMLElement, picture: IconName, tone: 'gold' | 'renown', label: string): (value: string) => void {
    const box = el('div', `gf-prize is-${tone}`);
    const value = el('span', 'gf-prize-value');
    box.append(icon(picture, tone === 'gold' ? 'gf-coin' : 'gf-gem'), value, el('span', 'gf-prize-label', label));
    parent.appendChild(box);
    return liveText(value);
  }

  function bullets(heading: string, tone: 'lost' | 'kept', items: readonly string[]): HTMLElement {
    const column = el('div', `gf-swap-col is-${tone}`);
    const list = el('ul');
    for (const item of items) list.appendChild(el('li', '', item));
    column.append(el('h3', '', heading), list);
    return column;
  }

  // ---------------------------------------------------------------- the dialogs
  function showOffline(report: OfflineReport): void {
    show({
      kind: 'offline',
      eyebrow: 'Welcome back',
      title: 'While you were away',
      fill(into, buttons) {
        prize(into, 'star', 'gold', 'lumens earned by your fleet, already in your balance')(`+${ctx.num(report.lumens)}`);
        into.appendChild(
          facts([
            ['Time away', formatDuration(report.awaySeconds)],
            ['Time that counted', formatDuration(report.countedSeconds)],
            ['Efficiency', formatPercent(report.efficiency)],
          ]),
        );
        if (report.countedSeconds < report.awaySeconds - 1) {
          const limit = formatDuration(getModifiers(host.state).offlineHours * 3600);
          into.appendChild(el('p', 'gf-dialog-note', `The fleet works unattended for up to ${limit}. Night Shift in the Institute stretches that.`));
        }
        const collect = action('Collect', 'gf-btn-primary', 'offline-collect', close);
        if (host.hasAds) {
          const double = action('Watch an ad to double it', 'gf-btn-gold', 'offline-double', () => {
            // The offer is good once: it goes as soon as it is taken.
            double.hidden = true;
            collect.focus();
            host.doubleOffline();
          });
          buttons.appendChild(double);
        }
        buttons.appendChild(collect);
        return { focus: collect };
      },
    });
  }

  function showZoneIntro(index: number): void {
    const zone = ZONES[index];
    if (!zone) return;
    show({
      kind: 'zone',
      zone: index,
      eyebrow: `Zone ${index + 1} of ${ZONES.length}`,
      title: zone.name,
      lingerMs: ZONE_INTRO_MS,
      tapAnywhere: true,
      fill(into, buttons) {
        into.append(el('p', 'gf-dialog-range', `${formatDepth(zone.topDepth)} to ${formatDepth(zone.bottomDepth)}`), el('p', 'gf-dialog-lead', zone.blurb));
        const perks = el('div', 'gf-perks');
        const income = el('div', 'gf-perk is-gold');
        income.append(icon('star'), el('span', '', TUNING.zoneBonus === 2 ? 'All income has doubled' : `All income is now x${TUNING.zoneBonus}`));
        const species = el('div', 'gf-perk is-cyan');
        species.append(icon('fish'), el('span', '', `${speciesInZone(index).length} new species are waiting`));
        perks.append(income, species);
        into.appendChild(perks);
        const go = action('Continue', 'gf-btn-primary', 'zone-continue', close);
        buttons.appendChild(go);
        return { focus: go };
      },
    });
  }

  function showPublished(result: PublishResult): void {
    ctx.selectTab('institute');
    show({
      kind: 'published',
      eyebrow: 'Expedition published',
      title: 'Your findings are in print',
      fill(into, buttons) {
        prize(into, 'renown', 'renown', result.renown === 1 ? 'point of Renown earned' : 'Renown earned')(`+${ctx.num(result.renown)}`);
        into.append(
          facts([
            ['Depth reached', formatDepth(depthOfStep(result.depthStep))],
            ['Time taken', formatDuration(result.runSeconds)],
          ]),
          el('p', 'gf-dialog-note', 'Spend your Renown in the Institute. Its upgrades stay with you on every expedition to come.'),
        );
        const go = action('Open the Institute', 'gf-btn-renown', 'published-continue', close);
        buttons.appendChild(go);
        return { focus: go };
      },
    });
  }

  function confirmPublish(): void {
    if (renownOnPublish(host.state) < 1) return;
    show({
      kind: 'confirm',
      eyebrow: 'Surface and publish',
      title: 'End this expedition?',
      fill(into, buttons) {
        const setRenown = prize(into, 'renown', 'renown', 'Renown for the Institute');
        const swap = el('div', 'gf-swap');
        swap.append(bullets('Resets', 'lost', ['Lumens', 'Fleet', 'Research', 'Depth']), bullets('You keep', 'kept', ['Codex', 'Achievements', 'Institute upgrades', 'Renown']));
        into.append(swap, el('p', 'gf-dialog-note', 'You start again at the surface, stronger for everything the Institute has learned.'));
        const stay = action('Keep diving', 'gf-btn-ghost', 'publish-cancel', close);
        const go = action('Publish', 'gf-btn-renown', 'publish-confirm', () => {
          close();
          host.publish();
        });
        buttons.append(stay, go);
        // The sub may still be diving behind the dialog, so the amount on offer is kept current.
        return { focus: stay, sync: (state) => setRenown(`+${ctx.num(renownOnPublish(state))}`) };
      },
    });
  }

  function showFinale(): void {
    show({
      kind: 'finale',
      zone: ZONES.length - 1,
      eyebrow: 'The sea floor',
      title: `You reached ${formatDepth(depthOfStep(TOTAL_STEPS))}`,
      fill(into, buttons) {
        const state = host.state;
        into.append(
          el('p', 'gf-dialog-lead', 'The very bottom of the Hadal Trench. Almost nobody has seen what lives here, and now you have. Thank you for diving all the way down.'),
          facts([
            ['Time played', formatDuration(state.stats.playSeconds)],
            ['Expeditions published', ctx.num(state.prestiges)],
            ['Species found', `${speciesFound(state)}/${SPECIES.length}`],
            ['Scans', ctx.num(state.stats.scans)],
            ['Lifetime lumens', ctx.num(state.lifetimeLumens)],
          ]),
          el('p', 'gf-dialog-note', 'The sea still has secrets: finish the codex, chase the last achievements, or see how fast you can do it all again.'),
        );
        const go = action('Keep exploring', 'gf-btn-primary', 'finale-continue', close);
        buttons.appendChild(go);
        return { focus: go };
      },
    });
  }

  /** Copies text to the clipboard where the browser allows it. `field` already holds the text, for the older fallback. */
  async function copyText(text: string, field: HTMLTextAreaElement): Promise<boolean> {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      // Not allowed here (an embedding page can forbid it); try the older way below.
    }
    try {
      field.focus();
      field.select();
      return document.execCommand('copy');
    } catch {
      return false;
    }
  }

  function showSettings(): void {
    show({
      kind: 'settings',
      eyebrow: '',
      title: 'Settings',
      fill(into, buttons) {
        const syncs: ((settings: Settings) => void)[] = [];
        let firstSwitch: HTMLElement | null = null;

        function group(heading: string, ...children: HTMLElement[]): void {
          const section = el('section', 'gf-set-group');
          section.append(el('h3', 'gf-set-title', heading), ...children);
          into.appendChild(section);
        }

        function toggle(key: keyof Settings, label: string, note: string, testId: string): HTMLElement {
          const control = button('gf-switch', testId);
          control.setAttribute('role', 'switch');
          const text = el('span', 'gf-switch-text');
          text.append(el('span', 'gf-switch-name', label), el('span', 'gf-switch-note', note));
          const track = el('span', 'gf-switch-track');
          track.appendChild(el('span', 'gf-switch-thumb'));
          control.append(text, track);
          const setChecked = liveAttr(control, 'aria-checked');
          control.addEventListener('click', () => {
            const patch: Partial<Settings> = {};
            patch[key] = !host.state.settings[key];
            host.updateSettings(patch);
          });
          syncs.push((settings) => setChecked(String(settings[key])));
          firstSwitch ??= control;
          return control;
        }

        group('Sound', toggle('music', 'Music', 'The ambient score', 'setting-music'), toggle('sfx', 'Sound effects', 'Scans, dives and chimes', 'setting-sfx'));
        group(
          'Display',
          toggle('scientific', 'Scientific notation', 'Show 1.23e9 instead of 1.23B', 'setting-scientific'),
          toggle('reducedMotion', 'Reduced motion', 'Fewer moving effects', 'setting-reduced-motion'),
        );

        // Export: the code appears in a box and goes to the clipboard where that is allowed.
        const exportBox = hook(el('textarea', 'gf-code'), 'export-code');
        exportBox.readOnly = true;
        exportBox.rows = 3;
        exportBox.spellcheck = false;
        exportBox.hidden = true;
        exportBox.setAttribute('aria-label', 'Your save code');
        const exportNote = el('p', 'gf-form-note');
        exportNote.setAttribute('role', 'status');
        const exportButton = action('Export save', 'gf-btn-ghost', 'export-button', () => {
          const code = host.exportSave();
          exportBox.value = code;
          exportBox.hidden = false;
          exportNote.textContent = 'This code holds your whole game. Keep it somewhere safe.';
          void copyText(code, exportBox).then((copied) => {
            exportNote.textContent = copied ? 'Copied to the clipboard. This code holds your whole game.' : 'Select the code above and copy it. It holds your whole game.';
          });
        });

        // Import: paste a code and load it.
        const importBox = hook(el('textarea', 'gf-code'), 'import-input');
        importBox.rows = 3;
        importBox.spellcheck = false;
        importBox.placeholder = 'Paste a save code here';
        importBox.setAttribute('aria-label', 'Save code to import');
        const importNote = hook(el('p', 'gf-form-note is-error'), 'import-message');
        importNote.setAttribute('role', 'alert');
        const importButton = action('Import save', 'gf-btn-ghost', 'import-button', () => {
          const code = importBox.value;
          if (code.trim() === '') {
            importNote.textContent = 'Paste a save code into the box first.';
            return;
          }
          if (!host.importSave(code)) {
            importNote.textContent = 'That is not a valid save code. Check that all of it was copied.';
            return;
          }
          close();
          ctx.toast('Save imported', 'good');
        });
        group('Save', exportButton, exportBox, exportNote, importBox, importButton, importNote);

        // Reset: a second, clearly dangerous button has to be pressed before anything is erased.
        const resetStep = el('div', 'gf-reset-step');
        resetStep.hidden = true;
        const resetButton = action('Reset game', 'gf-btn-ghost is-danger', 'reset-button', () => {
          resetButton.hidden = true;
          resetStep.hidden = false;
          keep.focus();
        });
        const keep = action('Keep my game', 'gf-btn-ghost', 'reset-cancel', () => {
          resetStep.hidden = true;
          resetButton.hidden = false;
          resetButton.focus();
        });
        const erase = action('Erase everything', 'gf-btn-danger', 'reset-confirm', () => {
          host.hardReset();
          close();
          ctx.toast('Game reset. A new expedition begins.', 'info');
        });
        const resetRow = el('div', 'gf-form-row');
        resetRow.append(keep, erase);
        resetStep.append(el('p', 'gf-form-note is-error', 'This erases everything for good: lumens, fleet, codex, Renown and achievements.'), resetRow);
        group('Start over', resetButton, resetStep);

        const about = el('div', 'gf-about');
        about.append(el('span', '', `${__TITLE__} version ${host.version}`), el('span', '', 'Built with AI assistance (Claude).'));
        if (/^https?:\/\//i.test(host.tipUrl)) {
          const tip = hook(el('a', 'gf-link', 'Support the developer'), 'tip-link');
          tip.href = host.tipUrl;
          tip.target = '_blank';
          tip.rel = 'noopener';
          about.appendChild(tip);
        }
        into.appendChild(about);

        buttons.appendChild(action('Done', 'gf-btn-primary', 'settings-done', close));
        return {
          focus: firstSwitch,
          sync(state) {
            for (const apply of syncs) apply(state.settings);
          },
        };
      },
    });
  }

  return {
    element: layer,
    get open() {
      return current !== null;
    },
    update(tick) {
      current?.sync?.(tick.state);
    },
    handleKey(event) {
      if (!current) return false;
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      } else if (event.key === 'Tab') {
        trapTab(event);
      }
      return true;
    },
    showOffline,
    showZoneIntro,
    showPublished,
    showFinale,
    showSettings,
    confirmPublish,
  };
}
