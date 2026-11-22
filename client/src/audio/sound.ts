import Phaser from 'phaser';
import { getSetting, setSetting } from '../settings';

// Mute (remembered in this browser) and the Web Audio output every sound goes through.

/**
 * Where the sounds play: an AudioContext and the node in front of the speakers (Phaser's master
 * gain, so the mute applies to everything). Read at play time, so a getter is fine.
 */
export interface AudioOut {
  readonly context: AudioContext;
  readonly destination: AudioNode | undefined;
}

// Kept here because Web Audio's `sound.mute` getter reads the gain node, which only changes once the
// audio context renders, so it lags right after being set.
let muted = false;
let game: Phaser.Game | null = null;
const listeners = new Set<(muted: boolean) => void>();

export function initMute(g: Phaser.Game): void {
  game = g;
  muted = getSetting('muted');
  g.sound.mute = muted;
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(value: boolean): void {
  muted = value;
  if (game) game.sound.mute = muted;
  setSetting('muted', muted);
  for (const cb of listeners) cb(muted);
}

export function toggleMute(): boolean {
  setMuted(!muted);
  return muted;
}

/** Called whenever the mute changes (every mute button shows the same state). */
export function onMuteChange(cb: (muted: boolean) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Phaser's Web Audio output (none with HTML5 audio or no audio at all). */
export function phaserAudioOut(g: Phaser.Game): AudioOut | null {
  const sound = g.sound;
  if (!(sound instanceof Phaser.Sound.WebAudioSoundManager)) return null;
  return {
    context: sound.context,
    get destination() {
      return sound.destination;
    },
  };
}
