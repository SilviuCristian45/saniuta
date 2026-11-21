import { isTouch } from '../device';
import { el } from './el';

// Phones play held sideways: a prompt covers the game while the phone is upright, and the first
// tap asks for fullscreen (and the screen to stay on) where the browser allows it.

let prompt: HTMLElement | null = null;

export function initRotatePrompt(): void {
  if (!isTouch || prompt) return;
  prompt = el('div', { class: 'rotate-prompt' }, [el('div', { class: 'rotate-icon', text: '📱' }), el('p', { text: 'Întoarce telefonul pe orizontală' })]);
  document.body.append(prompt);
}

/** Fullscreen and a screen wake lock on the first tap (both need a user gesture). */
export function fullscreenOnFirstTap(): void {
  if (!isTouch) return;
  const once = () => {
    window.removeEventListener('pointerdown', once);
    const root = document.documentElement;
    if (!document.fullscreenElement && root.requestFullscreen) root.requestFullscreen({ navigationUI: 'hide' }).catch(() => undefined);
    const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<unknown> } };
    nav.wakeLock?.request('screen').catch(() => undefined);
  };
  window.addEventListener('pointerdown', once);
}
