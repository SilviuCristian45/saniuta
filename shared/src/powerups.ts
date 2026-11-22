import {
  FOG_TICKS,
  GIFT_RADIUS,
  GIFT_RESPAWN_TICKS,
  POWER_FOG,
  POWER_GIANT,
  POWER_KINDS,
  POWER_NONE,
  POWER_SCARF,
  POWER_TEA,
  POWER_WAX,
  SCARF_TICKS,
  SLED_RADIUS,
  WAX_TICKS,
} from './constants';
import { idiv } from './fixed';
import { grounded } from './physics';
import { nextInt } from './rng';
import { launchGiant } from './snowballs';
import { nearby, type Track } from './track';
import type { GameEvent, GameState, PlayerState } from './types';

// Power-ups (when the room has them on): gift boxes on the track give one, drawn from state.rng,
// held until used with its own button (at most one at a time). Catch-up: the further back a sled
// is, the better the odds; the leader mostly gets the weak ones.

/**
 * Odds in percent for the leader and for the last sled, in POWER_KINDS order (wax, tea, giant
 * snowball, scarf, fog); in between they are interpolated by the place.
 */
export const POWER_ODDS_FIRST: readonly number[] = [10, 25, 5, 25, 35];
export const POWER_ODDS_LAST: readonly number[] = [35, 15, 35, 10, 5];

/** Every gift box of the track there (start of a run). */
export function resetGifts(state: GameState, track: Track): void {
  state.giftTimers = new Array<number>(track.gifts.length).fill(0);
}

/** Taken gift boxes come back after GIFT_RESPAWN_TICKS. */
export function tickGifts(state: GameState): void {
  for (let i = 0; i < state.giftTimers.length; i++) if (state.giftTimers[i]! > 0) state.giftTimers[i]!--;
}

/** Timed effects run down (finished sleds too: the fog clears for them as well). */
export function tickPowerUps(p: PlayerState): void {
  if (p.waxTicks > 0) p.waxTicks--;
  if (p.scarfTicks > 0) p.scarfTicks--;
  if (p.fogTicks > 0) p.fogTicks--;
}

/** Where a sled is in the field, per-mille: 0 = leading, 1000 = last (500 when alone). Finished sleds count as ahead. */
export function placePerMille(racers: readonly PlayerState[], p: Readonly<PlayerState>): number {
  if (racers.length <= 1) return 500;
  const ahead = racers.filter((o) => o.id !== p.id && (o.finished || o.y > p.y)).length;
  return idiv(ahead * 1000, racers.length - 1);
}

/** The odds (percent, POWER_KINDS order) at a place. */
export function powerOdds(place: number): number[] {
  return POWER_ODDS_FIRST.map((a, i) => a + idiv((POWER_ODDS_LAST[i]! - a) * place, 1000));
}

/** Draws a power-up for a sled at this place; advances state.rng. */
export function drawPowerUp(state: GameState, place: number): number {
  const odds = powerOdds(place);
  let roll = nextInt(state, odds.reduce((a, b) => a + b, 0));
  for (let i = 0; i < odds.length; i++) {
    roll -= odds[i]!;
    if (roll < 0) return POWER_KINDS[i]!;
  }
  return POWER_KINDS[POWER_KINDS.length - 1]!;
}

/** A sled on the snow with empty hands takes the first gift box it rides over. `racers` in slot order. */
export function pickUpGift(state: GameState, track: Track, racers: readonly PlayerState[], p: PlayerState, events: GameEvent[]): void {
  if (!state.powerUps || p.powerUp !== POWER_NONE || !grounded(p) || p.crashTicks > 0) return;
  const reach = GIFT_RADIUS + SLED_RADIUS;
  for (const i of nearby(track, track.rowGifts, p.y)) {
    if (state.giftTimers[i] !== 0) continue;
    const gift = track.gifts[i]!;
    const dx = p.x - gift.x;
    const dy = p.y - gift.y;
    if (dx * dx + dy * dy >= reach * reach) continue;
    state.giftTimers[i] = GIFT_RESPAWN_TICKS;
    p.powerUp = drawPowerUp(state, placePerMille(racers, p));
    events.push({ type: 'gift', playerId: p.id, gift: i, power: p.powerUp });
    return;
  }
}

/** A use press (latched by applyInput): the power-up held takes effect, if the sled is not overturned. */
export function usePowerUp(state: GameState, racers: readonly PlayerState[], p: PlayerState, events: GameEvent[]): void {
  if (!p.usePressed) return;
  p.usePressed = false;
  const power = p.powerUp;
  if (power === POWER_NONE || p.crashTicks > 0) return;
  if (power === POWER_GIANT && !launchGiant(state, p)) return;
  if (power === POWER_WAX) p.waxTicks = WAX_TICKS;
  else if (power === POWER_TEA) p.tea = true;
  else if (power === POWER_SCARF) p.scarfTicks = SCARF_TICKS;
  else if (power === POWER_FOG) {
    for (const o of racers) if (o.id !== p.id && !o.finished) o.fogTicks = FOG_TICKS;
  }
  p.powerUp = POWER_NONE;
  p.powerUpsUsed++;
  events.push({ type: 'power', playerId: p.id, power });
}

/** Clears what a sled holds and every effect on it (start of a run). */
export function resetPowerUps(p: PlayerState): void {
  p.powerUp = POWER_NONE;
  p.usePressed = false;
  p.waxTicks = 0;
  p.tea = false;
  p.scarfTicks = 0;
  p.fogTicks = 0;
}
