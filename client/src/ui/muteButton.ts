import { isMuted, onMuteChange, toggleMute } from '../audio/sound';
import { button, type Lifetime } from './html';

/** "Sunet: da/nu" (or the speaker icon), in step with every other mute button, for as long as `life` lasts. */
export function muteButton(life: Lifetime, style: 'label' | 'icon' = 'label'): HTMLButtonElement {
  const text = () => (style === 'icon' ? (isMuted() ? '🔇' : '🔊') : `Sunet: ${isMuted() ? 'nu' : 'da'}`);
  const node = button(text(), () => toggleMute(), 'secondary', 'small');
  node.setAttribute('aria-label', 'Sunet pornit sau oprit');
  const sync = () => {
    node.textContent = text();
    node.setAttribute('aria-pressed', String(!isMuted()));
  };
  sync();
  life.onEnd(onMuteChange(sync));
  return node;
}
