// Number and time formatting for an idle game, where values run from 0 to
// astronomically large and must stay readable at a glance.

const SUFFIXES = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc', 'Ud', 'Dd', 'Td', 'Qad', 'Qid', 'Sxd', 'Spd', 'Ocd', 'Nod', 'Vg'];

/**
 * 0-999 are shown whole (or with one decimal when `smallDecimals` is set and
 * the value is under 100), then three significant figures with a suffix:
 * 1.23K, 45.6M, 789B. Past the named suffixes it falls back to 1.23e75.
 * With `scientific` set, everything from a million up is shown as 1.23e9.
 */
export function formatNumber(value: number, smallDecimals = false, scientific = false): string {
  if (!Number.isFinite(value)) return value > 0 ? '∞' : '0';
  if (value < 0) return '-' + formatNumber(-value, smallDecimals, scientific);
  if (scientific && value >= 1e6) return formatScientific(value);
  if (value < 1000) {
    if (smallDecimals && value < 100 && !Number.isInteger(value)) {
      const text = value.toFixed(1);
      return text.endsWith('.0') ? text.slice(0, -2) : text;
    }
    const whole = Math.floor(value + 1e-9);
    return String(whole);
  }
  let tier = Math.floor(Math.log10(value) / 3);
  let scaled = value / Math.pow(10, tier * 3);
  // log10 can land a hair either side of an exact power of ten; correct the tier.
  if (scaled >= 1000) {
    tier += 1;
    scaled /= 1000;
  } else if (scaled < 1) {
    tier -= 1;
    scaled *= 1000;
  }
  if (tier >= SUFFIXES.length) return formatScientific(value);
  const digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
  return `${truncate(scaled, digits)}${SUFFIXES[tier] ?? ''}`;
}

function formatScientific(value: number): string {
  let exponent = Math.floor(Math.log10(value));
  let mantissa = value / Math.pow(10, exponent);
  if (mantissa >= 10) {
    exponent += 1;
    mantissa /= 10;
  } else if (mantissa < 1) {
    exponent -= 1;
    mantissa *= 10;
  }
  return `${truncate(mantissa, 2)}e${exponent}`;
}

/** Truncate rather than round, so a displayed balance never exceeds the real one. */
function truncate(value: number, digits: number): string {
  const factor = Math.pow(10, digits);
  return (Math.floor(value * factor + 1e-7) / factor).toFixed(digits);
}

/** "45s", "12m 30s", "3h 5m", "2d 4h". */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    const rest = seconds % 60;
    return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest ? `${hours}h ${rest}m` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest ? `${days}d ${rest}h` : `${days}d`;
}

/** Whole metres with thin grouping: 10,935 m. */
export function formatDepth(metres: number): string {
  return `${Math.round(metres).toLocaleString('en-US')} m`;
}

export function formatPercent(fraction: number, digits = 0): string {
  return `${(fraction * 100).toFixed(digits)}%`;
}
