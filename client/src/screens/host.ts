import type { GameTransport } from '../net/GameTransport';
import type { Child } from '../ui/el';
import type { Lifetime } from '../ui/html';

// The HTML screens (intro, name, menu, lobby) live inside Phaser scenes; what they need from the
// scene goes through a ScreenHost (scenes/phaserHost.ts).

export interface MenuData {
  /** Code from a ?room= invite link: joined right away. */
  invite?: string;
  /** Shown on arrival, e.g. an invalid invite link or a lost connection. */
  message?: string;
  /** The tab was reloaded during an online game: reconnect to that room right away. */
  resume?: boolean;
  /** Opened a link to another room while in this one ('' = code unknown): ask before switching. */
  switchFrom?: string;
}

export interface NameData extends MenuData {
  /** Opened from the menu's "schimbă": go straight to the input, prefilled. */
  edit?: boolean;
}

export type Route =
  | { to: 'intro'; data: MenuData }
  | { to: 'name'; data: NameData }
  | { to: 'menu'; data: MenuData }
  | { to: 'lobby'; transport: GameTransport }
  | { to: 'game'; transport: GameTransport };

export interface ScreenHost {
  /** The screen's lifetime: ends when the host moves on. */
  readonly life: Lifetime;
  go(route: Route): void;
  /** Still the screen being shown (async work may finish after the player moved on). */
  isActive(): boolean;
  /** Mounts the screen's HTML over the backdrop, for the screen's lifetime. */
  mount(className: string, children: Child[]): HTMLElement;
  /** A small picture of the sled of a slot, for the lobby rows. */
  avatarUrl(slot: number): string;
}
