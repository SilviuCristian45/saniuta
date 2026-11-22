import { MAX_SNOWBALLS } from '@saniuta/shared';
import { el } from '../ui/el';
import { stickToRide } from './stick';
import './touch.css';
import type { InputSource, RideInput } from './InputSource';

export interface TouchOptions {
  /** Joystick on the right, snowball button on the left. */
  leftHanded: boolean;
}

/** How far the knob travels, as a fraction of the pad radius. */
const KNOB_TRAVEL = 0.6;

interface Offset {
  dx: number;
  dy: number;
}

/**
 * On-screen controls for phones and tablets (HTML over the canvas), held sideways: an analog
 * joystick on the left (sideways steers, up kicks off, down brakes), a snowball button on the
 * right showing how many are carried and, with power-ups on, a smaller button beside it showing the
 * power-up held. Every finger is tracked on its own.
 */
export class TouchInput implements InputSource {
  private readonly root: HTMLElement;
  private readonly pad: HTMLElement;
  private readonly knob: HTMLElement;
  private readonly fireBtn: HTMLElement;
  private readonly dots: HTMLElement[];
  private readonly powerBtn: HTMLElement;
  private readonly powerImg: HTMLImageElement;
  /** Fingers on the pad, oldest first; the newest one steers. */
  private readonly padPointers = new Map<number, Offset>();
  private readonly firePointers = new Set<number>();
  private fireQueued = false;
  private useQueued = false;
  private visible = true;

  constructor(opts: TouchOptions) {
    this.knob = el('div', { class: 'knob' });
    this.pad = el('div', { class: 'touch-pad', attrs: { 'aria-label': 'Direcție' } }, [this.knob]);
    this.dots = Array.from({ length: MAX_SNOWBALLS }, () => el('i'));
    this.fireBtn = el('div', { class: 'touch-fire', attrs: { role: 'button', 'aria-label': 'Aruncă bulgăre' } }, [
      el('span', { text: 'BULGĂRE' }),
      el('div', { class: 'dots' }, this.dots),
    ]);
    this.powerImg = el('img', { attrs: { alt: '' } });
    this.powerBtn = el('div', { class: 'touch-power empty', attrs: { role: 'button', 'aria-label': 'Folosește power-up-ul' } }, [this.powerImg]);
    this.powerBtn.hidden = true;
    this.root = el('div', { class: `touch-controls${opts.leftHanded ? ' left-handed' : ''}` }, [this.pad, this.fireBtn, this.powerBtn]);

    for (const target of [this.pad, this.fireBtn, this.powerBtn]) {
      // Keeps the touch from scrolling, zooming or reaching the game canvas underneath.
      target.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
      target.addEventListener('contextmenu', (e) => e.preventDefault());
    }
    this.pad.addEventListener('pointerdown', (e) => {
      this.pad.setPointerCapture(e.pointerId);
      this.padPointers.set(e.pointerId, this.offsetOf(e));
      this.refreshKnob();
    });
    this.pad.addEventListener('pointermove', (e) => {
      if (!this.padPointers.has(e.pointerId)) return;
      this.padPointers.set(e.pointerId, this.offsetOf(e));
      this.refreshKnob();
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
      this.pad.addEventListener(type, (e) => {
        if (this.padPointers.delete(e.pointerId)) this.refreshKnob();
      });
      this.fireBtn.addEventListener(type, (e) => {
        this.firePointers.delete(e.pointerId);
        this.fireBtn.classList.toggle('pressed', this.firePointers.size > 0);
      });
    }
    this.powerBtn.addEventListener('pointerdown', (e) => {
      this.powerBtn.setPointerCapture(e.pointerId);
      this.powerBtn.classList.add('pressed');
      if (this.visible) this.useQueued = true;
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
      this.powerBtn.addEventListener(type, () => this.powerBtn.classList.remove('pressed'));
    }
    this.fireBtn.addEventListener('pointerdown', (e) => {
      this.fireBtn.setPointerCapture(e.pointerId);
      this.firePointers.add(e.pointerId);
      this.fireBtn.classList.add('pressed');
      if (this.visible) this.fireQueued = true;
    });
    document.body.append(this.root);
  }

  poll(): RideInput | null {
    const fire = this.fireQueued;
    const use = this.useQueued;
    this.fireQueued = false;
    this.useQueued = false;
    const finger = this.visible ? this.steeringFinger() : undefined;
    if (!finger) return fire || use ? { steer: 0, throttle: 0, fire, use } : null;
    return { ...stickToRide(finger.dx, finger.dy), fire, use };
  }

  /** The button shows the snowballs carried (dimmed when there are none). */
  setSnowballs(count: number): void {
    this.dots.forEach((dot, i) => dot.classList.toggle('full', i < count));
    this.fireBtn.classList.toggle('empty', count === 0);
  }

  /**
   * The power-up button: hidden when the room has power-ups off; otherwise the icon of the one held
   * (an image URL), dimmed with nothing held (null).
   */
  setPowerUp(enabled: boolean, icon: string | null): void {
    this.powerBtn.hidden = !enabled;
    this.powerBtn.classList.toggle('empty', !icon);
    if (icon && this.powerImg.getAttribute('src') !== icon) this.powerImg.src = icon;
    this.powerImg.style.visibility = icon ? 'visible' : 'hidden';
  }

  /** Shown only while there is something to ride; hiding lets go of everything held. */
  setVisible(visible: boolean): void {
    if (visible === this.visible) return;
    this.visible = visible;
    this.root.classList.toggle('hidden', !visible);
    if (!visible) this.releaseAll();
  }

  /**
   * Top edge (CSS px) of the control at the right edge of the screen: the snowball button, or the
   * joystick in left-handed mode. Measured even while hidden (hiding keeps the layout).
   */
  rightControlTop(): number {
    return (this.root.classList.contains('left-handed') ? this.pad : this.fireBtn).getBoundingClientRect().top;
  }

  releaseAll(): void {
    this.fireQueued = false;
    this.useQueued = false;
    this.powerBtn.classList.remove('pressed');
    this.padPointers.clear();
    this.firePointers.clear();
    this.fireBtn.classList.remove('pressed');
    this.refreshKnob();
  }

  destroy(): void {
    this.root.remove();
  }

  private steeringFinger(): Offset | undefined {
    let last: Offset | undefined;
    for (const p of this.padPointers.values()) last = p;
    return last;
  }

  /** Finger offset from the pad's center, in pad radii. */
  private offsetOf(e: PointerEvent): Offset {
    const rect = this.pad.getBoundingClientRect();
    const r = rect.width / 2;
    return { dx: (e.clientX - (rect.left + r)) / r, dy: (e.clientY - (rect.top + r)) / r };
  }

  private refreshKnob(): void {
    const last = this.steeringFinger();
    this.pad.classList.toggle('active', !!last);
    if (!last) {
      this.knob.style.transform = '';
      return;
    }
    const r = this.pad.getBoundingClientRect().width / 2;
    const len = Math.hypot(last.dx, last.dy);
    const k = len > KNOB_TRAVEL ? KNOB_TRAVEL / len : 1;
    this.knob.style.transform = `translate(${last.dx * k * r}px, ${last.dy * k * r}px)`;
  }
}
