import { assets } from '../core/assets.js';
import { SHIP_CLASSES, UPGRADES, MAX_UPGRADE, upgradePrice, PAINTS, PAINT_PRICE, shipStats, COMMODITIES, STATIONS, FACTIONS } from '../game/data.js';
import { activeShip, cargoUsed, cargoFree, addCredits, fmt, rank, price, availableAt, logEntry, addShip } from '../game/state.js';
import { generateJobs, acceptJob, abandonJob } from '../game/missions.js';
import { STORY, PEOPLE, acceptStory, finaleChoice } from '../game/story.js';
import { ZONES, BODIES, zoneAnchor, travelInfo, SATURN } from '../space/universe.js';
import { input } from '../core/input.js';

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

  clear() { for (const el of [...this.root.children]) if (el !== this.notifs && !el.classList.contains('hud')) el.remove(); this.modalStack = []; }

  get modalOpen() { return this.modalStack.length > 0 || !!this.dlg; }

  // ------------------------------------------------------------------ title & loading
  title({ hasSave, onNew, onContinue }) {
    const el = $(`<div class="title">
      <div class="bgimg" style="background-image:url(${assets.url('assets/ui/title.jpg')})"></div>
      <h1>SPACEWING</h1><h2>DIE RINGE DES KRONOS · 2260</h2>
      <div class="menu">
        ${hasSave ? '<button class="btn warm" data-a="cont">Fortsetzen</button>' : ''}
        <button class="btn" data-a="new">Neues Spiel</button>
        <button class="btn" data-a="help">Steuerung</button>
      </div>
      <div class="foot">Ein Söldnerspiel im Saturnsystem · Grafik gerendert in Blender · Musik live synthetisiert</div>
    </div>`);
    el.querySelector('[data-a="new"]').onclick = () => {
      this.sfx();
      const menu = el.querySelector('.menu');
      menu.innerHTML = `<div style="font-family:var(--f-head);letter-spacing:.2em;color:var(--dim)">DEIN RUFZEICHEN</div>
        <input maxlength="16" value="Wren" spellcheck="false"><button class="btn warm" data-a="go">Los geht’s</button><button class="btn small" data-a="back">Zurück</button>`;
      const inp = menu.querySelector('input'); inp.focus(); inp.select();
      input.enabled = false;
      const go = () => { input.enabled = true; onNew((inp.value || 'Wren').trim()); };
      menu.querySelector('[data-a="go"]').onclick = go;
      inp.onkeydown = (e) => { if (e.key === 'Enter') go(); };
      menu.querySelector('[data-a="back"]').onclick = () => { input.enabled = true; el.remove(); this.title({ hasSave, onNew, onContinue }); };
    };
    const c = el.querySelector('[data-a="cont"]'); if (c) c.onclick = () => { this.sfx(); onContinue(); };
    el.querySelector('[data-a="help"]').onclick = () => { this.sfx(); this.controlsPanel(); };
    this.root.appendChild(el);
    this.titleEl = el;
    return el;
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

  storyHint() {
    const g = this.g;
    const st = STORY[g.story];
    if (!st || g.story === 'ende') return g.flags.endingShown ? '<b>FREIES SPIEL</b><br>Die Geschichte ist erzählt. Das Saturnsystem bleibt offen für Aufträge, Handel und Kopfgelder.' : '';
    if (g.story === 'prolog') return '<b>PROLOG · DREI NÄCHTE MIETE</b><br>40 Kredits auf dem Konto, kein Schiff. Geh in die Bar und hör dich um.';
    if (g.story === 'eisfracht' && !g.flags['accepted:eisfracht']) return '<b>EISFRACHT</b><br>Kix meinte, die Alte am Fenstertisch der Bar sucht einen Piloten.';
    if (g.flags['accepted:' + g.story]) return `<b>${esc(st.title.toUpperCase())}</b><br>${esc(st.brief)}`;
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
        html += `<div class="card story"><div class="meta">STORYMISSION</div><h4>${esc(st.title)}</h4><p>${esc(st.brief)}</p><div class="row"><span class="warm">Story</span><button class="btn small warm" data-story="1">Annehmen</button></div></div>`;
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
  openWerft(initialTab = 'werft') {
    const station = this.g.location;
    let tab = initialTab;
    return this.panel('Werft & Markt', `${STATIONS[station].name} · Lenka Brandvold`, (body, rebuild, close, w) => {
      const old = w.querySelector('.tabs'); if (old) old.remove();
      this.tabs(body, [['werft', 'Mein Schiff'], ['kauf', 'Schiffe kaufen'], ['hangar', 'Hangar'], ['markt', 'Markt']], tab, (k) => { tab = k; rebuild(); });
      if (tab === 'markt') return this.marketBody(body, rebuild, station);
      if (tab === 'kauf') return this.shipShop(body, rebuild);
      if (tab === 'hangar') return this.hangarList(body, rebuild);
      this.shipUpgrades(body, rebuild);
    });
  }

  shipUpgrades(body, rebuild) {
    const g = this.g, ship = activeShip(g);
    if (!ship) { body.innerHTML = '<p class="dim">Kein Schiff im Hangar.</p>'; return; }
    const cls = SHIP_CLASSES[ship.cls], st = shipStats(ship);
    const repairCost = Math.round((1 - ship.hull) * st.hull * 6);
    let html = `<div class="split"><div>
      <img src="${assets.url(`assets/ships/${ship.cls}/preview.jpg`)}" style="width:100%;border:1px solid var(--line)">
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
      const p = lv < MAX_UPGRADE ? upgradePrice(ship.cls, k, lv) : null;
      html += `<tr><td><b>${u.name}</b><div class="dim" style="font-size:12px">${u.desc}</div></td>
        <td><div class="pips">${Array.from({ length: MAX_UPGRADE }, (_, i) => `<i class="${i < lv ? 'on' : ''}"></i>`).join('')}</div></td>
        <td class="num">${p != null ? `<button class="btn small" data-up="${k}" ${g.credits < p ? 'disabled' : ''}>${fmt(p)} Cr</button>` : '<span class="good">MAX</span>'}</td></tr>`;
    }
    html += `</table><h4 style="font-family:var(--f-head);letter-spacing:.14em;margin:18px 0 8px">LACKIERUNG · ${PAINT_PRICE} Cr</h4><div class="swatches">`;
    for (const p of PAINTS) html += `<div data-paint="${p.id || ''}" title="${p.name}" class="${(ship.paint || null) === p.hex ? 'on' : ''}" style="background:${p.hex || 'linear-gradient(135deg,#a8602f,#8b8f8c)'}"></div>`;
    html += `</div><div style="margin-top:14px"><label class="dim">Name: </label><input data-name value="${esc(ship.name)}" maxlength="22" style="background:#000;border:1px solid var(--line);color:#fff;padding:6px;font-family:var(--f-head);font-size:16px"></div></div></div>`;
    body.innerHTML = html;
    body.querySelector('[data-repair]')?.addEventListener('click', () => {
      if (g.credits < repairCost) { this.sfx('error'); this.notify('Nicht genug Kredits'); return; }
      g.credits -= repairCost; ship.hull = 1; this.sfx('coins'); rebuild();
    });
    body.querySelectorAll('[data-up]').forEach(b => b.onclick = () => {
      const k = b.dataset.up, lv = ship.upgrades[k] || 0, p = upgradePrice(ship.cls, k, lv);
      if (g.credits < p) { this.sfx('error'); return; }
      g.credits -= p; ship.upgrades[k] = lv + 1; logEntry(g, `${UPGRADES[k].name} Stufe ${lv + 1} eingebaut`); this.sfx('coins'); this.game.save(); rebuild();
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
        <div style="display:flex;gap:8px;margin-top:16px"><button class="btn small warm" data-save>Speichern</button><button class="btn small" data-story>Story-Bibel</button></div>
        </div><div><h4 style="font-family:var(--f-head);letter-spacing:.14em;margin:0 0 8px">LOGBUCH</h4>
        <div style="max-height:52vh;overflow:auto;font-size:14px;line-height:1.6">${g.log.map(l => `<div><span class="dim">Tag ${l.day}</span> · ${esc(l.text)}</div>`).join('') || '<span class="dim">Noch leer.</span>'}</div></div></div>`;
      body.querySelector('[data-save]').onclick = () => { this.game.save(); this.notify('Spielstand gespeichert'); this.sfx('coins'); };
      body.querySelector('[data-story]').onclick = () => window.open('https://github.com/simon23-12/SpaceWing/blob/main/docs/STORY.md', '_blank');
    });
  }

  // ------------------------------------------------------------------ map / travel
  openMap(flight) {
    const g = this.g;
    const here = flight ? flight.zoneId : STATIONS[g.location].zone;
    let sel = null;
    const wrap = this.panel('Systemkarte', flight ? 'Fusionsantrieb bereit · Ziel wählen' : 'Saturnsystem · Ansicht', (body) => {
      body.innerHTML = `<div class="mapwrap"><canvas width="900" height="666"></canvas><div class="dest"><div class="destinfo">Wähle ein Ziel auf der Karte.</div><div class="list"></div></div></div>`;
      const cv = body.querySelector('canvas'), ctx = cv.getContext('2d');
      const info = body.querySelector('.destinfo'), list = body.querySelector('.list');
      const zones = Object.entries(ZONES).filter(([id]) => id !== 'iapetus' || g.flags.gewoelbeOpen || STORY[g.story]?.zone === 'iapetus' || g.flags['accepted:gewoelbe']);
      // log-radial projection of the ring plane
      const proj = (p) => {
        const r = Math.hypot(p[0], p[2]); const a = Math.atan2(p[2], p[0]);
        const k = Math.log10(Math.max(r, 60000) / 60000) / Math.log10(13e6 / 60000);
        const R = 60 + k * 300;
        return [450 + Math.cos(a) * R, 333 + Math.sin(a) * R * 0.62];
      };
      const draw = () => {
        ctx.clearRect(0, 0, 900, 666);
        // orbits
        ctx.strokeStyle = 'rgba(120,200,255,0.12)';
        for (const b of Object.values(BODIES)) {
          const r = Math.hypot(b.pos[0], b.pos[2]); const k = Math.log10(r / 60000) / Math.log10(13e6 / 60000); const R = 60 + k * 300;
          ctx.beginPath(); ctx.ellipse(450, 333, R, R * 0.62, 0, 0, Math.PI * 2); ctx.stroke();
        }
        // Saturn + rings
        ctx.fillStyle = '#d8c08a'; ctx.beginPath(); ctx.arc(450, 333, 22, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(220,200,160,.6)'; ctx.lineWidth = 5; ctx.beginPath(); ctx.ellipse(450, 333, 44, 14, -0.3, 0, Math.PI * 2); ctx.stroke(); ctx.lineWidth = 1;
        ctx.font = '600 24px Rajdhani, sans-serif';
        for (const [id, z] of zones) {
          const [x, y] = proj(zoneAnchor(id));
          const isHere = id === here, isSel = id === sel;
          const story = STORY[g.story]?.zone === id && g.flags['accepted:' + g.story];
          const job = g.jobs.some(j => (j.kind === 'fracht' && STATIONS[j.to].zone === id) || ((j.kind === 'kopfgeld' || j.kind === 'eskorte') && j.zone === id));
          ctx.fillStyle = z.hostile ? '#ff5a4a' : isHere ? '#7fe08a' : '#7fd4ff';
          ctx.beginPath(); ctx.arc(x, y, isSel ? 12 : 8, 0, Math.PI * 2); ctx.fill();
          if (isSel) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 18, 0, Math.PI * 2); ctx.stroke(); ctx.lineWidth = 1; }
          if (story) { ctx.strokeStyle = '#ffcf7a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 24, 0, Math.PI * 2); ctx.stroke(); ctx.lineWidth = 1; }
          ctx.fillStyle = isHere ? '#bff5c4' : '#d8e6ef';
          ctx.fillText(z.name.split(' · ')[0] + (isHere ? ' (hier)' : '') + (job ? ' ◆' : ''), x + 16, y + 8);
        }
      };
      const pick = (id) => {
        sel = id; draw(); this.sfx('blip');
        const z = ZONES[id];
        if (id === here) { info.innerHTML = `<b>${z.name}</b><br>Du bist hier.`; return; }
        const t = travelInfo(here, id);
        const fuelCost = Math.round(t.fuel * (g.flags.zoll ? 26 : 18));
        info.innerHTML = `<b>${z.name}</b><br>Entfernung: ${fmt(t.distance)} km<br>Transferzeit: ${t.hours.toFixed(1)} h<br>Treibstoff (He-3): ${fuelCost} Cr${z.hostile ? '<br><span class="bad">Feindliches Gebiet</span>' : ''}`;
        if (flight) {
          const b = $(`<button class="btn warm" style="margin-top:10px">Fusionsbrand zünden</button>`);
          const blocked = flight.ships.some(s => s.alive && flight.isHostile(s, flight.player) && s.pos.distanceTo(flight.player.pos) < 2500);
          if (blocked) b.disabled = true, b.textContent = 'Feinde zu nah';
          if (g.credits < fuelCost) b.disabled = true, b.textContent = 'Zu wenig Kredits für Treibstoff';
          b.onclick = () => { g.credits -= fuelCost; wrap._close(); this.game.travel(flight, id); };
          info.appendChild(b);
        }
      };
      list.innerHTML = zones.map(([id, z]) => `<button class="btn small" data-z="${id}">${z.name.split(' · ')[0]}</button>`).join('');
      list.querySelectorAll('[data-z]').forEach(b => b.onclick = () => pick(b.dataset.z));
      cv.onclick = (e) => {
        const r = cv.getBoundingClientRect(); const mx = (e.clientX - r.left) * 900 / r.width, my = (e.clientY - r.top) * 666 / r.height;
        let best = null, bd = 30;
        for (const [id] of zones) { const [x, y] = proj(zoneAnchor(id)); const d = Math.hypot(x - mx, y - my); if (d < bd) { bd = d; best = id; } }
        if (best) pick(best);
      };
      draw();
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
      const finish = () => { removeEventListener('keydown', key); el.remove(); this.dlg = null; resolve(); };
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
        this.game.audio?.blip();
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
        ${[['Maus', 'Virtueller Steuerknüppel (Nicken/Gieren)'], ['W / S', 'Schub erhöhen / verringern (1–4: Stufen, X: Stopp)'], ['A / D', 'Rollen'], ['Q / E · R / V', 'Seitwärts · hoch/runter'], ['Shift', 'Nachbrenner'], ['Linke Maus / Leertaste', 'Laser'], ['Rechte Maus / F', 'Rakete (nach Zielerfassung)'], ['T / Y', 'Nächstes Ziel / Ziel voraus'], ['C', 'Cockpit / Verfolgerkamera'], ['Z', 'Flughilfe an/aus'], ['L', 'Andocken anfragen'], ['M', 'Systemkarte und Fusionsbrand'], ['Esc', 'Pause']].map(([k, v]) => `<tr><td><b>${k}</b></td><td>${v}</td></tr>`).join('')}
        </table></div><div><h4 style="font-family:var(--f-head);letter-spacing:.14em">AUF DER STATION</h4><table class="grid">
        ${[['WASD', 'Gehen'], ['Shift', 'Rennen'], ['Maus', 'Umsehen'], ['E', 'Benutzen / Sprechen'], ['Tab', 'Zur Brückenübersicht'], ['Esc', 'Pause']].map(([k, v]) => `<tr><td><b>${k}</b></td><td>${v}</td></tr>`).join('')}
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
