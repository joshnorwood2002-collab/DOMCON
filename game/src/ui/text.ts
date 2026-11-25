// Small pieces of wording shared by several parts of the interface.

import { formatDuration } from '../core/format.ts';

/** Past this many seconds a wait is not worth quoting; the amount still missing says more. */
const LONGEST_WAIT_QUOTED = 100 * 3600;

/**
 * How far away a price is: "in 2m 5s" at the current income, or the amount
 * still missing ("45 to go") when nothing is coming in or the wait is very
 * long. `num` formats the amount in the player's chosen notation.
 */
export function howFar(price: number, balance: number, rate: number, num: (value: number) => string): string {
  const missing = price - balance;
  if (missing <= 0) return '';
  if (rate > 0) {
    const seconds = missing / rate;
    if (seconds < LONGEST_WAIT_QUOTED) return `in ${formatDuration(Math.max(1, Math.ceil(seconds)))}`;
  }
  return `${num(Math.ceil(missing))} to go`;
}

/** Share of a price already saved, from 0 to 1, for the thin bar on a button. */
export function savedShare(price: number, balance: number): number {
  if (!(price > 0) || !Number.isFinite(price)) return 0;
  return Math.max(0, Math.min(1, balance / price));
}
