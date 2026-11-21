import { describe, expect, it } from 'vitest';
import { stickToRide } from '../src/input/stick';

describe('joystick mapping', () => {
  it('does nothing near the middle', () => {
    expect(stickToRide(0.05, -0.08)).toEqual({ steer: 0, throttle: 0 });
  });

  it('steers in screen directions, in proportion', () => {
    expect(stickToRide(1, 0).steer).toBe(100);
    expect(stickToRide(-1, 0).steer).toBe(-100);
    const half = stickToRide(0.5, 0).steer;
    expect(half).toBeGreaterThan(30);
    expect(half).toBeLessThan(70);
    expect(stickToRide(3, 0).steer).toBe(100); // a finger past the edge counts as the edge
  });

  it('up kicks off, down brakes harder the further, a tilted thumb does neither', () => {
    expect(stickToRide(0, -1).throttle).toBe(100);
    expect(stickToRide(0, 1).throttle).toBe(-100);
    expect(stickToRide(0, 0.7).throttle).toBeLessThan(0);
    expect(stickToRide(0, 0.7).throttle).toBeGreaterThan(-100);
    expect(stickToRide(0.9, 0.3).throttle).toBe(0);
    expect(stickToRide(0.9, -0.3).throttle).toBe(0);
  });
});
