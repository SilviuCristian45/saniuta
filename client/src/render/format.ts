import { FP, TICK_RATE, ticksToMs } from '@saniuta/shared';

// Numbers as the HUD and the end screens show them (no Phaser: shared with client/test).

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
