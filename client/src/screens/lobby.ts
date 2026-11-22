import {
  BOT_LEVEL_NAMES,
  BOT_LEVELS,
  canStart,
  FINISH_GRACE_TICKS,
  MAX_PLAYERS,
  MAX_SNOWBALLS,
  MIN_PLAYERS_TO_START,
  nextBotLevel,
  POINTS_BY_PLACE,
  ROUND_OPTIONS,
  sortedPlayers,
  TICK_RATE,
  TRACK_BUNICII,
  TRACK_IDS,
  TRACK_LUPULUI,
  TRACK_NEBUNILOR,
  TRACK_RANDOM,
  trackName,
  type GameState,
} from '@saniuta/shared';
import { isTouch } from '../device';
import type { GameTransport } from '../net/GameTransport';
import { ConnectionBanner } from '../ui/ConnectionBanner';
import { el } from '../ui/el';
import { button, setButtonStyle, setText, show } from '../ui/html';
import { fullscreenOnFirstTap } from '../ui/orientation';
import { notifyPresence } from '../ui/presence';
import { openSettings } from '../ui/settingsDialog';
import type { ScreenHost } from './host';

interface PlayerRow {
  row: HTMLElement;
  avatar: HTMLImageElement;
  name: HTMLElement;
  host: HTMLElement;
  /** The bot's level; the host cycles it with a click. */
  level: HTMLButtonElement;
  /** Id of the bot shown in this row ('' = not a bot). */
  botId: string;
}

/** How hard each track is, under its name on the lobby's track buttons. */
const TRACK_HINTS: Record<number, string> = {
  [TRACK_BUNICII]: 'ușoară',
  [TRACK_LUPULUI]: 'medie',
  [TRACK_NEBUNILOR]: 'grea',
  [TRACK_RANDOM]: 'alta la fiecare manșă',
};

const COPIED_MS = 1500;
/** Phones share the invite through the system sheet (WhatsApp...); desktops copy the link. */
const SHARE_LABEL = isTouch ? 'Trimite invitația' : 'Copiază link';

/** Room code and invite link, the players, and the host's track / runs / bots / Start. */
export class LobbyScreen {
  private rows: PlayerRow[] = [];
  private trackButtons: HTMLButtonElement[] = [];
  private roundButtons: HTMLButtonElement[] = [];
  private levelButtons: HTMLButtonElement[] = [];
  private addBotButton!: HTMLButtonElement;
  private removeBotButton!: HTMLButtonElement;
  private startButton!: HTMLButtonElement;
  private shareButton!: HTMLButtonElement;
  private copyReset = 0;
  /** The switch to the game is under way. */
  private leaving = false;
  private hint!: HTMLElement;
  private countText!: HTMLElement;
  private readonly banner: ConnectionBanner;

  constructor(
    private readonly host: ScreenHost,
    private readonly transport: GameTransport,
  ) {
    fullscreenOnFirstTap();
    host.mount('lobby', [el('div', { class: 'lobby-grid' }, [this.createHead(), this.createPlayers(), this.createSide()])]);
    this.banner = new ConnectionBanner(host.life, (message) => host.go({ to: 'menu', data: { message } }));
    // A match started while the page was in the background: switch as soon as it is shown again,
    // not only from update() (no frames run while hidden).
    document.addEventListener('visibilitychange', this.onVisible);
    host.life.onEnd(() => {
      document.removeEventListener('visibilitychange', this.onVisible);
      window.clearTimeout(this.copyReset);
    });
  }

  private readonly onVisible = () => {
    if (!document.hidden && this.host.isActive()) this.enterGameIfStarted();
  };

  /** True (and the game starting) once the room has left the lobby. */
  private enterGameIfStarted(): boolean {
    if (this.leaving) return true;
    if (this.transport.getState().phase === 'lobby') return false;
    this.leaving = true; // the handler and update() may both see it before the switch happens
    this.host.go({ to: 'game', transport: this.transport });
    return true;
  }

  /** An offline room has no code worth sharing: nobody else can join it. */
  private createHead(): HTMLElement {
    const online = this.transport.online;
    this.shareButton = button(SHARE_LABEL, () => void this.share(), 'secondary', 'small');
    show(this.shareButton, online);
    return el('div', { class: 'lobby-head' }, [
      el('div', { class: 'label', text: online ? 'Codul jocului' : 'Joc offline' }),
      el('div', { class: 'room-code', text: online ? this.transport.getState().code : 'cu boți' }),
      this.shareButton,
      online ? el('div', { class: 'share-hint', text: 'Trimite linkul prietenilor ca să intre' }) : null,
    ]);
  }

  private createPlayers(): HTMLElement {
    this.countText = el('div', { class: 'count' });
    const list = el('ul', { class: 'player-rows' });
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const avatar = el('img', { attrs: { alt: '' } });
      const name = el('span', { class: 'name' });
      const host = el('span', { class: 'host-tag', text: 'host' });
      const level = el('button', { class: 'bot-level', attrs: { type: 'button' } });
      const row = el('li', { class: 'player-row' }, [avatar, name, host, level]);
      list.append(row);
      const entry: PlayerRow = { row, avatar, name, host, level, botId: '' };
      level.addEventListener('click', () => this.cycleBotLevel(entry.botId));
      this.rows.push(entry);
    }
    const lateSecs = FINISH_GRACE_TICKS / TICK_RATE;
    const rules = [
      `Puncte pe manșă după locul la sosire: ${POINTS_BY_PLACE.join(' / ')}.`,
      `După primul sosit mai sunt ${lateSecs} s; cine n-a ajuns ia jumătate din punctele locului.`,
      `Ia bulgări din grămezi (maxim ${MAX_SNOWBALLS}) și aruncă-i în ceilalți ca să-i încetinești.`,
      'Ocolește brazii și stâncile; sari de pe trambuline.',
    ];
    return el('div', { class: 'lobby-players' }, [this.countText, list, el('p', { class: 'rules', text: rules.join('\n') })]);
  }

  private createSide(): HTMLElement {
    this.trackButtons = TRACK_IDS.map((trackId) => {
      const b = el('button', { class: 'btn secondary track-btn', attrs: { type: 'button' } }, [
        el('span', { class: 'track-name', text: trackName(trackId) }),
        el('span', { class: 'track-hint', text: TRACK_HINTS[trackId] ?? '' }),
      ]);
      b.addEventListener('click', () => this.transport.send({ type: 'track', trackId }));
      return b;
    });
    this.roundButtons = ROUND_OPTIONS.map((rounds) => {
      const b = button(String(rounds), () => this.transport.send({ type: 'rounds', rounds }));
      b.classList.add('round-btn');
      return b;
    });
    this.levelButtons = BOT_LEVELS.map((level) => {
      const b = button(BOT_LEVEL_NAMES[level]!, () => this.transport.send({ type: 'botLevel', level }));
      b.classList.add('level-btn');
      return b;
    });
    this.addBotButton = button('+Bot', () => this.transport.send({ type: 'addBot' }));
    this.removeBotButton = button('-Bot', () => this.transport.send({ type: 'removeBot' }));
    this.startButton = button('Start', () => this.transport.send({ type: 'start' }), 'primary', 'medium');
    this.hint = el('div', { class: 'hint' });
    const leave = button('Ieși din joc', () => this.leave(), 'secondary', 'small');
    return el('div', { class: 'lobby-side' }, [
      el('div', { class: 'label', text: 'Pârtia' }),
      el('div', { class: 'track-grid' }, this.trackButtons),
      el('div', { class: 'label', text: 'Manșe' }),
      el('div', { class: 'btn-row' }, this.roundButtons),
      el('div', { class: 'label', text: 'Nivel boți noi' }),
      el('div', { class: 'btn-row' }, this.levelButtons),
      el('div', { class: 'btn-row' }, [this.addBotButton, this.removeBotButton]),
      this.startButton,
      this.hint,
      el('div', { class: 'btn-row' }, [isTouch ? button('Setări', () => openSettings(), 'secondary', 'small') : null, leave]),
    ]);
  }

  /** Every frame: the time (ms, for the reconnecting dots) and the frame's duration. */
  update(time: number, delta: number): void {
    if (!this.banner.update(this.transport, time)) return;
    this.transport.update(delta);
    notifyPresence(this.transport);
    if (this.enterGameIfStarted()) return;
    const state = this.transport.getState();
    this.syncPlayers(state);
    this.syncControls(state);
  }

  private syncPlayers(state: Readonly<GameState>): void {
    const players = sortedPlayers(state as GameState);
    setText(this.countText, `Săniuțe ${players.length}/${MAX_PLAYERS}`);
    this.rows.forEach((row, i) => {
      const p = players[i];
      row.avatar.style.visibility = p ? 'visible' : 'hidden';
      show(row.host, !!p && p.id === state.hostId);
      row.row.classList.toggle('empty', !p);
      row.row.classList.toggle('away', !!p && !p.connected);
      row.botId = p?.isBot ? p.id : '';
      show(row.level, !!row.botId);
      if (!p) {
        setText(row.name, 'loc liber');
        return;
      }
      const src = this.host.avatarUrl(p.slot);
      if (row.avatar.getAttribute('src') !== src) row.avatar.src = src;
      setText(row.name, p.id === this.transport.playerId ? `${p.name} (tu)` : p.name);
      if (p.isBot) this.syncLevelTag(row.level, p.botLevel, state.hostId === this.transport.playerId);
    });
  }

  private syncControls(state: Readonly<GameState>): void {
    const me = this.transport.playerId;
    const isHost = state.hostId === me;
    TRACK_IDS.forEach((trackId, i) => {
      const b = this.trackButtons[i]!;
      setButtonStyle(b, state.trackId === trackId ? 'primary' : 'secondary');
      b.disabled = !isHost && state.trackId !== trackId;
    });
    ROUND_OPTIONS.forEach((rounds, i) => {
      const b = this.roundButtons[i]!;
      setButtonStyle(b, state.roundsTotal === rounds ? 'primary' : 'secondary');
      b.disabled = !isHost && state.roundsTotal !== rounds;
    });
    BOT_LEVELS.forEach((level, i) => {
      const b = this.levelButtons[i]!;
      setButtonStyle(b, state.botLevel === level ? 'primary' : 'secondary');
      b.disabled = !isHost && state.botLevel !== level;
    });
    const players = Object.values(state.players);
    show(this.addBotButton, isHost);
    this.addBotButton.disabled = players.length >= MAX_PLAYERS;
    show(this.removeBotButton, isHost);
    this.removeBotButton.disabled = !players.some((p) => p.isBot);
    show(this.startButton, isHost);
    this.startButton.disabled = !canStart(state as GameState, me);
    if (!isHost) setText(this.hint, 'Așteaptă ca hostul să pornească meciul.');
    else if (players.length < MIN_PLAYERS_TO_START) setText(this.hint, `Minim ${MIN_PLAYERS_TO_START} săniuțe pentru Start: adaugă un bot.`);
    else setText(this.hint, '');
  }

  private syncLevelTag(tag: HTMLButtonElement, botLevel: number, isHost: boolean): void {
    const label = BOT_LEVEL_NAMES[botLevel] ?? '';
    setText(tag, label);
    for (const level of BOT_LEVELS) tag.classList.toggle(`lvl-${level}`, botLevel === level);
    tag.disabled = !isHost;
    tag.title = isHost ? `Bot ${label}: clic ca să schimbi nivelul` : `Bot, nivel ${label}`;
  }

  /** Easy -> medium -> hard -> easy; the server checks that we are the host and still in the lobby. */
  private cycleBotLevel(botId: string): void {
    const bot = this.transport.getState().players[botId];
    if (bot?.isBot) this.transport.send({ type: 'setBotLevel', botId, level: nextBotLevel(bot.botLevel) });
  }

  private async share(): Promise<void> {
    const url = new URL(window.location.href);
    const code = this.transport.getState().code;
    url.search = `?room=${code}`;
    url.hash = '';
    if (isTouch && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: 'Săniuța la vale', text: `Hai la săniuș! Intră în jocul meu (cod ${code}):`, url: url.toString() });
        return;
      } catch (err) {
        // Closing the share sheet is a choice, not a failure; anything else falls back to copying.
        if (err instanceof DOMException && err.name === 'AbortError') return;
      }
    }
    const ok = await copyText(url.toString());
    this.shareButton.textContent = ok ? 'Copiat!' : 'Nu s-a putut copia';
    window.clearTimeout(this.copyReset);
    this.copyReset = window.setTimeout(() => (this.shareButton.textContent = SHARE_LABEL), COPIED_MS);
  }

  /** For good, no confirmation: the seat is freed at once. */
  private leave(): void {
    this.transport.dispose();
    this.host.go({ to: 'menu', data: {} });
  }
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API needs a secure context; fall back to the legacy copy command.
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    } finally {
      area.remove();
    }
  }
}
