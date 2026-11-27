// Everything layered on top of the play area: the balance, the depth readout,
// the zone ladder, the survey bar with its DIVE button, the Sonar Burst
// button, the new-player hint, toasts and the small discovery cards. The
// layer itself ignores the pointer, so a tap anywhere that is not a button
// falls through to the canvas underneath.

import type { ToastKind } from '../contracts.ts';
import { formatDepth, formatDuration, formatPercent } from '../core/format.ts';
import { currentZone, sonarReady, sonarUnlocked } from '../game/actions.ts';
import { ACHIEVEMENT_BONUS, RARITIES, TOTAL_STEPS, ZONES, ZONE_START_STEP, type AchievementDef, type SpeciesDef, type ZoneDef } from '../game/content.ts';
import {
  SONAR_COOLDOWN,
  SONAR_MULT,
  SONAR_SECONDS,
  boostMultiplier,
  dailyAvailable,
  dailyReward,
  depthOfStep,
  diveBlock,
  frenzyActive,
  getModifiers,
  hullCost,
  hullLocked,
  hullNeeded,
  localDay,
  renownOnPublish,
  sonarActive,
  surveyComplete,
  surveyProgress,
  surveyTarget,
} from '../game/economy.ts';
import { button, el, hook, liveAttr, liveClass, liveDisabled, liveFill, liveShown, liveText, sizeCanvas } from './dom.ts';
import { icon } from './icons.ts';
import type { Tick, UiContext } from './types.ts';

const TOAST_MS = 3500;
const NOTICE_MS = 4000;
/** Toasts on screen at once; a very short play area holds one fewer. */
const MAX_TOASTS = 3;
/** The gap in the top row must be at least this wide (CSS pixels) before toasts are shown in it. */
const TOP_TOAST_ROOM = 320;
/** How long a toast or card takes to fade away once its time is up. */
const LEAVE_MS = 240;

export interface Overlay {
  readonly element: HTMLElement;
  update(tick: Tick): void;
  toast(message: string, kind: ToastKind): void;
  setHint(text: string | null): void;
  showDiscovery(species: SpeciesDef): void;
  showAchievement(achievement: AchievementDef): void;
  /** How many toasts and how many discovery or achievement cards this size of play area can show at once. */
  setLimits(toasts: number, notices: number): void;
  /** Pixels this layer covers at the top and bottom of a play area whose box is `stage`. */
  insets(stage: DOMRect): { top: number; bottom: number };
}

function zoneAt(index: number): ZoneDef {
  return ZONES[Math.max(0, Math.min(ZONES.length - 1, index))] as ZoneDef;
}

export function createOverlay(ctx: UiContext): Overlay {
  const { host } = ctx;
  const root = el('div', 'gf-overlay');

  // ---------------------------------------------------------------- top left: the balance
  const top = el('div', 'gf-top');

  const wallet = el('div', 'gf-wallet gf-glass');
  wallet.setAttribute('role', 'group');
  wallet.setAttribute('aria-label', 'Lumens');
  const lumens = hook(el('div', 'gf-lumens'), 'lumens-value');
  const setLumens = liveText(lumens, '0');
  const rate = hook(el('div', 'gf-rate'), 'rate-value');
  const setRate = liveText(rate, '+0/s');
  const setBoosted = liveClass(rate, 'is-boosted');
  wallet.append(icon('star', 'gf-star'), lumens, rate);

  // ---------------------------------------------------------------- top right: depth and buttons
  const hudMain = el('div', 'gf-hud-main');

  const daily = button('gf-chip-btn gf-daily', 'daily-button');
  const dailyAmount = el('span', 'gf-daily-amount');
  const setDailyAmount = liveText(dailyAmount);
  daily.append(icon('gift'), dailyAmount);
  const setDailyLabel = liveAttr(daily, 'aria-label');
  const setDailyShown = liveShown(daily, false);
  daily.addEventListener('click', () => host.claimDaily());

  const depthChip = el('div', 'gf-depth gf-glass');
  const depthValue = hook(el('div', 'gf-depth-value'), 'depth-value');
  const setDepth = liveText(depthValue, formatDepth(0));
  const zoneName = hook(el('div', 'gf-zone-name'), 'zone-name');
  const setZoneName = liveText(zoneName, zoneAt(0).name);
  depthChip.append(depthValue, zoneName);

  const settings = button('gf-icon-btn', 'settings-button');
  settings.setAttribute('aria-label', 'Settings');
  settings.title = 'Settings';
  settings.append(icon('gear'));
  settings.addEventListener('click', () => ctx.openSettings());

  hudMain.append(daily, depthChip, settings);

  // Toasts sit in the gap between the balance and the depth readout when it is wide enough to hold a sentence.
  const topGap = el('div', 'gf-top-gap');
  const topToasts = el('div', 'gf-toasts');
  topToasts.setAttribute('role', 'status');
  topToasts.setAttribute('aria-live', 'polite');
  topGap.appendChild(topToasts);
  top.append(wallet, topGap, hudMain);

  // ---------------------------------------------------------------- under the top row: Renown, boosts, toasts
  const feed = el('div', 'gf-feed');
  const extras = el('div', 'gf-extras');

  const renown = button('gf-pill gf-renown', 'renown-chip');
  const renownValue = el('span', 'gf-renown-value');
  const setRenown = liveText(renownValue);
  const renownGain = el('span', 'gf-renown-gain');
  const setRenownGain = liveText(renownGain);
  renown.append(icon('renown'), renownValue, renownGain);
  const setRenownShown = liveShown(renown, false);
  const setRenownLabel = liveAttr(renown, 'aria-label');
  renown.addEventListener('click', () => ctx.selectTab('institute'));

  const sonarPill = el('div', 'gf-pill gf-boost is-sonar');
  const sonarPillTime = el('span', 'gf-boost-time');
  const setSonarPillTime = liveText(sonarPillTime);
  sonarPill.append(icon('sonar'), el('span', 'gf-boost-name', `Sonar x${SONAR_MULT}`), sonarPillTime);
  const setSonarPillShown = liveShown(sonarPill, false);

  const frenzyPill = el('div', 'gf-pill gf-boost is-frenzy');
  const frenzyName = el('span', 'gf-boost-name');
  const setFrenzyName = liveText(frenzyName);
  const frenzyTime = el('span', 'gf-boost-time');
  const setFrenzyTime = liveText(frenzyTime);
  frenzyPill.append(icon('fish'), frenzyName, frenzyTime);
  const setFrenzyShown = liveShown(frenzyPill, false);

  extras.append(renown, sonarPill, frenzyPill);

  const backRow = el('div', 'gf-back-row');
  const viewing = el('span', 'gf-viewing');
  const setViewing = liveText(viewing);
  const back = button('gf-back', 'back-to-sub');
  back.append(icon('sub'), el('span', '', 'Back to the sub'));
  back.addEventListener('click', () => host.setViewZone(currentZone(host.state)));
  backRow.append(viewing, back);
  const setBackShown = liveShown(backRow, false);

  // On a narrow play area there is no such gap, so toasts go under the top row instead.
  const feedToasts = el('div', 'gf-toasts');
  feedToasts.setAttribute('role', 'status');
  feedToasts.setAttribute('aria-live', 'polite');
  feed.append(extras, backRow, feedToasts);

  // ---------------------------------------------------------------- above the bottom bar: cards and the hint
  const low = el('div', 'gf-low');
  const notices = el('div', 'gf-notices');
  notices.setAttribute('aria-live', 'polite');
  const hint = hook(el('div', 'gf-hint'), 'hint');
  hint.setAttribute('role', 'status');
  hint.hidden = true;
  const hintText = el('span', 'gf-hint-text');
  const setHintText = liveText(hintText);
  hint.append(icon('tap'), hintText);
  low.append(notices, hint);

  const lane = el('div', 'gf-lane');
  lane.append(feed, low);

  // ---------------------------------------------------------------- right edge: the zone ladder
  const ladder = el('nav', 'gf-ladder');
  ladder.setAttribute('aria-label', 'Ocean zones');
  const setLadderQuiet = liveClass(ladder, 'is-quiet');
  const marks = ZONES.map((zone) => {
    const mark = button('gf-zone', `zone-${zone.id}`);
    mark.setAttribute('data-zone', String(zone.id));
    mark.setAttribute('data-label', zone.name);
    mark.append(icon('sub', 'gf-zone-sub'), el('span', 'gf-zone-dot'));
    mark.addEventListener('click', () => host.setViewZone(zone.id));
    const link = el('span', 'gf-zone-link');
    const linkFill = el('span', 'gf-zone-link-fill');
    link.appendChild(linkFill);
    ladder.append(mark, link);
    return {
      zone,
      setReached: liveClass(mark, 'is-reached'),
      setSub: liveClass(mark, 'is-sub'),
      setViewed: liveClass(mark, 'is-viewed'),
      setDisabled: liveDisabled(mark),
      setLabel: liveAttr(mark, 'aria-label'),
      setFill: liveFill(linkFill, 'Y'),
      /** Which of reached / sub / viewed were set when the label was last written. */
      labelKey: -1,
    };
  });
  ladder.appendChild(el('span', 'gf-zone-floor'));

  const mid = el('div', 'gf-mid');
  mid.append(lane, ladder);

  // ---------------------------------------------------------------- bottom: Sonar, survey bar, DIVE
  const dock = el('div', 'gf-dock');

  const sonar = button('gf-sonar', 'sonar-button');
  const sonarState = el('span', 'gf-sonar-state');
  const setSonarState = liveText(sonarState);
  const sonarFill = el('span', 'gf-sonar-fill');
  const setSonarFill = liveFill(sonarFill);
  sonar.append(icon('sonar'), el('span', 'gf-sonar-name', 'Sonar'), sonarState, sonarFill);
  const setSonarShown = liveShown(sonar, false);
  const setSonarMode = liveAttr(sonar, 'data-mode');
  const setSonarDisabled = liveDisabled(sonar);
  const setSonarLabel = liveAttr(sonar, 'aria-label');
  sonar.addEventListener('click', () => host.startSonar());

  const capsule = el('div', 'gf-capsule gf-glass');
  const survey = el('div', 'gf-survey');
  const surveyTitle = el('div', 'gf-survey-title');
  const setSurveyTitle = liveText(surveyTitle);
  const surveyDetail = el('div', 'gf-survey-detail');
  const setSurveyDetail = liveText(surveyDetail);
  const setSurveyWarn = liveClass(survey, 'is-warn');
  const bar = hook(el('div', 'gf-bar gf-survey-bar'), 'survey-bar');
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-label', 'Survey progress');
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', '100');
  const barFill = el('div', 'gf-bar-fill');
  bar.appendChild(barFill);
  const setBar = liveFill(barFill);
  const setBarNow = liveAttr(bar, 'aria-valuenow');
  const setBarDone = liveClass(bar, 'is-done');
  survey.append(surveyTitle, surveyDetail, bar);

  const dive = button('gf-dive', 'dive-button');
  // The label is in two parts so that a depth such as "1,075 m" is never split across lines.
  const diveMain = el('span', 'gf-dive-main');
  const diveWhat = el('span');
  const setDiveWhat = liveText(diveWhat, 'Dive');
  const diveWhere = el('span', 'gf-dive-where');
  const setDiveWhere = liveText(diveWhere);
  diveMain.append(diveWhat, ' ', diveWhere);
  const diveSub = el('span', 'gf-dive-sub');
  const diveSubText = el('span');
  const setDiveSub = liveText(diveSubText);
  diveSub.append(icon('star', 'gf-coin'), diveSubText);
  const setDiveSubShown = liveShown(diveSub, false);
  const setCoin = liveClass(diveSub, 'has-coin');
  const diveFill = el('span', 'gf-dive-fill');
  const setDiveFill = liveFill(diveFill);
  dive.append(icon('dive', 'gf-dive-arrow'), diveMain, diveSub, diveFill);
  const setDiveMode = liveAttr(dive, 'data-mode');
  const setDiveDisabled = liveDisabled(dive);
  dive.addEventListener('click', () => {
    const state = host.state;
    const zone = hullNeeded(state);
    if (zone === null) {
      host.dive();
    } else if (hullLocked(state, zone)) {
      // Nothing to buy yet: say why, and take the player to where the blueprint is sold.
      ctx.toast(`The ${zoneAt(zone).hullName} needs a blueprint from the Institute. Publish your expedition to earn Renown.`, 'warn');
      ctx.selectTab('institute');
    } else {
      host.buyHull();
    }
  });

  capsule.append(survey, dive);
  dock.append(sonar, capsule);
  root.append(top, mid, dock);

  // ---------------------------------------------------------------- toasts
  interface Toast {
    node: HTMLElement;
    message: string;
    timer: number;
  }
  const shownToasts: Toast[] = [];
  let toastLimit = MAX_TOASTS;
  /** Toasts that are fading out; cleared at once when a new one needs the room. */
  const fading = new Set<HTMLElement>();

  function fadeOut(node: HTMLElement): void {
    fading.add(node);
    node.classList.add('is-leaving');
    window.setTimeout(() => {
      fading.delete(node);
      node.remove();
    }, LEAVE_MS);
  }

  function expire(entry: Toast): void {
    const index = shownToasts.indexOf(entry);
    if (index < 0) return;
    shownToasts.splice(index, 1);
    fadeOut(entry.node);
  }

  function toast(message: string, kind: ToastKind): void {
    const same = shownToasts.find((entry) => entry.message === message);
    if (same) {
      // The same news again: keep the one toast and give it a fresh lifetime.
      window.clearTimeout(same.timer);
      same.timer = window.setTimeout(() => expire(same), TOAST_MS);
      return;
    }
    for (const node of fading) node.remove();
    fading.clear();
    while (shownToasts.length >= toastLimit) {
      const oldest = shownToasts.shift();
      if (!oldest) break;
      window.clearTimeout(oldest.timer);
      oldest.node.remove();
    }
    const node = hook(el('div', `gf-toast is-${kind}`, message), 'toast');
    const entry: Toast = { node, message, timer: 0 };
    entry.timer = window.setTimeout(() => expire(entry), TOAST_MS);
    shownToasts.push(entry);
    (topGap.clientWidth >= TOP_TOAST_ROOM ? topToasts : feedToasts).appendChild(node);
  }

  // ---------------------------------------------------------------- discovery and achievement cards
  interface Notice {
    node: HTMLElement;
    timer: number;
  }
  const liveNotices: Notice[] = [];
  let noticeLimit = 2;

  /** Takes a card off screen: with a fade when its time is up, at once when a newer card needs its place. */
  function retire(notice: Notice, fade: boolean): void {
    window.clearTimeout(notice.timer);
    const index = liveNotices.indexOf(notice);
    if (index >= 0) liveNotices.splice(index, 1);
    if (!fade) {
      notice.node.remove();
      return;
    }
    notice.node.classList.add('is-leaving');
    window.setTimeout(() => notice.node.remove(), LEAVE_MS);
  }

  function pushNotice(node: HTMLElement): void {
    // A newer card pushes the oldest out early rather than waiting its turn, so news is never late.
    while (liveNotices.length >= noticeLimit) {
      const oldest = liveNotices[0];
      if (!oldest) break;
      retire(oldest, false);
    }
    const notice: Notice = { node, timer: 0 };
    notice.timer = window.setTimeout(() => retire(notice, true), NOTICE_MS);
    liveNotices.push(notice);
    notices.appendChild(node);
  }

  function noticeText(label: string, tag: HTMLElement, title: string, note: string): HTMLElement {
    const text = el('div', 'gf-notice-text');
    const eyebrow = el('div', 'gf-notice-eyebrow');
    eyebrow.append(el('span', '', label), tag);
    text.append(eyebrow, el('div', 'gf-notice-title', title), el('div', 'gf-notice-note', note));
    return text;
  }

  function showDiscovery(species: SpeciesDef): void {
    const card = el('div', 'gf-notice is-discovery');
    const portrait = el('canvas', 'gf-portrait');
    portrait.setAttribute('data-zone', String(species.zone));
    sizeCanvas(portrait, 64, 48);
    try {
      host.drawPortrait(portrait, species, false);
    } catch {
      // A portrait that fails to draw must not cost the player the news; the card shows without it.
    }
    const tag = el('span', 'gf-rarity', RARITIES[species.rarity].label);
    tag.setAttribute('data-rarity', species.rarity);
    card.append(portrait, noticeText('New species', tag, species.name, species.note));
    pushNotice(card);
  }

  function showAchievement(achievement: AchievementDef): void {
    const card = el('div', 'gf-notice is-achievement');
    const badge = el('span', 'gf-notice-badge');
    badge.appendChild(icon('trophy'));
    const tag = el('span', 'gf-notice-bonus', `+${formatPercent(ACHIEVEMENT_BONUS)} income`);
    card.append(badge, noticeText('Achievement', tag, achievement.name, achievement.description));
    pushNotice(card);
  }

  // ---------------------------------------------------------------- hint
  let hintShown: string | null = null;

  function setHint(text: string | null): void {
    if (text === hintShown) return;
    hintShown = text;
    hint.hidden = text === null;
    if (text === null) return;
    setHintText(text);
    // Restart the entrance so a change of advice catches the eye.
    hint.classList.remove('is-fresh');
    void hint.offsetWidth;
    hint.classList.add('is-fresh');
  }

  // ---------------------------------------------------------------- refresh
  function lumensToGo(amount: number): string {
    const text = ctx.num(Math.ceil(amount));
    return `${text} ${text === '1' ? 'lumen' : 'lumens'} to go`;
  }

  function updateDock(tick: Tick, sonarOn: boolean): void {
    const state = tick.state;
    const block = diveBlock(state);
    const depth = depthOfStep(state.depthStep);
    const progress = surveyProgress(state);

    let mode = 'survey';
    let main = 'Dive';
    let where = '';
    let sub = '';
    let coin = false;
    let fill = 0;
    let disabled = false;
    let title = '';
    let detail = '';
    let warn = false;

    if (block === 'floor') {
      mode = 'floor';
      main = 'Sea floor reached';
      sub = formatDepth(depth);
      disabled = true;
      title = 'The sea floor';
      detail = 'Nothing lies deeper than this.';
    } else {
      const done = surveyComplete(state);
      const toGo = lumensToGo(Math.max(0, surveyTarget(state) - state.survey));
      const needed = hullNeeded(state);
      title = done ? 'Survey complete' : `Surveying ${formatDepth(depth)}`;
      if (needed !== null) {
        const zone = zoneAt(needed);
        if (hullLocked(state, needed)) {
          mode = 'blueprint';
          main = `${zone.hullName} locked`;
          sub = 'Open the Institute';
          detail = 'Needs an Institute blueprint. Publish to earn Renown.';
          warn = true;
        } else {
          const cost = hullCost(state, needed);
          const affordable = state.lumens >= cost;
          mode = affordable ? 'hull' : 'hull-poor';
          main = `Build ${zone.hullName}`;
          sub = ctx.num(cost);
          coin = true;
          disabled = !affordable;
          fill = affordable ? 0 : state.lumens / cost;
          detail = done ? `The ${zone.name} needs the ${zone.hullName}` : `${toGo} · ${zone.hullName} needed next`;
        }
      } else if (done) {
        mode = 'ready';
        main = 'Dive to';
        where = formatDepth(depthOfStep(state.depthStep + 1));
        detail = 'Ready when you are';
      } else {
        main = 'Dive';
        sub = `${Math.floor(progress * 100)}%`;
        disabled = true;
        detail = toGo;
      }
    }

    setSurveyTitle(title);
    setSurveyDetail(detail);
    setSurveyWarn(warn);
    setBar(progress);
    setBarNow(String(Math.floor(progress * 100)));
    setBarDone(progress >= 1);
    setDiveMode(mode);
    setDiveWhat(main);
    setDiveWhere(where);
    setDiveSub(sub);
    setDiveSubShown(sub !== '');
    setCoin(coin);
    setDiveFill(fill);
    setDiveDisabled(disabled);

    const unlocked = sonarUnlocked(state);
    setSonarShown(unlocked);
    if (!unlocked) return;
    if (sonarOn) {
      const left = Math.max(0, state.sonarUntil - state.clock);
      const text = formatDuration(Math.ceil(left));
      setSonarMode('active');
      setSonarState(text);
      setSonarFill(left / SONAR_SECONDS);
      setSonarDisabled(true);
      setSonarLabel(`Sonar Burst is active: all income x${SONAR_MULT} for another ${text}`);
    } else if (sonarReady(state)) {
      setSonarMode('ready');
      setSonarState(host.hasAds ? 'Watch ad' : 'Free');
      setSonarFill(0);
      setSonarDisabled(false);
      const how = host.hasAds ? 'Watch an advert to start it.' : `Free. Ready again ${formatDuration(SONAR_COOLDOWN)} after each use.`;
      setSonarLabel(`Sonar Burst: all income x${SONAR_MULT} for ${formatDuration(SONAR_SECONDS)}. ${how}`);
    } else {
      const left = Math.max(0, state.sonarReadyAt - state.clock);
      const span = Math.max(1, state.sonarReadyAt - state.sonarUntil);
      const text = formatDuration(Math.ceil(left));
      setSonarMode('charging');
      setSonarState(text);
      setSonarFill(1 - left / span);
      setSonarDisabled(true);
      setSonarLabel(`Sonar Burst is recharging: ready in ${text}`);
    }
  }

  function updateLadder(tick: Tick, subZone: number, view: number): void {
    const state = tick.state;
    const start = ZONE_START_STEP[subZone] ?? 0;
    const end = ZONE_START_STEP[subZone + 1] ?? TOTAL_STEPS;
    const within = end > start ? (state.depthStep - start) / (end - start) : 1;
    setLadderQuiet(state.maxStepEver < (ZONE_START_STEP[1] ?? 0));
    for (const mark of marks) {
      const index = mark.zone.id;
      const reached = index <= subZone;
      const isSub = index === subZone;
      const viewed = index === view;
      mark.setReached(reached);
      mark.setSub(isSub);
      mark.setViewed(viewed);
      mark.setDisabled(!reached);
      mark.setFill(index < subZone ? 1 : isSub ? within : 0);
      const key = (reached ? 4 : 0) + (isSub ? 2 : 0) + (viewed ? 1 : 0);
      if (key !== mark.labelKey) {
        mark.labelKey = key;
        const notes = [mark.zone.name];
        if (!reached) notes.push('not reached yet');
        if (isSub) notes.push('the sub is here');
        if (viewed) notes.push('on screen now');
        mark.setLabel(notes.join(', '));
      }
    }
  }

  function update(tick: Tick): void {
    const state = tick.state;
    setLumens(ctx.num(state.lumens));
    setRate(`+${ctx.rate(tick.rate)}/s`);
    setBoosted(boostMultiplier(state) > 1);

    const subZone = currentZone(state);
    const view = host.viewZone;
    setDepth(formatDepth(depthOfStep(state.depthStep)));
    setZoneName(zoneAt(subZone).name);

    const today = localDay(Date.now(), new Date().getTimezoneOffset());
    const gift = dailyAvailable(state, today);
    setDailyShown(gift);
    if (gift) {
      const reward = ctx.num(dailyReward(state, today));
      setDailyAmount(`+${reward}`);
      setDailyLabel(`Claim your daily gift: ${reward} lumens`);
    }

    const pending = renownOnPublish(state);
    const renownKnown = state.renown > 0 || state.prestiges > 0 || pending >= 1;
    setRenownShown(renownKnown);
    if (renownKnown) {
      const balance = ctx.num(state.renown);
      setRenown(balance);
      setRenownGain(pending >= 1 ? `(+${ctx.num(pending)})` : '');
      setRenownLabel(pending >= 1 ? `Renown: ${balance}. Publishing now would add ${ctx.num(pending)}. Open the Institute.` : `Renown: ${balance}. Open the Institute.`);
    }

    const sonarOn = sonarActive(state);
    setSonarPillShown(sonarOn);
    if (sonarOn) setSonarPillTime(formatDuration(Math.ceil(state.sonarUntil - state.clock)));

    const frenzy = getModifiers(state).frenzyMult;
    const frenzyOn = frenzy > 0 && frenzyActive(state);
    setFrenzyShown(frenzyOn);
    if (frenzyOn) {
      setFrenzyName(`Frenzy x${frenzy}`);
      setFrenzyTime(formatDuration(Math.ceil(state.frenzyUntil - state.clock)));
    }

    const away = view !== subZone;
    setBackShown(away);
    if (away) setViewing(`Looking at the ${zoneAt(view).name}`);

    updateLadder(tick, subZone, view);
    updateDock(tick, sonarOn);
  }

  return {
    element: root,
    update,
    toast,
    setHint,
    showDiscovery,
    showAchievement,
    setLimits(toasts, notices) {
      toastLimit = Math.max(1, Math.min(MAX_TOASTS, toasts));
      noticeLimit = Math.max(1, notices);
    },
    insets(stage) {
      const topEdge = top.getBoundingClientRect().bottom;
      const lowEdge = hint.hidden ? dock.getBoundingClientRect().top : hint.getBoundingClientRect().top;
      return {
        top: Math.max(0, Math.round(topEdge - stage.top)),
        bottom: Math.max(0, Math.round(stage.bottom - lowEdge)),
      };
    },
  };
}
