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
      if (this.locked) { this.mouse.dx += e.movementX; this.mouse.dy += e.movementY; }
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

  endFrame() {
    this.pressed.clear(); this.clicked.clear();
    this.mouse.dx = 0; this.mouse.dy = 0; this.mouse.wheel = 0;
  }
}

export const input = new Input();
