// Integer-only math for the simulation. Every value here stays an integer well below 2^53,
// so client and server compute bit-identical results whatever the JS engine.
// No bitwise operators on fixed-point values: they truncate to 32 bits.

/** Full circle in angle steps; headings are integers in [0, ANGLE_STEPS). 0 = +x, clockwise on screen (y down). */
export const ANGLE_STEPS = 1024;
const QUARTER = ANGLE_STEPS / 4;

/** sin/cos results are scaled by TRIG_ONE. */
export const TRIG_ONE = 16384;

/** round(sin(i * 90° / 256) * 16384) for i = 0..256, written out so it never depends on Math.sin. */
const SIN_QUARTER: readonly number[] = [
  0, 101, 201, 302, 402, 503, 603, 704, 804, 904, 1005, 1105, 1205, 1306, 1406, 1506,
  1606, 1706, 1806, 1906, 2006, 2105, 2205, 2305, 2404, 2503, 2603, 2702, 2801, 2900, 2999, 3098,
  3196, 3295, 3393, 3492, 3590, 3688, 3786, 3883, 3981, 4078, 4176, 4273, 4370, 4467, 4563, 4660,
  4756, 4852, 4948, 5044, 5139, 5235, 5330, 5425, 5520, 5614, 5708, 5803, 5897, 5990, 6084, 6177,
  6270, 6363, 6455, 6547, 6639, 6731, 6823, 6914, 7005, 7096, 7186, 7276, 7366, 7456, 7545, 7635,
  7723, 7812, 7900, 7988, 8076, 8163, 8250, 8337, 8423, 8509, 8595, 8680, 8765, 8850, 8935, 9019,
  9102, 9186, 9269, 9352, 9434, 9516, 9598, 9679, 9760, 9841, 9921, 10001, 10080, 10159, 10238, 10316,
  10394, 10471, 10549, 10625, 10702, 10778, 10853, 10928, 11003, 11077, 11151, 11224, 11297, 11370, 11442, 11514,
  11585, 11656, 11727, 11797, 11866, 11935, 12004, 12072, 12140, 12207, 12274, 12340, 12406, 12472, 12537, 12601,
  12665, 12729, 12792, 12854, 12916, 12978, 13039, 13100, 13160, 13219, 13279, 13337, 13395, 13453, 13510, 13567,
  13623, 13678, 13733, 13788, 13842, 13896, 13949, 14001, 14053, 14104, 14155, 14206, 14256, 14305, 14354, 14402,
  14449, 14497, 14543, 14589, 14635, 14680, 14724, 14768, 14811, 14854, 14896, 14937, 14978, 15019, 15059, 15098,
  15137, 15175, 15213, 15250, 15286, 15322, 15357, 15392, 15426, 15460, 15493, 15525, 15557, 15588, 15619, 15649,
  15679, 15707, 15736, 15763, 15791, 15817, 15843, 15868, 15893, 15917, 15941, 15964, 15986, 16008, 16029, 16049,
  16069, 16088, 16107, 16125, 16143, 16160, 16176, 16192, 16207, 16221, 16235, 16248, 16261, 16273, 16284, 16295,
  16305, 16315, 16324, 16332, 16340, 16347, 16353, 16359, 16364, 16369, 16373, 16376, 16379, 16381, 16383, 16384,
  16384,
];

/** Wraps any integer angle into [0, ANGLE_STEPS). */
export function wrapAngle(a: number): number {
  const r = a % ANGLE_STEPS;
  return r < 0 ? r + ANGLE_STEPS : r;
}

/** sin(a) * TRIG_ONE for an integer angle in steps. */
export function isin(a: number): number {
  const w = wrapAngle(a);
  if (w <= QUARTER) return SIN_QUARTER[w]!;
  if (w <= 2 * QUARTER) return SIN_QUARTER[2 * QUARTER - w]!;
  if (w <= 3 * QUARTER) return -SIN_QUARTER[w - 2 * QUARTER]!;
  return -SIN_QUARTER[ANGLE_STEPS - w]!;
}

/** cos(a) * TRIG_ONE for an integer angle in steps. */
export function icos(a: number): number {
  return isin(a + QUARTER);
}

/** Integer division rounded toward zero (never -0, so states compare equal after JSON). */
export function idiv(a: number, b: number): number {
  return Math.trunc(a / b) || 0;
}

/** floor(sqrt(n)) for a non-negative integer, exact (the float estimate is corrected). */
export function isqrt(n: number): number {
  if (n <= 0) return 0;
  let r = Math.floor(Math.sqrt(n));
  while (r * r > n) r--;
  while ((r + 1) * (r + 1) <= n) r++;
  return r;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Integer angle of the vector (x, y) in steps, by binary search on the sine table
 * (no Math.atan2). Accurate to one step, which is plenty for steering decisions.
 */
export function iatan2(y: number, x: number): number {
  if (x === 0 && y === 0) return 0;
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  // First-quadrant angle: the largest a in [0, QUARTER] with sin(a) * ax <= cos(a) * ay (tan(a) <= ay / ax).
  let lo = 0;
  let hi = QUARTER;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (SIN_QUARTER[mid]! * ax <= SIN_QUARTER[QUARTER - mid]! * ay) lo = mid;
    else hi = mid - 1;
  }
  if (x >= 0) return y >= 0 ? lo : wrapAngle(-lo);
  return y >= 0 ? 2 * QUARTER - lo : 2 * QUARTER + lo;
}

/** Signed smallest difference b - a between two angles, in (-ANGLE_STEPS/2, ANGLE_STEPS/2]. */
export function angleDiff(a: number, b: number): number {
  let d = wrapAngle(b - a);
  if (d > ANGLE_STEPS / 2) d -= ANGLE_STEPS;
  return d;
}

/** 32-bit integer hash of a few integers (uint32 by design, so bitwise is fine here). */
export function hash32(...values: number[]): number {
  let h = 0x9e3779b9;
  for (const v of values) {
    h = Math.imul(h ^ (v >>> 0), 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return h >>> 0;
}

/** Deterministic roll in [0, 100) from a hash. */
export function percent(...values: number[]): number {
  return hash32(...values) % 100;
}
