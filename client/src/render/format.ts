import { FP, POWER_FOG, POWER_GIANT, POWER_SCARF, POWER_TEA, POWER_WAX, TICK_RATE, ticksToMs } from '@saniuta/shared';

// Numbers and names as the HUD and the end screens show them (no Phaser: shared with client/test).

/** m:ss.d for a run time in ticks. */
export function formatTime(ticks: number): string {
  const ms = ticksToMs(ticks);
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const d = Math.floor((ms % 1000) / 100);
  return `${m}:${String(s).padStart(2, '0')}.${d}`;
}

/** Sub-units per tick to a fun km/h (450 px/s reads as ~65 km/h). */
export function kmh(speed: number): number {
  return Math.round(((speed / FP) * TICK_RATE * 0.145));
}

/** "1-a", "al 2-lea", ... as in "Ai sosit al 2-lea". */
export function ordinal(place: number): string {
  return place === 1 ? 'primul' : `al ${place}-lea`;
}

/** Power-up names as the game shows them (POWER_WAX..POWER_FOG). */
export const POWER_NAMES: Record<number, string> = {
  [POWER_WAX]: 'Ceară pe tălpici',
  [POWER_TEA]: 'Ceai fierbinte',
  [POWER_GIANT]: 'Bulgăre uriaș',
  [POWER_SCARF]: 'Fular magic',
  [POWER_FOG]: 'Ceață',
};

/** What each one does, in a few words (shown when it is picked up). */
export const POWER_HINTS: Record<number, string> = {
  [POWER_WAX]: 'mai repede 3 s',
  [POWER_TEA]: 'nu te răstorni o dată',
  [POWER_GIANT]: 'răstoarnă pe cine prinde',
  [POWER_SCARF]: 'bulgării nu te ating 4 s',
  [POWER_FOG]: 'ceilalți pierd harta 4 s',
};
