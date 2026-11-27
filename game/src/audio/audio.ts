// Sound, synthesised with the Web Audio API as the game runs. There are no
// audio files. Nothing here makes a sound, or even creates an AudioContext,
// until unlock() has been called from a user gesture, and every call is safe
// when Web Audio is missing: the game must never fail because of sound.

import type { AudioEngine, Sfx } from '../contracts.ts';

/** How one zone's ambient bed sounds. Frequencies in Hz, levels as linear gain. */
interface ZoneMood {
  /** Root of the drone. */
  root: number;
  /** Notes the occasional chimes are drawn from, in semitones above the root two octaves up. */
  scale: readonly number[];
  droneLevel: number;
  /** Filtered noise: surf near the surface, a faint hiss of pressure far down. */
  waterLevel: number;
  waterCutoff: number;
  chimeLevel: number;
  /** Seconds between chimes, shortest and longest. */
  chimeGap: readonly [number, number];
}

const MOODS: readonly ZoneMood[] = [
  { root: 110, scale: [0, 4, 7, 9, 12, 16], droneLevel: 0.05, waterLevel: 0.05, waterCutoff: 1400, chimeLevel: 0.05, chimeGap: [2.5, 6] },
  { root: 98, scale: [0, 3, 7, 10, 12, 15], droneLevel: 0.06, waterLevel: 0.035, waterCutoff: 900, chimeLevel: 0.045, chimeGap: [4, 8] },
  { root: 82.4, scale: [0, 3, 5, 7, 10, 12], droneLevel: 0.07, waterLevel: 0.022, waterCutoff: 600, chimeLevel: 0.04, chimeGap: [5, 11] },
  { root: 65.4, scale: [0, 2, 7, 12, 14], droneLevel: 0.08, waterLevel: 0.015, waterCutoff: 420, chimeLevel: 0.035, chimeGap: [7, 14] },
  { root: 55, scale: [0, 1, 6, 7, 12, 13], droneLevel: 0.085, waterLevel: 0.012, waterCutoff: 320, chimeLevel: 0.035, chimeGap: [6, 13] },
];

const MUSIC_LEVEL = 0.3;
const SFX_LEVEL = 1.5;
const MASTER_LEVEL = 0.8;
/** Sounds that can fire many times a second are spaced at least this far apart (seconds). */
const MIN_GAP: Partial<Record<Sfx, number>> = { tap: 0.045, scan: 0.06, scanRare: 0.07, ui: 0.04, buy: 0.05, error: 0.12 };
const DEFAULT_GAP = 0.08;
const MAX_VOICES = 28;

type Wave = 'sine' | 'triangle' | 'square' | 'sawtooth';

interface ToneOptions {
  type?: Wave;
  attack?: number;
  /** Glide to this frequency over the note. */
  slideTo?: number;
  pan?: number;
}

/**
 * Builds sounds on any audio context. The live engine and the offline
 * measurements used by the tests share this, so what is measured is what plays.
 */
class Synth {
  voices = 0;
  private readonly noise: AudioBuffer;
  private readonly ctx: BaseAudioContext;
  private readonly out: AudioNode;

  constructor(ctx: BaseAudioContext, out: AudioNode) {
    this.ctx = ctx;
    this.out = out;
    // Two seconds of noise, reused by every burst and by the water bed.
    this.noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 2), ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }

  private track(node: AudioScheduledSourceNode, ...chain: AudioNode[]): void {
    this.voices += 1;
    node.onended = () => {
      this.voices -= 1;
      for (const link of [node, ...chain]) {
        try {
          link.disconnect();
        } catch {
          // Already disconnected.
        }
      }
    };
  }

  tone(frequency: number, at: number, duration: number, level: number, options: ToneOptions = {}): void {
    const oscillator = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    oscillator.type = options.type ?? 'sine';
    oscillator.frequency.setValueAtTime(frequency, at);
    if (options.slideTo) oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, options.slideTo), at + duration);
    const attack = Math.min(options.attack ?? 0.006, duration * 0.5);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.linearRampToValueAtTime(level, at + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    let last: AudioNode = gain;
    const chain: AudioNode[] = [gain];
    if (options.pan && 'createStereoPanner' in this.ctx) {
      const panner = this.ctx.createStereoPanner();
      panner.pan.value = options.pan;
      gain.connect(panner);
      last = panner;
      chain.push(panner);
    }
    oscillator.connect(gain);
    last.connect(this.out);
    oscillator.start(at);
    oscillator.stop(at + duration + 0.02);
    this.track(oscillator, ...chain);
  }

  burst(at: number, duration: number, level: number, cutoff: number, sweepTo?: number, kind: BiquadFilterType = 'lowpass'): void {
    const source = this.ctx.createBufferSource();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();
    source.buffer = this.noise;
    source.loop = true;
    filter.type = kind;
    filter.frequency.setValueAtTime(cutoff, at);
    if (sweepTo) filter.frequency.exponentialRampToValueAtTime(Math.max(40, sweepTo), at + duration);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.linearRampToValueAtTime(level, at + Math.min(0.02, duration * 0.3));
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.out);
    source.start(at, Math.random());
    source.stop(at + duration + 0.02);
    this.track(source, filter, gain);
  }

  /** One sound effect, starting at time `at`. `pitch` multiplies frequency; `intensity` 0-1 scales loudness. */
  sfx(name: Sfx, at: number, pitch = 1, intensity = 0.7): void {
    const loud = 0.55 + 0.45 * Math.min(1, Math.max(0, intensity));
    const p = Math.min(2, Math.max(0.5, pitch));
    switch (name) {
      case 'tap':
        this.tone(880 * p, at, 0.07, 0.1 * loud, { type: 'sine' });
        break;
      case 'ui':
        this.tone(1500, at, 0.03, 0.05, { type: 'sine' });
        break;
      case 'scan':
        this.tone(660 * p, at, 0.08, 0.13 * loud, { type: 'triangle' });
        this.tone(990 * p, at + 0.06, 0.12, 0.13 * loud, { type: 'triangle' });
        break;
      case 'scanRare':
        [784, 1175, 1568].forEach((frequency, index) => this.tone(frequency * p, at + index * 0.055, 0.22, 0.12 * loud, { type: 'sine' }));
        this.tone(3136 * p, at + 0.1, 0.3, 0.03 * loud, { type: 'sine' });
        break;
      case 'discover':
        [523.3, 659.3, 784, 1046.5].forEach((frequency, index) => this.tone(frequency, at + index * 0.1, index === 3 ? 0.7 : 0.26, 0.15, { type: 'triangle' }));
        this.tone(2093, at + 0.3, 0.6, 0.035, { type: 'sine' });
        break;
      case 'studyUp':
        this.tone(880, at, 0.16, 0.11, { type: 'sine' });
        this.tone(1318.5, at + 0.11, 0.3, 0.11, { type: 'sine' });
        break;
      case 'buy':
        this.tone(230 * p, at, 0.11, 0.15 * loud, { type: 'sine', slideTo: 150 * p });
        this.burst(at, 0.04, 0.05, 2400);
        break;
      case 'research':
        this.tone(440, at, 0.07, 0.1, { type: 'triangle' });
        this.tone(660, at + 0.06, 0.07, 0.1, { type: 'triangle' });
        this.tone(880, at + 0.12, 0.16, 0.1, { type: 'triangle' });
        break;
      case 'dive':
        this.burst(at, 0.75, 0.16, 1800, 220);
        this.tone(300, at, 0.7, 0.12, { type: 'sine', slideTo: 90 });
        for (let i = 0; i < 4; i++) this.tone(900 + Math.random() * 700, at + 0.15 + i * 0.11, 0.05, 0.035, { type: 'sine', pan: Math.random() * 1.2 - 0.6 });
        break;
      case 'zone':
        [55, 82.4, 110].forEach((frequency) => this.tone(frequency * p, at, 2.4, 0.085 * loud, { type: 'sine', attack: 0.4 }));
        this.tone(220 * p, at + 0.3, 2, 0.035 * loud, { type: 'triangle', attack: 0.5 });
        this.burst(at, 2.2, 0.035 * loud, 300, 900);
        break;
      case 'hull':
        [523, 811, 1217].forEach((frequency) => this.tone(frequency, at, 0.28, 0.065, { type: 'triangle' }));
        this.burst(at, 0.5, 0.05, 1200, 300);
        break;
      case 'shoal':
        [880, 987.8, 1174.7, 1318.5, 1568, 1760].forEach((frequency, index) => this.tone(frequency, at + index * 0.045, 0.14, 0.085, { type: 'sine' }));
        break;
      case 'frenzy':
        this.tone(220, at, 0.5, 0.13, { type: 'triangle', slideTo: 880 });
        this.burst(at, 0.5, 0.06, 500, 4000, 'bandpass');
        this.tone(1318.5, at + 0.45, 0.25, 0.1, { type: 'sine' });
        break;
      case 'sonar':
        [0, 0.34, 0.68].forEach((delay, index) => this.tone(1180, at + delay, 1.5 - index * 0.3, 0.18 / (1 + index * 1.6), { type: 'sine', attack: 0.004 }));
        break;
      case 'publish':
        [261.6, 329.6, 392, 523.3].forEach((frequency, index) => this.tone(frequency, at + index * 0.05, 1.5, 0.08, { type: 'triangle', attack: 0.03 }));
        this.tone(523.3, at + 0.2, 0.9, 0.045, { type: 'sine', slideTo: 1046.5 });
        break;
      case 'achievement':
        this.tone(1046.5, at, 0.4, 0.12, { type: 'sine' });
        this.tone(1568, at + 0.13, 0.55, 0.12, { type: 'sine' });
        this.tone(1568 * 2.76, at + 0.13, 0.2, 0.02, { type: 'sine' });
        break;
      case 'daily':
        [1318.5, 1568, 1975.5, 2637].forEach((frequency, index) => this.tone(frequency, at + index * 0.06, 0.2, 0.075, { type: 'sine' }));
        break;
      case 'error':
        this.tone(196, at, 0.08, 0.12, { type: 'sine' });
        this.tone(150, at + 0.09, 0.1, 0.12, { type: 'sine' });
        break;
    }
  }

  /** One soft chime of the ambient bed. */
  chime(mood: ZoneMood, at: number): void {
    const step = mood.scale[Math.floor(Math.random() * mood.scale.length)] ?? 0;
    const frequency = mood.root * 4 * Math.pow(2, step / 12);
    const pan = Math.random() * 1.4 - 0.7;
    this.tone(frequency, at, 3.2, mood.chimeLevel, { type: 'sine', attack: 0.5, pan });
    this.tone(frequency * 2, at + 0.05, 1.8, mood.chimeLevel * 0.25, { type: 'sine', attack: 0.4, pan });
  }
}

/** Brownish noise that loops without a seam: its last sample runs straight on into its first. */
export function loopingNoise(length: number, fade: number, random: () => number = Math.random): Float32Array {
  const raw = new Float32Array(length + fade);
  // Each sample drifts from the last, which sounds like moving water, not hiss.
  let last = 0;
  for (let i = 0; i < raw.length; i++) {
    last = (last + (random() * 2 - 1) * 0.04) * 0.985;
    raw[i] = last * 6;
  }
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const own = raw[i] as number;
    if (i >= fade) {
      out[i] = own;
    } else {
      // The opening fades in from what would have followed the end. Equal power, so the level does not dip.
      const mix = i / fade;
      out[i] = own * Math.sqrt(mix) + (raw[length + i] as number) * Math.sqrt(1 - mix);
    }
  }
  return out;
}

/** Drone voices as multiples of the zone's root: two a hair apart so they beat slowly, a fifth, and one high enough for small speakers. */
const DRONE_VOICES: readonly { ratio: number; type: Wave; level: number }[] = [
  { ratio: 1, type: 'triangle', level: 0.42 },
  { ratio: 1.004, type: 'triangle', level: 0.34 },
  { ratio: 1.4955, type: 'sine', level: 0.22 },
  { ratio: 4.012, type: 'sine', level: 0.1 },
];

/** The continuous part of the ambient bed: a slow drone and filtered noise. */
interface Bed {
  drones: OscillatorNode[];
  droneLevel: GainNode;
  waterFilter: BiquadFilterNode;
  waterLevel: GainNode;
}

/** A gain stage that rises and falls slowly on its own. */
function swell(ctx: BaseAudioContext, hertz: number, depth: number): GainNode {
  const stage = ctx.createGain();
  const wave = ctx.createOscillator();
  const amount = ctx.createGain();
  wave.frequency.value = hertz;
  amount.gain.value = depth;
  wave.connect(amount);
  amount.connect(stage.gain);
  wave.start();
  return stage;
}

function buildBed(ctx: BaseAudioContext, out: AudioNode, mood: ZoneMood): Bed {
  const droneFilter = ctx.createBiquadFilter();
  droneFilter.type = 'lowpass';
  droneFilter.frequency.value = 520;
  const droneSwell = swell(ctx, 0.05, 0.3);
  const droneLevel = ctx.createGain();
  droneLevel.gain.value = mood.droneLevel;
  const drones = DRONE_VOICES.map((voice) => {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = voice.type;
    oscillator.frequency.value = mood.root * voice.ratio;
    gain.gain.value = voice.level;
    oscillator.connect(gain);
    gain.connect(droneFilter);
    oscillator.start();
    return oscillator;
  });
  droneFilter.connect(droneSwell);
  droneSwell.connect(droneLevel);
  droneLevel.connect(out);

  const water = ctx.createBufferSource();
  const length = Math.floor(ctx.sampleRate * 4);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  buffer.getChannelData(0).set(loopingNoise(length, Math.floor(ctx.sampleRate * 0.3)));
  water.buffer = buffer;
  water.loop = true;
  const waterFilter = ctx.createBiquadFilter();
  waterFilter.type = 'lowpass';
  waterFilter.frequency.value = mood.waterCutoff;
  // A very slow swell, like a current passing.
  const waterSwell = swell(ctx, 0.07, 0.45);
  const waterLevel = ctx.createGain();
  waterLevel.gain.value = mood.waterLevel;
  water.connect(waterFilter);
  waterFilter.connect(waterSwell);
  waterSwell.connect(waterLevel);
  waterLevel.connect(out);
  water.start();
  return { drones, droneLevel, waterFilter, waterLevel };
}

function moodFor(zone: number): ZoneMood {
  return MOODS[Math.min(MOODS.length - 1, Math.max(0, Math.round(zone)))] as ZoneMood;
}

/** Everything between the sounds and the speakers. The measurements below use the same chain as the live game. */
function buildOutput(ctx: BaseAudioContext): { music: GainNode; effects: GainNode } {
  // A limiter: however many sounds pile up, the sum cannot clip.
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -6;
  limiter.knee.value = 3;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.2;
  const master = ctx.createGain();
  master.gain.value = MASTER_LEVEL;
  master.connect(limiter);
  limiter.connect(ctx.destination);
  const music = ctx.createGain();
  const effects = ctx.createGain();
  music.gain.value = MUSIC_LEVEL;
  effects.gain.value = SFX_LEVEL;
  music.connect(master);
  effects.connect(master);
  return { music, effects };
}

export function createAudio(): AudioEngine {
  let ctx: AudioContext | null = null;
  let synth: Synth | null = null;
  let musicBus: GainNode | null = null;
  let sfxBus: GainNode | null = null;
  let bed: Bed | null = null;
  let failed = false;
  let musicOn = true;
  let sfxOn = true;
  let suspended = false;
  let zone = 0;
  let nextChimeAt = 0;
  let createdAt = 0;
  const lastPlayed = new Map<Sfx, number>();

  const safely = (action: () => void): void => {
    try {
      action();
    } catch {
      // Sound is never worth breaking the game for.
    }
  };

  /** Silent for any reason: the host asked, the tab is hidden, or the player turned everything off. */
  const quiet = (): boolean => suspended || (!musicOn && !sfxOn);

  /** Runs or stops the audio clock to match. Stopped, it uses no processor time at all. */
  function sync(): void {
    const context = ctx;
    if (!context || context.state === 'closed') return;
    safely(() => {
      if (quiet()) {
        if (context.state === 'running') void context.suspend().catch(() => {});
      } else if (context.state !== 'running') {
        void context.resume().catch(() => {});
      }
    });
  }

  function ramp(node: GainNode | null, level: number, seconds: number): void {
    if (!ctx || !node) return;
    const now = ctx.currentTime;
    node.gain.cancelScheduledValues(now);
    node.gain.setTargetAtTime(level, now, Math.max(0.01, seconds / 3));
  }

  function applyZone(): void {
    if (!ctx || !bed) return;
    const mood = moodFor(zone);
    const now = ctx.currentTime;
    // The drone dips to silence, retunes, and returns: a slide between two keys would sound like a siren.
    const retuneAt = now + 1.1;
    bed.droneLevel.gain.cancelScheduledValues(now);
    bed.droneLevel.gain.setTargetAtTime(0, now, 0.25);
    bed.droneLevel.gain.setTargetAtTime(mood.droneLevel, retuneAt, 0.6);
    bed.drones.forEach((oscillator, index) => {
      oscillator.frequency.cancelScheduledValues(now);
      oscillator.frequency.setValueAtTime(mood.root * (DRONE_VOICES[index]?.ratio ?? 1), retuneAt);
    });
    bed.waterFilter.frequency.cancelScheduledValues(now);
    bed.waterFilter.frequency.setTargetAtTime(mood.waterCutoff, now, 1);
    bed.waterLevel.gain.cancelScheduledValues(now);
    bed.waterLevel.gain.setTargetAtTime(mood.waterLevel, now, 1);
  }

  function start(): void {
    const Constructor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Constructor) {
      failed = true;
      return;
    }
    const context = new Constructor();
    try {
      const { music, effects } = buildOutput(context);
      if (!musicOn) music.gain.value = 0;
      if (!sfxOn) effects.gain.value = 0;
      synth = new Synth(context, effects);
      bed = buildBed(context, music, moodFor(zone));
      musicBus = music;
      sfxBus = effects;
      const chimes = new Synth(context, music);
      nextChimeAt = context.currentTime + 2;
      createdAt = performance.now();
      ctx = context;
      // Chimes are scheduled just ahead of time. The audio clock stops while suspended, so they pause with it.
      window.setInterval(() => {
        safely(() => {
          if (quiet() || !musicOn || context.state !== 'running') return;
          if (context.currentTime + 0.5 < nextChimeAt) return;
          const mood = moodFor(zone);
          chimes.chime(mood, Math.max(context.currentTime + 0.05, nextChimeAt));
          nextChimeAt = context.currentTime + mood.chimeGap[0] + Math.random() * (mood.chimeGap[1] - mood.chimeGap[0]);
        });
      }, 400);
    } catch (error) {
      void context.close().catch(() => {});
      throw error;
    }
  }

  return {
    unlock() {
      if (failed) return;
      if (!ctx) {
        try {
          start();
        } catch {
          failed = true;
          ctx = null;
          synth = null;
          bed = null;
          return;
        }
      }
      // Called on every press, not only the first: some browsers only start sound on a release or a
      // click, and phones stop it again after a call or an app switch.
      sync();
    },
    setMusicEnabled(on) {
      musicOn = on;
      safely(() => ramp(musicBus, on ? MUSIC_LEVEL : 0, 0.6));
      sync();
    },
    setSfxEnabled(on) {
      sfxOn = on;
      safely(() => ramp(sfxBus, on ? SFX_LEVEL : 0, 0.15));
      sync();
    },
    setSuspended(value) {
      suspended = value;
      sync();
    },
    setZone(next) {
      if (next === zone) return;
      zone = next;
      safely(applyZone);
    },
    play(sfx, options) {
      const context = ctx;
      const voice = synth;
      if (!context || !voice || !sfxOn || suspended) return;
      // A context takes a moment to start, and the press that created it deserves its sound, so sounds
      // asked for in that moment are queued. One that stays stopped (blocked by the browser) gets nothing,
      // or everything queued would play at once when it finally started.
      if (context.state !== 'running' && performance.now() - createdAt > 400) return;
      const now = context.currentTime;
      if (now - (lastPlayed.get(sfx) ?? -1) < (MIN_GAP[sfx] ?? DEFAULT_GAP)) return;
      // When the mix is crowded, the smallest sounds give way first.
      if (voice.voices >= MAX_VOICES || (voice.voices >= MAX_VOICES - 8 && (sfx === 'tap' || sfx === 'ui'))) return;
      lastPlayed.set(sfx, now);
      safely(() => voice.sfx(sfx, now + 0.005, options?.pitch ?? 1, options?.intensity ?? 0.7));
    },
  };
}

export const SFX_NAMES: readonly Sfx[] = ['tap', 'scan', 'scanRare', 'discover', 'buy', 'research', 'dive', 'zone', 'hull', 'shoal', 'frenzy', 'sonar', 'publish', 'achievement', 'studyUp', 'daily', 'error', 'ui'];

export interface AudioMeasurement {
  /** Loudest sample, where 1 is the most a speaker can be asked for. */
  peak: number;
  rms: number;
  /** Seconds until the sound has fallen below an audible floor for good. */
  length: number;
  finite: boolean;
}

/** A limiter that has only just started turns everything down for a moment, so measured sounds begin after it settles. */
const SETTLE = 0.5;

function measure(buffer: AudioBuffer): AudioMeasurement {
  let peak = 0;
  let sum = 0;
  let lastLoud = 0;
  let finite = true;
  let samples = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i++) {
      const value = data[i] as number;
      if (!Number.isFinite(value)) finite = false;
      const size = Math.abs(value);
      if (size > peak) peak = size;
      if (size > 0.003 && i > lastLoud) lastLoud = i;
      sum += value * value;
      samples += 1;
    }
  }
  return { peak, rms: Math.sqrt(sum / Math.max(1, samples)), length: Math.max(0, lastLoud / buffer.sampleRate - SETTLE), finite };
}

/**
 * Renders every effect, every zone's ambient bed and a worst-case pile-up
 * without playing them, and reports their levels. The browser tests use this,
 * since they cannot listen; `inspect` receives the rendered sound itself.
 */
export async function measureAudio(inspect?: (name: string, buffer: AudioBuffer) => void): Promise<Record<string, AudioMeasurement>> {
  const results: Record<string, AudioMeasurement> = {};
  const rate = 44100;
  const render = async (name: string, seconds: number, fill: (ctx: OfflineAudioContext, music: GainNode, effects: GainNode) => void): Promise<void> => {
    const offline = new OfflineAudioContext(2, rate * seconds, rate);
    const { music, effects } = buildOutput(offline);
    fill(offline, music, effects);
    const buffer = await offline.startRendering();
    inspect?.(name, buffer);
    results[name] = measure(buffer);
  };
  for (const name of SFX_NAMES) {
    await render(name, 4.5, (ctx, _music, effects) => new Synth(ctx, effects).sfx(name, SETTLE, 1, 1));
  }
  for (let zone = 0; zone < MOODS.length; zone++) {
    await render(`ambient-${zone}`, 12, (ctx, music) => {
      const mood = moodFor(zone);
      buildBed(ctx, music, mood);
      const chimes = new Synth(ctx, music);
      chimes.chime(mood, 1);
      chimes.chime(mood, 6);
    });
  }
  // Everything at once over the loudest bed: the limiter has to hold this.
  await render('pile-up', 4, (ctx, music, effects) => {
    buildBed(ctx, music, moodFor(4));
    const synth = new Synth(ctx, effects);
    for (const name of SFX_NAMES) synth.sfx(name, SETTLE, 1, 1);
  });
  return results;
}
