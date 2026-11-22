import { MAX_PLAYERS, sanitizeName } from '@saniuta/shared';
import { isTouch } from '../device';
import type { GameTransport } from '../net/GameTransport';
import { abandonResumableRoom, createOfflineRoom, createRoom, joinRoom, onlineEnabled, resumeRoom, RoomError } from '../net/rooms';
import { getSetting, setSetting } from '../settings';
import { load } from '../storage';
import { CodeInput } from '../ui/CodeInput';
import { openDialog } from '../ui/dialog';
import { el } from '../ui/el';
import { button, setButtonStyle, title } from '../ui/html';
import { openSettings } from '../ui/settingsDialog';
import type { MenuData, ScreenHost } from './host';

/** Two obvious choices: create a game, or join a friend's by code. Offline play with bots is the third. */
export class MenuScreen {
  private readonly status: HTMLElement;
  private codeProblem!: HTMLElement;
  private codeInput!: CodeInput;
  private createButton!: HTMLButtonElement;
  private readonly offlineButton: HTMLButtonElement;
  private busy = false;

  constructor(
    private readonly host: ScreenHost,
    opts: MenuData,
  ) {
    this.status = el('p', { class: 'message status', text: opts.message ?? '' });
    this.offlineButton = button('Joacă offline cu boți', () => this.onPlayOffline(), onlineEnabled ? 'secondary' : 'primary', 'medium');
    host.mount('menu', [
      title(true),
      this.playingAs(),
      el('div', { class: 'cards' }, [this.createCreateCard(), this.createJoinCard()]),
      this.status,
      // One row, so a phone held sideways sees all of it.
      el('div', { class: 'menu-footer' }, [this.offlineButton, isTouch ? button('Setări', () => openSettings(), 'secondary', 'small') : null]),
      isTouch ? null : this.cornerToggle(),
    ]);

    if (opts.switchFrom !== undefined && opts.invite) this.askSwitch(opts.switchFrom, opts.invite);
    else if (opts.resume) this.resume();
    else if (opts.invite) this.joinInvite(opts.invite);
    else if (!isTouch && onlineEnabled) this.codeInput.focus();
  }

  private resume(): void {
    void this.connect(resumeRoom(), 'Se reconectează la joc...');
  }

  /** A link to another room while this tab still has a game: the link wins, once confirmed. */
  private askSwitch(current: string, invite: string): void {
    const from = current ? ` (${current})` : '';
    const stay = () => {
      dialog.close();
      // Whatever happens, a later reload should not ask again.
      forgetInviteInUrl();
      this.resume();
    };
    const dialog = openDialog(
      [
        el('h2', { text: `Ieși din jocul curent${from}
și intri în ${invite}?` }),
        el('div', { class: 'btn-row' }, [
          button(
            `Da, intru în ${invite}`,
            () => {
              dialog.close();
              this.setStatus('Ieși din jocul curent...', true);
              void abandonResumableRoom().then(() => this.joinInvite(invite));
            },
            'primary',
          ),
          button('Nu, rămân', stay),
        ]),
      ],
      stay,
    );
  }

  /** Desktop: "Efecte reduse" in the corner (touch devices have it under "Setări"). */
  private cornerToggle(): HTMLElement {
    const label = () => `Efecte reduse: ${getSetting('reducedEffects') ? 'da' : 'nu'}`;
    const node = button(
      label(),
      () => {
        setSetting('reducedEffects', !getSetting('reducedEffects'));
        node.textContent = label();
      },
      'secondary',
      'small',
    );
    return el('div', { class: 'corner-toggle' }, [node]);
  }

  /** "Joci ca {nume} · schimbă" */
  private playingAs(): HTMLElement {
    const change = el('button', { class: 'link', text: '· schimbă', attrs: { type: 'button' } });
    change.addEventListener('click', () => {
      if (!this.busy) this.host.go({ to: 'name', data: { edit: true } });
    });
    return el('p', { class: 'playing-as' }, [`Joci ca ${this.playerName()} `, change]);
  }

  private createCreateCard(): HTMLElement {
    this.createButton = button('Creează', () => this.onCreateRoom(), onlineEnabled ? 'primary' : 'secondary', 'medium');
    this.createButton.classList.add('card-action');
    const card = el('div', { class: 'card clickable' }, [
      el('h2', { text: 'Creează joc' }),
      el('p', { text: `Invită până la ${MAX_PLAYERS - 1} prieteni la săniuș` }),
      this.createButton,
      onlineEnabled ? null : el('p', { class: 'soon', text: 'Jocul online vine curând' }),
    ]);
    card.addEventListener('click', (e) => {
      if (e.target !== this.createButton) this.onCreateRoom();
    });
    return card;
  }

  private createJoinCard(): HTMLElement {
    this.codeProblem = el('p', { class: 'problem' });
    this.codeInput = new CodeInput({
      onComplete: (code) => this.join(code),
      onProblem: (message) => (this.codeProblem.textContent = message),
    });
    return el('div', { class: 'card' }, [
      el('h2', { text: 'Intră la un prieten' }),
      el('p', { text: 'Scrie codul de 6 caractere primit' }),
      this.codeInput.element,
      this.codeProblem,
    ]);
  }

  private playerName(): string {
    return sanitizeName(load('name') ?? '');
  }

  private onCreateRoom(): void {
    void this.connect(createRoom(this.playerName()), 'Se creează jocul...');
  }

  private onPlayOffline(): void {
    void this.connect(createOfflineRoom(this.playerName()), 'Se pregătește pârtia...');
  }

  private join(code: string): void {
    void this.connect(joinRoom(code, this.playerName()), `Intri în ${code}...`);
  }

  private joinInvite(code: string): void {
    this.codeInput.setCode(code);
    // Whatever happens, a later reload of this page should not retry the invite.
    forgetInviteInUrl();
    this.join(code);
  }

  private async connect(pending: Promise<GameTransport>, message: string): Promise<void> {
    if (this.busy) return;
    this.setBusy(true);
    this.setStatus(message, true);
    try {
      const transport = await pending;
      if (!this.host.isActive()) {
        transport.dispose();
        return;
      }
      this.host.go({ to: 'lobby', transport });
    } catch (err) {
      this.setBusy(false);
      this.setStatus(err instanceof Error ? err.message : 'Nu s-a putut intra în joc.', false);
      // No server (or a full one): highlight "Joacă offline cu boți" right under the message.
      if (err instanceof RoomError && err.offline) setButtonStyle(this.offlineButton, 'primary');
    }
  }

  private setStatus(text: string, info: boolean): void {
    this.status.textContent = text;
    this.status.classList.toggle('info', info);
  }

  private setBusy(busy: boolean): void {
    this.busy = busy;
    this.createButton.disabled = busy;
    this.offlineButton.disabled = busy;
    this.codeInput.setDisabled(busy);
  }
}

function forgetInviteInUrl(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete('room');
  // Flag options stay flags (?debug, not ?debug=).
  url.search = url.searchParams.toString().replace(/=(?=&|$)/g, '');
  window.history.replaceState(null, '', url);
}
