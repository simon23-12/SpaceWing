// Keyboard / mouse / pointer-lock input with per-frame edge detection.
class Input {
  constructor() {
    this.keys = new Set();
    this.pressed = new Set();   // went down this frame
    this.mouse = { dx: 0, dy: 0, x: 0, y: 0, buttons: 0, wheel: 0 };
    this.clicked = new Set();
    this.locked = false;
    this.enabled = true;
    addEventListener('keydown', e => {
      if (e.repeat) return;
      if (!this.enabled) return;
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
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
    document.addEventListener('pointerlockchange', () => { this.locked = !!document.pointerLockElement; });
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
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

  /**
   * Gamepad / joystick (Gamepad API), polled once per frame.
   * Standard mapping (Xbox/PlayStation): left stick = pitch/yaw, right stick X = roll, RT = fire, LT = missile.
   * Flight sticks (non-standard): axis 0/1 = yaw/pitch, twist = roll, throttle lever = throttle, trigger = fire.
   */
  pollPad() {
    const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
    const gp = pads.find(p => p.connected && p.axes.length >= 2);
    if (!gp) { this.pad = null; return; }
    const dz = (v, d = 0.12) => Math.abs(v || 0) < d ? 0 : (v - Math.sign(v) * d) / (1 - d);
    const std = gp.mapping === 'standard';
    const down = gp.buttons.map(b => !!b?.pressed);
    const prev = this.padPrev || [];
    const pad = { id: gp.id, std, down, hit: (i) => down[i] && !prev[i], val: (i) => gp.buttons[i]?.value || 0 };
    if (std) {
      pad.yaw = dz(gp.axes[0]); pad.pitch = dz(gp.axes[1]); pad.roll = dz(gp.axes[2]); pad.look = dz(gp.axes[3]);
      pad.fire = pad.val(7) > 0.3; pad.missile = pad.hit(6); pad.boost = down[0] || down[10];
      pad.throttleDelta = (down[5] || down[12] ? 1 : 0) - (down[4] || down[13] ? 1 : 0);
      pad.target = pad.hit(1); pad.ahead = pad.hit(2); pad.cam = pad.hit(3); pad.map = pad.hit(9); pad.dock = pad.hit(8);
      pad.use = pad.hit(0); pad.menu = pad.hit(9);
    } else {
      // flight stick: twist is usually axis 5 (or 2), the throttle lever axis 6 / 3 / 2
      const twistIdx = gp.axes.length > 5 ? 5 : 2;
      const thrIdx = gp.axes.length > 6 ? 6 : gp.axes.length > 3 ? 3 : -1;
      pad.yaw = dz(gp.axes[0], 0.06); pad.pitch = dz(gp.axes[1], 0.06); pad.roll = dz(gp.axes[twistIdx], 0.15);
      if (thrIdx >= 0 && thrIdx !== twistIdx) pad.throttle = (1 - gp.axes[thrIdx]) / 2;
      pad.fire = down[0]; pad.missile = pad.hit(1); pad.boost = down[2]; pad.target = pad.hit(3); pad.ahead = pad.hit(4); pad.cam = pad.hit(5);
      pad.map = pad.hit(6); pad.dock = pad.hit(7); pad.use = pad.hit(1);
      pad.throttleDelta = 0;
    }
    this.padPrev = down;
    // the pad counts as "in use" once a stick moves or a button is pressed
    if (Math.abs(pad.yaw) + Math.abs(pad.pitch) + Math.abs(pad.roll) > 0.05 || down.some(Boolean)) this.padActive = performance.now();
    pad.active = this.padActive && performance.now() - this.padActive < 4000;
    this.pad = pad;
  }

  endFrame() {
    this.pressed.clear(); this.clicked.clear();
    this.mouse.dx = 0; this.mouse.dy = 0; this.mouse.wheel = 0;
  }
}

export const input = new Input();
