import { isTouch } from '../device';
import { getSetting, setSetting, type Settings } from '../settings';
import { openDialog } from './dialog';
import { el } from './el';
import { button } from './html';

// "Setări": effects and the touch controls, remembered on this device.

function toggle(key: keyof Settings, label: string): HTMLButtonElement {
  const state = el('span', { class: 'state' });
  const node = el('button', { class: 'toggle', attrs: { type: 'button' } }, [el('span', { text: label }), state]);
  const sync = () => {
    const on = getSetting(key);
    node.classList.toggle('on', on);
    node.setAttribute('aria-pressed', String(on));
    state.textContent = on ? 'da' : 'nu';
  };
  node.addEventListener('click', () => {
    setSetting(key, !getSetting(key));
    sync();
  });
  sync();
  return node;
}

export function openSettings(): void {
  const items = [toggle('reducedEffects', 'Efecte reduse')];
  if (isTouch) items.push(toggle('leftHanded', 'Mod stângaci (bulgărele în stânga)'));
  const dialog = openDialog(
    [el('h2', { text: 'Setări' }), el('div', { class: 'toggle-list' }, items), button('Gata', () => dialog.close(), 'primary', 'medium')],
    () => dialog.close(),
  );
}
