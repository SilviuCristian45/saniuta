import { DEFAULT_TUNING, TUNING, setTuning, type Tuning } from '@saniuta/shared';
import { load, save } from '../storage';
import { el } from '../ui/el';

// ?tune (local games only): a slider per riding-feel number, applied live and kept in this browser.
// Online games always ride with DEFAULT_TUNING (client and server must step with the same numbers).

const KEY = 'tune';

/** The values an earlier ?tune session saved (null when there are none). */
export function savedTuning(): Partial<Tuning> | null {
  const raw = load(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Partial<Tuning>;
  } catch {
    return null;
  }
}

export class TunePanel {
  private readonly root: HTMLElement;

  constructor() {
    const rows = (Object.keys(DEFAULT_TUNING) as (keyof Tuning)[]).map((key) => {
      const def = DEFAULT_TUNING[key];
      const max = Math.max(10, def * 3);
      const value = el('span', { class: 'tune-value', text: String(TUNING[key]) });
      const input = el('input', { attrs: { type: 'range', min: '0', max: String(max), step: '1', value: String(TUNING[key]) } });
      input.addEventListener('input', () => {
        setTuning({ [key]: Number(input.value) });
        value.textContent = input.value;
        save(KEY, JSON.stringify(TUNING));
      });
      return el('label', { class: 'tune-row' }, [el('span', { text: key }), input, value]);
    });
    const reset = el('button', {
      text: 'Valori implicite',
      onClick: () => {
        setTuning(DEFAULT_TUNING);
        save(KEY, JSON.stringify(TUNING));
        this.root.querySelectorAll<HTMLInputElement>('input').forEach((input, i) => {
          const key = (Object.keys(DEFAULT_TUNING) as (keyof Tuning)[])[i]!;
          input.value = String(TUNING[key]);
          (input.nextElementSibling as HTMLElement).textContent = input.value;
        });
      },
    });
    this.root = el('div', { class: 'tune-panel' }, [el('h3', { text: 'Reglaje (doar local)' }), ...rows, reset]);
    document.body.append(this.root);
  }

  destroy(): void {
    this.root.remove();
  }
}
