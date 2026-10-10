import * as THREE from 'three';
import { FACTIONS } from '../game/data.js';
import { hostile } from './ship.js';
import { CommScreen, drawStatus, drawDrive } from './hudParts.js';

const _v = new THREE.Vector3(), _p = new THREE.Vector3();

function el(tag, cls, parent, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
}

export class HUD {
  constructor(gunner = false) {
    this.gunner = gunner;
    this.root = el('div', 'hud', document.getElementById('ui'));
    this.canvas = el('canvas', 'hud-canvas', this.root);
    this.ctx = this.canvas.getContext('2d');
    this.zone = el('div', 'hud-zone', this.root);
    this.obj = el('div', 'hud-objective', this.root);
    this.comm = el('div', 'hud-comm hidden', this.root);
    this.toast = el('div', 'hud-toast', this.root);
    this.promptEl = el('div', 'hud-prompt hidden', this.root);
    this.left = el('div', 'hud-gauge hud-left', this.root, '<canvas width="330" height="148"></canvas>');
    this.right = el('div', 'hud-gauge hud-right', this.root, '<canvas width="230" height="148"></canvas>');
    this.statusCv = this.left.querySelector('canvas'); this.driveCv = this.right.querySelector('canvas');
    this.commScreen = new CommScreen(this.comm);
    this.hitT = 0; this.lastShield = null;
    this.target = el('div', 'hud-panel hud-target hidden', this.root);
    this.radar = el('canvas', 'hud-radar', this.root);
    this.radar.width = this.radar.height = 220;
    this.rctx = this.radar.getContext('2d');
    this.help = el('div', 'hud-help', this.root, gunner
      ? 'Maus: Turm drehen · LMB/Leertaste: Feuer · T: Ziel durchschalten · Y: Ziel voraus · H: Hilfe'
      : 'Maus: Steuern · W/S: Schub · A/D: Rollen · Q/E: Seitwärts · Shift: Boost · LMB/Leertaste: Laser · RMB/F: Rakete · T: Ziel · C: Kamera · L: Andocken · M: Systemkarte · H: Hilfe');
    this.help.style.opacity = 0;
    this.commQueue = [];
    this.commT = 0;
    this.toastT = 0;
    this.resize();
    this._onResize = () => this.resize();
    addEventListener('resize', this._onResize);
  }

  resize() {
    const dpr = Math.min(devicePixelRatio, 2);
    this.canvas.width = innerWidth * dpr; this.canvas.height = innerHeight * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  dispose() { removeEventListener('resize', this._onResize); this.root.remove(); }

  toggleHelp() { this.help.style.opacity = this.help.style.opacity === '1' ? 0 : 1; }

  setZone(t) { this.zone.textContent = t; }
  setObjective(t) { this.obj.innerHTML = t ? `<b>ZIEL</b> ${t}` : ''; this.obj.classList.toggle('hidden', !t); }
  showToast(t, dur = 3) { this.toast.innerHTML = t; this.toast.classList.add('on'); this.toastT = dur; }
  prompt(t) { this.promptEl.classList.toggle('hidden', !t); if (t) this.promptEl.innerHTML = t; }

  /** Queue a comm message: speaker, text, faction colour. */
  say(speaker, text, color = '#9fd6ff', dur) {
    this.commQueue.push({ speaker, text, color, dur: dur || Math.max(3.5, text.length / 16) });
  }
  get commBusy() { return this.commT > 0 || this.commQueue.length > 0; }

  update(dt, flight) {
    // comm
    if (this.commT > 0) { this.commT -= dt; if (this.commT <= 0) this.commScreen.hide(); }
    if (this.commT > 0) this.commScreen.update(dt, flight.game.audio?.voiceLevel?.() || 0);
    if (this.commT <= 0 && this.commQueue.length) {
      const m = this.commQueue.shift();
      this.commT = m.dur;
      const A = flight.game.audio, name = flight.game.state?.callsign;
      const vl = A?.voiceLength?.(m.text, name) || 0;
      if (vl) { this.commT = Math.max(m.dur, vl + 1.0); A.speak(m.text, { name, radio: true }); }
      else A?.blip?.();
      this.commScreen.show(m, vl);
    }
    if (this.toastT > 0) { this.toastT -= dt; if (this.toastT <= 0) this.toast.classList.remove('on'); }

    const p = flight.player;
    if (!p) return;
    if (this.lastShield != null && p.shield + p.hull < this.lastShield - 0.5) this.hitT = 1;
    this.lastShield = p.shield + p.hull;
    this.hitT = Math.max(0, this.hitT - dt * 2.5);
    drawStatus(this.statusCv, p, flight, this.hitT);
    drawDrive(this.driveCv, p, this.gunner ? 'GESCHÜTZTURM' : flight.camMode === 'cockpit' ? 'COCKPIT' : 'VERFOLGER');

    this.draw(flight);
    this.drawRadar(flight);
    this.drawTarget(flight);
  }

  drawTarget(flight) {
    const t = flight.player.target;
    if (!t || !t.alive) { this.target.classList.add('hidden'); return; }
    this.target.classList.remove('hidden');
    const d = flight.player.pos.distanceTo(t.pos);
    const fc = FACTIONS[t.faction] || FACTIONS.neutral;
    const dist = d > 2000 ? (d / 1000).toFixed(1) + ' km' : Math.round(d) + ' m';
    if (t.isObject) {
      const key = t.name + '|' + Math.round(d / 10);
      if (this._tk === key) return;
      this._tk = key;
      this.target.innerHTML = `<div class="tname" style="color:${t.kind === 'salvage' ? '#ffb050' : fc.color}">${t.name}</div>
        <div class="tfac">${t.kind === 'salvage' ? 'Objekt · Trümmer' : 'Objekt · Station · ' + fc.name}</div>
        <div class="tinfo">${t.info}</div><div class="tdist">${dist}</div>`;
      return;
    }
    const closing = Math.round(-flight.player.vel.clone().sub(t.vel).dot(t.pos.clone().sub(flight.player.pos).normalize()));
    const key = t.id + '|' + Math.round(t.shield) + '|' + Math.round(t.hull) + '|' + Math.round(d / 10) + '|' + Math.round(closing / 10);
    if (this._tk === key) return;
    this._tk = key;
    const cls = t.stats?.name ? `${t.stats.name}${t.stats.role ? ' · ' + t.stats.role : ''}` : '';
    this.target.innerHTML = `<div class="tname" style="color:${fc.color}">${t.name}</div>
      <div class="tfac">${cls}</div>
      <div class="tfac">${fc.name}${t.cargoLabel ? ' · ' + t.cargoLabel : ''}</div>
      <div class="bar"><label>SCHILD</label><div class="track"><div class="fill shield" style="width:${100 * t.shield / t.maxShield}%"></div></div></div>
      <div class="bar"><label>RUMPF</label><div class="track"><div class="fill hull" style="width:${100 * t.hull / t.maxHull}%"></div></div></div>
      <div class="tdist">${dist} <small>${closing >= 0 ? '▼' : '▲'} ${Math.abs(closing)} m/s</small></div>
      <div class="tinfo">${flight.isHostile(t, flight.player) ? 'Vorhalten: auf den Kreis vor dem Ziel zielen' : (FACTIONS[t.faction] || {}).name || ''}</div>`;
  }

  project(cam, pos) {
    _p.copy(pos).project(cam);
    const behind = _v.copy(pos).sub(cam.position).dot(cam.getWorldDirection(new THREE.Vector3())) < 0;
    return { x: (_p.x * 0.5 + 0.5) * innerWidth, y: (-_p.y * 0.5 + 0.5) * innerHeight, behind };
  }

  draw(flight) {
    const ctx = this.ctx, W = innerWidth, H = innerHeight, cam = flight.camera;
    ctx.clearRect(0, 0, W, H);
    const p = flight.player;
    // crosshair: where the guns converge (~600 m ahead)
    const aim = this.gunner ? { x: W / 2, y: H / 2 } : this.project(cam, p.pos.clone().addScaledVector(p.forward(new THREE.Vector3()), 600));
    ctx.strokeStyle = 'rgba(160,230,255,0.85)'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(aim.x, aim.y, 14, 0.3, Math.PI - 0.3); ctx.moveTo(aim.x + 14 * Math.cos(Math.PI + 0.3), aim.y + 14 * Math.sin(Math.PI + 0.3));
    ctx.arc(aim.x, aim.y, 14, Math.PI + 0.3, 2 * Math.PI - 0.3);
    ctx.moveTo(aim.x - 3, aim.y); ctx.lineTo(aim.x + 3, aim.y);
    ctx.stroke();
    // virtual stick
    const vs = flight.stick;
    if (vs && flight.camMode) {
      const cx = W / 2, cy = H / 2, R = Math.min(W, H) * 0.18;
      ctx.strokeStyle = 'rgba(160,230,255,0.12)';
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = 'rgba(200,240,255,0.7)';
      ctx.beginPath(); ctx.arc(cx + vs.x * R, cy + vs.y * R, 3, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(200,240,255,0.25)';
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + vs.x * R, cy + vs.y * R); ctx.stroke();
    }
    // contacts
    ctx.font = '11px "Rajdhani", "Segoe UI", sans-serif';
    for (const s of flight.ships) {
      if (s === p || !s.alive) continue;
      const d = p.pos.distanceTo(s.pos);
      if (d > 12000) continue;
      const sp = this.project(cam, s.pos);
      const hostileTo = hostile(s.faction, 'player', flight.hostileOverrides);
      const col = hostileTo ? '#ff5a4a' : (FACTIONS[s.faction] || FACTIONS.neutral).color;
      const isT = p.target === s;
      if (sp.behind || sp.x < 0 || sp.x > W || sp.y < 0 || sp.y > H) {
        if (isT || hostileTo || s.tags.has('objective')) this.edgeArrow(ctx, sp, col, isT);
        continue;
      }
      const size = Math.max(10, Math.min(60, s.radius * 900 / Math.max(d, 1)));
      ctx.strokeStyle = col; ctx.lineWidth = isT ? 2 : 1.2;
      this.bracket(ctx, sp.x, sp.y, size, isT);
      if (isT || d < 3000) {
        ctx.fillStyle = col;
        ctx.fillText(`${s.name}  ${d > 2000 ? (d / 1000).toFixed(1) + 'km' : Math.round(d) + 'm'}`, sp.x + size + 4, sp.y - size + 8);
      }
      if (!isT && hostileTo && d < 1500) {
        // every close hostile shows where to aim (small diamond)
        const l = this.project(cam, flight.leadFor(p, s));
        if (!l.behind) { ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(l.x, l.y - 4); ctx.lineTo(l.x + 4, l.y); ctx.lineTo(l.x, l.y + 4); ctx.lineTo(l.x - 4, l.y); ctx.closePath(); ctx.stroke(); }
      }
      if (isT) {
        // lead indicator: where the bolts must go; turns green when the guns line up (aim assist takes over)
        const lp = flight.leadFor(p, s);
        const l = this.project(cam, lp);
        if (!l.behind) {
          const aimDir = this.gunner ? cam.getWorldDirection(new THREE.Vector3()) : p.forward(new THREE.Vector3());
          const from = this.gunner ? cam.position : p.pos;
          const onT = hostileTo && lp.clone().sub(from).normalize().angleTo(aimDir) < (this.gunner ? 0.05 : 0.07) && d < 1600;
          const lc = onT ? '#5aff8a' : col;
          ctx.strokeStyle = lc; ctx.lineWidth = onT ? 2.5 : 1.8;
          ctx.beginPath(); ctx.arc(l.x, l.y, onT ? 11 : 9, 0, Math.PI * 2); ctx.stroke();
          ctx.beginPath(); ctx.arc(l.x, l.y, 2, 0, Math.PI * 2); ctx.fillStyle = lc; ctx.fill();
          ctx.setLineDash([2, 4]); ctx.lineWidth = 1; ctx.strokeStyle = col; ctx.beginPath(); ctx.moveTo(sp.x, sp.y); ctx.lineTo(l.x, l.y); ctx.stroke(); ctx.setLineDash([]);
          if (onT) { ctx.fillStyle = '#5aff8a'; ctx.fillText('IM ZIEL', l.x + 14, l.y + 4); }
        }
        if (flight.lock && flight.lock.target === s) {
          const k = Math.min(1, flight.lock.t / p.stats.lockTime);
          ctx.strokeStyle = k >= 1 ? '#ff4040' : '#ffd040';
          ctx.beginPath(); ctx.arc(sp.x, sp.y, size + 10 + (1 - k) * 30, 0, Math.PI * 2 * k); ctx.stroke();
          if (k >= 1) { ctx.fillStyle = '#ff4040'; ctx.fillText('ERFASST', sp.x - 20, sp.y + size + 18); }
        }
      }
    }
    // locked object (station / salvage): bracket and label
    const tg = p.target;
    if (tg && tg.isObject && tg.alive) {
      const sp = this.project(cam, tg.pos), d = p.pos.distanceTo(tg.pos);
      const oc = tg.kind === 'salvage' ? '#ffb050' : '#9fe0ff';
      if (sp.behind || sp.x < 0 || sp.x > W || sp.y < 0 || sp.y > H) this.edgeArrow(ctx, sp, oc, true);
      else {
        ctx.strokeStyle = oc; ctx.lineWidth = 2; this.bracket(ctx, sp.x, sp.y, tg.kind === 'salvage' ? 14 : 30, true);
        ctx.fillStyle = oc; ctx.fillText(`${tg.name}  ${d > 2000 ? (d / 1000).toFixed(1) + 'km' : Math.round(d) + 'm'}`, sp.x + 34, sp.y - 20);
      }
    }
    // salvage pieces: small amber diamonds
    ctx.fillStyle = '#ffb050'; ctx.strokeStyle = '#ffb050'; ctx.lineWidth = 1;
    let labelled = false;
    for (const sv of flight.salvage || []) {
      const d = p.pos.distanceTo(sv.mesh.position);
      if (d > 3500) continue;
      const sp = this.project(cam, sv.mesh.position);
      if (sp.behind || sp.x < 0 || sp.x > W || sp.y < 0 || sp.y > H) continue;
      ctx.beginPath(); ctx.moveTo(sp.x, sp.y - 5); ctx.lineTo(sp.x + 5, sp.y); ctx.lineTo(sp.x, sp.y + 5); ctx.lineTo(sp.x - 5, sp.y); ctx.closePath(); ctx.stroke();
      if (!labelled && d < 1500 && sv.tgt !== p.target) { labelled = true; ctx.fillText(`Trümmer ${Math.round(d)} m`, sp.x + 9, sp.y + 4); }
    }
    // waypoints
    for (const w of flight.waypoints) {
      const sp = this.project(cam, w.pos);
      const d = p.pos.distanceTo(w.pos);
      if (sp.behind || sp.x < 0 || sp.x > W || sp.y < 0 || sp.y > H) { this.edgeArrow(ctx, sp, '#ffd36a', true); continue; }
      ctx.strokeStyle = '#ffd36a'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(sp.x, sp.y - 10); ctx.lineTo(sp.x + 10, sp.y); ctx.lineTo(sp.x, sp.y + 10); ctx.lineTo(sp.x - 10, sp.y); ctx.closePath(); ctx.stroke();
      ctx.fillStyle = '#ffd36a';
      ctx.fillText(`${w.label}  ${d > 2000 ? (d / 1000).toFixed(1) + 'km' : Math.round(d) + 'm'}`, sp.x + 14, sp.y + 4);
    }
    // damage vignette
    flight.game.renderer.grade.uniforms.hit.value = Math.max(0, 0.6 - (p.time - p.lastHit) * 1.5) * (p.hull < p.maxHull ? 1 : 0.4);
  }

  bracket(ctx, x, y, s, full) {
    const k = s * 0.35;
    ctx.beginPath();
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      ctx.moveTo(x + sx * s, y + sy * (s - k)); ctx.lineTo(x + sx * s, y + sy * s); ctx.lineTo(x + sx * (s - k), y + sy * s);
    }
    ctx.stroke();
    if (full) { ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2); ctx.stroke(); }
  }

  edgeArrow(ctx, sp, col, strong) {
    const W = innerWidth, H = innerHeight;
    let dx = sp.x - W / 2, dy = sp.y - H / 2;
    if (sp.behind) { dx = -dx; dy = -dy; }
    const a = Math.atan2(dy, dx);
    const R = Math.min(W, H) * 0.42;
    const x = W / 2 + Math.cos(a) * R, y = H / 2 + Math.sin(a) * R;
    ctx.save(); ctx.translate(x, y); ctx.rotate(a);
    ctx.fillStyle = col; ctx.globalAlpha = strong ? 0.95 : 0.55;
    ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(-6, -7); ctx.lineTo(-6, 7); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  drawRadar(flight) {
    const ctx = this.rctx, S = 220, c = S / 2, R = 100;
    const p = flight.player;
    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = 'rgba(6,14,22,0.55)'; ctx.beginPath(); ctx.arc(c, c, R + 6, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(120,200,255,0.25)'; ctx.lineWidth = 1;
    for (const r of [R, R * 0.66, R * 0.33]) { ctx.beginPath(); ctx.arc(c, c, r, 0, Math.PI * 2); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(c - R, c); ctx.lineTo(c + R, c); ctx.moveTo(c, c - R); ctx.lineTo(c, c + R); ctx.stroke();
    const range = flight.radarRange || 5000;
    const inv = p.quat.clone().invert();
    const plot = (pos, col, size, isT, sq) => {
      const l = _v.copy(pos).sub(p.pos).applyQuaternion(inv);
      const d = l.length();
      const k = Math.min(1, Math.sqrt(d / range));
      const h = Math.hypot(l.x, l.z) || 1;
      const x = c + (l.x / h) * k * R, y = c + (l.z / h) * k * R;
      const elev = THREE.MathUtils.clamp(-l.y / range * R * 0.6, -25, 25);
      ctx.strokeStyle = col; ctx.globalAlpha = 0.5;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + elev); ctx.stroke();
      ctx.globalAlpha = d > range ? 0.45 : 1; ctx.fillStyle = col;
      if (sq) ctx.fillRect(x - size, y + elev - size, size * 2, size * 2);
      else { ctx.beginPath(); ctx.arc(x, y + elev, size, 0, Math.PI * 2); ctx.fill(); }
      if (isT) { ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y + elev, size + 3, 0, Math.PI * 2); ctx.stroke(); }
      ctx.globalAlpha = 1;
    };
    for (const s of flight.ships) {
      if (s === p || !s.alive) continue;
      const col = hostile(s.faction, 'player', flight.hostileOverrides) ? '#ff5a4a' : (FACTIONS[s.faction] || FACTIONS.neutral).color;
      plot(s.pos, col, s.stats.length > 30 ? 3.5 : 2.5, p.target === s);
    }
    for (const w of flight.waypoints) plot(w.pos, '#ffd36a', 3, false, true);
    if (flight.station) plot(flight.station.pos, '#8fd18f', 4, false, true);
    ctx.fillStyle = '#bff'; ctx.beginPath(); ctx.moveTo(c, c - 6); ctx.lineTo(c + 4, c + 4); ctx.lineTo(c - 4, c + 4); ctx.fill();
  }
}
