import { describe, expect, it } from 'vitest';
import { loadSeat, saveSeat, startupRoute, type SeatStorage } from '../src/net/resume';

/** In-memory sessionStorage; `broken` throws like a blocked one. */
function fakeStorage(broken = false): SeatStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  const guard = () => {
    if (broken) throw new Error('SecurityError');
  };
  return {
    data,
    getItem: (key) => (guard(), data.get(key) ?? null),
    setItem: (key, value) => (guard(), void data.set(key, value)),
    removeItem: (key) => (guard(), void data.delete(key)),
  };
}

describe('resume after a reload', () => {
  it('keeps the token with the room code and forgets it on request', () => {
    const storage = fakeStorage();
    saveSeat(storage, { token: 'abc:123', code: 'K7Q2MX' });
    expect(loadSeat(storage)).toEqual({ token: 'abc:123', code: 'K7Q2MX' });
    expect([...storage.data.keys()]).toEqual(['saniuta.reconnect']);
    saveSeat(storage, null);
    expect(loadSeat(storage)).toBeNull();
  });

  it('ignores missing, corrupt or blocked storage', () => {
    expect(loadSeat(null)).toBeNull();
    const storage = fakeStorage();
    storage.data.set('saniuta.reconnect', 'not json');
    expect(loadSeat(storage)).toBeNull();
    storage.data.set('saniuta.reconnect', JSON.stringify({ token: '' }));
    expect(loadSeat(storage)).toBeNull();
    storage.data.set('saniuta.reconnect', JSON.stringify({ token: 't' }));
    expect(loadSeat(storage)).toEqual({ token: 't', code: '' });
    const broken = fakeStorage(true);
    expect(() => saveSeat(broken, { token: 't', code: 'K7Q2MX' })).not.toThrow();
    expect(loadSeat(broken)).toBeNull();
  });

  it('starts normally when there is nothing to resume, invite or not', () => {
    expect(startupRoute(null, undefined)).toEqual({ kind: 'normal' });
    expect(startupRoute(null, 'K7Q2MX')).toEqual({ kind: 'normal' });
  });

  it('resumes the saved room, also through a link to the same room', () => {
    expect(startupRoute('K7Q2MX', undefined)).toEqual({ kind: 'resume' });
    expect(startupRoute('K7Q2MX', 'K7Q2MX')).toEqual({ kind: 'resume' });
  });

  it('asks before switching when the link is to another room', () => {
    expect(startupRoute('K7Q2MX', 'PB4HZN')).toEqual({ kind: 'switch', from: 'K7Q2MX', to: 'PB4HZN' });
    expect(startupRoute('', 'PB4HZN')).toEqual({ kind: 'switch', from: '', to: 'PB4HZN' });
  });
});
