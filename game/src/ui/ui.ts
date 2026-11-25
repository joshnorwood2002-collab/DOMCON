// PLACEHOLDER interface: a canvas and a strip of buttons, enough to play.
// Implements the Ui contract exactly.
import type { Ui, UiHost } from '../contracts.ts';
import { formatNumber } from '../core/format.ts';
import { GENERATORS } from '../game/content.ts';
import { availableResearch, canPublish, depthOfStep, diveBlock, generatorCost, generatorUnlocked, hullCost, hullNeeded, passiveRate, renownOnPublish, surveyProgress } from '../game/economy.ts';

export function createUi(root: HTMLElement, host: UiHost): Ui {
  root.innerHTML = '';
  const canvas = document.createElement('canvas');
  const bar = document.createElement('div');
  bar.className = 'bar';
  const info = document.createElement('span');
  info.id = 'hud';
  const hint = document.createElement('em');
  hint.id = 'hint';
  const button = (id: string, onClick: () => void): HTMLButtonElement => {
    const element = document.createElement('button');
    element.id = id;
    element.addEventListener('click', onClick);
    bar.appendChild(element);
    return element;
  };
  bar.append(info, hint);
  const diveButton = button('dive', () => (hullNeeded(host.state) !== null && diveBlock(host.state) !== 'survey' ? host.buyHull() : host.dive()));
  const fleetButtons = GENERATORS.map((gen) => button(`gen-${gen.id}`, () => host.buyGenerator(gen.id, 1)));
  const researchButton = button('research', () => {
    const next = availableResearch(host.state)[0];
    if (next) host.buyResearch(next.id);
  });
  const publishButton = button('publish', () => host.publish());
  root.append(canvas, bar);
  const toasts: string[] = [];
  return {
    canvas,
    modalOpen: false,
    update() {
      const state = host.state;
      info.textContent = `${formatNumber(state.lumens)} lumens (+${formatNumber(passiveRate(state), true)}/s) | ${depthOfStep(state.depthStep)} m | survey ${Math.round(surveyProgress(state) * 100)}% ${toasts[toasts.length - 1] ?? ''}`;
      const zone = hullNeeded(state);
      diveButton.textContent = diveBlock(state) === 'hull' && zone !== null ? `Hull ${formatNumber(hullCost(state, zone))}` : 'Dive';
      diveButton.disabled = diveBlock(state) === 'survey' || diveBlock(state) === 'floor';
      fleetButtons.forEach((element, index) => {
        element.hidden = !generatorUnlocked(state, index);
        element.textContent = `${(GENERATORS[index] as (typeof GENERATORS)[number]).name} x${state.generators[index] ?? 0} (${formatNumber(generatorCost(state, index))})`;
        element.disabled = generatorCost(state, index) > state.lumens;
      });
      const next = availableResearch(state)[0];
      researchButton.hidden = !next;
      if (next) {
        researchButton.textContent = `${next.name} (${formatNumber(next.cost)})`;
        researchButton.disabled = next.cost > state.lumens;
      }
      publishButton.hidden = !canPublish(state);
      publishButton.textContent = `Publish +${renownOnPublish(state)}`;
    },
    toast(message) {
      toasts.push(message);
    },
    setHint(text) {
      hint.textContent = text ?? '';
    },
    showOffline() {},
    showZoneIntro() {},
    showPublished() {},
    showAchievement() {},
    showDiscovery() {},
    showFinale() {},
    playInsets: () => ({ top: 0, bottom: 0 }),
  };
}
