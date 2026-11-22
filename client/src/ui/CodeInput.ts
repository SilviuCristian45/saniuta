import { normalizeRoomCode, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '@saniuta/shared';
import { keepInViewOnFocus } from './html';

export const CODE_HINT = 'Codul are doar litere și cifre, fără 0, O, 1, I, L.';

export interface CodeInputHandlers {
  /** All six boxes hold valid characters. */
  onComplete(code: string): void;
  /** A rejected character or paste (with the reason), or '' once the input is fine again. */
  onProblem(message: string): void;
}

/**
 * Six one-letter boxes, verification-code style: typing moves to the next box, Backspace
 * goes back, a paste fills them all (an invite link works too), letters are upper-cased
 * and characters outside the room code alphabet are rejected.
 */
export class CodeInput {
  readonly boxes: HTMLInputElement[] = [];
  readonly element: HTMLDivElement;

  constructor(private readonly handlers: CodeInputHandlers) {
    const wrap = document.createElement('div');
    wrap.className = 'code-boxes';
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
      const box = document.createElement('input');
      box.className = 'field code-box';
      box.maxLength = 2; // room for the replacement character before it is trimmed to one
      box.autocomplete = 'off';
      box.spellcheck = false;
      // Phone keyboards: letters (upper case), no autocorrect or suggestions over the boxes.
      box.setAttribute('autocapitalize', 'characters');
      box.setAttribute('autocorrect', 'off');
      box.setAttribute('inputmode', 'text');
      box.setAttribute('enterkeyhint', 'go');
      box.setAttribute('aria-label', `Caracterul ${i + 1} din cod`);
      box.addEventListener('input', () => this.onInput(i));
      box.addEventListener('keydown', (e) => this.onKey(i, e));
      box.addEventListener('paste', (e) => this.onPaste(e));
      box.addEventListener('focus', () => box.select());
      keepInViewOnFocus(box);
      wrap.appendChild(box);
      this.boxes.push(box);
    }
    this.element = wrap;
  }

  get code(): string {
    return this.boxes.map((b) => b.value).join('');
  }

  setCode(code: string): void {
    this.boxes.forEach((b, i) => (b.value = code[i] ?? ''));
  }

  setDisabled(disabled: boolean): void {
    for (const b of this.boxes) b.disabled = disabled;
  }

  focus(): void {
    const firstEmpty = this.boxes.find((b) => !b.value) ?? this.boxes[this.boxes.length - 1]!;
    firstEmpty.focus({ preventScroll: true });
  }

  private onInput(i: number): void {
    const box = this.boxes[i]!;
    // Keep only the newest character (typing over a filled box replaces it).
    const ch = normalizeRoomCode(box.value).slice(-1);
    if (!ch) {
      box.value = '';
      return;
    }
    if (!ROOM_CODE_ALPHABET.includes(ch)) {
      box.value = '';
      this.reject(box, `„${ch}” nu poate apărea în cod. ${CODE_HINT}`);
      return;
    }
    box.value = ch;
    this.handlers.onProblem('');
    this.boxes[i + 1]?.focus();
    this.checkComplete();
  }

  private onKey(i: number, e: KeyboardEvent): void {
    const box = this.boxes[i]!;
    if (e.key === 'Backspace' && !box.value && i > 0) {
      e.preventDefault();
      const prev = this.boxes[i - 1]!;
      prev.value = '';
      prev.focus();
    } else if (e.key === 'ArrowLeft' && i > 0) {
      e.preventDefault();
      this.boxes[i - 1]!.focus();
    } else if (e.key === 'ArrowRight' && i < this.boxes.length - 1) {
      e.preventDefault();
      this.boxes[i + 1]!.focus();
    } else if (e.key === 'Enter') {
      this.checkComplete();
    }
  }

  private onPaste(e: ClipboardEvent): void {
    e.preventDefault();
    let text = e.clipboardData?.getData('text') ?? '';
    // A whole invite link pastes as its code.
    const fromLink = /[?&]room=([^&#\s]+)/i.exec(text);
    if (fromLink) text = fromLink[1]!;
    const code = normalizeRoomCode(text).replace(/-/g, '');
    const bad = [...code].filter((ch) => !ROOM_CODE_ALPHABET.includes(ch));
    if (bad.length > 0) {
      this.reject(this.boxes[0]!, `Codul lipit conține „${[...new Set(bad)].join('')}”. ${CODE_HINT}`);
      return;
    }
    if (code.length !== ROOM_CODE_LENGTH) {
      this.reject(this.boxes[0]!, `Codul are ${ROOM_CODE_LENGTH} caractere (ai lipit ${code.length}).`);
      return;
    }
    this.setCode(code);
    this.handlers.onProblem('');
    this.boxes[this.boxes.length - 1]!.focus();
    this.checkComplete();
  }

  private reject(box: HTMLInputElement, message: string): void {
    this.handlers.onProblem(message);
    box.classList.remove('invalid');
    void box.offsetWidth; // restart the shake animation
    box.classList.add('invalid');
    window.setTimeout(() => box.classList.remove('invalid'), 600);
  }

  private checkComplete(): void {
    const code = this.code;
    if (code.length === ROOM_CODE_LENGTH) this.handlers.onComplete(code);
  }
}
