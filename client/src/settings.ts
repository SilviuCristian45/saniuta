import { isTouch } from './device';
import { load, save } from './storage';

// Player preferences kept in this browser.

export interface Settings {
  /** Fewer snowflakes, shorter trails, no camera shake. On by default on phones. */
  reducedEffects: boolean;
  /** Touch: joystick on the right, snowball button on the left. */
  leftHanded: boolean;
  muted: boolean;
}

const DEFAULTS: Settings = { reducedEffects: isTouch, leftHanded: false, muted: false };

export function getSetting<K extends keyof Settings>(key: K): Settings[K] {
  const raw = load(`setting.${key}`);
  return raw === null ? DEFAULTS[key] : raw === '1';
}

export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
  save(`setting.${key}`, value ? '1' : '0');
}

export function reducedEffects(): boolean {
  return getSetting('reducedEffects');
}

/** A short buzz on phones that support it (ignored elsewhere). */
export function vibrate(ms: number): void {
  if (!isTouch) return;
  try {
    navigator.vibrate?.(ms);
  } catch {
    // not allowed, fine
  }
}
