import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, TUNING, applyGameTuning, setTuning } from '../src';

afterEach(() => setTuning(DEFAULT_TUNING));

describe('tuning', () => {
  it('saved ?tune values apply only to a local game with ?tune', () => {
    const saved = { gravity: 45, turnRate: 20 };
    applyGameTuning({ online: true, tune: true, saved });
    expect(TUNING).toEqual(DEFAULT_TUNING);
    applyGameTuning({ online: false, tune: false, saved });
    expect(TUNING).toEqual(DEFAULT_TUNING);
    applyGameTuning({ online: false, tune: true, saved });
    expect(TUNING.gravity).toBe(45);
    expect(TUNING.turnRate).toBe(20);
    applyGameTuning({ online: true, tune: false, saved: null });
    expect(TUNING).toEqual(DEFAULT_TUNING);
  });

  it('only integers are accepted', () => {
    setTuning({ gravity: 1.5, maxSpeed: Number.NaN });
    expect(TUNING).toEqual(DEFAULT_TUNING);
  });
});
