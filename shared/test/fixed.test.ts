import { describe, expect, it } from 'vitest';
import { ANGLE_STEPS, iatan2, icos, idiv, isin, isqrt, TRIG_ONE } from '../src';

describe('fixed-point helpers', () => {
  it('sine table hits the quadrant points exactly', () => {
    expect(isin(0)).toBe(0);
    expect(isin(ANGLE_STEPS / 4)).toBe(TRIG_ONE);
    expect(icos(ANGLE_STEPS / 2)).toBe(-TRIG_ONE);
  });

  it('atan2 inverts the table on the axes', () => {
    expect(iatan2(0, 100)).toBe(0);
    expect(iatan2(100, 0)).toBe(ANGLE_STEPS / 4);
  });

  it('isqrt and idiv are exact integer operations', () => {
    expect(isqrt(1_000_000)).toBe(1000);
    expect(isqrt(99)).toBe(9);
    expect(idiv(-7, 2)).toBe(-3);
    expect(Object.is(idiv(-1, 2), 0)).toBe(true); // never -0
  });
});
