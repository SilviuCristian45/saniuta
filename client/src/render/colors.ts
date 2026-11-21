// The palette: a snowy Carpathian slope at dusk turning into night, warm cabin lights.

/** Coat (and sled ribbon) color per slot. */
export const PLAYER_COLORS: readonly number[] = [0xe63946, 0x3a86ff, 0xffbe0b, 0x2a9d8f, 0x9b5de5, 0xfb8500];
/** Scarf color per slot: knitted stripes in a second color. */
export const SCARF_COLORS: readonly number[] = [0xffd166, 0xff006e, 0x8338ec, 0xffffff, 0x06d6a0, 0x00b4d8];

export const COLORS = {
  night: 0x141b33,
  offPiste: 0x7d8db0,
  offPisteDark: 0x5f6f93,
  snow: 0xe2e9f6,
  snowShade: 0xccd6ea,
  snowbank: 0xf6f9ff,
  snowbankShadow: 0x9eabc9,
  ice: 0xa6dcf2,
  iceStreak: 0xf0fbff,
  deep: 0xf4f7ff,
  deepLump: 0xc3cee5,
  trail: 0x8d9cc0,
  wood: 0x9c6b3e,
  woodDark: 0x6b4423,
  woodLight: 0xc28e5c,
  fir: 0x1e4637,
  firMid: 0x2c6150,
  firLight: 0x3f7a62,
  rock: 0x6d7385,
  rockLight: 0x9097a8,
  warm: 0xffc46b,
  warmDeep: 0xff9f43,
  text: '#fff6e0',
  textDim: '#c8d4ec',
  gold: '#ffd166',
  outline: '#141b33',
} as const;

export const hexColor = (c: number) => '#' + c.toString(16).padStart(6, '0');
