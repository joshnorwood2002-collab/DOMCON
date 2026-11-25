// The panel beside (or below) the play area: five tabs and whichever one is
// open. A tab's contents are built the first time it is opened, so a new
// player's page starts small.

import type { SpeciesDef } from '../game/content.ts';
import { canPublish } from '../game/economy.ts';
import { createCodexView } from './codex.ts';
import { button, el, liveAttr, liveClass } from './dom.ts';
import { createFleetView, fleetAffordable } from './fleet.ts';
import { createGoalsView } from './goals.ts';
import { icon, logo } from './icons.ts';
import { createInstituteView, instituteAffordable } from './institute.ts';
import { createResearchModel, createResearchView } from './research.ts';
import { TAB_IDS, type TabId, type Tick, type UiContext, type View } from './types.ts';

const TAB_LABELS: Readonly<Record<TabId, string>> = {
  fleet: 'Fleet',
  research: 'Research',
  codex: 'Codex',
  institute: 'Institute',
  goals: 'Goals',
};

export interface Panel {
  readonly element: HTMLElement;
  select(tab: TabId): void;
  update(tick: Tick): void;
  /** Call when a different save has been loaded. */
  reset(): void;
  /** A species was just discovered: its codex card is flagged until the player has looked. */
  noteDiscovery(species: SpeciesDef): void;
  /** An achievement was just unlocked: the Goals tab is flagged until the player has looked. */
  noteAchievement(): void;
}

export function createPanel(ctx: UiContext): Panel {
  const root = el('section', 'gf-panel');
  root.setAttribute('aria-label', 'Expedition');

  const brand = el('header', 'gf-brand');
  brand.append(logo(), el('span', 'gf-brand-name', __TITLE__));

  const tablist = el('div', 'gf-tabs');
  tablist.setAttribute('role', 'tablist');
  tablist.setAttribute('aria-label', 'Sections');
  const views = el('div', 'gf-views');

  const research = createResearchModel();
  const freshSpecies = new Set<string>();
  let freshGoals = 0;
  /** Number of expeditions published when the player last saw that publishing was open; -1 = never. */
  let publishSeenAt = -1;
  let active: TabId = 'fleet';

  const builders: Readonly<Record<TabId, () => View>> = {
    fleet: () => createFleetView(ctx),
    research: () => createResearchView(ctx, research),
    codex: () => createCodexView(ctx, freshSpecies),
    institute: () => createInstituteView(ctx),
    goals: () => createGoalsView(ctx),
  };
  const built = new Map<TabId, View>();

  const tabs = TAB_IDS.map((id) => {
    const tab = button('gf-tab', `tab-${id}`);
    tab.id = `gf-tab-${id}`;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', `gf-view-${id}`);
    tab.append(icon(id), el('span', 'gf-tab-label', TAB_LABELS[id]), el('span', 'gf-dot'));
    tab.addEventListener('click', () => select(id));
    tablist.appendChild(tab);

    const pane = el('div', 'gf-view');
    pane.id = `gf-view-${id}`;
    pane.setAttribute('role', 'tabpanel');
    pane.setAttribute('aria-labelledby', tab.id);
    pane.tabIndex = 0;
    views.appendChild(pane);
    return { id, tab, pane, setSelected: liveAttr(tab, 'aria-selected'), setDot: liveClass(tab, 'has-dot') };
  });

  function show(id: TabId): void {
    for (const entry of tabs) {
      const on = entry.id === id;
      entry.setSelected(String(on));
      entry.tab.tabIndex = on ? 0 : -1;
      entry.pane.hidden = !on;
      if (on && !built.has(id)) {
        const view = builders[id]();
        built.set(id, view);
        entry.pane.appendChild(view.element);
      }
    }
  }

  function select(id: TabId): void {
    if (id !== active) {
      built.get(active)?.left?.();
      // The "New" tags have been seen once the player walks away from the codex.
      if (active === 'codex') freshSpecies.clear();
      active = id;
      show(id);
    }
    if (id === 'goals') freshGoals = 0;
    ctx.refresh();
  }

  // Arrow keys move along the tabs, as screen-reader users expect of a tab list.
  tablist.addEventListener('keydown', (event) => {
    const index = TAB_IDS.indexOf(active);
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % TAB_IDS.length;
    else if (event.key === 'ArrowLeft') next = (index + TAB_IDS.length - 1) % TAB_IDS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = TAB_IDS.length - 1;
    else return;
    event.preventDefault();
    const target = tabs[next];
    if (!target) return;
    select(target.id);
    target.tab.focus();
  });

  root.append(brand, tablist, views);
  show(active);

  function update(tick: Tick): void {
    const state = tick.state;
    const cheapest = research.available(state)[0];
    const publishOpen = canPublish(state);
    if (active === 'institute' && publishOpen) publishSeenAt = state.prestiges;
    if (active === 'goals') freshGoals = 0;
    const flagged: Readonly<Record<TabId, boolean>> = {
      fleet: fleetAffordable(state),
      research: cheapest !== undefined && cheapest.cost <= state.lumens,
      codex: freshSpecies.size > 0,
      institute: instituteAffordable(state) || (publishOpen && publishSeenAt !== state.prestiges),
      goals: freshGoals > 0,
    };
    // The open tab never carries a dot: its contents are already in view.
    for (const entry of tabs) entry.setDot(entry.id !== active && flagged[entry.id]);
    built.get(active)?.update(tick);
  }

  return {
    element: root,
    select,
    update,
    reset() {
      freshSpecies.clear();
      freshGoals = 0;
      publishSeenAt = -1;
      for (const view of built.values()) view.reset?.();
    },
    noteDiscovery(species) {
      freshSpecies.add(species.id);
    },
    noteAchievement() {
      freshGoals += 1;
    },
  };
}
