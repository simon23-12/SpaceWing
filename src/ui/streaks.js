/**
 * Canvas speed streaks: star particles rushing past a vanishing point.
 * Used gently on the title screen and at full strength for transits and hyperspace jumps.
 */
export class Streaks {
  constructor(parent, { count = 260, speed = 1, vx = 0.5, vy = 0.5, color = [190, 225, 255], alpha = 0.9, z = 0 } = {}) {
    this.cv = document.createElement('canvas');
    this.cv.className = 'streaks';
    this.cv.style.cssText = `position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:${z}`;
    parent.appendChild(this.cv);
    this.ctx = this.cv.getContext('2d');
    this.opts = { count, speed, vx, vy, color, alpha };
    this.p = Array.from({ length: count }, () => this.spawn(true));
    this.last = performance.now();
    this.running = true;
    this.resize = () => { const d = Math.min(devicePixelRatio || 1, 1.5); this.cv.width = Math.round(this.cv.clientWidth * d); this.cv.height = Math.round(this.cv.clientHeight * d); };
    addEventListener('resize', this.resize);
    this.resize();
    const loop = (t) => { if (!this.running) return; this.frame(Math.min(0.05, (t - this.last) / 1000)); this.last = t; requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  spawn(initial) {
    const a = Math.random() * Math.PI * 2, r = 0.15 + Math.pow(Math.random(), 0.6) * 1.6;
    return { x: Math.cos(a) * r, y: Math.sin(a) * r, z: initial ? 0.2 + Math.random() * 4 : 4 + Math.random() * 0.5, w: 0.5 + Math.random() * 1.5, h: Math.random() };
  }

  set(o) { Object.assign(this.opts, o); }

  frame(dt) {
    if (!this.cv.width || this.cv.width !== Math.round(this.cv.clientWidth * Math.min(devicePixelRatio || 1, 1.5))) this.resize();
    const { ctx, cv } = this, W = cv.width, H = cv.height, o = this.opts;
    if (!W || !H) return;
    ctx.clearRect(0, 0, W, H);
    if (o.alpha <= 0.001) return;
    const cx = W * o.vx, cy = H * o.vy, f = Math.max(W, H) * 0.5;
    ctx.lineCap = 'round';
    for (let i = 0; i < this.p.length; i++) {
      const s = this.p[i];
      s.z -= dt * o.speed * (0.9 + s.h * 0.4);
      if (s.z < 0.06) { this.p[i] = this.spawn(false); continue; }
      const tail = s.z + 0.04 + o.speed * 0.07;          // tail grows with speed
      const x1 = cx + s.x / s.z * f, y1 = cy + s.y / s.z * f;
      const x0 = cx + s.x / tail * f, y0 = cy + s.y / tail * f;
      if (x0 < -50 || x0 > W + 50 || y0 < -50 || y0 > H + 50) { this.p[i] = this.spawn(false); continue; }
      const k = Math.min(1, (4 - s.z) / 1.2) * o.alpha;
      const [r, g, b] = o.color;
      ctx.strokeStyle = `rgba(${r},${g},${b},${k * (0.35 + s.h * 0.65)})`;
      ctx.lineWidth = s.w * (1.2 / Math.max(0.35, s.z)) * (W / 1600);
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    }
  }

  dispose() { this.running = false; removeEventListener('resize', this.resize); this.cv.remove(); }
}
