import { INPUT_MAX } from '@saniuta/shared';

// The joystick's mapping, kept free of the DOM so it can be tested.

/** No input this close to the middle, as a fraction of the radius. */
export const DEAD_ZONE = 0.15;
/** Pushed further up than this (fraction of the radius) the rider kicks... */
export const KICK_ZONE = 0.5;
/** ...and further down than this it brakes, harder the further. */
export const BRAKE_ZONE = 0.4;

/**
 * Joystick offset (dx right, dy down, in radii, any length) to steer/throttle. Sideways steers in
 * proportion (screen directions, like the arrow keys); up kicks, down brakes, so steering with a
 * slightly tilted thumb never brakes by accident.
 */
export function stickToRide(dx: number, dy: number): { steer: number; throttle: number } {
  const len = Math.hypot(dx, dy);
  if (len < DEAD_ZONE) return { steer: 0, throttle: 0 };
  const k = len > 1 ? 1 / len : 1;
  const x = dx * k;
  const y = dy * k;
  const steer = Math.abs(x) < DEAD_ZONE ? 0 : Math.round(((x - Math.sign(x) * DEAD_ZONE) / (1 - DEAD_ZONE)) * INPUT_MAX);
  let throttle = 0;
  if (y < -KICK_ZONE) throttle = INPUT_MAX;
  else if (y > BRAKE_ZONE) throttle = -Math.round(((y - BRAKE_ZONE) / (1 - BRAKE_ZONE)) * INPUT_MAX);
  return { steer: Math.max(-INPUT_MAX, Math.min(INPUT_MAX, steer)), throttle: Math.max(-INPUT_MAX, throttle) };
}
