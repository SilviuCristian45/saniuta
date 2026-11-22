import { MAX_NAME_LENGTH, sanitizeName } from '@saniuta/shared';
import { isTouch } from '../device';
import { load, save } from '../storage';
import { el } from '../ui/el';
import { button, keepInViewOnFocus, onKeyFor, title } from '../ui/html';
import type { MenuData, NameData, ScreenHost } from './host';

const EMPTY_MESSAGE = 'Scrie-ți porecla ca să continui.';

/** "Cum te cheamă?" — the first step after the intro. A saved name only needs confirming. */
export function showName(host: ScreenHost, opts: NameData): void {
  const next = () => {
    const data: MenuData = { invite: opts.invite, message: opts.message };
    host.go({ to: 'menu', data });
  };
  const inviteLine = () => (opts.invite ? el('p', { class: 'invite-line', text: `Intri în jocul ${opts.invite}` }) : null);

  const saved = load('name')?.trim();
  if (saved && !opts.edit) {
    // Returning player: "Salut, {nume}!" with Continuă / Schimbă numele.
    host.mount('name-screen', [
      title(true),
      el('h2', { text: `Salut, ${sanitizeName(saved)}!` }),
      inviteLine(),
      el('div', { class: 'actions' }, [
        button('Continuă', next, 'primary', 'medium'),
        button('Schimbă numele', () => host.go({ to: 'name', data: { ...opts, edit: true } }), 'secondary', 'small'),
      ]),
    ]);
    onKeyFor(host.life, 'Enter', next);
    return;
  }

  const input = el('input', {
    class: 'field big',
    attrs: { placeholder: 'Porecla ta', autocomplete: 'off', autocapitalize: 'words', enterkeyhint: 'done', 'aria-label': 'Porecla ta' },
  });
  input.maxLength = MAX_NAME_LENGTH;
  input.spellcheck = false;
  input.value = saved ?? '';
  keepInViewOnFocus(input);
  const counter = el('div', { class: 'counter' });
  const message = el('p', { class: 'message' });
  const submitButton = button('Continuă', () => submit(), 'primary', 'medium');

  host.mount('name-screen', [
    title(true),
    el('h2', { text: 'Cum te cheamă?' }),
    el('div', { class: 'field-wrap' }, [input, counter]),
    inviteLine(),
    el('div', { class: 'actions' }, [submitButton]),
    message,
  ]);

  const valid = () => input.value.trim().length > 0;
  const refresh = () => {
    counter.textContent = `${[...input.value].length}/${MAX_NAME_LENGTH}`;
    // Looks disabled while empty, but a tap still says why nothing happens.
    submitButton.classList.toggle('dim', !valid());
    if (valid()) message.textContent = '';
  };
  const submit = () => {
    if (!valid()) {
      message.textContent = EMPTY_MESSAGE;
      input.focus();
      return;
    }
    save('name', input.value.trim());
    next();
  };
  input.addEventListener('input', refresh);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
  });
  refresh();
  // A phone would pop its keyboard over the screen before the player has even looked at it.
  if (!isTouch) {
    input.focus();
    input.select();
  }
}
