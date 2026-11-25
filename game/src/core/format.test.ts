import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatDuration, formatNumber } from './format.ts';

test('small numbers are shown whole', () => {
  assert.equal(formatNumber(0), '0');
  assert.equal(formatNumber(7), '7');
  assert.equal(formatNumber(999), '999');
  assert.equal(formatNumber(999.9), '999');
});

test('small decimals are optional', () => {
  assert.equal(formatNumber(0.25, true), '0.3');
  assert.equal(formatNumber(1.5, true), '1.5');
  assert.equal(formatNumber(3, true), '3');
  assert.equal(formatNumber(150.5, true), '150');
});

test('suffixes use three significant figures', () => {
  assert.equal(formatNumber(1000), '1.00K');
  assert.equal(formatNumber(1234), '1.23K');
  assert.equal(formatNumber(12_345), '12.3K');
  assert.equal(formatNumber(123_456), '123K');
  assert.equal(formatNumber(1_500_000), '1.50M');
  assert.equal(formatNumber(2.5e9), '2.50B');
  assert.equal(formatNumber(7.77e12), '7.77T');
  assert.equal(formatNumber(1e15), '1.00Qa');
});

test('never shows 1000 of a suffix', () => {
  assert.equal(formatNumber(999_999), '999K');
  assert.equal(formatNumber(999_999.99), '999K');
  assert.equal(formatNumber(1_000_000), '1.00M');
});

test('a displayed balance never exceeds the real one', () => {
  assert.equal(formatNumber(1999), '1.99K');
  assert.equal(formatNumber(19_990), '19.9K');
});

test('falls back to scientific notation past the named suffixes', () => {
  assert.match(formatNumber(1.234e80), /^1\.23e80$/);
  assert.match(formatNumber(9.999e99), /^(9\.99e99|1\.00e100)$/);
});

test('handles negative and non-finite input', () => {
  assert.equal(formatNumber(-1500), '-1.50K');
  assert.equal(formatNumber(Number.NaN), '0');
  assert.equal(formatNumber(Number.POSITIVE_INFINITY), '∞');
});

test('durations', () => {
  assert.equal(formatDuration(0), '0s');
  assert.equal(formatDuration(45), '45s');
  assert.equal(formatDuration(60), '1m');
  assert.equal(formatDuration(750), '12m 30s');
  assert.equal(formatDuration(3600), '1h');
  assert.equal(formatDuration(3 * 3600 + 5 * 60), '3h 5m');
  assert.equal(formatDuration(2 * 86400 + 4 * 3600), '2d 4h');
});

test('scientific notation is optional from a million up', () => {
  assert.equal(formatNumber(999_999, false, true), '999K');
  assert.equal(formatNumber(1_000_000, false, true), '1.00e6');
  assert.equal(formatNumber(2.5e9, false, true), '2.50e9');
});
