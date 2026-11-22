import { el } from './el';

// Small messages stacked in the top-right corner: the newest at the bottom, older ones pushed up,
// at most three, each gone by itself after a few seconds. Never interactive, so it never blocks play.

export interface ToastOptions {
  /** Plain text after the lead. */
  message: string;
  /** Shown first, in the accent color (e.g. a player's name). */
  lead?: string;
  /** Stripe and lead color; defaults to the title yellow. */
  accent?: number;
}

const MAX_TOASTS = 3;
const SHOW_MS = 3000;
const FADE_MS = 250;

let stack: HTMLElement | undefined;
const active: HTMLElement[] = [];

/** A toast in the top-right corner, above whatever screen is showing. */
export function showToast(opts: ToastOptions): void {
  if (!stack) {
    stack = el('div', { class: 'toasts', attrs: { 'aria-live': 'polite' } });
    document.body.append(stack);
  }
  const toast = el('div', { class: 'toast' }, [opts.lead ? el('b', { text: opts.lead }) : null, el('span', { text: opts.message })]);
  if (opts.accent !== undefined) toast.style.setProperty('--accent', `#${opts.accent.toString(16).padStart(6, '0')}`);
  stack.append(toast);
  active.push(toast);
  requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('in')));
  window.setTimeout(() => dismiss(toast), SHOW_MS);
  if (active.length > MAX_TOASTS) dismiss(active[0]!);
}

function dismiss(toast: HTMLElement): void {
  const i = active.indexOf(toast);
  if (i < 0) return;
  active.splice(i, 1);
  // Collapses while fading, so the rest slide up into the freed place.
  toast.classList.add('out');
  window.setTimeout(() => toast.remove(), FADE_MS);
}
