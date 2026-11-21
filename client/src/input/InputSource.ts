/** What the player wants this frame; the transport turns it into one input per simulation tick. */
export interface RideInput {
  steer: number; // -100 (left on screen) .. 100 (right)
  throttle: number; // > 0 kick ("sus"), < 0 brake ("jos")
  /** Snowball throw pressed since the last poll (latched until the next tick by the transport). */
  fire: boolean;
}

/** Turns a device (keyboard, touch) into riding input. Polled once per frame. */
export interface InputSource {
  /** null when this source is not being used right now (so another one can take over). */
  poll(): RideInput | null;
  /** Lets go of everything held (page hidden, run over). */
  releaseAll(): void;
  destroy(): void;
}

export const NO_INPUT: RideInput = { steer: 0, throttle: 0, fire: false };
