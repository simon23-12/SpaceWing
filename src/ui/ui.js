import { assets } from '../core/assets.js';
import { SHIP_CLASSES, UPGRADES, MAX_UPGRADE, maxLevel, upgradePrice, PAINTS, PAINT_PRICE, shipStats, COMMODITIES, STATIONS, FACTIONS, MOONS, MOON_ORDER, moonOfZone, moonOfStation, JUMP_CLASS } from '../game/data.js';
import { activeShip, cargoUsed, cargoFree, addCredits, fmt, rank, price, availableAt, logEntry, addShip } from '../game/state.js';
import { generateJobs, acceptJob, abandonJob } from '../game/missions.js';
import { STORY, PEOPLE, acceptStory, finaleChoice } from '../game/story.js';
import { ZONES, BODIES, zoneAnchor, travelInfo, SATURN } from '../space/universe.js';
import { input } from '../core/input.js';
import { Streaks } from './streaks.js';
import { ShipPreview } from './shipPreview.js';

const $ = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const esc = (s) => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

const TIPS = [
  'Die Ringe des Saturn sind im Schnitt nur zehn Meter dick, aber 280.000 Kilometer breit.',
  'Enceladus schleudert jede Sekunde rund 200 Kilogramm Wasser ins All.',
  'Titan ist der einzige Mond mit einer dichten Atmosphäre. Auf seinen Seen regnet es Methan.',
  'Iapetus hat eine schwarze und eine weiße Seite. Niemand weiß genau, warum.',
  'Mit T schaltest du das nächste Ziel auf, mit Y das Ziel vor deiner Nase.',
  'Raketen brauchen eine Zielerfassung: Halte das Ziel im Visier, bis der Kreis sich schließt.',
  'Upgrades in der Werft bleiben beim Schiff. Ein verkauftes Schiff nimmt sie mit.',
  'Die Preise hängen von der Politik ab. Achte auf Zoll und Embargo.',
  'Z schaltet die Flughilfe ab. Dann gilt nur noch Newton.',
];

export class UI {
  constructor(game) {
    this.game = game;
    this.root = document.getElementById('ui');
    this.fade = document.getElementById('fade');
    this.notifs = $('<div class="notif"></div>'); this.root.appendChild(this.notifs);
    this.modalStack = [];
  }

  get g() { return this.game.state; }
  sfx(k = 'click') { this.game.audio?.[k]?.(); }

  // ------------------------------------------------------------------ basics
  fadeOut(sec = 0.6) { this.fade.style.transition = `opacity ${sec}s`; this.fade.style.opacity = 1; return new Promise(r => setTimeout(r, sec * 1000)); }
  fadeIn(sec = 0.8) { this.fade.style.transition = `opacity ${sec}s`; this.fade.style.opacity = 0; return new Promise(r => setTimeout(r, sec * 1000)); }

  notify(text) {
    const d = $(`<div>${text}</div>`); this.notifs.appendChild(d);
    setTimeout(() => d.remove(), 5000);
  }

  clear() { for (const el of [...this.root.children]) if (el !== this.notifs && !el.classList.contains('hud')) { el._cleanup?.(); el.remove(); } this.modalStack = []; }

  get modalOpen() { return this.modalStack.length > 0 || !!this.dlg; }

  // ------------------------------------------------------------------ title & loading
  title({ hasSave, onNew, onContinue }) {
    const el = $(`<div class="title">
      <div class="bgimg" style="background-image:url(${assets.url('assets/ui/title.jpg')})"></div>
      <h1>SPACEWING</h1><h2>SATURN</h2>
      <div class="menu">
        ${hasSave ? '<button class="btn warm" data-a="cont">Fortsetzen</button>' : ''}
        <button class="btn" data-a="new">Neues Spiel</button>
        <button class="btn" data-a="help">Steuerung</button>
      </div>
      <div class="credit">Von Simon</div>
    </div>`);
    // speed streaks drifting through the picture, slowly, towards the station
    const streaks = new Streaks(el, { count: 55, speed: 1.5, vx: 0.66, vy: 0.55, alpha: 0.85, color: [205, 228, 255], z: 0 });
    el._cleanup = () => streaks.dispose();
    el.querySelector('[data-a="new"]').onclick = () => {
      this.sfx();
      const menu = el.querySelector('.menu');
      menu.innerHTML = `<div style="font-family:var(--f-head);letter-spacing:.2em;color:var(--dim)">DEIN RUFZEICHEN</div>
        <input maxlength="16" value="Wren" spellcheck="false"><button class="btn warm" data-a="go">Los geht’s</button><button class="btn small" data-a="back">Zurück</button>`;
      const inp = menu.querySelector('input'); inp.focus(); inp.select();
      input.enabled = false;
      const go = () => { input.enabled = true; streaks.dispose(); onNew((inp.value || 'Wren').trim()); };
      menu.querySelector('[data-a="go"]').onclick = go;
      inp.onkeydown = (e) => { if (e.key === 'Enter') go(); };
      menu.querySelector('[data-a="back"]').onclick = () => { input.enabled = true; streaks.dispose(); el.remove(); this.title({ hasSave, onNew, onContinue }); };
    };
    const c = el.querySelector('[data-a="cont"]'); if (c) c.onclick = () => { this.sfx(); streaks.dispose(); onContinue(); };
    el.querySelector('[data-a="help"]').onclick = () => { this.sfx(); this.controlsPanel(); };
    this.root.appendChild(el);
    this.titleEl = el;
    return el;
  }

  /** Full-screen transit / jump tunnel. Resolves after `sec` seconds. */
  transitScreen(label, sub = '', sec = 2.8) {
    const el = $(`<div class="transit"><div class="tl"><div class="lbl">${esc(label)}</div><div class="sub">${esc(sub)}</div></div></div>`);
    this.root.appendChild(el);
    const st = new Streaks(el, { count: 420, speed: 0.2, vx: 0.5, vy: 0.5, alpha: 1, color: [170, 210, 255], z: 0 });
    const t0 = performance.now();
    return new Promise(res => {
      const tick = () => {
        const k = (performance.now() - t0) / 1000 / sec;
        st.set({ speed: 0.2 + Math.sin(Math.min(1, k) * Math.PI) * 7 });
        if (k < 1) requestAnimationFrame(tick); else { st.dispose(); el.remove(); res(); }
      };
      this.fadeIn(0.3);
      tick();
    });
  }

  loading(label = 'LADE') {
    const tip = TIPS[Math.floor(Math.random() * TIPS.length)];
    const el = $(`<div class="loading" style="background-image:url(${assets.url('assets/ui/title.jpg')})"><div class="box"><div class="lbl">${label}</div><div class="bar"><div></div></div><div class="tip">${tip}</div></div></div>`);
    this.root.appendChild(el);
    const bar = el.querySelector('.bar div');
    assets.onProgress = (l, t) => { bar.style.width = Math.round(100 * l / Math.max(t, 1)) + '%'; };
    return { done: () => { assets.onProgress = null; bar.style.width = '100%'; setTimeout(() => el.remove(), 150); } };
  }

  // ------------------------------------------------------------------ top bar
  topbar() {
    const g = this.g, ship = activeShip(g);
    const st = STATIONS[g.location];
    const el = $(`<div class="topbar">
      <span class="loc">${st ? st.name.toUpperCase() : ''}</span><span>Tag ${g.day}</span><span>${esc(g.callsign)} · ${rank(g)}</span><span class="sp"></span>
      <span>${ship ? esc(ship.name) + ' · Rumpf ' + Math.round(ship.hull * 100) + '%' : 'Kein Schiff'}</span>
      <span class="cr">${fmt(g.credits)} Cr</span></div>`);
    return el;
  }

  // ------------------------------------------------------------------ station overview (X-Wing Alliance style concourse)
  async overview(onPick) {
    const data = await assets.getJSON('assets/ui/overview.json');
    const el = $(`<div class="overview"><div class="img"></div></div>`);
    const img = el.querySelector('.img');
    img.style.backgroundImage = `url(${assets.url('assets/ui/overview.jpg')})`;
    el.appendChild(this.topbar());
    const hint = this.storyHint();
    if (hint) el.appendChild($(`<div class="sidehint">${hint}</div>`));
    const btns = $(`<div class="ovbtns"><button class="btn small" data-a="walk">Zu Fuß erkunden</button><button class="btn small" data-a="menu">Menü</button></div>`);
    btns.querySelector('[data-a="walk"]').onclick = () => { this.sfx(); onPick('walk'); };
    btns.querySelector('[data-a="menu"]').onclick = () => { this.sfx(); this.pause(); };
    el.appendChild(btns);
    // fit 16:9 image with "cover" and position hotspots on top
    const layout = () => {
      const W = innerWidth, H = innerHeight, ar = 16 / 9;
      let w = W, h = W / ar; if (h < H) { h = H; w = H * ar; }
      const x0 = (W - w) / 2, y0 = (H - h) / 2;
      Object.assign(img.style, { left: x0 + 'px', top: y0 + 'px', width: w + 'px', height: h + 'px' });
      for (const hs of el.querySelectorAll('.hs')) {
        const d = hs._d;
        Object.assign(hs.style, { left: x0 + d.x0 * w + 'px', top: y0 + d.y0 * h + 'px', width: (d.x1 - d.x0) * w + 'px', height: (d.y1 - d.y0) * h + 'px' });
      }
    };
    for (const d of data.hotspots) {
      const label = { bar: 'Bar „Cassini-Spalt“', hangar: 'Hangar 7', kabine: 'Quartiere', aussicht: 'Aussichtsplattform', boerse: 'Söldnerbörse', werft: 'Werft & Markt', karte: 'Systemkarte' }[d.id] || d.label;
      const hs = $(`<div class="hs"><div class="tag">${label}</div></div>`);
      hs._d = d;
      hs.onclick = () => { this.sfx(); onPick(d.id); };
      hs.onmouseenter = () => this.sfx('blip');
      el.appendChild(hs);
    }
    addEventListener('resize', layout);
    el._cleanup = () => removeEventListener('resize', layout);
    this.root.appendChild(el);
    layout();
    requestAnimationFrame(() => { img.style.transform = 'scale(1.035)'; });
    this.ov = el;
    return el;
  }

  closeOverview() { if (this.ov) { this.ov._cleanup(); this.ov.remove(); this.ov = null; } }

  refreshTopbar() {
    const old = this.root.querySelector('.topbar');
    if (old) old.replaceWith(this.topbar());
  }

  /** Warning line if a mission zone lies in a moon system the active ship cannot jump to yet. */
  jumpNeed(zone) {
    const mid = zone && moonOfZone(zone);
    if (!mid) return '';
    const need = MOONS[mid].jump, ship = activeShip(this.g), have = ship ? shipStats(ship).jump : 0;
    if (mid === moonOfStation(this.g.location) || have >= need) return '';
    return `<p class="bad" style="margin:4px 0 8px">Ziel ${MOONS[mid].name}: Sprungtriebwerk Klasse ${JUMP_CLASS[need]} nötig (Werft).</p>`;
  }

  storyHint() {
    const g = this.g;
    const st = STORY[g.story];
    if (!st || g.story === 'ende') return g.flags.endingShown ? '<b>FREIES SPIEL</b><br>Die Geschichte ist erzählt. Das Saturnsystem bleibt offen für Aufträge, Handel und Kopfgelder.' : '';
    if (g.story === 'prolog') return '<b>PROLOG · DREI NÄCHTE MIETE</b><br>40 Kredits auf dem Konto, kein Schiff. Geh in die Bar und hör dich um.';
    if (g.story === 'eisfracht' && !g.flags['accepted:eisfracht']) return '<b>EISFRACHT</b><br>Kix meinte, die Alte am Fenstertisch der Bar sucht einen Piloten.';
    if (g.flags['accepted:' + g.story]) return `<b>${esc(st.title.toUpperCase())}</b><br>${esc(st.brief)}${this.jumpNeed(st.zone)}`;
    if (g.story === 'funkstille') return '<b>FUNKSTILLE</b><br>Von Mags fehlt jede Spur. Vielleicht weiß Kix in der Bar mehr.';
    if (g.story === 'kassini') return '<b>DIE KASSINI-TEILUNG</b><br>Mags und Juno warten in der Bar. Es ist Zeit für eine Entscheidung.';
    if (st.available && st.available(g)) return `<b>NEUE STORYMISSION</b><br>„${esc(st.title)}“ wartet an der Söldnerbörse.`;
    return '<b>BROTLOS</b><br>Verdiene Kredits an der Söldnerbörse und rüste die Spacewing in der Werft auf.';
  }

  // ------------------------------------------------------------------ modal panel scaffold
  panel(title, sub, build, { onClose, wide } = {}) {
    const wrap = $(`<div class="modal"><div class="panel"><header><h3>${title}</h3><div class="sub">${sub || ''}</div><div class="x">✕</div></header><div class="body"></div></div></div>`);
    const body = wrap.querySelector('.body');
    const close = () => { wrap.remove(); this.modalStack = this.modalStack.filter(m => m !== wrap); onClose && onClose(); this.game.onModalClosed?.(); };
    wrap.querySelector('.x').onclick = () => { this.sfx(); close(); };
    wrap.addEventListener('mousedown', e => { if (e.target === wrap) close(); });
    wrap._close = close;
    wrap._body = body;
    wrap._sub = wrap.querySelector('.sub');
    this.root.appendChild(wrap);
    this.modalStack.push(wrap);
    input.unlock();
    const rebuild = () => { body.innerHTML = ''; build(body, rebuild, close, wrap); this.refreshTopbar(); };
    rebuild();
    return wrap;
  }

  closeTop() { const m = this.modalStack[this.modalStack.length - 1]; if (m) { m._close(); return true; } return false; }

  tabs(body, names, active, onPick) {
    const t = $(`<div class="tabs">${names.map(([k, n]) => `<div data-k="${k}" class="${k === active ? 'on' : ''}">${n}</div>`).join('')}</div>`);
    t.querySelectorAll('div').forEach(d => d.onclick = () => { this.sfx(); onPick(d.dataset.k); });
    body.parentElement.insertBefore(t, body);
    return t;
  }

  // ------------------------------------------------------------------ Söldnerbörse
  openBoerse() {
    const station = this.g.location;
    this.panel('Söldnerbörse', `${STATIONS[station].name} · Dispatcher Femi Oduya`, (body, rebuild) => {
      const g = this.g;
      const jobs = generateJobs(g, station);
      const st = STORY[g.story];
      let html = '<div class="cards">';
      if (st && st.available && st.available(g) && !g.flags['accepted:' + g.story] && st.giver !== 'kix' && st.giver !== 'juno') {
        html += `<div class="card story"><div class="meta">STORYMISSION</div><h4>${esc(st.title)}</h4><p>${esc(st.brief)}</p>${this.jumpNeed(st.zone)}<div class="row"><span class="warm">Story</span><button class="btn small warm" data-story="1">Annehmen</button></div></div>`;
      }
      if (g.story === 'kassini' && !g.flags.ending && g.flags['done:schakalnest']) {
        html += `<div class="card story"><div class="meta">STORY</div><h4>Die Kassini-Teilung</h4><p>Mags und Juno warten in der Bar auf deine Entscheidung.</p></div>`;
      }
      for (const j of jobs) {
        html += `<div class="card"><div class="meta">${j.kind === 'fracht' ? 'FRACHTAUFTRAG' : j.kind === 'kopfgeld' ? 'KOPFGELD' : 'ESKORTE'} · ${esc(j.client)}</div>
          <h4>${esc(j.title)}</h4><p>${esc(j.text)}</p>
          ${j.kind === 'fracht' ? `<div class="meta">Ziel: ${STATIONS[j.to].name} · Reise ${travelInfo(STATIONS[station].zone, STATIONS[j.to].zone).hours.toFixed(1)} h${j.risk ? ' · <span class="bad">Risiko ' + '▲'.repeat(j.risk) + '</span>' : ''}</div>` : ''}
          <div class="row"><span class="warm">${fmt(j.pay)} Cr</span><button class="btn small" data-job="${j.id}">Annehmen</button></div></div>`;
      }
      html += '</div>';
      if (g.jobs.length) {
        html += '<h4 style="font-family:var(--f-head);letter-spacing:.14em;margin:22px 0 8px">LAUFENDE AUFTRÄGE</h4><table class="grid"><tr><th>Auftrag</th><th>Ziel</th><th class="num">Lohn</th><th></th></tr>';
        for (const j of g.jobs) {
          const target = j.kind === 'fracht' ? STATIONS[j.to].name : ZONES[j.zone].name;
          html += `<tr><td>${esc(j.title)}${j.done ? ' <span class="good">✓ erfüllt</span>' : ''}</td><td>${esc(target)}</td><td class="num warm">${fmt(j.pay)}</td><td class="num"><button class="btn small" data-drop="${j.id}">Abbrechen</button></td></tr>`;
        }
        html += '</table>';
      }
      body.innerHTML = html;
      body.querySelector('[data-story]')?.addEventListener('click', () => {
        this.sfx(); acceptStory(this.game, g.story); st.onAccept && st.onAccept(this.game); this.game.save(); rebuild();
      });
      body.querySelectorAll('[data-job]').forEach(b => b.onclick = () => {
        const j = jobs.find(x => x.id === b.dataset.job);
        const err = acceptJob(this.game, j);
        if (err) { this.sfx('error'); this.notify(err); } else { this.sfx('coins'); this.notify('Auftrag angenommen'); this.game.save(); }
        rebuild();
      });
      body.querySelectorAll('[data-drop]').forEach(b => b.onclick = () => { abandonJob(this.game, g.jobs.find(x => x.id === b.dataset.drop)); this.sfx(); rebuild(); });
    });
  }

  // ------------------------------------------------------------------ market
  openMarket(wrapTab) {
    const station = this.g.location;
    return this.panel('Markt', `${STATIONS[station].name} · ${STATIONS[station].blurb}`, (body, rebuild) => this.marketBody(body, rebuild, station));
  }

  marketBody(body, rebuild, station) {
    const g = this.g, ship = activeShip(g);
    if (!ship) { body.innerHTML = '<p class="dim">Du hast kein Schiff, in das du Fracht laden könntest.</p>'; return; }
    const free = cargoFree(ship);
    let html = `<div class="meta" style="margin-bottom:10px">Frachtraum ${esc(ship.name)}: <b>${cargoUsed(ship)}</b> / ${shipStats(ship).cargo} belegt · Kredits <span class="warm">${fmt(g.credits)}</span></div>
      <table class="grid"><tr><th>Ware</th><th class="num">Kaufen</th><th class="num">Verkaufen</th><th class="num">An Bord</th><th class="num">Handel</th></tr>`;
    for (const [k, c] of Object.entries(COMMODITIES)) {
      const buy = price(g, station, k, 'buy'), sell = price(g, station, k, 'sell');
      const have = ship.cargo[k] || 0;
      const avail = availableAt(station, k);
      const base = c.base;
      const cls = sell > base * 1.15 ? 'good' : buy < base * 0.85 ? 'good' : '';
      html += `<tr><td>${esc(c.name)} <span class="dim">/${c.unit}</span>${c.illegal ? ' <span class="bad">illegal</span>' : ''}</td>
        <td class="num ${buy < base * 0.85 ? 'good' : ''}">${avail ? fmt(buy) : '<span class="dim">–</span>'}</td>
        <td class="num ${sell > base * 1.15 ? 'good' : ''}">${fmt(sell)}</td><td class="num">${have || ''}</td>
        <td class="num"><span class="qty">${avail ? `<button data-b="${k}" data-n="1">+1</button><button data-b="${k}" data-n="10">+10</button>` : ''}${have ? `<button data-s="${k}" data-n="1">−1</button><button data-s="${k}" data-n="${have}">alle</button>` : ''}</span></td></tr>`;
    }
    html += '</table>';
    const jobCargo = Object.entries(ship.cargo).filter(([k]) => k.startsWith('job:'));
    if (jobCargo.length) html += `<p class="dim" style="margin-top:12px">Auftragsfracht an Bord: ${jobCargo.map(([k, n]) => n + ' Einheiten').join(', ')}</p>`;
    body.innerHTML = html;
    body.querySelectorAll('[data-b]').forEach(b => b.onclick = () => {
      const k = b.dataset.b; let n = Math.min(+b.dataset.n, cargoFree(ship));
      const p = price(g, station, k, 'buy');
      n = Math.min(n, Math.floor(g.credits / p));
      if (n <= 0) { this.sfx('error'); return; }
      g.credits -= n * p; ship.cargo[k] = (ship.cargo[k] || 0) + n; this.sfx('coins'); rebuild();
    });
    body.querySelectorAll('[data-s]').forEach(b => b.onclick = () => {
      const k = b.dataset.s; const n = Math.min(+b.dataset.n, ship.cargo[k] || 0);
      const p = price(g, station, k, 'sell');
      ship.cargo[k] -= n; if (!ship.cargo[k]) delete ship.cargo[k];
      addCredits(g, n * p); this.sfx('coins'); rebuild();
    });
  }

  // ------------------------------------------------------------------ shipyard
  /** Yara's workshop in Hangar 7: upgrades ("mods"), repairs and paint. */
  openWerkstatt() {
    return this.panel('Werkstatt', 'Hangar 7 · Yara Benedek · Mods, Reparatur, Lackierung', (body, rebuild) => this.shipUpgrades(body, rebuild), { wide: true, onClose: () => this.disposePreview() });
  }

  openWerft(initialTab) {
    const station = this.g.location;
    // on Cassini the mods are done in Yara's workshop; Lenka sells ships and goods
    const home = station === 'cassini';
    let tab = initialTab || (home ? 'kauf' : 'werft');
    return this.panel(home ? 'Werft & Markt' : 'Werft & Markt', `${STATIONS[station].name}${home ? ' · Lenka Brandvold' : ''}`, (body, rebuild, close, w) => {
      if (tab !== 'werft') this.disposePreview();
      const old = w.querySelector('.tabs'); if (old) old.remove();
      this.tabs(body, [...(home ? [] : [['werft', 'Mein Schiff']]), ['kauf', 'Schiffe kaufen'], ['hangar', 'Hangar'], ['markt', 'Markt']], tab, (k) => { tab = k; rebuild(); });
      if (tab === 'markt') return this.marketBody(body, rebuild, station);
      if (tab === 'kauf') return this.shipShop(body, rebuild);
      if (tab === 'hangar') return this.hangarList(body, rebuild);
      this.shipUpgrades(body, rebuild);
    }, { wide: true, onClose: () => this.disposePreview() });
  }

  disposePreview() { this.pv?.dispose(); this.pv = null; this.pvWrap = null; }

  /** Before/after numbers for a mod, shown next to the 3D preview. */
  modDiff(ship, k) {
    const lv = ship.upgrades[k] || 0;
    if (lv >= maxLevel(k)) return `<b>${UPGRADES[k].name}</b><div class="good">Voll ausgebaut</div>`;
    const a = shipStats(ship), b = shipStats({ ...ship, upgrades: { ...ship.upgrades, [k]: lv + 1 } });
    const rows = {
      engine: [['Tempo', 'speed', ' m/s'], ['Nachbrenner', 'boost', ' m/s'], ['Wendigkeit', 'turn', '', 2]],
      shield: [['Schild', 'shield', '']], armor: [['Rumpf', 'hull', '']],
      lasers: [['Laser-DPS', (s) => s.laserDmg * s.laserRate, '']], missiles: [['Raketen', 'missiles', ''], ['Erfassung', 'lockTime', ' s', 2]],
      cargo: [['Fracht', 'cargo', ' t']], reactor: [['Energie/s', 'regen', '', 1]], salvage: [['Bergungsnetz', 'salvage', ' t']],
      jump: [['Sprungklasse', (s) => JUMP_CLASS[s.jump], '']],
    }[k] || [];
    const val = (s, f) => typeof f === 'function' ? f(s) : s[f];
    const show = (v, dig) => typeof v === 'number' ? (dig ? v.toFixed(dig) : Math.round(v)) : v;
    const p = upgradePrice(ship.cls, k, lv);
    return `<b>${UPGRADES[k].name} · Stufe ${lv + 1}</b><div class="dim" style="font-size:12px;margin:2px 0 6px">${UPGRADES[k].desc}</div>` +
      rows.map(([l, f, u, dig]) => `<div class="svrow"><span>${l}</span><span>${show(val(a, f), dig)}${u}</span><span class="arrow">→</span><span class="good">${show(val(b, f), dig)}${u}</span></div>`).join('') +
      `<div style="margin-top:6px" class="${this.g.credits >= p ? 'warm' : 'bad'}">${fmt(p)} Cr${this.g.credits >= p ? '' : ' · es fehlen ' + fmt(p - this.g.credits) + ' Cr'}</div>`;
  }

  shipUpgrades(body, rebuild) {
    const g = this.g, ship = activeShip(g);
    if (!ship) { body.innerHTML = '<p class="dim">Kein Schiff im Hangar.</p>'; return; }
    const cls = SHIP_CLASSES[ship.cls], st = shipStats(ship);
    const repairCost = Math.round((1 - ship.hull) * st.hull * 6);
    let html = `<div class="split"><div>
      <div class="svslot"></div>
      <h4 style="font-family:var(--f-head);font-size:22px;letter-spacing:.1em;margin:10px 0 2px">${esc(ship.name)}</h4>
      <div class="dim">${esc(cls.maker)} · ${esc(cls.role)}</div><p style="line-height:1.5">${esc(cls.desc || '')}</p>
      <div class="statgrid">
        <span>Rumpf</span><div class="meter"><div style="width:${ship.hull * 100}%;background:${ship.hull < 0.5 ? 'var(--bad)' : 'var(--accent)'}"></div></div><span>${Math.round(ship.hull * st.hull)}/${Math.round(st.hull)}</span>
        <span>Schild</span><div class="meter"><div style="width:${Math.min(100, st.shield / 7)}%"></div></div><span>${Math.round(st.shield)}</span>
        <span>Tempo</span><div class="meter"><div style="width:${Math.min(100, st.speed / 3.5)}%"></div></div><span>${Math.round(st.speed)} m/s</span>
        <span>Wendigkeit</span><div class="meter"><div style="width:${Math.min(100, st.turn * 40)}%"></div></div><span>${st.turn.toFixed(2)}</span>
        <span>Laser</span><div class="meter"><div style="width:${Math.min(100, st.laserDmg * st.laserRate / 2.2)}%"></div></div><span>${Math.round(st.laserDmg * st.laserRate)} DPS</span>
        <span>Fracht</span><div class="meter"><div style="width:${Math.min(100, st.cargo)}%"></div></div><span>${st.cargo}</span>
      </div>
      ${ship.hull < 0.999 ? `<button class="btn warm" style="margin-top:12px" data-repair="1">Reparieren · ${fmt(repairCost)} Cr</button>` : ''}
      </div><div>
      <h4 style="font-family:var(--f-head);letter-spacing:.14em;margin:0 0 10px">UPGRADES</h4><table class="grid">`;
    for (const [k, u] of Object.entries(UPGRADES)) {
      const lv = ship.upgrades[k] || 0;
      const p = lv < maxLevel(k) ? upgradePrice(ship.cls, k, lv) : null;
      html += `<tr data-pv="${k}" class="pvrow${this.pvKey === k ? ' sel' : ''}"${k === 'jump' ? ' style="background:rgba(255,207,122,.06)"' : ''}><td><b>${u.name}</b>${k === 'jump' ? ` <span class="warm">Klasse ${JUMP_CLASS[lv]}</span>` : ''}<div class="dim" style="font-size:12px">${u.desc}</div></td>
        <td><div class="pips">${Array.from({ length: maxLevel(k) }, (_, i) => `<i class="${i < lv ? 'on' : ''}"></i>`).join('')}</div></td>
        <td class="num">${p != null ? `<button class="btn small" data-up="${k}" ${g.credits < p ? 'disabled' : ''}>${fmt(p)} Cr</button>` : '<span class="good">MAX</span>'}</td></tr>`;
    }
    html += `</table><h4 style="font-family:var(--f-head);letter-spacing:.14em;margin:18px 0 8px">LACKIERUNG · ${PAINT_PRICE} Cr</h4><div class="swatches">`;
    for (const p of PAINTS) html += `<div data-paint="${p.id || ''}" title="${p.name}" class="${(ship.paint || null) === p.hex ? 'on' : ''}" style="background:${p.hex || 'linear-gradient(135deg,#a8602f,#8b8f8c)'}"></div>`;
    html += `</div><div style="margin-top:14px"><label class="dim">Name: </label><input data-name value="${esc(ship.name)}" maxlength="22" style="background:#000;border:1px solid var(--line);color:#fff;padding:6px;font-family:var(--f-head);font-size:16px"></div></div></div>`;
    body.innerHTML = html;
    // live 3D preview: kept across rebuilds (one WebGL context per open panel)
    if (!this.pvWrap || this.pvShip !== ship.uid) {
      this.disposePreview();
      this.pvWrap = document.createElement('div'); this.pvWrap.className = 'shipview';
      this.pvWrap.innerHTML = '<canvas></canvas><div class="svinfo dim">Mod anklicken für eine Vorschau</div>';
      this.pv = new ShipPreview(this.pvWrap.querySelector('canvas'), ship); this.pvShip = ship.uid; this.pvKey = null;
    }
    body.querySelector('.svslot').replaceWith(this.pvWrap);
    requestAnimationFrame(() => this.pv?.resize());
    const info = this.pvWrap.querySelector('.svinfo');
    if (this.pvKey) info.innerHTML = this.modDiff(ship, this.pvKey);
    body.querySelectorAll('[data-pv]').forEach(tr => tr.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      const k = tr.dataset.pv; this.pvKey = k;
      body.querySelectorAll('.pvrow').forEach(r => r.classList.toggle('sel', r === tr));
      info.classList.remove('dim'); info.innerHTML = this.modDiff(ship, k);
      this.pv.showUpgrade(k, (ship.upgrades[k] || 0) + 1); this.sfx('blip');
    }));
    body.querySelector('[data-repair]')?.addEventListener('click', () => {
      if (g.credits < repairCost) { this.sfx('error'); this.notify('Nicht genug Kredits'); return; }
      g.credits -= repairCost; ship.hull = 1; this.sfx('coins'); rebuild();
    });
    body.querySelectorAll('[data-up]').forEach(b => b.onclick = () => {
      const k = b.dataset.up, lv = ship.upgrades[k] || 0, p = upgradePrice(ship.cls, k, lv);
      if (g.credits < p) { this.sfx('error'); return; }
      g.credits -= p; ship.upgrades[k] = lv + 1; logEntry(g, `${UPGRADES[k].name} Stufe ${lv + 1} eingebaut`); this.sfx('coins'); this.game.save();
      this.pvKey = k; this.pv?.showUpgrade(k, lv + 1); rebuild();
    });
    body.querySelectorAll('[data-paint]').forEach(d => {
      const p = PAINTS.find(x => (x.id || '') === d.dataset.paint);
      d.addEventListener('mouseenter', () => this.pv?.setPaint(p.hex));
      d.addEventListener('mouseleave', () => this.pv?.setPaint(ship.paint || null));
    });
    body.querySelectorAll('[data-paint]').forEach(d => d.onclick = () => {
      const p = PAINTS.find(x => (x.id || '') === d.dataset.paint);
      if ((ship.paint || null) === p.hex) return;
      if (g.credits < PAINT_PRICE) { this.sfx('error'); this.notify('Nicht genug Kredits'); return; }
      g.credits -= PAINT_PRICE; ship.paint = p.hex; this.sfx('coins'); rebuild();
    });
    const nm = body.querySelector('[data-name]');
    input.enabled = true;
    nm.onfocus = () => { input.enabled = false; }; nm.onblur = () => { input.enabled = true; ship.name = nm.value || ship.name; this.refreshTopbar(); };
  }

  shipShop(body, rebuild) {
    const g = this.g;
    let html = '<div class="cards">';
    for (const [id, c] of Object.entries(SHIP_CLASSES)) {
      if (c.npcOnly) continue;
      const locked = c.needsRep && Object.entries(c.needsRep).some(([f, v]) => (g.rep[f] || 0) < v);
      html += `<div class="card"><img src="${assets.url(`assets/ships/${id}/preview.jpg`)}"><h4>${esc(c.name)}</h4><div class="meta">${esc(c.maker)} · ${esc(c.role)}</div>
        <p style="font-size:14px">${esc(c.desc || '')}</p>
        <div class="meta">Rumpf ${c.hull} · Schild ${c.shield} · ${c.speed} m/s · Fracht ${c.cargo} · Raketen ${c.missiles}</div>
        <div class="row"><span class="warm">${fmt(c.price)} Cr</span>${locked ? '<span class="bad">Nur mit Konsortiums-Ruf</span>' : `<button class="btn small" data-buy="${id}" ${g.credits < c.price ? 'disabled' : ''}>Kaufen</button>`}</div></div>`;
    }
    html += '</div>';
    body.innerHTML = html;
    body.querySelectorAll('[data-buy]').forEach(b => b.onclick = () => {
      const id = b.dataset.buy, c = SHIP_CLASSES[id];
      if (g.credits < c.price) return;
      g.credits -= c.price;
      const s = addShip(g, id); g.activeShip = s.uid;
      logEntry(g, `${c.name} gekauft`); this.sfx('coins'); this.notify(`${c.name} gehört dir. Sie steht in Hangar 7.`); this.game.save(); rebuild();
    });
  }

  hangarList(body, rebuild) {
    const g = this.g;
    let html = '<table class="grid"><tr><th>Schiff</th><th>Klasse</th><th class="num">Rumpf</th><th class="num">Wert</th><th></th></tr>';
    for (const s of g.ships) {
      const c = SHIP_CLASSES[s.cls];
      const val = Math.round((c.price || 20000) * 0.55 + Object.entries(s.upgrades).reduce((a, [k, l]) => { let v = 0; for (let i = 0; i < l; i++) v += upgradePrice(s.cls, k, i) * 0.5; return a + v; }, 0));
      const active = s.uid === g.activeShip;
      html += `<tr><td>${esc(s.name)} ${active ? '<span class="good">· aktiv</span>' : ''}</td><td>${esc(c.name)}</td><td class="num">${Math.round(s.hull * 100)} %</td><td class="num warm">${fmt(val)}</td>
        <td class="num">${active ? '' : `<button class="btn small" data-act="${s.uid}">Aktivieren</button> `}${g.ships.length > 1 && cargoUsed(s) === 0 ? `<button class="btn small" data-sell="${s.uid}" data-v="${val}">Verkaufen</button>` : ''}</td></tr>`;
    }
    html += '</table>';
    body.innerHTML = html;
    body.querySelectorAll('[data-act]').forEach(b => b.onclick = () => { g.activeShip = b.dataset.act; this.sfx(); rebuild(); });
    body.querySelectorAll('[data-sell]').forEach(b => b.onclick = () => {
      const s = g.ships.find(x => x.uid === b.dataset.sell);
      if (s.cls === 'spacewing' && !confirm('Teos Spacewing wirklich verkaufen? Mags wird das nicht gefallen.')) return;
      g.ships = g.ships.filter(x => x !== s); addCredits(g, +b.dataset.v, `${s.name} verkauft`);
      if (g.activeShip === s.uid) g.activeShip = g.ships[0]?.uid; this.sfx('coins'); rebuild();
    });
  }

  // ------------------------------------------------------------------ cabin terminal
  openTerminal() {
    this.panel('Terminal', 'Kabine 4-117 · Hochstation Cassini', (body, rebuild) => {
      const g = this.g;
      const reps = Object.entries(g.rep).map(([k, v]) => `<span>${FACTIONS[k]?.name || k}</span><div class="meter"><div style="width:${Math.min(100, Math.abs(v))}%;background:${v >= 0 ? 'var(--good)' : 'var(--bad)'}"></div></div><span class="${v >= 0 ? 'good' : 'bad'}">${v}</span>`).join('');
      body.innerHTML = `<div class="split"><div>
        <h4 style="font-family:var(--f-head);letter-spacing:.14em;margin:0 0 8px">PILOT</h4>
        <div class="statgrid"><span>Rufzeichen</span><b>${esc(g.callsign)}</b><span></span><span>Rang</span><b>${rank(g)}</b><span></span>
        <span>Kredits</span><b class="warm">${fmt(g.credits)}</b><span></span><span>Verdient</span><b>${fmt(g.earned)}</b><span></span><span>Abschüsse</span><b>${g.kills}</b><span></span><span>Tag</span><b>${g.day}</b><span></span></div>
        <h4 style="font-family:var(--f-head);letter-spacing:.14em;margin:16px 0 8px">RUF</h4><div class="statgrid">${reps}</div>
        <div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap"><button class="btn small warm" data-save>Speichern</button><button class="btn small" data-apt>Apartments &amp; Transit</button><button class="btn small" data-story>Story-Bibel</button></div>
        </div><div><h4 style="font-family:var(--f-head);letter-spacing:.14em;margin:0 0 8px">LOGBUCH</h4>
        <div style="max-height:52vh;overflow:auto;font-size:14px;line-height:1.6">${g.log.map(l => `<div><span class="dim">Tag ${l.day}</span> · ${esc(l.text)}</div>`).join('') || '<span class="dim">Noch leer.</span>'}</div></div></div>`;
      body.querySelector('[data-save]').onclick = () => { this.game.save(); this.notify('Spielstand gespeichert'); this.sfx('coins'); };
      body.querySelector('[data-apt]').onclick = () => this.openApartment(g.location);
      body.querySelector('[data-story]').onclick = () => window.open('https://github.com/simon23-12/SpaceWing/blob/main/docs/STORY.md', '_blank');
    });
  }

  /** Buy an apartment at a station; once you own two, you can transit between them. */
  openApartment(stationId) {
    const st = STATIONS[stationId];
    this.panel('Apartments', `${st.name} · Transit zwischen eigenen Apartments`, (body, rebuild) => {
      const g = this.g;
      g.apartments = g.apartments || {};
      const own = !!g.apartments[stationId];
      let html = `<div class="split"><div><h4 style="font-family:var(--f-head);letter-spacing:.14em;margin:0 0 8px">HIER</h4>`;
      if (!st.apartment) html += '<p class="dim">Auf dieser Station werden keine Wohnungen verkauft.</p>';
      else if (own) html += `<p><b class="good">⌂ ${esc(st.flat)}</b><br><span class="dim">Dein Eigentum. Keine Miete, ein Bett, ein Transit-Anschluss.</span></p>`;
      else html += `<p><b>${esc(st.flat)}</b><br><span class="dim">Mit eigener Transit-Kapsel ins Quanten-Relais der Stationen.</span></p><button class="btn warm" data-buy ${g.credits < st.apartment ? 'disabled' : ''}>Kaufen · ${fmt(st.apartment)} Cr</button>`;
      html += `<p class="dim" style="margin-top:16px;line-height:1.5">Wer auf zwei Stationen ein Apartment besitzt, reist per Transit-Kapsel ohne Flug zwischen ihnen. Dein aktives Schiff wird vom Frachtdienst mitgenommen.</p></div><div>
        <h4 style="font-family:var(--f-head);letter-spacing:.14em;margin:0 0 8px">TRANSIT</h4>`;
      const others = MOON_ORDER.map(m => MOONS[m].station).filter(sid => sid !== stationId);
      for (const sid of others) {
        const S = STATIONS[sid], M = MOONS[moonOfStation(sid)];
        const has = !!g.apartments[sid], open = M.unlock(g);
        html += `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin:8px 0;padding:8px;border:1px solid var(--line)">
          <div><b style="color:${M.color}">${M.name}</b> · ${esc(S.name)}<div class="dim" style="font-size:12px">${has ? '⌂ ' + esc(S.flat) : open ? `Kein Apartment (${fmt(S.apartment)} Cr vor Ort)` : 'Mond noch gesperrt'}</div></div>
          ${has && own ? `<button class="btn small warm" data-go="${sid}">Transit</button>` : ''}</div>`;
      }
      html += `</div></div>`;
      body.innerHTML = html;
      body.querySelector('[data-buy]')?.addEventListener('click', () => {
        if (g.credits < st.apartment) return;
        g.credits -= st.apartment; g.apartments[stationId] = true;
        logEntry(g, `Apartment gekauft: ${st.flat}, ${st.name}`);
        this.sfx('coins'); this.notify('Apartment gekauft. Willkommen zu Hause.'); this.game.save(); rebuild(); this.refreshTopbar();
      });
      body.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { this.closeTop(); this.game.teleport(b.dataset.go); });
    });
  }

  // ------------------------------------------------------------------ map / travel
  openMap(flight) {
    const g = this.g;
    const here = flight ? flight.zoneId : STATIONS[g.location].zone;
    const hereMoon = moonOfZone(here);
    const ship = flight ? (flight.player.record?.cls ? flight.player.record : null) : activeShip(g);
    const jumpCls = ship ? shipStats(ship).jump : 0;
    let selMoon = hereMoon, selZone = null;
    const wrap = this.panel('Systemkarte · Saturn', flight ? `Sprungtriebwerk: Klasse ${JUMP_CLASS[jumpCls]} · Ziel wählen` : 'Die fünf Monde · Saturn ist dein Fixpunkt', (body) => {
      body.innerHTML = `<div class="mapwrap"><canvas width="900" height="666"></canvas><div class="dest"><div class="destinfo"></div><div class="list"></div></div></div>`;
      const cv = body.querySelector('canvas'), ctx = cv.getContext('2d');
      const info = body.querySelector('.destinfo'), list = body.querySelector('.list');
      const proj = (p) => {
        const r = Math.hypot(p[0], p[2]); const a = Math.atan2(p[2], p[0]);
        const k = Math.log10(Math.max(r, 60000) / 60000) / Math.log10(4.2e6 / 60000);
        const R = 70 + k * 300;
        return [450 + Math.cos(a) * R, 333 + Math.sin(a) * R * 0.62];
      };
      const open = (id) => MOONS[id].unlock(g);
      const draw = () => {
        ctx.clearRect(0, 0, 900, 666);
        ctx.strokeStyle = 'rgba(120,200,255,0.12)';
        for (const id of MOON_ORDER) {
          const b = BODIES[id]; const r = Math.hypot(b.pos[0], b.pos[2]); const k = Math.log10(r / 60000) / Math.log10(4.2e6 / 60000); const R = 70 + k * 300;
          ctx.beginPath(); ctx.ellipse(450, 333, R, R * 0.62, 0, 0, Math.PI * 2); ctx.stroke();
        }
        const grd = ctx.createRadialGradient(440, 325, 4, 450, 333, 30); grd.addColorStop(0, '#f4e2b8'); grd.addColorStop(1, '#a8885a');
        ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(450, 333, 26, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(230,210,170,.7)'; ctx.lineWidth = 6; ctx.beginPath(); ctx.ellipse(450, 333, 52, 15, -0.3, 0, Math.PI * 2); ctx.stroke(); ctx.lineWidth = 1;
        ctx.fillStyle = '#e8d4a8'; ctx.font = '600 15px Rajdhani, sans-serif'; ctx.fillText('SATURN', 428, 380);
        ctx.font = '600 24px Rajdhani, sans-serif';
        for (const id of MOON_ORDER) {
          const M = MOONS[id];
          const [x, y] = proj(BODIES[id].pos);
          const isHere = id === hereMoon, isSel = id === selMoon, ok = open(id);
          const story = STORY[g.story] && g.flags['accepted:' + g.story] && M.zones.includes(STORY[g.story].zone);
          ctx.globalAlpha = ok ? 1 : 0.45;
          ctx.fillStyle = M.color; ctx.beginPath(); ctx.arc(x, y, isSel ? 13 : 9, 0, Math.PI * 2); ctx.fill();
          if (isSel) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 19, 0, Math.PI * 2); ctx.stroke(); ctx.lineWidth = 1; }
          if (story) { ctx.strokeStyle = '#ffcf7a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 26, 0, Math.PI * 2); ctx.stroke(); ctx.lineWidth = 1; }
          ctx.fillStyle = isHere ? '#bff5c4' : ok ? '#d8e6ef' : '#8a96a0';
          const apt = g.apartments?.[M.station] ? ' ⌂' : '';
          ctx.fillText(`${M.name}${isHere ? ' (hier)' : ''}${ok ? '' : ' 🔒'}${apt}`, x + 18, y + 8);
          ctx.globalAlpha = 1;
        }
      };
      const zoneButtons = (mid) => {
        const M = MOONS[mid];
        const ok = open(mid);
        let html = `<b style="font-size:20px;color:${M.color}">${M.name.toUpperCase()}</b> <span class="dim">· ${M.tag}</span><br><span style="line-height:1.45">${M.desc}</span><br>`;
        html += `<span class="dim">Sprungklasse ${JUMP_CLASS[M.jump] || '–'} · Station: ${STATIONS[M.station].name}${g.apartments?.[M.station] ? ' · ⌂ Apartment' : ''}</span>`;
        if (!ok) html += `<br><span class="bad">Gesperrt.</span> Freischalten: ${M.why}`;
        info.innerHTML = html;
        list.innerHTML = '';
        if (!ok) return;
        for (const zid of M.zones) {
          const z = ZONES[zid];
          const row = $(`<div style="margin-top:10px"><div><b>${esc(z.name)}</b>${zid === here ? ' <span class="good">(hier)</span>' : ''}${z.hostile ? ' <span class="bad">feindlich</span>' : ''}</div></div>`);
          if (flight && zid !== here) {
            const jump = mid !== hereMoon;
            const t = travelInfo(here, zid);
            const borrowed = flight.player.record?.uid?.startsWith('TEMP');   // story ships: the owner pays the fuel
            const fuelCost = borrowed ? 0 : jump ? Math.round((260 + M.jump * 180) * (g.flags.zoll ? 1.4 : 1)) : Math.round(t.fuel * (g.flags.zoll ? 26 : 18));
            const b = $(`<button class="btn ${jump ? 'warm' : ''} small" style="margin-top:6px">${jump ? 'Hyperraumsprung' : 'Fusionsbrand'} · ${fuelCost} Cr</button>`);
            const blocked = flight.ships.some(s => s.alive && flight.isHostile(s, flight.player) && s.pos.distanceTo(flight.player.pos) < 2500);
            if (jump && jumpCls < M.jump) b.disabled = true, b.textContent = `Sprungtriebwerk Klasse ${JUMP_CLASS[M.jump]} nötig (Werft)`;
            else if (blocked) b.disabled = true, b.textContent = 'Feinde zu nah';
            else if (g.credits < fuelCost) b.disabled = true, b.textContent = 'Zu wenig Kredits für Treibstoff';
            b.onclick = () => { g.credits -= fuelCost; wrap._close(); this.game.travel(flight, zid, jump); };
            row.appendChild(b);
          }
          list.appendChild(row);
        }
        if (!flight && mid !== hereMoon && g.apartments?.[M.station] && g.apartments?.[g.location] && g.docked) {
          const b = $(`<button class="btn warm" style="margin-top:12px">Apartment-Transit nach ${esc(M.name)}</button>`);
          b.onclick = () => { wrap._close(); this.game.teleport(M.station); };
          list.appendChild(b);
        }
      };
      const pick = (id) => { selMoon = id; draw(); this.sfx('blip'); zoneButtons(id); };
      cv.onclick = (e) => {
        const r = cv.getBoundingClientRect(); const mx = (e.clientX - r.left) * 900 / r.width, my = (e.clientY - r.top) * 666 / r.height;
        let best = null, bd = 34;
        for (const id of MOON_ORDER) { const [x, y] = proj(BODIES[id].pos); const d = Math.hypot(x - mx, y - my); if (d < bd) { bd = d; best = id; } }
        if (best) pick(best);
      };
      const tabs = $(`<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px"></div>`);
      for (const id of MOON_ORDER) { const b = $(`<button class="btn small">${MOONS[id].name}${open(id) ? '' : ' 🔒'}</button>`); b.onclick = () => pick(id); tabs.appendChild(b); }
      info.before(tabs);
      pick(selMoon);
    }, { onClose: () => { if (flight) flight.paused = false; } });
    if (flight) flight.paused = true;
    return wrap;
  }

  // ------------------------------------------------------------------ dialogue
  /** steps: [{who, text, choices?, act?, label?, go?, end?}] → resolves when finished */
  dialog(steps) {
    return new Promise((resolve) => {
      input.unlock();
      const el = $(`<div class="dialog"><div class="portrait"></div><div style="flex:1"><div class="who"></div><div class="role"></div><div class="txt"></div><div class="choices"></div><div class="cont">[LEERTASTE / KLICK] weiter</div></div></div>`);
      this.root.appendChild(el);
      this.dlg = el;
      let i = 0, typing = null, full = '';
      const labels = {}; steps.forEach((s, k) => { if (s.label) labels[s.label] = k; });
      const finish = () => { removeEventListener('keydown', key); el.remove(); this.dlg = null; this.game.audio?.stopVoice?.(); resolve(); };
      const show = () => {
        if (i >= steps.length) return finish();
        const s = steps[i];
        const p = PEOPLE[s.who] || { name: s.who, role: '', ini: '?', color: '#9fd6ff' };
        el.querySelector('.who').textContent = p.name; el.querySelector('.who').style.color = p.color;
        el.querySelector('.role').textContent = p.role;
        const por = el.querySelector('.portrait');
        por.innerHTML = `<img src="${assets.url(`assets/portraits/${s.who}.jpg`)}" onerror="this.remove()"><div class="ini" style="color:${p.color}">${p.ini}</div>`;
        por.querySelector('img')?.addEventListener('load', () => por.querySelector('.ini')?.remove());
        por.style.background = `radial-gradient(circle at 50% 40%, ${p.color}55, #0a141e 72%)`;
        full = s.text; const t = el.querySelector('.txt'); t.textContent = '';
        let n = 0; clearInterval(typing);
        typing = setInterval(() => { n += 2; t.textContent = full.slice(0, n); if (n >= full.length) { clearInterval(typing); typing = null; } }, 16);
        if (!(s.who !== 'self' && this.game.audio?.voiceLength?.(s.text, this.g?.callsign) && this.game.audio.speak(s.text, { name: this.g?.callsign }))) this.game.audio?.blip();
        const ch = el.querySelector('.choices'); ch.innerHTML = '';
        el.querySelector('.cont').style.display = s.choices ? 'none' : '';
        if (s.choices) s.choices.forEach((c, k) => {
          const d = $(`<div><span class="k">${k + 1}</span>${esc(c.t)}</div>`);
          d.onclick = (e) => { e.stopPropagation(); choose(c); };
          ch.appendChild(d);
        });
      };
      const choose = (c) => {
        this.sfx();
        if (c.act) c.act(this.game);
        if (c.end) return finish();
        i = c.go != null ? labels[c.go] : i + 1;
        show();
      };
      const next = () => {
        const s = steps[i];
        if (!s) return finish();
        if (typing) { clearInterval(typing); typing = null; el.querySelector('.txt').textContent = full; return; }
        if (s.choices) return;
        if (s.act) s.act(this.game);
        if (s.end) return finish();
        i = s.go != null ? labels[s.go] : i + 1;
        show();
      };
      const key = (e) => {
        const s = steps[i];
        if (s && s.choices && /^Digit[1-9]$/.test(e.code)) { const c = s.choices[+e.code.slice(5) - 1]; if (c) choose(c); return; }
        if (e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyE') { e.preventDefault(); next(); }
      };
      el.addEventListener('click', next);
      addEventListener('keydown', key);
      show();
    });
  }

  // ------------------------------------------------------------------ pause & help
  controlsPanel() {
    this.panel('Steuerung', '', (body) => {
      body.innerHTML = `<div class="split"><div><h4 style="font-family:var(--f-head);letter-spacing:.14em">IM ALL</h4><table class="grid">
        ${[['Maus', 'Virtueller Steuerknüppel (Nicken/Gieren)'], ['W / S', 'Schub erhöhen / verringern (1–4: Stufen, X: Stopp)'], ['A / D', 'Rollen'], ['Q / E · R / V', 'Seitwärts · hoch/runter'], ['Shift', 'Nachbrenner'], ['Linke Maus / Leertaste', 'Laser'], ['Rechte Maus / F', 'Rakete (nach Zielerfassung)'], ['T / Y', 'Nächstes Ziel / Ziel voraus'], ['C', 'Cockpit / Verfolgerkamera'], ['Z', 'Flughilfe an/aus'], ['L', 'Andocken anfragen'], ['M', 'Systemkarte: Hyperraumsprung / Fusionsbrand'], ['Esc', 'Pause']].map(([k, v]) => `<tr><td><b>${k}</b></td><td>${v}</td></tr>`).join('')}
        </table></div><div><h4 style="font-family:var(--f-head);letter-spacing:.14em">AUF DER STATION</h4><table class="grid">
        ${[['WASD', 'Gehen'], ['Shift', 'Rennen'], ['Maus', 'Umsehen'], ['E', 'Benutzen / Sprechen / Lift'], ['1–4', 'Antwort im Gespräch wählen'], ['Tab', 'Deckplan (Übersicht)'], ['F12', 'Vollbild'], ['Esc', 'Pause']].map(([k, v]) => `<tr><td><b>${k}</b></td><td>${v}</td></tr>`).join('')}
        </table><p class="dim" style="margin-top:14px">Maus-Empfindlichkeit</p><input type="range" min="0.3" max="2.5" step="0.1" value="${this.game.settings.mouseSens}" data-sens style="width:100%">
        <label style="display:block;margin-top:10px"><input type="checkbox" data-inv ${this.game.settings.invertY ? 'checked' : ''}> Y-Achse invertieren</label>
        <p class="dim" style="margin-top:10px">Lautstärke</p><input type="range" min="0" max="1" step="0.05" value="${this.game.settings.volume}" data-vol style="width:100%"></div></div>`;
      body.querySelector('[data-sens]').oninput = (e) => { this.game.settings.mouseSens = +e.target.value; this.game.saveSettings(); };
      body.querySelector('[data-inv]').onchange = (e) => { this.game.settings.invertY = e.target.checked; this.game.saveSettings(); };
      body.querySelector('[data-vol]').oninput = (e) => { this.game.settings.volume = +e.target.value; this.game.applyVolume(); this.game.saveSettings(); };
    });
  }

  pause() {
    if (this.pauseEl) return;
    this.game.setPaused(true);
    const wrap = this.panel('Pause', `${esc(this.g.callsign)} · Tag ${this.g.day}`, (body) => {
      body.innerHTML = `<div style="display:flex;flex-direction:column;gap:10px;max-width:420px">
        <button class="btn warm" data-a="resume">Weiter</button><button class="btn" data-a="controls">Steuerung &amp; Optionen</button>
        <button class="btn" data-a="save" ${this.game.mode?.isFlight ? 'disabled title="Nur angedockt"' : ''}>Speichern</button>
        <button class="btn" data-a="title">Hauptmenü</button></div>`;
      body.querySelector('[data-a="resume"]').onclick = () => wrap._close();
      body.querySelector('[data-a="controls"]').onclick = () => this.controlsPanel();
      body.querySelector('[data-a="save"]').onclick = () => { this.game.save(); this.notify('Gespeichert'); };
      body.querySelector('[data-a="title"]').onclick = () => { wrap._close(); this.game.toTitle(); };
    }, { onClose: () => { this.pauseEl = null; this.game.setPaused(false); } });
    this.pauseEl = wrap;
  }

  cockpit() {}
}
