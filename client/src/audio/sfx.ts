import { fetchFirst } from './files';
import type { AudioOut } from './sound';

// One-shot sound effects. Each one is generated with Web Audio unless a file with its name exists in
// client/public/audio/ (<name>.ogg, else <name>.mp3): then the file plays instead (names: README).
// Everything goes through the output's destination (Phaser's master gain), so the mute applies.

export const SFX_NAMES = [
  'brad', // a sled overturns on a fir: a soft thud and snow falling off the branches
  'piatra', // a sled overturns on a rock: a hard knock
  'saritura', // take-off from a ramp
  'aterizare', // landing in the snow
  'aruncare', // a snowball thrown
  'lovit', // a snowball hits a sled
  'ciocnire', // two sleds bump
  'numaratoare', // 3, 2, 1
  'hai', // HAI!
  'sosire', // crossing the finish line
  'castig', // the podium (end of the match)
] as const;
export type SfxName = (typeof SFX_NAMES)[number];

/** The same effect more often than this plays once (a pile-up of bumps is one knock). */
const MIN_GAP_MS = 45;
const GAP_MS: Partial<Record<SfxName, number>> = { ciocnire: 90, lovit: 70 };

const files = new Map<SfxName, AudioBuffer>();
const lastPlayed = new Map<SfxName, number>();
let output: AudioOut | null = null;
let noiseBuffer: AudioBuffer | null = null;

/** Looks for replacement files once, at boot; a missing file simply keeps the generated sound. */
export function initSfx(out: AudioOut | null): void {
  if (!out) return;
  output = out;
  for (const name of SFX_NAMES) {
    void fetchFirst(out.context, [`audio/${name}.ogg`, `audio/${name}.mp3`]).then((buffer) => {
      if (buffer) files.set(name, buffer);
    });
  }
}

/** `volume` 0..1 scales the sound (quieter for what happens to the others, far away). */
export function playSfx(name: SfxName, volume = 1): void {
  const destination = output?.destination;
  if (!output || !destination || volume <= 0) return;
  const ctx = output.context;
  // Before the first tap the context is suspended: sounds would all burst out at once later.
  if (ctx.state !== 'running') return;
  const now = performance.now();
  if (now - (lastPlayed.get(name) ?? -Infinity) < (GAP_MS[name] ?? MIN_GAP_MS)) return;
  lastPlayed.set(name, now);

  const out = ctx.createGain();
  out.gain.value = Math.min(1, volume);
  out.connect(destination);
  const file = files.get(name);
  if (file) {
    const src = ctx.createBufferSource();
    src.buffer = file;
    src.connect(out);
    src.start();
    return;
  }
  SYNTH[name](ctx, out, ctx.currentTime);
}

type Synth = (ctx: AudioContext, out: AudioNode, t: number) => void;

const SYNTH: Record<SfxName, Synth> = {
  // Into a fir: a muffled thump, then the snow sliding off the branches.
  brad: (ctx, out, t) => {
    tone(ctx, out, t, { type: 'sine', from: 120, to: 50, dur: 0.22, vol: 0.5 });
    noise(ctx, out, t + 0.04, { dur: 0.5, vol: 0.22, filter: 'lowpass', from: 2400, to: 500 });
  },
  // Into a rock: a hard, short knock with a crack on top.
  piatra: (ctx, out, t) => {
    tone(ctx, out, t, { type: 'triangle', from: 260, to: 90, dur: 0.14, vol: 0.5 });
    noise(ctx, out, t, { dur: 0.06, vol: 0.35, filter: 'bandpass', from: 3200, to: 1400 });
  },
  // Off the ramp: a whoosh rising.
  saritura: (ctx, out, t) => {
    noise(ctx, out, t, { dur: 0.3, vol: 0.18, filter: 'bandpass', from: 500, to: 2200 });
    tone(ctx, out, t, { type: 'sine', from: 300, to: 640, dur: 0.22, vol: 0.08 });
  },
  // Back in the snow: a soft crunchy "pff".
  aterizare: (ctx, out, t) => {
    tone(ctx, out, t, { type: 'sine', from: 140, to: 60, dur: 0.12, vol: 0.35 });
    noise(ctx, out, t, { dur: 0.18, vol: 0.25, filter: 'lowpass', from: 1800, to: 400 });
  },
  // A snowball leaving the hand: a short swish.
  aruncare: (ctx, out, t) => noise(ctx, out, t, { dur: 0.16, vol: 0.2, filter: 'bandpass', from: 1500, to: 3500 }),
  // A snowball bursting on someone: a wet "pof".
  lovit: (ctx, out, t) => {
    noise(ctx, out, t, { dur: 0.2, vol: 0.32, filter: 'lowpass', from: 2600, to: 700 });
    tone(ctx, out, t, { type: 'sine', from: 220, to: 90, dur: 0.1, vol: 0.25 });
  },
  // Wood on wood: two sleds knocking.
  ciocnire: (ctx, out, t) => {
    tone(ctx, out, t, { type: 'square', from: 180, to: 120, dur: 0.07, vol: 0.12 });
    tone(ctx, out, t, { type: 'sine', from: 140, to: 70, dur: 0.12, vol: 0.35 });
  },
  numaratoare: (ctx, out, t) => tone(ctx, out, t, { type: 'sine', from: 660, dur: 0.16, vol: 0.3 }),
  // HAI!: a bright double note.
  hai: (ctx, out, t) => {
    tone(ctx, out, t, { type: 'square', from: 990, dur: 0.34, vol: 0.12 });
    tone(ctx, out, t, { type: 'sine', from: 1320, dur: 0.34, vol: 0.18 });
  },
  // Over the line: sleigh bells jingling up.
  sosire: (ctx, out, t) => {
    [1568, 1760, 2093, 2349, 2637].forEach((f, i) => {
      tone(ctx, out, t + i * 0.05, { type: 'sine', from: f, dur: 0.22, vol: 0.12 });
      tone(ctx, out, t + i * 0.05, { type: 'triangle', from: f * 2.01, dur: 0.12, vol: 0.04 });
    });
  },
  // The podium: a short fanfare, G G G C ... E G C'.
  castig: (ctx, out, t) => {
    const notes: [number, number, number][] = [
      [392, 0, 0.12],
      [392, 0.14, 0.12],
      [392, 0.28, 0.12],
      [523, 0.42, 0.45],
      [659, 0.92, 0.18],
      [784, 1.12, 0.18],
      [1047, 1.32, 0.8],
    ];
    for (const [f, at, dur] of notes) {
      tone(ctx, out, t + at, { type: 'sawtooth', from: f, dur, vol: 0.08 });
      tone(ctx, out, t + at, { type: 'triangle', from: f / 2, dur, vol: 0.15 });
    }
  },
};

interface ToneOptions {
  type: OscillatorType;
  from: number;
  to?: number;
  dur: number;
  vol: number;
}

function tone(ctx: AudioContext, out: AudioNode, t: number, o: ToneOptions): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = o.type;
  osc.frequency.setValueAtTime(o.from, t);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + o.dur);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(o.vol, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  osc.connect(gain).connect(out);
  osc.start(t);
  osc.stop(t + o.dur + 0.02);
}

interface NoiseOptions {
  dur: number;
  vol: number;
  filter: BiquadFilterType;
  from: number;
  to: number;
}

/** One second of white noise, made once per context (also the source of the slide and wind loops). */
export function noiseBufferFor(ctx: AudioContext): AudioBuffer {
  if (!noiseBuffer || noiseBuffer.sampleRate !== ctx.sampleRate) {
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  return noiseBuffer;
}

/** Filtered white noise. */
function noise(ctx: AudioContext, out: AudioNode, t: number, o: NoiseOptions): void {
  const src = ctx.createBufferSource();
  src.buffer = noiseBufferFor(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = o.filter;
  filter.frequency.setValueAtTime(o.from, t);
  filter.frequency.exponentialRampToValueAtTime(o.to, t + o.dur);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(o.vol, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + o.dur);
  src.connect(filter).connect(gain).connect(out);
  src.start(t);
  src.stop(t + o.dur);
}
