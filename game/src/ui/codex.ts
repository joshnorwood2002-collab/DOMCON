// The Codex tab: every species in the game, one chapter per ocean zone. The
// renderer paints each portrait; this file only decides when one needs painting.

import { formatDepth, formatPercent } from '../core/format.ts';
import { MAX_STUDY_LEVEL, RARITIES, SPECIES, ZONES, speciesInZone, type SpeciesDef } from '../game/content.ts';
import { MAX_TOTAL_STUDY_LEVELS, codexMultiplier, nextStudyTarget, speciesFound, studyLevel, totalStudyLevels, zoneOfStep } from '../game/economy.ts';
import { el, liveAttr, liveClass, liveShown, liveText, sizeCanvas } from './dom.ts';
import { icon } from './icons.ts';
import type { Tick, UiContext, View } from './types.ts';

const PORTRAIT_WIDTH = 76;
const PORTRAIT_HEIGHT = 57;
/** Portraits painted per animation frame, so opening the tab never stalls the game. */
const PORTRAITS_PER_FRAME = 4;

/** What a card's canvas currently shows. */
type Painted = 'nothing' | 'silhouette' | 'portrait';

interface Card {
  readonly species: SpeciesDef;
  readonly canvas: HTMLCanvasElement;
  painted: Painted;
  queued: boolean;
  setKnown(on: boolean): void;
  setFresh(on: boolean): void;
  setName(value: string): void;
  setNote(value: string): void;
  setStudy(value: string): void;
  setLevel(value: string): void;
  readonly pips: readonly ((on: boolean) => void)[];
}

function statTile(label: string): { tile: HTMLElement; set: (value: string) => void } {
  const tile = el('div', 'gf-stat');
  const value = el('div', 'gf-stat-value');
  tile.append(value, el('div', 'gf-stat-label', label));
  return { tile, set: liveText(value) };
}

/**
 * `fresh` holds the ids of species discovered since the tab was last open;
 * their cards carry a "New" tag until the player has had a look.
 */
export function createCodexView(ctx: UiContext, fresh: ReadonlySet<string>): View {
  const { host } = ctx;
  const root = el('div', 'gf-view-body');

  const stats = el('div', 'gf-stats');
  const found = statTile('Species found');
  const levels = statTile('Study levels');
  const bonus = statTile('Income bonus');
  stats.append(found.tile, levels.tile, bonus.tile);
  root.appendChild(stats);

  const paintQueue: Card[] = [];
  let paintScheduled = false;

  function paintSome(): void {
    paintScheduled = false;
    for (let done = 0; done < PORTRAITS_PER_FRAME; done++) {
      const card = paintQueue.shift();
      if (!card) break;
      card.queued = false;
      const known = (host.state.codex[card.species.id] ?? 0) > 0;
      try {
        host.drawPortrait(card.canvas, card.species, !known);
      } catch {
        // A portrait that fails to draw leaves its tile blank; the rest of the card still reads fine.
      }
      card.painted = known ? 'portrait' : 'silhouette';
    }
    if (paintQueue.length > 0) schedulePaint();
  }

  function schedulePaint(): void {
    if (paintScheduled) return;
    paintScheduled = true;
    window.requestAnimationFrame(paintSome);
  }

  function buildCard(species: SpeciesDef): { element: HTMLElement; card: Card } {
    const element = el('article', 'gf-card');
    const canvas = el('canvas', 'gf-portrait');
    canvas.setAttribute('data-zone', String(species.zone));
    sizeCanvas(canvas, PORTRAIT_WIDTH, PORTRAIT_HEIGHT);

    const text = el('div', 'gf-card-text');
    const head = el('div', 'gf-card-head');
    const name = el('span', 'gf-card-name');
    const tag = el('span', 'gf-rarity', RARITIES[species.rarity].label);
    tag.setAttribute('data-rarity', species.rarity);
    head.append(name, el('span', 'gf-new', 'New'), tag);

    const study = el('div', 'gf-study');
    const pipRow = el('span', 'gf-pips');
    pipRow.setAttribute('role', 'img');
    const pips: ((on: boolean) => void)[] = [];
    for (let level = 0; level < MAX_STUDY_LEVEL; level++) {
      const pip = el('span', 'gf-pip');
      pipRow.appendChild(pip);
      pips.push(liveClass(pip, 'is-on'));
    }
    const studyText = el('span', 'gf-study-text');
    study.append(pipRow, studyText);

    const note = el('div', 'gf-card-note');
    text.append(head, study, note);
    element.append(canvas, text);

    return {
      element,
      card: {
        species,
        canvas,
        painted: 'nothing',
        queued: false,
        setKnown: liveClass(element, 'is-known'),
        setFresh: liveClass(element, 'is-fresh'),
        setName: liveText(name),
        setNote: liveText(note),
        setStudy: liveText(studyText),
        setLevel: liveAttr(pipRow, 'aria-label'),
        pips,
      },
    };
  }

  const chapters = ZONES.map((zone) => {
    const section = el('section', 'gf-chapter');
    section.setAttribute('data-zone', String(zone.id));
    const head = el('header', 'gf-chapter-head');
    const count = el('span', 'gf-chapter-count');
    head.append(el('h3', 'gf-chapter-title', zone.name), el('span', 'gf-chapter-range', `${formatDepth(zone.topDepth)} to ${formatDepth(zone.bottomDepth)}`), count);
    const locked = el('div', 'gf-chapter-locked');
    locked.append(icon('lock'), el('span', '', `Reach ${formatDepth(zone.topDepth)} to open this chapter`));
    const grid = el('div', 'gf-cards');
    section.append(head, locked, grid);
    root.appendChild(section);
    return {
      zone,
      species: speciesInZone(zone.id),
      grid,
      /** Filled the first time the zone is seen as reached. */
      cards: [] as Card[],
      setCount: liveText(count),
      setLocked: liveClass(section, 'is-locked'),
      setLockedShown: liveShown(locked, true),
    };
  });

  function update(tick: Tick): void {
    const state = tick.state;
    found.set(`${speciesFound(state)}/${SPECIES.length}`);
    levels.set(`${totalStudyLevels(state)}/${MAX_TOTAL_STUDY_LEVELS}`);
    bonus.set(`+${formatPercent(codexMultiplier(state) - 1)}`);

    const deepest = zoneOfStep(state.maxStepEver);
    for (const chapter of chapters) {
      const reached = chapter.zone.id <= deepest;
      chapter.setLocked(!reached);
      chapter.setLockedShown(!reached);
      if (!reached) {
        chapter.setCount('Locked');
        continue;
      }
      if (chapter.cards.length === 0) {
        for (const species of chapter.species) {
          const built = buildCard(species);
          chapter.grid.appendChild(built.element);
          chapter.cards.push(built.card);
        }
      }

      let known = 0;
      for (const card of chapter.cards) {
        const species = card.species;
        const scans = state.codex[species.id] ?? 0;
        const isKnown = scans > 0;
        if (isKnown) known++;
        const level = studyLevel(species.rarity, scans);
        const next = nextStudyTarget(species.rarity, scans);
        card.setKnown(isKnown);
        card.setFresh(isKnown && fresh.has(species.id));
        card.setName(isKnown ? species.name : 'Unknown');
        card.setNote(isKnown ? species.note : 'Not scanned yet. Keep an eye on the water.');
        card.setStudy(!isKnown ? 'No scans' : next === null ? 'Fully studied' : `${ctx.num(scans)}/${ctx.num(next)} scans`);
        card.setLevel(`Study level ${level} of ${MAX_STUDY_LEVEL}`);
        card.pips.forEach((setPip, index) => setPip(index < level));

        const wanted: Painted = isKnown ? 'portrait' : 'silhouette';
        if (card.painted !== wanted && !card.queued) {
          card.queued = true;
          paintQueue.push(card);
          schedulePaint();
        }
      }
      chapter.setCount(`${known}/${chapter.cards.length}`);
    }
  }

  return { element: root, update };
}
