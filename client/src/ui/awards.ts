import type { AwardId } from '@saniuta/shared';
import { kmh } from '../render/format';

// The end-of-match award texts, without Phaser (the podium shows them under the table).

/** Ticks to "3.4 s" (the simulation runs 30 ticks a second). */
const seconds = (ticks: number) => `${(ticks / 30).toFixed(1).replace('.', ',')} s`;
const times = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const AWARD_TEXT: Record<AwardId, { title: string; detail: (n: number) => string }> = {
  fulgerul: { title: 'Fulgerul', detail: (n) => `cea mai mare viteză: ${kmh(n)} km/h` },
  lunetistul: { title: 'Lunetistul', detail: (n) => `cei mai mulți bulgări nimeriți (${n})` },
  tinta: { title: 'Ținta', detail: (n) => `lovit de cei mai mulți bulgări (${n})` },
  cascadorul: { title: 'Cascadorul', detail: (n) => `cel mai mult timp în aer (${seconds(n)})` },
  omDeZapada: { title: 'Om de zăpadă', detail: (n) => `cele mai multe răsturnări (${times(n, 'dată', 'ori')})` },
  sanieDeOtel: { title: 'Sanie de oțel', detail: () => 'nicio răsturnare tot meciul' },
};
