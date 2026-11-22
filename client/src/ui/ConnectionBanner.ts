import type { GameTransport } from '../net/GameTransport';
import { el } from './el';
import { setText, show, type Lifetime } from './html';

/** "Se reconectează..." strip shown by the lobby and game screens while an online room is down. */
export class ConnectionBanner {
  private readonly node = el('div', { class: 'conn-banner', attrs: { role: 'status' } });

  /** onClosed: the connection is gone for good (the transport is disposed); go back to the menu with the reason. */
  constructor(
    life: Lifetime,
    private readonly onClosed: (reason: string) => void,
  ) {
    show(this.node, false);
    document.body.append(this.node);
    life.onEnd(() => this.node.remove());
  }

  /** Returns false once the connection is gone for good; onClosed has then been called. */
  update(transport: GameTransport, time: number): boolean {
    const status = transport.connectionStatus();
    if (status === 'closed') {
      transport.dispose();
      this.onClosed(transport.closeReason);
      return false;
    }
    show(this.node, status === 'reconnecting');
    if (status === 'reconnecting') {
      const dots = '.'.repeat(1 + (Math.floor(time / 400) % 3));
      setText(this.node, `Conexiunea s-a întrerupt. Se reconectează${dots.padEnd(3)}`);
    }
    return true;
  }
}
