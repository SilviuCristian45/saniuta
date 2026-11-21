// mulberry32: tiny, fast, deterministic. The state lives inside GameState.rng.

export interface RngHolder {
  rng: number;
}

export function seedFrom(value: number | string): number {
  if (typeof value === 'number') return value >>> 0;
  // FNV-1a
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function nextRandom(holder: RngHolder): number {
  const s = (holder.rng + 0x6d2b79f5) >>> 0;
  holder.rng = s;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function nextInt(holder: RngHolder, maxExclusive: number): number {
  return Math.floor(nextRandom(holder) * maxExclusive);
}
