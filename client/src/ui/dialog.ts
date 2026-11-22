import { el } from './el';

// A modal box over everything else, closed by its own buttons (or Esc when it has a cancel action).

export interface Dialog {
  close(): void;
}

export function openDialog(content: (Node | string)[], onEscape?: () => void): Dialog {
  const backdrop = el('div', { class: 'modal-backdrop' }, [el('div', { class: 'modal', attrs: { role: 'dialog', 'aria-modal': 'true' } }, content)]);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && onEscape) onEscape();
  };
  window.addEventListener('keydown', onKey);
  document.body.append(backdrop);
  return {
    close: () => {
      window.removeEventListener('keydown', onKey);
      backdrop.remove();
    },
  };
}
