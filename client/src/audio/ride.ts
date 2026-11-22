import { SURFACE_DEEP, SURFACE_ICE } from '@saniuta/shared';
import { fetchFirst } from './files';
import { noiseBufferFor } from './sfx';
import type { AudioOut } from './sound';

// The two sounds that run all the time while riding, each a loop: the runners on the snow
// ("alunecare", louder and brighter with speed: a hiss on ice, a low rumble in deep snow, silent in
// the air) and the wind ("vant", rising with speed). Generated from filtered noise unless
// client/public/audio/alunecare.ogg|mp3 or vant.ogg|mp3 exist: then those loop instead.

export interface RideState {
  /** 0 (standing) .. 1 (top speed). */
  speed: number;
  /** SURFACE_SNOW | SURFACE_ICE | SURFACE_DEEP under the sled. */
  surface: number;
  /** On the snow (not in the air, not overturned). */
  grounded: boolean;
}

interface Loop {
  gain: GainNode;
  filter: BiquadFilterNode;
  source: AudioBufferSourceNode;
  /** A file loops instead of the filtered noise: the filter stays open, only the level and rate follow the ride. */
  fromFile: boolean;
}

/** How fast the level and color follow the ride (seconds, setTargetAtTime). */
const SMOOTH = 0.08;

let output: AudioOut | null = null;
const fileBuffers: { alunecare: AudioBuffer | null; vant: AudioBuffer | null } = { alunecare: null, vant: null };

/** Looks for replacement loops once, at boot. */
export function initRideSounds(out: AudioOut | null): void {
  if (!out) return;
  output = out;
  for (const name of ['alunecare', 'vant'] as const) {
    void fetchFirst(out.context, [`audio/${name}.ogg`, `audio/${name}.mp3`]).then((buffer) => {
      fileBuffers[name] = buffer;
    });
  }
}

/** The player's own ride sounds: started by the game scene, updated every frame, stopped at the end. */
export class RideSound {
  private slide: Loop | null = null;
  private wind: Loop | null = null;

  /** Every frame; `ride` null means silence (not riding, paused, between runs). */
  update(ride: RideState | null): void {
    const ctx = output?.context;
    if (!output || !ctx || ctx.state !== 'running') return;
    if (!this.slide) this.slide = this.makeLoop(ctx, 'alunecare', 'bandpass');
    if (!this.wind) this.wind = this.makeLoop(ctx, 'vant', 'lowpass');
    if (!this.slide || !this.wind) return;
    const t = ctx.currentTime;
    const speed = ride ? Math.max(0, Math.min(1, ride.speed)) : 0;

    // Runners: nothing in the air or overturned; ice hisses higher, deep snow rumbles lower and louder.
    let slideVol = ride && ride.grounded ? 0.05 + speed * 0.3 : 0;
    let slideFreq = 700 + speed * 900;
    if (ride?.surface === SURFACE_ICE) {
      slideFreq = 2600 + speed * 1600;
      slideVol *= 0.8;
    } else if (ride?.surface === SURFACE_DEEP) {
      slideFreq = 260 + speed * 200;
      slideVol *= 1.3;
    }
    if (speed < 0.02) slideVol = 0;
    this.drive(this.slide, t, slideVol, slideFreq, 0.6 + speed * 0.8);

    // Wind: only once there is some speed, growing with its square; a bit louder in the air.
    const windVol = ride ? Math.max(0, speed - 0.15) ** 2 * (ride.grounded ? 0.35 : 0.5) : 0;
    this.drive(this.wind, t, windVol, 300 + speed * 1400, 0.8 + speed * 0.5);
  }

  stop(): void {
    for (const loop of [this.slide, this.wind]) {
      if (!loop) continue;
      try {
        loop.source.stop();
      } catch {
        // already stopped
      }
      loop.gain.disconnect();
    }
    this.slide = null;
    this.wind = null;
  }

  private makeLoop(ctx: AudioContext, name: 'alunecare' | 'vant', type: BiquadFilterType): Loop | null {
    const destination = output?.destination;
    if (!destination) return null;
    const file = fileBuffers[name];
    const source = ctx.createBufferSource();
    source.buffer = file ?? noiseBufferFor(ctx);
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = file ? 'allpass' : type;
    filter.Q.value = name === 'alunecare' ? 0.9 : 0.5;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    source.connect(filter).connect(gain).connect(destination);
    // Noise starts at a random point, so the loop's seam never lines up with the other one.
    source.start(ctx.currentTime, file ? 0 : Math.random() * 0.9);
    return { gain, filter, source, fromFile: !!file };
  }

  private drive(loop: Loop, t: number, volume: number, freq: number, rate: number): void {
    loop.gain.gain.setTargetAtTime(volume, t, SMOOTH);
    if (loop.fromFile) loop.source.playbackRate.setTargetAtTime(rate, t, SMOOTH);
    else loop.filter.frequency.setTargetAtTime(freq, t, SMOOTH);
  }
}
