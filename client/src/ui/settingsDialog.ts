import { isMuted, setMuted } from '../audio/sound';
import { isTouch } from '../device';
import { getSetting, setSetting, type Settings } from '../settings';
import { openDialog } from './dialog';
import { el } from './el';
import { button } from './html';

// "Setări": sound, effects and the touch controls, remembered on this device.

function toggle(label: string, get: () => boolean, set: (on: boolean) => void): HTMLButtonElement {
  const state = el('span', { class: 'state' });
  const node = el('button', { class: 'toggle', attrs: { type: 'button' } }, [el('span', { text: label }), state]);
  const sync = () => {
    const on = get();
    node.classList.toggle('on', on);
    node.setAttribute('aria-pressed', String(on));
    state.textContent = on ? 'da' : 'nu';
  };
  node.addEventListener('click', () => {
    set(!get());
    sync();
  });
  sync();
  return node;
}

const setting = (key: keyof Settings, label: string) =>
  toggle(
    label,
    () => getSetting(key),
    (on) => setSetting(key, on),
  );

export function openSettings(): void {
  const items = [
    toggle(
      'Sunet',
      () => !isMuted(),
      (on) => setMuted(!on),
    ),
    setting('reducedEffects', 'Efecte reduse'),
  ];
  if (isTouch) items.push(setting('leftHanded', 'Mod stângaci (bulgărele în stânga)'));
  const dialog = openDialog(
    [el('h2', { text: 'Setări' }), el('div', { class: 'toggle-list' }, items), button('Gata', () => dialog.close(), 'primary', 'medium')],
    () => dialog.close(),
  );
}
