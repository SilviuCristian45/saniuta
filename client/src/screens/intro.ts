import { el } from '../ui/el';
import { button, onKeyFor, title } from '../ui/html';
import type { MenuData, ScreenHost } from './host';

/** Title screen. Its click is also the user gesture browsers want before sound. Next: the nickname. */
export function showIntro(host: ScreenHost, next: MenuData): void {
  const enter = () => host.go({ to: 'name', data: next });
  host.mount('intro', [
    title(),
    el('p', { class: 'subtitle', text: 'Curse cu săniuțe de lemn, la apus, pe o pârtie din Carpați' }),
    button('Hai la săniuș!', enter, 'primary', 'big'),
  ]);
  onKeyFor(host.life, 'Enter', enter);
}
