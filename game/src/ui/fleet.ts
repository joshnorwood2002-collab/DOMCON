// The Fleet tab: one row per unit the player has unlocked, each with its own
// buy button, and a single teaser for the next unit still out of reach.

import { formatDepth } from '../core/format.ts';
import { FLEET_MILESTONES, GENERATORS, type GeneratorDef } from '../game/content.ts';
import { depthOfStep, generatorCost, generatorRate, generatorUnlocked, maxAffordable, nextMilestone } from '../game/economy.ts';
import type { GameState } from '../game/state.ts';
import { button, el, hook, liveAttr, liveClass, liveDisabled, liveFill, liveShown, liveText, progressBar } from './dom.ts';
import { fleetTile, icon } from './icons.ts';
import { howFar, savedShare } from './text.ts';
import type { Tick, UiContext, View } from './types.ts';

type BuyAmount = 1 | 10 | 'max';

const AMOUNTS: readonly { value: BuyAmount; label: string; id: string }[] = [
  { value: 1, label: 'x1', id: 'buy-amount-1' },
  { value: 10, label: 'x10', id: 'buy-amount-10' },
  { value: 'max', label: 'Max', id: 'buy-amount-max' },
];

/** The doubling threshold the count has already passed, or 0 before the first. */
function passedMilestone(count: number): number {
  let passed = 0;
  for (const threshold of FLEET_MILESTONES) {
    if (count >= threshold) passed = threshold;
  }
  return passed;
}

/** True when the next single unit of any unlocked tier can be paid for. */
export function fleetAffordable(state: GameState): boolean {
  for (const def of GENERATORS) {
    if (generatorUnlocked(state, def.id) && generatorCost(state, def.id, 1) <= state.lumens) return true;
  }
  return false;
}

export function createFleetView(ctx: UiContext): View {
  const { host } = ctx;
  let amount: BuyAmount = 1;
  /** The amount switch stays out of sight until the player could use it, then never hides again. */
  let switchRevealed = false;

  const root = el('div', 'gf-view-body');

  const head = el('div', 'gf-view-head');
  const summary = el('div', 'gf-view-note');
  const setSummary = liveText(summary);
  const seg = el('div', 'gf-seg');
  seg.setAttribute('role', 'group');
  seg.setAttribute('aria-label', 'How many to buy at once');
  const setSegWaiting = liveClass(seg, 'is-waiting');
  const segButtons = AMOUNTS.map((choice) => {
    const control = button('gf-seg-btn', choice.id);
    control.textContent = choice.label;
    control.addEventListener('click', () => {
      amount = choice.value;
      ctx.refresh();
    });
    seg.appendChild(control);
    return { value: choice.value, setPressed: liveAttr(control, 'aria-pressed') };
  });
  head.append(summary, seg);

  const list = el('div', 'gf-list');
  const rows = GENERATORS.map((def) => {
    const row = el('div', 'gf-row gf-unit');
    const info = el('div', 'gf-row-info');

    const headLine = el('div', 'gf-row-head');
    const count = el('span', 'gf-unit-count');
    headLine.append(el('span', 'gf-row-name', def.name), count);

    const about = el('div', 'gf-row-desc', def.description);
    const owned = el('div', 'gf-unit-owned');
    const rate = el('div', 'gf-unit-rate');
    const mile = el('div', 'gf-mile');
    const mileBar = progressBar('gf-mile-bar');
    const mileText = el('span', 'gf-mile-text');
    mile.append(mileBar.bar, mileText);
    owned.append(rate, mile);
    info.append(headLine, about, owned);

    const buy = button('gf-buy', `gen-${def.id}-buy`);
    const buyLabel = el('span', 'gf-buy-label');
    const price = el('span', 'gf-price');
    const priceText = el('span');
    price.append(icon('star', 'gf-coin'), priceText);
    const buyFill = el('span', 'gf-buy-fill');
    buy.append(buyLabel, price, buyFill);
    buy.addEventListener('click', () => host.buyGenerator(def.id, amount));

    row.append(fleetTile(def.id), info, buy);
    list.appendChild(row);

    return {
      def,
      count,
      /** Units owned at the last refresh; -1 until the row has been shown once. */
      lastCount: -1,
      setShown: liveShown(row, false),
      setOwned: liveClass(row, 'is-owned'),
      setCount: liveText(count),
      setRate: liveText(rate),
      setMile: mileBar.set,
      setMileText: liveText(mileText),
      setLabel: liveText(buyLabel),
      setPrice: liveText(priceText),
      setFill: liveFill(buyFill),
      setAffordable: liveClass(buy, 'is-ok'),
      setDisabled: liveDisabled(buy),
      setSpoken: liveAttr(buy, 'aria-label'),
    };
  });

  const teaser = hook(el('div', 'gf-row gf-teaser'), 'fleet-teaser');
  const teaserTile = el('span', 'gf-glyph is-locked');
  teaserTile.appendChild(icon('lock'));
  const teaserInfo = el('div', 'gf-row-info');
  const teaserName = el('div', 'gf-row-name');
  const setTeaserName = liveText(teaserName);
  const teaserNote = el('div', 'gf-row-desc');
  const setTeaserNote = liveText(teaserNote);
  teaserInfo.append(teaserName, teaserNote);
  teaser.append(teaserTile, teaserInfo);
  const setTeaserShown = liveShown(teaser, false);
  list.appendChild(teaser);

  root.append(head, list);

  function update(tick: Tick): void {
    const state = tick.state;
    let units = 0;
    let nextLocked: GeneratorDef | null = null;
    let couldBuyTwo = false;

    for (const row of rows) {
      const gen = row.def.id;
      const unlocked = generatorUnlocked(state, gen);
      row.setShown(unlocked);
      if (!unlocked) {
        nextLocked ??= row.def;
        continue;
      }

      const count = state.generators[gen] ?? 0;
      units += count;
      row.setOwned(count > 0);
      row.setCount(count > 0 ? ctx.num(count) : '');
      // The owned count gives a small pop when it goes up, so a purchase is felt as well as seen.
      if (row.lastCount >= 0 && count > row.lastCount && !state.settings.reducedMotion && typeof row.count.animate === 'function') {
        row.count.animate([{ transform: 'scale(1.4)' }, { transform: 'scale(1)' }], { duration: 220, easing: 'ease-out' });
      }
      row.lastCount = count;
      if (count > 0) {
        row.setRate(`+${ctx.rate(generatorRate(state, gen))}/s`);
        const next = nextMilestone(count);
        if (next === null) {
          row.setMile(1);
          row.setMileText('Every doubling earned');
        } else {
          const passed = passedMilestone(count);
          row.setMile((count - passed) / (next - passed));
          row.setMileText(`x2 at ${next}`);
        }
      }

      const most = amount === 'max' || !switchRevealed ? maxAffordable(state, gen) : 0;
      if (most >= 2) couldBuyTwo = true;
      const quantity = amount === 'max' ? Math.max(1, most) : amount;
      const cost = generatorCost(state, gen, quantity);
      const affordable = cost <= state.lumens;
      const priceText = ctx.num(cost);
      const wait = affordable ? '' : howFar(cost, state.lumens, tick.rate, ctx.num);
      row.setLabel(affordable ? `Buy ${quantity}` : quantity > 1 ? `x${quantity} ${wait}` : wait);
      row.setPrice(priceText);
      row.setFill(affordable ? 0 : savedShare(cost, state.lumens));
      row.setAffordable(affordable);
      row.setDisabled(!affordable);
      row.setSpoken(`Buy ${quantity} ${quantity === 1 ? row.def.name : row.def.plural} for ${priceText} lumens${affordable ? '' : `, ${wait}`}`);
    }

    if (units > 0 || couldBuyTwo) switchRevealed = true;
    setSegWaiting(!switchRevealed);
    for (const choice of segButtons) choice.setPressed(String(choice.value === amount));

    setSummary(units > 0 ? `${ctx.num(units)} ${units === 1 ? 'unit' : 'units'} · +${ctx.rate(tick.rate)}/s` : 'Your fleet earns lumens while you rest.');

    setTeaserShown(nextLocked !== null);
    if (nextLocked) {
      setTeaserName(nextLocked.name);
      setTeaserNote(`Unlocks at ${formatDepth(depthOfStep(nextLocked.unlockStep))}`);
    }
  }

  return {
    element: root,
    update,
    reset() {
      amount = 1;
      switchRevealed = false;
      for (const row of rows) row.lastCount = -1;
    },
  };
}
