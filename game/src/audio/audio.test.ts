import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mulberry32 } from '../core/rng.ts';
import { loopingNoise, SFX_NAMES } from './audio.ts';

test('the ambient water loop repeats without a click', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const loop = loopingNoise(8000, 600, mulberry32(seed));
    let largestStep = 0;
    for (let i = 1; i < loop.length; i++) largestStep = Math.max(largestStep, Math.abs((loop[i] as number) - (loop[i - 1] as number)));
    const seam = Math.abs((loop[0] as number) - (loop[loop.length - 1] as number));
    assert.ok(seam <= largestStep, `seed ${seed}: the jump where the loop restarts (${seam.toFixed(4)}) is no bigger than any other step (${largestStep.toFixed(4)})`);
    assert.ok(loop.every((value) => Number.isFinite(value) && Math.abs(value) < 4), 'samples stay in a sensible range');
  }
});

test('every sound has a distinct name', () => {
  assert.equal(new Set(SFX_NAMES).size, SFX_NAMES.length);
  assert.equal(SFX_NAMES.length, 18);
});
