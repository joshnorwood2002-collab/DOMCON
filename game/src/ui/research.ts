// The Research tab: what the player can see and has not bought, cheapest first.

import { RESEARCH, type ResearchDef } from '../game/content.ts';
import { availableResearch } from '../game/economy.ts';
import type { GameState } from '../game/state.ts';
import { button, el, liveAttr, liveClass, liveDisabled, liveFill, liveShown, liveText } from './dom.ts';
import { fleetTile, icon, iconTile, type IconName } from './icons.ts';
import { howFar, savedShare } from './text.ts';
import type { Tick, UiContext, View } from './types.ts';

/** Picture and tile hue for each kind of research that is not tied to one fleet unit. */
const GROUP_LOOK: Readonly<Record<Exclude<ResearchDef['group'], 'fleet'>, readonly [IconName, number]>> = {
  scanner: ['scan', 174],
  analysis: ['analysis', 46],
  shoal: ['fish', 200],
  automation: ['gear', 262],
};

export interface ResearchModel {
  /**
   * Unbought research the player can see, cheapest first. The same array is
   * handed back until something that could change the list has changed, so
   * callers can tell "nothing new" by comparing it with the last one.
   */
  available(state: GameState): readonly ResearchDef[];
}

export function createResearchModel(): ResearchModel {
  let owner: GameState | null = null;
  let key = '';
  let list: readonly ResearchDef[] = [];
  return {
    available(state) {
      // The list depends only on what is bought, how deep this expedition has gone and the fleet counts.
      const next = `${Object.keys(state.research).length}|${state.stats.maxStepThisRun}|${state.generators.join(',')}`;
      if (state !== owner || next !== key) {
        owner = state;
        key = next;
        list = availableResearch(state);
      }
      return list;
    },
  };
}

interface Row {
  readonly research: ResearchDef;
  readonly element: HTMLElement;
  setLabel(value: string): void;
  setPrice(value: string): void;
  setFill(fraction: number): void;
  setAffordable(on: boolean): void;
  setDisabled(disabled: boolean): void;
  setSpoken(value: string): void;
}

export function createResearchView(ctx: UiContext, model: ResearchModel): View {
  const { host } = ctx;
  const root = el('div', 'gf-view-body');

  const head = el('div', 'gf-view-head');
  const note = el('div', 'gf-view-note');
  const setNote = liveText(note);
  head.appendChild(note);

  const list = el('div', 'gf-list');

  const empty = el('div', 'gf-empty');
  const emptyTile = el('span', 'gf-empty-icon');
  emptyTile.appendChild(icon('research'));
  empty.append(
    emptyTile,
    el('div', 'gf-empty-title', 'Dive deeper to uncover more'),
    el('div', 'gf-empty-note', 'You have bought everything in sight. New research turns up at new depths and as your fleet grows.'),
  );
  const setEmptyShown = liveShown(empty, false);

  root.append(head, list, empty);

  const rows = new Map<string, Row>();
  let laidOut: readonly ResearchDef[] | null = null;

  function rowFor(research: ResearchDef): Row {
    const known = rows.get(research.id);
    if (known) return known;

    const element = el('div', 'gf-row');
    let tile: HTMLElement;
    if (research.group === 'fleet') {
      tile = fleetTile(research.effect.kind === 'genMult' ? research.effect.gen : 0);
    } else {
      const [name, hue] = GROUP_LOOK[research.group];
      tile = iconTile(name, hue);
    }
    const info = el('div', 'gf-row-info');
    info.append(el('div', 'gf-row-name', research.name), el('div', 'gf-row-desc', research.description));

    const buy = button('gf-buy', `research-${research.id}-buy`);
    const label = el('span', 'gf-buy-label');
    const price = el('span', 'gf-price');
    const priceText = el('span');
    price.append(icon('star', 'gf-coin'), priceText);
    const fill = el('span', 'gf-buy-fill');
    buy.append(label, price, fill);
    buy.addEventListener('click', () => host.buyResearch(research.id));
    element.append(tile, info, buy);

    const row: Row = {
      research,
      element,
      setLabel: liveText(label),
      setPrice: liveText(priceText),
      setFill: liveFill(fill),
      setAffordable: liveClass(buy, 'is-ok'),
      setDisabled: liveDisabled(buy),
      setSpoken: liveAttr(buy, 'aria-label'),
    };
    rows.set(research.id, row);
    return row;
  }

  /** Makes the list on screen match `wanted`, moving only the rows that are out of place. */
  function layOut(wanted: readonly ResearchDef[]): void {
    wanted.forEach((research, index) => {
      const element = rowFor(research).element;
      const current = list.children[index];
      if (current !== element) list.insertBefore(element, current ?? null);
    });
    while (list.children.length > wanted.length) list.lastElementChild?.remove();
  }

  function update(tick: Tick): void {
    const state = tick.state;
    const available = model.available(state);
    if (available !== laidOut) {
      laidOut = available;
      layOut(available);
    }
    const done = Object.keys(state.research).length;
    setNote(`${done} of ${RESEARCH.length} done this expedition`);
    setEmptyShown(available.length === 0);

    for (const research of available) {
      const row = rowFor(research);
      const affordable = research.cost <= state.lumens;
      const priceText = ctx.num(research.cost);
      const wait = affordable ? '' : howFar(research.cost, state.lumens, tick.rate, ctx.num);
      row.setLabel(affordable ? 'Research' : wait);
      row.setPrice(priceText);
      row.setFill(affordable ? 0 : savedShare(research.cost, state.lumens));
      row.setAffordable(affordable);
      row.setDisabled(!affordable);
      row.setSpoken(`Research ${research.name} for ${priceText} lumens${affordable ? '' : `, ${wait}`}`);
    }
  }

  return { element: root, update };
}
