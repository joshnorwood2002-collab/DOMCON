import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashString, mulberry32, pick, randInt, weightedPick } from './rng.ts';

test('same seed gives the same sequence', () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  for (let i = 0; i < 50; i++) assert.equal(a(), b());
});

test('values stay in [0, 1) and are spread out', () => {
  const rng = mulberry32(1);
  let sum = 0;
  for (let i = 0; i < 10_000; i++) {
    const v = rng();
    assert.ok(v >= 0 && v < 1);
    sum += v;
  }
  assert.ok(Math.abs(sum / 10_000 - 0.5) < 0.02);
});

test('randInt is inclusive at both ends', () => {
  const rng = mulberry32(3);
  const seen = new Set<number>();
  for (let i = 0; i < 500; i++) seen.add(randInt(rng, 1, 4));
  assert.deepEqual([...seen].sort(), [1, 2, 3, 4]);
});

test('pick and weightedPick respect their inputs', () => {
  const rng = mulberry32(9);
  assert.equal(pick(rng, ['only']), 'only');
  const counts = { a: 0, b: 0 };
  for (let i = 0; i < 2000; i++) counts[weightedPick(rng, [{ weight: 9, value: 'a' as const }, { weight: 1, value: 'b' as const }])]++;
  assert.ok(counts.a > counts.b * 5);
  assert.throws(() => weightedPick(rng, []));
});

test('hashString is stable and distinguishes ids', () => {
  assert.equal(hashString('lantern'), hashString('lantern'));
  assert.notEqual(hashString('lantern'), hashString('lantern2'));
});
