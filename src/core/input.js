// Keyboard / mouse / pointer-lock input with per-frame edge detection, rebindable actions and joysticks.
import { keysFor, profileFor, padName } from './bindings.js';

const THREE_clamp = (v) => Math.max(0, Math.min(1, v));
class Input {
  constructor() {
    this.keys = new Set();
    this.pressed = new Set();   // went down this frame
    this.mouse = { dx: 0, dy: 0, x: 0, y: 0, buttons: 0, wheel: 0 };
    this.clicked = new Set();
    this.locked = false;
    this.enabled = true;
    this.padRest = {}; this.padMoved = {};
    addEventListener('gamepadconnected', (e) => { this.padRest[e.gamepad.id] = null; this.onPadConnected?.(e.gamepad, padName(e.gamepad.id)); });
    addEventListener('keydown', e => {
      if (e.repeat) return;
      if (!this.enabled) return;
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Backspace'].includes(e.code) && !/INPUT|TEXTAREA/.test(e.target?.tagName)) e.preventDefault();
      this.keys.add(e.code); this.pressed.add(e.code);
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.mouse.buttons = 0; });
    addEventListener('mousemove', e => {
      this.mouse.x = e.clientX; this.mouse.y = e.clientY;
      this.mouse.dx += e.movementX; this.mouse.dy += e.movementY;
    });
    addEventListener('mousedown', e => { this.mouse.buttons |= (1 << e.button); this.clicked.add(e.button); });
    addEventListener('mouseup', e => { this.mouse.buttons &= ~(1 << e.button); });
    addEventListener('wheel', e => { this.mouse.wheel += Math.sign(e.deltaY); }, { passive: true });
    addEventListener('contextmenu', e => e.preventDefault());
    // the browser swallows Esc while the mouse is captured and just releases it; report that so the game can open its menu
    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = !!document.pointerLockElement;
      if (was && !this.locked && performance.now() - (this.selfUnlock || 0) > 250) this.onLockLost?.();
    });
  }

  down(code) { return this.enabled && this.keys.has(code); }
  hit(code) { return this.enabled && this.pressed.has(code); }
  button(b) { return this.enabled && (this.mouse.buttons & (1 << b)) !== 0; }
  click(b) { return this.enabled && this.clicked.has(b); }

  lock(el) {
    if (!document.pointerLockElement) {
      try { const p = el.requestPointerLock({ unadjustedMovement: true }); if (p && p.catch) p.catch(() => el.requestPointerLock()); }
      catch { el.requestPointerLock(); }
    }
  }
  unlock() { if (document.pointerLockElement) { this.selfUnlock = performance.now(); document.exitPointerLock(); } }

  /** Action held (rebindable key or joystick/gamepad button). */
  act(id) {
    if (!this.enabled) return false;
    for (const k of keysFor(id)) if (this.keys.has(k)) return true;
    return !!this.pad?.down(id);
  }
  /** Action went down this frame. */
  actHit(id) {
    if (!this.enabled) return false;
    for (const k of keysFor(id)) if (this.pressed.has(k)) return true;
    return !!this.pad?.hit(id);
  }

  /** The connected joystick / gamepad that is used (the last one that moved, else the first). */
  gamepads() { return navigator.getGamepads ? [...navigator.getGamepads()].filter(g => g && g.connected && g.axes.length >= 2) : []; }

  /**
   * Gamepad / joystick (Gamepad API), polled once per frame through the device's profile (bindings.js):
   * flight axes pitch/yaw/roll/throttle and buttons, hat directions or axis positions bound to actions.
   */
  pollPad() {
    const pads = this.gamepads();
    if (!pads.length) { this.pad = null; return; }
    const gp = pads.find(p => p.id === this.lastPadId) || pads[0];
    const prof = profileFor(gp);
    const dz = (v, d) => Math.abs(v || 0) < d ? 0 : (v - Math.sign(v) * d) / (1 - d);
    const std = gp.mapping === 'standard';
    const ax = gp.axes, btn = gp.buttons;
    // an axis only counts once it has moved: unused axes of some sticks sit at 0 or ±1 and would pin the throttle
    const rest = this.padRest[gp.id] ||= ax.slice();
    const moved = this.padMoved[gp.id] ||= new Set();
    ax.forEach((v, i) => { if (Math.abs(v - rest[i]) > 0.25) moved.add(i); });
    const isOn = (bd) => bd.b != null ? !!(btn[bd.b]?.pressed || (btn[bd.b]?.value || 0) > 0.3) : Math.abs((ax[bd.a] ?? 9) - bd.v) < (bd.hat ? 0.1 : 0.35);
    const now = {};
    for (const [id, list] of Object.entries(prof.buttons || {})) now[id] = (list || []).some(isOn);
    const prev = this.padPrevAct || {};
    const axis = (k, d) => { const A = prof.axes?.[k]; if (!A || ax[A.i] == null || !moved.has(A.i)) return 0; const v = dz(ax[A.i], d); return A.inv ? -v : v; };
    const dzs = prof.deadzone ?? (std ? 0.12 : 0.06);
    const pad = { id: gp.id, std, gp, prof, down: (id) => !!now[id], hit: (id) => !!now[id] && !prev[id] };
    pad.yaw = axis('yaw', dzs); pad.pitch = axis('pitch', dzs); pad.roll = axis('roll', Math.max(dzs, 0.1));
    pad.look = std && prof.look != null ? dz(ax[prof.look], 0.12) : 0;
    const T = prof.axes?.throttle;
    if (T && ax[T.i] != null && moved.has(T.i)) pad.throttle = THREE_clamp((T.inv ? 1 + ax[T.i] : 1 - ax[T.i]) / 2);
    this.padPrevAct = now;
    // the pad counts as "in use" once a stick moves or a button is pressed
    if (Math.abs(pad.yaw) + Math.abs(pad.pitch) + Math.abs(pad.roll) > 0.05 || btn.some(b => b?.pressed)) { this.padActive = performance.now(); this.lastPadId = gp.id; }
    pad.active = this.padActive && performance.now() - this.padActive < 4000;
    this.pad = pad;
  }

  endFrame() {
    this.pressed.clear(); this.clicked.clear();
    this.mouse.dx = 0; this.mouse.dy = 0; this.mouse.wheel = 0;
  }
}

export const input = new Input();
