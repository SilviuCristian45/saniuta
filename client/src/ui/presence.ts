import type { GameState } from '@saniuta/shared';
import type { GameTransport } from '../net/GameTransport';
import { PLAYER_COLORS } from '../render/colors';
import { showToast, type ToastOptions } from './Toasts';

// Toasts about the other people in the room (joined, left, dropped, back, new host), worked out
// by comparing each state with the previous one. Bots come and go by the host's hand: no toasts.

interface Seen {
  name: string;
  slot: number;
  isBot: boolean;
  connected: boolean;
  left: boolean;
}

interface Snapshot {
  hostId: string;
  players: Map<string, Seen>;
}

/** Kept per transport, so the lobby and the game scene continue from the same snapshot. */
const snapshots = new WeakMap<GameTransport, Snapshot>();

/** Called by the lobby and game scenes every frame, after transport.update(). */
export function notifyPresence(transport: GameTransport): void {
  const next = snapshot(transport.getState());
  const prev = snapshots.get(transport);
  snapshots.set(transport, next);
  // The first look at a room (joining, resuming) has nothing to compare with.
  if (prev) for (const toast of presenceToasts(prev, next, transport.playerId)) showToast(toast);
}

function snapshot(state: Readonly<GameState>): Snapshot {
  const players = new Map<string, Seen>();
  for (const p of Object.values(state.players)) {
    players.set(p.id, { name: p.name, slot: p.slot, isBot: p.isBot, connected: p.connected, left: p.left });
  }
  return { hostId: state.hostId, players };
}

function presenceToasts(prev: Snapshot, next: Snapshot, me: string): ToastOptions[] {
  const toasts: ToastOptions[] = [];
  const about = (p: Seen, message: string) => toasts.push({ lead: p.name, message, accent: PLAYER_COLORS[p.slot] });

  for (const [id, p] of next.players) {
    if (id === me || p.isBot) continue;
    const before = prev.players.get(id);
    if (!before) about(p, 'a intrat în joc');
    else if (p.left && !before.left) about(p, 'a ieșit din joc');
    else if (!p.left && before.connected && !p.connected) about(p, 's-a deconectat...');
    else if (!p.left && !before.connected && p.connected) about(p, 'a revenit');
  }
  // Removed in the lobby. Players already shown as left are only being cleared out on the way back to the lobby.
  for (const [id, p] of prev.players) {
    if (id !== me && !p.isBot && !p.left && !next.players.has(id)) about(p, 'a ieșit din joc');
  }

  if (next.hostId && next.hostId !== prev.hostId) {
    const host = next.players.get(next.hostId);
    if (next.hostId === me) toasts.push({ message: 'Acum tu ești hostul.' });
    else if (host) about(host, 'e acum host');
  }
  return toasts;
}
