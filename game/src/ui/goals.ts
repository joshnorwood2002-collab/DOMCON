// The Goals tab: every achievement with its progress, then lifetime statistics.

import { formatDepth, formatDuration, formatPercent } from '../core/format.ts';
import { metricValue } from '../game/actions.ts';
import { ACHIEVEMENTS, ACHIEVEMENT_BONUS, type AchievementMetric } from '../game/content.ts';
import { achievementCount, depthOfStep } from '../game/economy.ts';
import type { GameState } from '../game/state.ts';
import { el, liveClass, liveText, progressBar } from './dom.ts';
import { icon } from './icons.ts';
import type { Tick, UiContext, View } from './types.ts';

export function createGoalsView(ctx: UiContext): View {
  const root = el('div', 'gf-view-body');

  const head = el('div', 'gf-view-head');
  const summary = el('div', 'gf-view-note');
  const setSummary = liveText(summary);
  const bonus = el('div', 'gf-goal-bonus');
  const setBonus = liveText(bonus);
  head.append(summary, bonus);

  const list = el('div', 'gf-list gf-goals');
  const rows = ACHIEVEMENTS.map((achievement) => {
    const row = el('div', 'gf-goal');
    const badge = el('span', 'gf-goal-badge');
    badge.append(icon('trophy', 'gf-goal-open'), icon('check', 'gf-goal-done'));
    const info = el('div', 'gf-row-info');
    const top = el('div', 'gf-row-head');
    const progress = el('span', 'gf-goal-progress');
    top.append(el('span', 'gf-row-name', achievement.name), progress);
    const bar = progressBar('gf-goal-bar');
    info.append(top, el('div', 'gf-row-desc', achievement.description), bar.bar);
    row.append(badge, info);
    list.appendChild(row);
    return { achievement, setDone: liveClass(row, 'is-done'), setProgress: liveText(progress), setBar: bar.set };
  });

  const statsTitle = el('h3', 'gf-section-title', 'Statistics');
  const stats = el('dl', 'gf-facts');
  function fact(label: string): (value: string) => void {
    const row = el('div', 'gf-fact');
    const value = el('dd');
    row.append(el('dt', '', label), value);
    stats.appendChild(row);
    return liveText(value);
  }
  const setPlayed = fact('Time played');
  const setScans = fact('Scans');
  const setTaps = fact('Taps');
  const setStreak = fact('Best streak');
  const setPublished = fact('Expeditions published');
  const setFastest = fact('Fastest expedition');
  const setLifetime = fact('Lifetime lumens');

  root.append(head, list, statsTitle, stats);

  /** An achievement's count in the unit a player reads: depths in metres, everything else as a number. */
  function amount(metric: AchievementMetric, value: number): string {
    return metric === 'depthStep' ? formatDepth(depthOfStep(value)) : ctx.num(Math.floor(value));
  }

  function update(tick: Tick): void {
    const state: GameState = tick.state;
    const unlocked = achievementCount(state);
    setSummary(`${unlocked} of ${ACHIEVEMENTS.length} achievements`);
    setBonus(`+${formatPercent(unlocked * ACHIEVEMENT_BONUS)} income`);

    // Several achievements share a measure, so each one is worked out once per refresh.
    const measured = new Map<AchievementMetric, number>();
    for (const row of rows) {
      const { metric, target, id } = row.achievement;
      let value = measured.get(metric);
      if (value === undefined) {
        value = metricValue(state, metric);
        measured.set(metric, value);
      }
      const done = state.achievements[id] === true;
      row.setDone(done);
      // Depth is counted in dives but shown in metres, and the bar has to agree with the figures beside it.
      const share = metric === 'depthStep' ? depthOfStep(value) / depthOfStep(target) : value / target;
      row.setBar(done ? 1 : share);
      row.setProgress(done ? 'Done' : `${amount(metric, Math.min(value, target))} / ${amount(metric, target)}`);
    }

    setPlayed(formatDuration(state.stats.playSeconds));
    setScans(ctx.num(state.stats.scans));
    setTaps(ctx.num(state.stats.taps));
    setStreak(ctx.num(state.stats.bestCombo));
    setPublished(ctx.num(state.prestiges));
    setFastest(state.stats.fastestRunSeconds > 0 ? formatDuration(state.stats.fastestRunSeconds) : 'None yet');
    setLifetime(ctx.num(state.lifetimeLumens));
  }

  return { element: root, update };
}
