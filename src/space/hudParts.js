import { assets } from '../core/assets.js';

/*
 * HUD parts drawn on small canvases: the comm screen (who is talking, with a live portrait feed) and the
 * ship status / drive panels.
 */

const PORTRAIT_FOR = [
  [/^Mags/, 'mags'], [/^Juno/, 'juno'], [/Morrow/, 'morrow'], [/Brandt/, 'brandt'], [/Varga/, 'varga'], [/^Noor/, 'noor'],
  [/Rook/, 'rook'], [/Saffi/, 'saffi'], [/Vesper/, 'vesper'], [/^Kix|KX-9/, 'kix'], [/Söldnerbörse/, 'oduya'],
  [/Schakal/, 'schakal'], [/^Quelle|Kollektiv|Tropfen|Wassertanker/, 'c_kollektiv'], [/Flugleitung|Kontrolle|Lotse/, 'c_lotse'],
  [/Lanze|Goldwacht|Stationswache|Liga|Zoll|Patrouille|Wache/, 'c_wache'],
];

function hashStr(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }

export function portraitFor(speaker) {
  if (speaker === 'Bordcomputer') return null;
  for (const [re, id] of PORTRAIT_FOR) {
    if (!re.test(speaker)) continue;
    return id === 'schakal' ? (hashStr(speaker) % 2 ? 'c_schakal2' : 'c_schakal1') : id;
  }
  return 'c_frachter';
}

const imgCache = new Map();
function portraitImg(id) {
  if (!id) return null;
  if (!imgCache.has(id)) {
    const im = new Image();
    im.src = assets.url(`assets/portraits/${id}.jpg`);
    imgCache.set(id, im);
  }
  const im = imgCache.get(id);
  return im.complete && im.naturalWidth ? im : null;
}

/** Comm screen: portrait feed with scanlines, signal noise and a voice meter; the text types out with the voice. */
export class CommScreen {
  constructor(el) {
    this.el = el;
    el.innerHTML = `<div class="cport"><canvas width="168" height="168"></canvas><div class="clive"><i></i>FUNK</div></div>
      <div class="cbody"><div class="chead"><span class="who"></span><span class="chan"></span></div><div class="txt"></div><canvas class="cmeter" width="240" height="18"></canvas></div>`;
    this.cv = el.querySelector('.cport canvas'); this.ctx = this.cv.getContext('2d');
    this.mv = el.querySelector('.cmeter'); this.mctx = this.mv.getContext('2d');
    this.whoEl = el.querySelector('.who'); this.chanEl = el.querySelector('.chan'); this.txtEl = el.querySelector('.txt');
    this.t = 0; this.levels = new Array(24).fill(0);
  }

  show(m, voiceSec) {
    this.m = m; this.t = 0; this.shown = 0;
    this.pid = portraitFor(m.speaker);
    portraitImg(this.pid);
    this.cps = voiceSec ? Math.max(14, m.text.length / Math.max(0.8, voiceSec * 0.92)) : 42;
    this.el.style.setProperty('--fc', m.color);
    this.whoEl.textContent = m.speaker; this.whoEl.style.color = m.color;
    this.chanEl.textContent = `KANAL ${1 + hashStr(m.speaker) % 9} · ${voiceSec ? 'SPRACHE' : 'TEXT'}`;
    this.txtEl.textContent = '';
    this.el.classList.remove('hidden');
    this.el.classList.remove('cin'); void this.el.offsetWidth; this.el.classList.add('cin');
  }

  hide() { this.el.classList.add('hidden'); this.m = null; }

  update(dt, level) {
    if (!this.m) return;
    this.t += dt;
    const n = Math.min(this.m.text.length, Math.floor(this.t * this.cps));
    if (n !== this.shown) { this.shown = n; this.txtEl.textContent = this.m.text.slice(0, n); }
    this.drawPortrait(level);
    this.drawMeter(level);
  }

  drawPortrait(level) {
    const x = this.ctx, W = this.cv.width, H = this.cv.height, t = this.t;
    x.fillStyle = '#03080c'; x.fillRect(0, 0, W, H);
    const im = portraitImg(this.pid);
    const open = Math.min(1, t * 5);                       // the feed "tunes in"
    if (im) {
      const z = 1.18 + 0.02 * Math.sin(t * 0.7);
      const sw = im.naturalWidth / z, sx = (im.naturalWidth - sw) / 2 + Math.sin(t * 0.5) * 4, sy = im.naturalHeight * 0.06;
      x.globalAlpha = open;
      x.filter = `saturate(0.75) contrast(1.12) brightness(${0.92 + level * 0.35})`;
      x.drawImage(im, sx, sy, sw, sw, 0, 0, W, H);
      x.filter = 'none';
      // a few torn lines of signal break-up, more when the signal is opening
      const tears = (1 - open) * 10 + (Math.random() < 0.06 ? 3 : 0);
      for (let i = 0; i < tears; i++) {
        const y = Math.random() * H, h = 2 + Math.random() * 6, off = (Math.random() - 0.5) * 18;
        x.drawImage(this.cv, 0, y, W, h, off, y, W, h);
      }
      x.globalAlpha = 1;
    } else {
      // ship computer: a pulsing waveform instead of a face
      x.strokeStyle = this.m.color; x.lineWidth = 2; x.globalAlpha = 0.9;
      x.beginPath();
      for (let i = 0; i <= W; i += 3) {
        const a = Math.sin(i * 0.09 + t * 7) * Math.sin(i * 0.023 + t * 1.3);
        x.lineTo(i, H / 2 + a * (8 + level * 60));
      }
      x.stroke(); x.globalAlpha = 1;
      x.strokeStyle = 'rgba(127,212,255,.25)'; x.beginPath(); x.arc(W / 2, H / 2, 46 + level * 18, 0, Math.PI * 2); x.stroke();
    }
    // colour wash, scanlines, grain, vignette
    x.globalCompositeOperation = 'overlay'; x.fillStyle = this.m.color; x.globalAlpha = 0.22; x.fillRect(0, 0, W, H);
    x.globalCompositeOperation = 'source-over'; x.globalAlpha = 1;
    x.fillStyle = 'rgba(0,0,0,.28)';
    const roll = (t * 40) % 4;
    for (let y = roll; y < H; y += 4) x.fillRect(0, y, W, 2);
    const bandY = (t * 60) % (H + 40) - 20;
    x.fillStyle = 'rgba(200,240,255,.05)'; x.fillRect(0, bandY, W, 18);
    for (let i = 0; i < 90; i++) { x.fillStyle = `rgba(255,255,255,${Math.random() * 0.12})`; x.fillRect(Math.random() * W, Math.random() * H, 1, 1); }
    const g = x.createRadialGradient(W / 2, H / 2, W * 0.3, W / 2, H / 2, W * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.65)');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
  }

  drawMeter(level) {
    const x = this.mctx, W = this.mv.width, H = this.mv.height;
    this.levels.push(level); this.levels.shift();
    x.clearRect(0, 0, W, H);
    const n = this.levels.length, bw = W / n;
    for (let i = 0; i < n; i++) {
      const v = Math.min(1, this.levels[i] * 3.2);
      const h = Math.max(1.5, v * H);
      x.fillStyle = i === n - 1 ? '#ffffff' : this.m.color;
      x.globalAlpha = 0.25 + 0.75 * (i / n);
      x.fillRect(i * bw + 1, (H - h) / 2, bw - 2, h);
    }
    x.globalAlpha = 1;
  }
}

// ------------------------------------------------------------------ ship status (shield / hull / energy)

function segBar(x, X, Y, W, H, k, color, segs = 22, warn = false) {
  const gap = 2, sw = (W - gap * (segs - 1)) / segs;
  const lit = k * segs;
  for (let i = 0; i < segs; i++) {
    const f = Math.max(0, Math.min(1, lit - i));
    x.fillStyle = 'rgba(160,220,255,0.08)';
    x.beginPath(); x.moveTo(X + i * (sw + gap) + 2, Y); x.lineTo(X + i * (sw + gap) + sw + 2, Y); x.lineTo(X + i * (sw + gap) + sw, Y + H); x.lineTo(X + i * (sw + gap), Y + H); x.fill();
    if (f <= 0) continue;
    x.fillStyle = color; x.globalAlpha = (warn && i < 3 ? 0.6 + 0.4 * Math.sin(performance.now() / 90) : 1) * (0.35 + 0.65 * f);
    x.shadowColor = color; x.shadowBlur = 6;
    x.beginPath(); x.moveTo(X + i * (sw + gap) + 2, Y); x.lineTo(X + i * (sw + gap) + sw + 2, Y); x.lineTo(X + i * (sw + gap) + sw, Y + H); x.lineTo(X + i * (sw + gap), Y + H); x.fill();
    x.shadowBlur = 0; x.globalAlpha = 1;
  }
}

export function drawStatus(cv, p, flight, hitT) {
  const x = cv.getContext('2d'), W = cv.width, H = cv.height;
  x.clearRect(0, 0, W, H);
  const sh = p.shield / p.maxShield, hu = p.hull / p.maxHull, en = p.energy / p.stats.energy;
  // left: shield bubble around the ship glyph, hull ring inside
  const cx = 62, cy = 62, R = 50;
  const segs = 28;
  for (let i = 0; i < segs; i++) {
    const a0 = -Math.PI / 2 + i / segs * Math.PI * 2 + 0.035, a1 = a0 + Math.PI * 2 / segs - 0.07;
    const on = i / segs < sh;
    x.strokeStyle = on ? '#5ab8ff' : 'rgba(90,184,255,0.12)'; x.lineWidth = 6;
    if (on) { x.shadowColor = '#5ab8ff'; x.shadowBlur = 8 + hitT * 14; }
    x.beginPath(); x.arc(cx, cy, R, a0, a1); x.stroke(); x.shadowBlur = 0;
  }
  const hc = hu < 0.3 ? '#ff6a5a' : hu < 0.6 ? '#ffcf7a' : '#e8e0c8';
  x.strokeStyle = 'rgba(232,224,200,0.12)'; x.lineWidth = 3;
  x.beginPath(); x.arc(cx, cy, R - 10, 0, Math.PI * 2); x.stroke();
  x.strokeStyle = hc; x.beginPath(); x.arc(cx, cy, R - 10, -Math.PI / 2, -Math.PI / 2 + hu * Math.PI * 2); x.stroke();
  // ship glyph (top view wedge with two nacelles), tinted by hull state
  x.save(); x.translate(cx, cy + 2); x.fillStyle = hc; x.globalAlpha = 0.9 - (hu < 0.3 ? 0.4 * (0.5 + 0.5 * Math.sin(performance.now() / 120)) : 0);
  x.beginPath(); x.moveTo(0, -22); x.lineTo(9, 8); x.lineTo(-9, 8); x.closePath(); x.fill();
  x.fillRect(-15, -2, 6, 16); x.fillRect(9, -2, 6, 16);
  x.globalAlpha = 1; x.restore();
  if (hitT > 0) { x.strokeStyle = `rgba(255,255,255,${hitT})`; x.lineWidth = 2; x.beginPath(); x.arc(cx, cy, R + 5, 0, Math.PI * 2); x.stroke(); }
  // right: three segmented bars with readouts
  const X = 134, BW = W - X - 52;
  x.font = '600 11px Rajdhani, sans-serif'; x.textBaseline = 'middle';
  const row = (y, label, k, v, color, warn) => {
    x.fillStyle = 'rgba(168,228,255,0.6)'; x.fillText(label, X, y - 9);
    segBar(x, X, y - 2, BW, 9, k, color, 22, warn);
    x.fillStyle = '#fff'; x.font = '600 15px Rajdhani, sans-serif'; x.textAlign = 'right'; x.fillText(String(v), W - 4, y + 2);
    x.textAlign = 'left'; x.font = '600 11px Rajdhani, sans-serif';
  };
  row(24, 'SCHILD', sh, Math.round(p.shield), '#5ab8ff');
  row(60, 'RUMPF', hu, Math.round(p.hull), hc, hu < 0.3);
  row(96, 'ENERGIE', en, Math.round(p.energy), p.input.boost ? '#ffe7a8' : '#ffcf7a', en < 0.15);
  // footer: missiles as pips, flight assist, salvage net
  x.fillStyle = 'rgba(168,228,255,0.6)';
  x.fillText('RAK', 4, 136);
  for (let i = 0; i < Math.max(p.missiles, p.stats.missiles || 0); i++) {
    x.fillStyle = i < p.missiles ? '#ffcf7a' : 'rgba(255,207,122,0.15)';
    x.beginPath(); x.moveTo(30 + i * 9, 132); x.lineTo(34 + i * 9, 132); x.lineTo(34 + i * 9, 141); x.lineTo(30 + i * 9, 141); x.fill();
  }
  x.fillStyle = p.flightAssist ? 'rgba(168,228,255,0.6)' : '#ff9a5a';
  x.fillText(p.flightAssist ? 'FLUGHILFE' : 'NEWTON', X, 136);
  const net = p.record?.cargo?.schrott || 0;
  if (!flight.gunner) { x.textAlign = 'right'; x.fillStyle = 'rgba(255,176,80,0.8)'; x.fillText(`BERGUNG ${net}/${p.stats.salvage || 2} t`, W - 4, 136); x.textAlign = 'left'; }
}

// ------------------------------------------------------------------ drive panel (speed, throttle, boost)

export function drawDrive(cv, p, label) {
  const x = cv.getContext('2d'), W = cv.width, H = cv.height;
  x.clearRect(0, 0, W, H);
  const v = p.speed(), vmax = p.stats.boost || 1, cruise = p.stats.speed;
  // speed arc
  const cx = W - 66, cy = 70, R = 52, a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
  x.lineWidth = 5; x.strokeStyle = 'rgba(127,212,255,0.12)'; x.beginPath(); x.arc(cx, cy, R, a0, a1); x.stroke();
  const k = Math.min(1, v / vmax), kc = cruise / vmax;
  x.strokeStyle = p.input.boost ? '#ffe7a8' : '#7fd4ff'; x.shadowColor = x.strokeStyle; x.shadowBlur = 10;
  x.beginPath(); x.arc(cx, cy, R, a0, a0 + (a1 - a0) * k); x.stroke(); x.shadowBlur = 0;
  // cruise limit tick
  const ac = a0 + (a1 - a0) * kc;
  x.strokeStyle = '#ffcf7a'; x.lineWidth = 2; x.beginPath(); x.moveTo(cx + Math.cos(ac) * (R - 8), cy + Math.sin(ac) * (R - 8)); x.lineTo(cx + Math.cos(ac) * (R + 6), cy + Math.sin(ac) * (R + 6)); x.stroke();
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillStyle = '#fff'; x.font = '600 32px Rajdhani, sans-serif'; x.fillText(Math.round(v), cx, cy - 2);
  x.fillStyle = 'rgba(168,228,255,0.6)'; x.font = '600 11px Rajdhani, sans-serif'; x.fillText('M/S', cx, cy + 20);
  // throttle: vertical segmented column
  const segs = 16, X = 10, Y = 14, Hh = 112, sh = Hh / segs;
  for (let i = 0; i < segs; i++) {
    const on = (i + 0.5) / segs < p.throttle;
    x.fillStyle = on ? (p.input.boost ? '#ffe7a8' : '#7fd4ff') : 'rgba(127,212,255,0.1)';
    if (on) { x.shadowColor = x.fillStyle; x.shadowBlur = 6; }
    x.fillRect(X, Y + Hh - (i + 1) * sh + 1, 16 + i * 0.6, sh - 2); x.shadowBlur = 0;
  }
  x.textAlign = 'left'; x.fillStyle = 'rgba(168,228,255,0.6)';
  x.fillText('SCHUB', X, Y + Hh + 12);
  x.fillStyle = '#fff'; x.font = '600 14px Rajdhani, sans-serif'; x.fillText(Math.round(p.throttle * 100) + ' %', X + 34, Y + Hh - 6);
  x.font = '600 11px Rajdhani, sans-serif'; x.textAlign = 'right'; x.fillStyle = 'rgba(168,228,255,0.6)';
  x.fillText(label, W - 6, H - 8);
  if (p.input.boost) { x.fillStyle = '#ffe7a8'; x.fillText('NACHBRENNER', W - 6, H - 22); }
}
