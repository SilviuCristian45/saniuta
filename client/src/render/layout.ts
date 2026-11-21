import { FP } from '@saniuta/shared';

// Screen layout: a fixed 1280×720 canvas scaled to fit. The world (the slope, in simulation pixels)
// is seen through the main camera following the player's sled; the HUD, the minimap and the
// snowfall are drawn by a second camera that never moves or zooms.

export const GAME_W = 1280;
export const GAME_H = 720;

/** World camera zoom: further out at speed, so a fast rider sees more of what is coming. */
export const ZOOM_SLOW = 0.95;
export const ZOOM_FAST = 0.78;
/** The followed sled sits this far above the middle of the screen (fraction of the height): more slope ahead. */
export const LOOK_AHEAD = 0.22;

/** Simulation sub-units to world pixels. */
export const px = (v: number) => v / FP;

export const FONT = "'Trebuchet MS', 'Segoe UI', Verdana, sans-serif";

/** World depths (inside the world layer); y-sorted objects use DEPTH.sorted + y / SORT_SPAN. */
export const DEPTH = {
  ground: 0,
  trails: 1,
  ramps: 2,
  piles: 3,
  shadows: 4,
  sorted: 10,
  air: 20,
  balls: 21,
  fx: 22,
  lights: 23,
  labels: 24,
  debug: 30,
} as const;
export const SORT_SPAN = 1_000_000;

/** Depth of an object standing on the slope at world y (px): lower ones are drawn over higher ones. */
export function sortDepth(yPx: number): number {
  return DEPTH.sorted + yPx / SORT_SPAN;
}

/** HUD depths (inside the HUD layer). */
export const HUD_DEPTH = {
  tint: 0,
  snow: 1,
  panel: 10,
  text: 11,
  banner: 20,
  overlay: 30,
} as const;
