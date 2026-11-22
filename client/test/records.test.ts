import { TRACK_BUNICII, TRACK_LUPULUI } from '@saniuta/shared';
import { describe, expect, it } from 'vitest';
import { recordsLine } from '../src/ui/records';

describe('records line', () => {
  it('puts this player first, then the others by place, and says nothing without records', () => {
    expect(recordsLine([], 'me')).toBe('');
    const line = recordsLine(
      [
        { playerId: 'ana', name: 'Ana', trackId: TRACK_LUPULUI, place: 2, kind: 'top' },
        { playerId: 'me', name: 'Ion', trackId: TRACK_LUPULUI, place: 5, kind: 'record' },
      ],
      'me',
    );
    expect(line).toBe('★ Record nou pe Valea Lupului! Locul 5  ·  Ana: în top pe Valea Lupului, locul 2 ★');
    expect(recordsLine([{ playerId: 'me', name: 'Ion', trackId: TRACK_BUNICII, place: 1, kind: 'top' }], 'me')).toBe(
      '★ Ai intrat în top pe Pârtia Bunicii! Locul 1 ★',
    );
  });
});
