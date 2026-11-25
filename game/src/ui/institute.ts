// The Institute tab: publishing an expedition for Renown, and the permanent
// upgrades Renown buys. It is on show from the first minute, so it explains
// itself until the player can use it.

import { formatDepth } from '../core/format.ts';
import { INSTITUTE, TOTAL_STEPS, type Effect, type InstituteDef } from '../game/content.ts';
import { PRESTIGE_MIN_STEP, depthOfStep, instituteCost, instituteLevel, instituteVisible, renownAtStep, renownOnPublish } from '../game/economy.ts';
import type { GameState } from '../game/state.ts';
import { button, el, liveAttr, liveClass, liveDisabled, liveShown, liveText, progressBar } from './dom.ts';
import { fleetTile, icon, iconTile, type IconName } from './icons.ts';
import type { Tick, UiContext, View } from './types.ts';

/** How many dives ahead the publish card looks. */
const FORECAST_DIVES = 3;

/** Picture and tile hue for an upgrade, chosen by what it does. */
const EFFECT_LOOK: Partial<Record<Effect['kind'], readonly [IconName, number]>> = {
  globalMult: ['star', 46],
  tapMult: ['scan', 174],
  diveDiscount: ['dive', 200],
  offlineHours: ['clock', 216],
  autoDive: ['sub', 190],
  autoBuy: ['fleet', 152],
  unlockZone: ['hull', 262],
  codexBonus: ['codex', 152],
  rareChance: ['fish', 286],
  studySpeed: ['sonar', 174],
  renownMult: ['renown', 270],
  generatorDiscount: ['gift', 28],
};

function upgradeTile(upgrade: InstituteDef): HTMLElement {
  if (upgrade.effect.kind === 'seedBuoys') return fleetTile(0);
  const [name, hue] = EFFECT_LOOK[upgrade.effect.kind] ?? ['star', 46];
  return iconTile(name, hue);
}

/** True when the Renown balance covers the next level of any upgrade on show. */
export function instituteAffordable(state: GameState): boolean {
  if (state.renown <= 0) return false;
  for (const upgrade of INSTITUTE) {
    if (instituteVisible(state, upgrade) && instituteCost(state, upgrade) <= state.renown) return true;
  }
  return false;
}

export function createInstituteView(ctx: UiContext): View {
  const { host } = ctx;
  const root = el('div', 'gf-view-body');

  const intro = el(
    'p',
    'gf-intro',
    'Every expedition ends back at the surface. Publish what you found to earn Renown, then spend it here on upgrades you keep for good.',
  );
  const setIntroShown = liveShown(intro, true);

  // ---------------------------------------------------------------- the publish card
  const card = el('section', 'gf-publish');
  const nowLine = el('div', 'gf-publish-now');
  const nowValue = el('span', 'gf-publish-value');
  const setNowValue = liveText(nowValue);
  const nowLabel = el('span', 'gf-publish-label');
  const setNowLabel = liveText(nowLabel);
  nowLine.append(icon('renown', 'gf-gem'), nowValue, nowLabel);

  const need = el('div', 'gf-publish-need');
  const needText = el('div', 'gf-publish-need-text');
  const setNeedText = liveText(needText);
  const needBar = progressBar('gf-need-bar');
  need.append(needText, needBar.bar);
  const setNeedShown = liveShown(need, true);

  const forecast = el('div', 'gf-forecast');
  const forecastLabel = el('div', 'gf-forecast-label');
  const setForecastLabel = liveText(forecastLabel);
  const forecastRow = el('div', 'gf-forecast-row');
  const chips = Array.from({ length: FORECAST_DIVES }, () => {
    const chip = el('div', 'gf-forecast-chip');
    const depth = el('span', 'gf-forecast-depth');
    const value = el('span', 'gf-forecast-value');
    const valueText = el('span');
    value.append(icon('renown', 'gf-gem'), valueText);
    const gain = el('span', 'gf-forecast-gain');
    chip.append(depth, value, gain);
    forecastRow.appendChild(chip);
    return { setShown: liveShown(chip, true), setDepth: liveText(depth), setValue: liveText(valueText), setGain: liveText(gain) };
  });
  forecast.append(forecastLabel, forecastRow);
  const setForecastShown = liveShown(forecast, true);

  const publish = button('gf-btn gf-btn-renown gf-publish-btn', 'publish-button');
  const setPublishText = liveText(publish, 'Publish expedition');
  const setPublishDisabled = liveDisabled(publish);
  publish.addEventListener('click', () => ctx.askPublish());

  const terms = el('p', 'gf-publish-terms', 'Publishing resets lumens, fleet, research and depth. Your codex, achievements, Institute upgrades and Renown stay.');
  card.append(el('h3', 'gf-section-title', 'Surface and publish'), nowLine, need, forecast, publish, terms);

  // ---------------------------------------------------------------- balance and upgrades
  const balance = el('div', 'gf-balance');
  const balanceValue = el('span', 'gf-balance-value');
  const setBalance = liveText(balanceValue);
  const balanceTotal = el('span', 'gf-balance-total');
  const setBalanceTotal = liveText(balanceTotal);
  balance.append(el('h3', 'gf-section-title', 'Institute upgrades'), icon('renown', 'gf-gem'), balanceValue, balanceTotal);

  const list = el('div', 'gf-list');
  const rows = INSTITUTE.map((upgrade) => {
    const row = el('div', 'gf-row');
    const info = el('div', 'gf-row-info');
    const head = el('div', 'gf-row-head');
    const level = el('span', 'gf-level');
    head.append(el('span', 'gf-row-name', upgrade.name), level);
    info.append(head, el('div', 'gf-row-desc', upgrade.description));

    const buy = button('gf-buy is-renown', `institute-${upgrade.id}-buy`);
    const label = el('span', 'gf-buy-label');
    const price = el('span', 'gf-price');
    const priceText = el('span');
    price.append(icon('renown', 'gf-gem'), priceText);
    buy.append(label, price);
    buy.addEventListener('click', () => host.buyInstitute(upgrade.id));

    row.append(upgradeTile(upgrade), info, buy);
    list.appendChild(row);
    return {
      upgrade,
      setShown: liveShown(row, false),
      setLevel: liveText(level),
      setLabel: liveText(label),
      setPrice: liveText(priceText),
      setPriceShown: liveShown(price, true),
      setAffordable: liveClass(buy, 'is-ok'),
      setMaxed: liveClass(buy, 'is-maxed'),
      setDisabled: liveDisabled(buy),
      setSpoken: liveAttr(buy, 'aria-label'),
    };
  });

  const later = el('p', 'gf-later');
  const setLater = liveText(later);
  const setLaterShown = liveShown(later, false);

  root.append(intro, card, balance, list, later);

  function levelText(upgrade: InstituteDef, level: number): string {
    if (upgrade.maxLevel === 1) return level > 0 ? 'Owned' : '';
    if (level === 0) return '';
    // Upgrades with no practical ceiling show just the level reached.
    return upgrade.maxLevel > 99 ? `Level ${level}` : `Level ${level}/${upgrade.maxLevel}`;
  }

  function update(tick: Tick): void {
    const state = tick.state;
    const now = renownOnPublish(state);
    const reached = state.stats.maxStepThisRun;
    const canPublish = now >= 1;
    const minDepth = formatDepth(depthOfStep(PRESTIGE_MIN_STEP));

    setIntroShown(state.prestiges === 0);
    setNowValue(ctx.num(now));
    setNowLabel(canPublish ? 'Renown if you publish now' : 'Renown yet');
    setNeedShown(!canPublish);
    if (!canPublish) {
      setNeedText(`Dive to ${minDepth} to publish. Deepest this expedition: ${formatDepth(depthOfStep(reached))}.`);
      needBar.set(reached / PRESTIGE_MIN_STEP);
    }

    const base = Math.max(reached, PRESTIGE_MIN_STEP - 1);
    let anyChip = false;
    chips.forEach((chip, index) => {
      const step = base + 1 + index;
      const shown = step <= TOTAL_STEPS;
      chip.setShown(shown);
      if (!shown) return;
      anyChip = true;
      const total = renownAtStep(state, step);
      chip.setDepth(formatDepth(depthOfStep(step)));
      chip.setValue(ctx.num(total));
      chip.setGain(canPublish ? `+${ctx.num(total - now)}` : '');
    });
    setForecastShown(anyChip);
    setForecastLabel(canPublish ? 'Dive deeper first and it pays more:' : 'What publishing will pay:');

    setPublishText(canPublish ? `Publish for ${ctx.num(now)} Renown` : `Publish (reach ${minDepth})`);
    setPublishDisabled(!canPublish);

    setBalance(ctx.num(state.renown));
    setBalanceTotal(state.renownTotal > state.renown ? `of ${ctx.num(state.renownTotal)} earned` : '');

    let hiddenUpgrades = 0;
    for (const row of rows) {
      const upgrade = row.upgrade;
      const visible = instituteVisible(state, upgrade);
      row.setShown(visible);
      if (!visible) {
        hiddenUpgrades++;
        continue;
      }
      const level = instituteLevel(state, upgrade.id);
      const cost = instituteCost(state, upgrade);
      const maxed = !Number.isFinite(cost);
      const affordable = !maxed && cost <= state.renown;
      const priceText = maxed ? '' : ctx.num(cost);
      const label = maxed ? (upgrade.maxLevel === 1 ? 'Owned' : 'Maxed') : affordable ? (level === 0 ? 'Buy' : 'Upgrade') : `Need ${ctx.num(cost - state.renown)} more`;
      row.setLevel(levelText(upgrade, level));
      row.setLabel(label);
      row.setPrice(priceText);
      row.setPriceShown(!maxed);
      row.setAffordable(affordable);
      row.setMaxed(maxed);
      row.setDisabled(!affordable);
      row.setSpoken(maxed ? `${upgrade.name}: ${label}` : `${upgrade.name}: ${label}, ${priceText} Renown`);
    }
    setLaterShown(hiddenUpgrades > 0);
    if (hiddenUpgrades > 0) setLater(`${hiddenUpgrades} more ${hiddenUpgrades === 1 ? 'upgrade appears' : 'upgrades appear'} as you publish expeditions.`);
  }

  return { element: root, update };
}
