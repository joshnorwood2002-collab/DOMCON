// PLACEHOLDER audio engine: silent. Implements the AudioEngine contract exactly.
import type { AudioEngine } from '../contracts.ts';

export function createAudio(): AudioEngine {
  return {
    unlock() {},
    setMusicEnabled() {},
    setSfxEnabled() {},
    setSuspended() {},
    setZone() {},
    play() {},
  };
}
