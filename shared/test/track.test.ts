import { describe, expect, it } from 'vitest';
import {
  FIXED_TRACK_IDS,
  ROW_LEN,
  SLED_RADIUS,
  START_ROW,
  TRACK_BUNICII,
  TRACK_LUPULUI,
  TRACK_NEBUNILOR,
  TRACK_RANDOM,
  centerAt,
  fixedTrackSeed,
  generateTrack,
  getTrack,
  halfWidthAt,
  trackName,
  type Track,
} from '../src';
import { numbersIn } from './helpers';

const fixed = (id: number) => getTrack(id, fixedTrackSeed(id));

describe('track generation', () => {
  it('the same track id and seed give exactly the same track', () => {
    for (const id of [...FIXED_TRACK_IDS, TRACK_RANDOM]) {
      expect(JSON.stringify(generateTrack(id, 12345))).toBe(JSON.stringify(generateTrack(id, 12345)));
    }
    expect(getTrack(TRACK_LUPULUI, 7)).toBe(getTrack(TRACK_LUPULUI, 7)); // cached
  });

  it('different seeds give different random tracks', () => {
    expect(JSON.stringify(generateTrack(TRACK_RANDOM, 1).obstacles)).not.toBe(JSON.stringify(generateTrack(TRACK_RANDOM, 2).obstacles));
  });

  it('the fixed tracks have their names and get harder', () => {
    expect(trackName(TRACK_BUNICII)).toBe('Pârtia Bunicii');
    expect(trackName(TRACK_LUPULUI)).toBe('Valea Lupului');
    expect(trackName(TRACK_NEBUNILOR)).toBe('Coborârea Nebunilor');
    expect(trackName(TRACK_RANDOM)).toBe('Pârtie aleatoare');
    const density = (t: Track) => t.obstacles.length / t.rowCount;
    const width = (t: Track) => t.half.reduce((a, b) => a + b, 0) / t.rowCount;
    const [easy, mid, hard] = FIXED_TRACK_IDS.map(fixed);
    expect(density(easy!)).toBeLessThan(density(mid!));
    expect(density(mid!)).toBeLessThan(density(hard!));
    expect(width(easy!)).toBeGreaterThan(width(mid!));
    expect(width(mid!)).toBeGreaterThan(width(hard!));
    expect(easy!.ramps.length).toBeLessThan(hard!.ramps.length);
  });

  it('everything is an integer, on the track, and the start is clear', () => {
    for (const id of [...FIXED_TRACK_IDS, TRACK_RANDOM]) {
      const t = id === TRACK_RANDOM ? generateTrack(id, 99) : fixed(id);
      expect(numbersIn(t).filter(([, v]) => !Number.isSafeInteger(v))).toEqual([]);
      for (const o of t.obstacles) {
        expect(Math.abs(o.x - centerAt(t, o.y))).toBeLessThanOrEqual(halfWidthAt(t, o.y));
        expect(o.y).toBeGreaterThan(t.startY + 10 * ROW_LEN);
        expect(o.y).toBeLessThan(t.finishY);
      }
      for (const p of t.piles) expect(Math.abs(p.x - centerAt(t, p.y))).toBeLessThanOrEqual(halfWidthAt(t, p.y));
      expect(t.startY).toBe(START_ROW * ROW_LEN);
      expect(t.finishY).toBeGreaterThan(t.startY);
      expect(t.endY).toBeGreaterThan(t.finishY);
      expect(t.piles.length).toBeGreaterThan(10);
    }
  });

  it('there is always a way through: an opening of three sleds across every stretch', () => {
    for (const id of [...FIXED_TRACK_IDS, TRACK_RANDOM]) {
      const t = id === TRACK_RANDOM ? generateTrack(id, 4242) : fixed(id);
      for (let y = t.startY; y < t.finishY; y += ROW_LEN / 4) {
        const c = centerAt(t, y);
        const h = halfWidthAt(t, y);
        const blocked = t.obstacles
          .filter((o) => Math.abs(o.y - y) < o.r + SLED_RADIUS)
          .map((o) => [o.x - o.r - SLED_RADIUS, o.x + o.r + SLED_RADIUS] as const)
          .sort((a, b) => a[0] - b[0]);
        let free = c - h;
        let widest = 0;
        for (const [a, b] of blocked) {
          widest = Math.max(widest, a - free);
          free = Math.max(free, b);
        }
        widest = Math.max(widest, c + h - free);
        expect(widest, `${t.name} at y=${y}`).toBeGreaterThanOrEqual(6 * SLED_RADIUS);
      }
    }
  });
});
