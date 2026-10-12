import { assets } from '../core/assets.js';
import { SHIP_CLASSES, UPGRADES, MAX_UPGRADE, maxLevel, upgradePrice, PAINTS, PAINT_PRICE, shipStats, COMMODITIES, STATIONS, FACTIONS, MOONS, MOON_ORDER, moonOfZone, moonOfStation, JUMP_CLASS } from '../game/data.js';
import { state, activeShip, cargoUsed, cargoFree, addCredits, fmt, rank, price, availableAt, logEntry, addShip } from '../game/state.js';
import { generateJobs, acceptJob, abandonJob, jobBlocker, SIM_SCENARIOS, SIM_TIERS, MEDALS, simReward } from '../game/missions.js';
import { STORY, PEOPLE, acceptStory, finaleChoice, storyJumpPass } from '../game/story.js';
import { ZONES, BODIES, zoneAnchor, travelInfo, SATURN } from '../space/universe.js';
import { input } from '../core/input.js';
import { ACTIONS, ACTION, AXES, keysFor, keyLabel, bindKey, resetKeys, importControls, withKeys, profileFor, saveProfile, resetProfile, defaultProfile, padLabel, padName } from '../core/bindings.js';
import { Streaks } from './streaks.js';
import { ShipPreview } from './shipPreview.js';

const $ = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const esc = (s) => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

const TIPS = [
  'Die Ringe des Saturn sind im Schnitt nur zehn Meter dick, aber 280.000 Kilometer breit.',
  'Enceladus schleudert jede Sekunde rund 200 Kilogramm Wasser ins All.',
  'Titan ist der einzige Mond mit einer dichten Atmosphäre. Auf seinen Seen regnet es Methan.',
  'Iapetus hat eine schwarze und eine weiße Seite. Niemand weiß genau, warum.',
  'Mit T schaltest du das nächste Ziel auf, mit R das vorherige und mit G das Ziel am Fadenkreuz. Alles frei belegbar im Menü.',
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
      <div class="tlayers"><div class="tbg" style="background-image:url(${assets.url('assets/ui/title_bg.jpg')}), url(${assets.url('assets/ui/title.jpg')})"></div>
        <div class="tst" style="background-image:url(${assets.url('assets/ui/title_st.png')})"></div></div>
      <h1>SPACEWING</h1><h2>SATURN</h2>
      <div class="menu">
        ${hasSave ? '<button class="btn warm" data-a="cont">Fortsetzen</button>' : ''}
        <button class="btn" data-a="new">Neues Spiel</button>
        <button class="btn" data-a="load">Spielstand laden (JSON)</button>
        <button class="btn" data-a="help">Steuerung</button>
      </div>
      <div class="credit">Von Simon</div>
      <div class="fkey"><b>F12</b> Vollbild</div>
    </div>`);
    // speed streaks drifting through the picture, slowly, towards the station
    const streaks = new Streaks(el, { count: 55, speed: 1.5, vx: 0.66, vy: 0.55, alpha: 0.85, color: [205, 228, 255], z: 0 });
    // slow drift: Saturn and the station move a little against each other (and follow the mouse a bit)
    const bg = el.querySelector('.tbg'), stl = el.querySelector('.tst');
    let mx = 0, my = 0, raf = 0;
    const onMove = (e) => { mx = e.clientX / innerWidth - 0.5; my = e.clientY / innerHeight - 0.5; };
    addEventListener('mousemove', onMove);
    const t0 = performance.now();
    const tick = () => {
      const t = (performance.now() - t0) / 1000;
      bg.style.transform = `scale(${1.07 + 0.025 * Math.sin(t / 23)}) translate(${Math.sin(t / 31) * 0.9 - mx * 0.6}%, ${Math.cos(t / 37) * 0.6 - my * 0.5}%)`;
      stl.style.transform = `scale(${1.05 + 0.02 * Math.sin(t / 17 + 1)}) translate(${Math.sin(t / 13) * 1.3 - mx * 1.6}%, ${Math.cos(t / 15) * 0.9 - my * 1.2}%) rotate(${Math.sin(t / 19) * 0.7}deg)`;
      raf = requestAnimationFrame(tick);
    };
    tick();
    el._cleanup = () => { streaks.dispose(); cancelAnimationFrame(raf); removeEventListener('mousemove', onMove); };
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
    el.querySelector('[data-a="load"]').onclick = () => { this.sfx(); this.importSave(); };
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
      <span class="cr">${fmt(g.credits)} Cr</span><span class="tbkey" title="Pilotenstatus: Reputation, Kredits, Aufträge">[${keyLabel(keysFor('stats')[0])}] Status</span></div>`);
    el.querySelector('.tbkey').onclick = () => this.toggleStats();
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

  /** Warning line if a mission zone lies in a moon system the active ship cannot jump to yet; for a story mission with a jump pass, the pass note instead. */
  jumpNeed(zone, story = null) {
    const mid = zone && moonOfZone(zone);
    if (!mid) return '';
    const need = MOONS[mid].jump, ship = activeShip(this.g), have = ship ? shipStats(ship).jump : 0;
    if (mid === moonOfStation(this.g.location) || have >= need) return '';
    if (story?.jumpPass) return `<p class="good" style="margin:4px 0 8px">${esc(story.jumpPass)}</p>`;
    return `<p class="bad" style="margin:4px 0 8px">Ziel ${MOONS[mid].name}: Sprungtriebwerk Klasse ${JUMP_CLASS[need]} nötig (Werft).</p>`;
  }

  storyHint() {
    const g = this.g;
    const st = STORY[g.story];
    if (!st || g.story === 'ende') return g.flags.endingShown ? '<b>FREIES SPIEL</b><br>Die Geschichte ist erzählt. Das Saturnsystem bleibt offen für Aufträge, Handel und Kopfgelder.' : '';
    if (g.story === 'prolog') return '<b>PROLOG · VIERZIG KREDITS</b><br>40 Kredits auf dem Konto, kein Schiff. Geh in die Bar und hör dich um.';
    if (g.story === 'eisfracht' && !g.flags['accepted:eisfracht']) return '<b>EISFRACHT</b><br>Kix meinte, die Alte am Fenstertisch der Bar sucht einen Piloten.';
    if (g.flags['accepted:' + g.story]) return `<b>${esc(st.title.toUpperCase())}</b><br>${esc(st.brief)}${this.jumpNeed(st.zone, st)}`;
    if (g.story === 'funkstille') return '<b>FUNKSTILLE</b><br>Von Mags fehlt jede Spur. Vielleicht weiß Kix in der Bar mehr.';
    if (g.story === 'kassini') return '<b>DIE KASSINI-TEILUNG</b><br>Mags und Juno warten in der Bar. Es ist Zeit für eine Entscheidung.';
    if (st.available && st.available(g)) return `<b>NEUE STORYMISSION</b><br>„${esc(st.title)}“ wartet an der Söldnerbörse.`;
    return '<b>BROTLOS</b><br>Verdiene Kredits an der Söldnerbörse und rüste die Spacewing in der Werft auf.';
  }

  // ------------------------------------------------------------------ modal panel scaffold
  panel(title, sub, build, { onClose, wide, narrow, side } = {}) {
    const wrap = $(`<div class="modal${side ? ' side' : ''}"><div class="panel${narrow ? ' narrow' : ''}"><header><h3>${title}</h3><div class="sub">${sub || ''}</div><div class="x">✕</div></header><div class="body"></div></div></div>`);
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
  openBoerse(initialTab = 'auftraege') {
    const station = this.g.location;
    let tab = initialTab;
    this.panel('Söldnerbörse', `${STATIONS[station].name} · Dispatcher Femi Oduya`, (body, rebuild, close, w) => {
      const g = this.g;
      w.querySelector('.tabs')?.remove();
      this.tabs(body, [['auftraege', 'Aufträge'], ['erledigt', `Erledigt${g.jobsDone?.length ? ' · ' + g.jobsDone.filter(d => d.status === 'ok').length : ''}`]], tab, (k) => { tab = k; rebuild(); });
      if (tab === 'erledigt') return this.doneJobs(body);
      const jobs = generateJobs(g, station);
      const st = STORY[g.story];
      let html = '<div class="cards">';
      if (st && st.available && st.available(g) && !g.flags['accepted:' + g.story] && st.giver !== 'kix' && st.giver !== 'juno') {
        const need = this.jumpNeed(st.zone, st), blocked = need && !st.jumpPass;
        html += `<div class="card story${blocked ? ' blocked' : ''}"><div class="meta">STORYMISSION</div><h4>${esc(st.title)}</h4><p>${esc(st.brief)}</p>${need}<div class="row"><span class="warm">Story</span><button class="btn small warm" data-story="1" ${blocked ? 'disabled' : ''}>Annehmen</button></div></div>`;
      }
      if (g.story === 'kassini' && !g.flags.ending && g.flags['done:schakalnest']) {
        html += `<div class="card story"><div class="meta">STORY</div><h4>Die Kassini-Teilung</h4><p>Mags und Juno warten in der Bar auf deine Entscheidung.</p></div>`;
      }
      // jobs the active ship cannot fly yet (jump class, locked moon, cargo space) stay visible but greyed out, at the end
      const listed = jobs.map(j => ({ j, block: jobBlocker(g, j) })).sort((a, b) => !!a.block - !!b.block);
      for (const { j, block } of listed) {
        html += `<div class="card${block ? ' blocked' : ''}"><div class="meta">${j.kind === 'fracht' ? 'FRACHTAUFTRAG' : j.kind === 'kopfgeld' ? 'KOPFGELD' : 'ESKORTE'} · ${esc(j.client)}</div>
          <h4>${esc(j.title)}</h4><p>${esc(j.text)}</p>
          ${j.kind === 'fracht' ? `<div class="meta">Ziel: ${STATIONS[j.to].name} · Reise ${travelInfo(STATIONS[station].zone, STATIONS[j.to].zone).hours.toFixed(1)} h${j.risk ? ' · <span class="bad">Risiko ' + '▲'.repeat(j.risk) + '</span>' : ''}</div>` : ''}
          ${block ? `<div class="lockline">🔒 ${esc(block)}</div>` : ''}
          <div class="row"><span class="warm">${fmt(j.pay)} Cr</span><button class="btn small" data-job="${j.id}" ${block ? 'disabled' : ''}>Annehmen</button></div></div>`;
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

  /** History of finished, failed and abandoned jobs and story missions. */
  doneJobs(body) {
    const g = this.g, list = g.jobsDone || [];
    const kinds = { fracht: 'Fracht', kopfgeld: 'Kopfgeld', eskorte: 'Eskorte', story: 'Story' };
    const ok = list.filter(d => d.status === 'ok');
    // story missions finished before the history existed (older saves) are listed from the flags
    const old = Object.keys(STORY).filter(id => g.flags['done:' + id] && !list.some(d => d.kind === 'story' && d.title === STORY[id].title));
    let html = `<div class="donesum"><div><label>ERLEDIGT</label><b>${ok.length + old.length}</b></div><div><label>VERDIENT</label><b class="warm">${fmt(ok.reduce((a, d) => a + (d.pay || 0), 0))} Cr</b></div><div><label>ABSCHÜSSE</label><b>${g.kills}</b></div></div>`;
    if (!list.length && !old.length) { body.innerHTML = html + '<p class="dim">Noch keine Aufträge erledigt. Frachtaufträge im Rhea-System sind ein guter Anfang.</p>'; return; }
    html += '<table class="grid"><tr><th>Tag</th><th>Art</th><th>Auftrag</th><th>Ort</th><th class="num">Lohn</th></tr>';
    for (const d of list) html += `<tr class="${d.status === 'ok' ? '' : 'dim'}"><td>${d.day}</td><td>${kinds[d.kind] || ''}</td><td>${esc(d.title)}${d.status === 'ok' ? ' <span class="good">✓</span>' : ` <span class="bad">${esc(d.status)}</span>`}</td><td>${esc(d.where || '')}</td><td class="num warm">${d.pay ? fmt(d.pay) : '–'}</td></tr>`;
    for (const id of old) html += `<tr><td>–</td><td>Story</td><td>${esc(STORY[id].title)} <span class="good">✓</span></td><td></td><td class="num">–</td></tr>`;
    body.innerHTML = html + '</table>';
  }

  // ------------------------------------------------------------------ pilot status (P anywhere on a station)
  pilotStats() {
    const g = this.g;
    const reps = Object.entries(g.rep).map(([k, v]) => `<span>${FACTIONS[k]?.name || k}</span><div class="meter"><div style="width:${Math.min(100, Math.abs(v))}%;background:${v >= 0 ? 'var(--good)' : 'var(--bad)'}"></div></div><span class="${v >= 0 ? 'good' : 'bad'}">${v}</span>`).join('');
    const ship = activeShip(g);
    return `<h4 style="font-family:var(--f-head);letter-spacing:.14em;margin:0 0 8px">PILOT</h4>
        <div class="statgrid"><span>Rufzeichen</span><b>${esc(g.callsign)}</b><span></span><span>Rang</span><b>${rank(g)}</b><span></span>
        <span>Kredits</span><b class="warm">${fmt(g.credits)}</b><span></span><span>Verdient</span><b>${fmt(g.earned)}</b><span></span><span>Abschüsse</span><b>${g.kills}</b><span></span><span>Tag</span><b>${g.day}</b><span></span>
        <span>Schiff</span><b>${ship ? esc(ship.name) : '–'}</b><span>${ship ? 'Rumpf ' + Math.round(ship.hull * 100) + ' %' : ''}</span><span>Aufträge</span><b>${g.jobs.length} offen</b><span>${(g.jobsDone || []).filter(d => d.status === 'ok').length} erledigt</span></div>
        <h4 style="font-family:var(--f-head);letter-spacing:.14em;margin:16px 0 8px">REPUTATION</h4><div class="statgrid">${reps}</div>`;
  }

  /** Pilot status (credits, rank, reputation, story) on a key press anywhere on a station; the same key closes it. */
  toggleStats() {
    if (this.statsEl) { this.statsEl._close(); return; }
    if (this.modalOpen) return;
    const g = this.g, st = STORY[g.story];
    this.statsEl = this.panel('Pilotenstatus', `${esc(g.callsign)} · Tag ${g.day} · [${keyLabel(keysFor('stats')[0])}] schließt`, (body) => {
      body.innerHTML = `<div class="split"><div>${this.pilotStats()}</div><div>
        <h4 style="font-family:var(--f-head);letter-spacing:.14em;margin:0 0 8px">STORY</h4><div class="sidehint" style="position:static;max-width:none">${this.storyHint() || '–'}</div>
        <h4 style="font-family:var(--f-head);letter-spacing:.14em;margin:16px 0 8px">LAUFENDE AUFTRÄGE</h4>${g.jobs.length ? g.jobs.map(j => `<div>${esc(j.title)}${j.done ? ' <span class="good">✓ erfüllt, andocken zum Kassieren</span>' : ` <span class="dim">→ ${esc(j.kind === 'fracht' ? STATIONS[j.to].name : ZONES[j.zone].name)}</span>`}</div>`).join('') : '<span class="dim">Keine.</span>'}
        <h4 style="font-family:var(--f-head);letter-spacing:.14em;margin:16px 0 8px">LETZTE EINTRÄGE</h4><div style="font-size:14px;line-height:1.6">${g.log.slice(0, 6).map(l => `<div><span class="dim">Tag ${l.day}</span> · ${esc(l.text)}</div>`).join('')}</div>
      </div></div>`;
    }, { wide: true, onClose: () => { this.statsEl = null; } });
    this.sfx('blip');
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
      if (tab !== 'werft' && tab !== 'hangar') this.disposePreview();
      const old = w.querySelector('.tabs'); if (old) old.remove();
      this.tabs(body, [...(home ? [] : [['werft', 'Mein Schiff']]), ['kauf', 'Schiffe kaufen'], ['hangar', 'Hangar'], ['markt', 'Markt']], tab, (k) => { tab = k; rebuild(); });
      if (tab === 'markt') return this.marketBody(body, rebuild, station);
      if (tab === 'kauf') return this.shipShop(body, rebuild);
      if (tab === 'hangar') return this.hangarList(body, rebuild);
      this.shipUpgrades(body, rebuild);
    }, { wide: true, onClose: () => this.disposePreview() });
  }

  /** Combat simulator on the Kommandodeck: pick a ship, then a scenario; medals per scenario. */
  openSim() {
    const g = this.g;
    const medalIcons = (m) => [1, 2, 3].map(k => `<i class="medal m${k}${m >= k ? '' : ' off'}" title="${MEDALS[k]}"></i>`).join('');
    return this.panel('Gefechtssimulator', 'Kommandodeck · Übungsflüge ohne echten Schaden · Medaillen bringen einmalig Kredits', (body, rebuild) => {
      const ships = this.game.simShips();
      const sel = ships.find(s => s.key === g.simShip) || ships.find(s => s.key === g.activeShip) || ships[0];
      if (!sel) { body.innerHTML = '<p class="dim">Ohne eigenes Schiff gibt es keine Simulation.</p>'; return; }
      const st = shipStats(sel.rec), missiles = st.missiles;
      const total = Object.keys(SIM_SCENARIOS).length, golds = Object.values(g.simMedals || {}).filter(m => m === 3).length;
      let html = `<div class="simtop"><div><div class="sl">SCHIFF FÜR DIE SIMULATION</div><div class="simships">${ships.map(s => {
        const ss = shipStats(s.rec);
        return `<div class="simship${s === sel ? ' on' : ''}" data-ship="${s.key}"><b>${esc(s.own ? s.rec.name : 'Probeflug')}</b><span>${esc(SHIP_CLASSES[s.rec.cls].name)}${s.own ? '' : ' · Werkszustand'}</span><span>${Math.round(ss.laserDmg * ss.laserRate)} DPS · ${ss.missiles ? ss.missiles + ' Raketen' : '<em>keine Raketen</em>'}</span></div>`;
      }).join('')}</div></div>
        <div class="simsum"><div class="sl">MEDAILLEN</div><b>${golds}</b> / ${total} Gold</div></div>
        <div class="simhint">${missiles ? `Die ${esc(sel.rec.name)} hat ${missiles} Raketen an Bord. Im Simulator sind die Schächte immer voll.`
          : `<b>Keine Raketen.</b> Mit ${sel.own && sel.rec.cls === 'spacewing' ? 'der alten Spacewing' : 'diesem Schiff'} ist am Anfang wenig zu holen: Die Grundausbildung ist machbar, alles darüber wird zäh. Bei Yara Laser und Schild aufrüsten und einen Raketenwerfer einbauen, dann wird es deutlich leichter.`}</div>`;
      SIM_TIERS.forEach((T, ti) => {
        const list = Object.entries(SIM_SCENARIOS).filter(([, S]) => S.tier === ti);
        const open = MOONS[T.moon].unlock(g);
        html += `<div class="simtier${open ? '' : ' locked'}"><h4>${esc(T.name)} <span>${esc(T.sub)}</span></h4>${open ? '' : `<div class="lockline">🔒 Wird mit dem Mondsystem ${MOONS[T.moon].name} freigeschaltet · ${esc(MOONS[T.moon].why)}</div>`}<div class="cards">`;
        for (const [id, S] of list) {
          const m = g.simMedals?.[id] || 0;
          const warn = S.needs === 'missiles' && !missiles;
          const goal = S.kind === 'survive' ? `Gold: ≥ 70 % Rumpf übrig` : S.kind === 'escort' ? 'Gold: Frachter ≥ 80 % heil' : `Gold ≤ ${S.gold} s · Silber ≤ ${S.silver} s`;
          const next = m < 3 ? Math.round(simReward(S, m + 1) - simReward(S, m)) : 0;
          html += `<div class="card simcard${open ? '' : ' blocked'}"><div class="medals">${medalIcons(m)}</div><h4>${esc(S.name)}</h4>
            <p style="font-size:14px;line-height:1.45">${esc(S.desc)}</p>
            <p class="tip"><b>Tipp</b> ${esc(withKeys(S.tip))}</p>
            ${warn ? '<div class="lockline">Empfohlen: Raketenwerfer. Ohne Raketen sehr schwer.</div>' : ''}
            <div class="meta">${goal}${g.simBest?.[id] ? ` · Bestzeit ${g.simBest[id]} s` : ''}</div>
            <div class="row"><span class="warm">${m >= 3 ? '<span class="good">Gold geholt</span>' : `${MEDALS[m + 1]}: +${fmt(next)} Cr`}</span><button class="btn small warm" data-sim="${id}" ${open ? '' : 'disabled'}>Starten</button></div></div>`;
        }
        html += '</div></div>';
      });
      body.innerHTML = html;
      body.querySelectorAll('[data-ship]').forEach(d => d.onclick = () => { g.simShip = d.dataset.ship; this.sfx('blip'); rebuild(); });
      body.querySelectorAll('[data-sim]').forEach(b => b.onclick = () => { this.sfx(); this.closeTop(); this.game.startSim(b.dataset.sim, sel.key); });
    }, { wide: true });
  }

  /** Result screen after a simulator run. */
  simReport(x) {
    const { S, r, medal, before, reward } = x;
    const failed = !r.won;
    this.panel('Simulation beendet', `${esc(S.name)} · ${esc(x.shipName || '')}`, (body, rebuild, close) => {
      const line = failed ? (x.aborted ? 'Abgebrochen.' : S.kind === 'escort' && r.ally === 0 ? 'Der Frachter wurde zerstört.' : 'Abgeschossen. Im Ernstfall wäre das teuer geworden.')
        : medal > before ? `Neue Medaille: <b class="mtxt m${medal}">${MEDALS[medal]}</b>` : `${MEDALS[medal]} erreicht (Bestwert: ${MEDALS[before]})`;
      body.innerHTML = `<div class="simres">
        <div class="bigmedal ${failed ? 'fail' : 'm' + medal}"><span>${failed ? '✕' : MEDALS[medal].toUpperCase()}</span></div>
        <div><div class="line">${line}</div>
          <div class="debrief" style="margin-top:12px">
            <div class="dtile"><label>ZEIT</label><b>${r.sec} s</b><span>${S.kind === 'clear' && !failed ? `Gold ≤ ${S.gold} s · Silber ≤ ${S.silver} s${x.newBest ? ' · neue Bestzeit' : ''}` : S.kind === 'survive' ? `Ziel: ${S.survive} s` : ''}</span></div>
            <div class="dtile"><label>RUMPF</label><b>${Math.round((r.hull || 0) * 100)} %</b><span>${S.kind === 'survive' ? 'Gold ab 70 %, Silber ab 35 %' : ''}</span></div>
            ${S.kind === 'escort' ? `<div class="dtile"><label>FRACHTER</label><b>${Math.round((r.ally || 0) * 100)} %</b><span>Gold ab 80 %, Silber ab 50 %</span></div>` : ''}
            <div class="dtile ${reward ? 'good' : ''}"><label>PRÄMIE</label><b>${reward ? '+' + fmt(reward) + ' Cr' : '—'}</b><span>${reward ? 'Ausbildungsfonds der Station' : 'nur für neue Medaillen'}</span></div>
          </div>
          ${failed || medal < 3 ? `<p class="tip" style="margin-top:12px"><b>Tipp</b> ${esc(withKeys(S.tip))}</p>` : ''}
        </div></div>
        <div class="drow"><button class="btn warm" data-a="again">Nochmal</button><button class="btn" data-a="list">Andere Simulation</button><button class="btn" data-a="ok">Schließen</button></div>`;
      body.querySelector('[data-a="again"]').onclick = () => { this.sfx(); close(); this.game.startSim(x.id, x.shipKey); };
      body.querySelector('[data-a="list"]').onclick = () => { this.sfx(); close(); this.openSim(); };
      body.querySelector('[data-a="ok"]').onclick = () => { this.sfx(); close(); };
    });
    this.sfx(medal > before ? 'coins' : 'blip');
  }

  disposePreview() { this.pv?.dispose(); this.pv = null; this.pvWrap = null; }

  // ------------------------------------------------------------------ flight report after docking
  debrief(r, { side = false } = {}) {
    const g = this.g, mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
    const tile = (label, value, sub = '', cls = '') => `<div class="dtile ${cls}"><label>${label}</label><b>${value}</b><span>${sub}</span></div>`;
    const salvPrice = price(g, r.station, 'schrott', 'sell');
    this.panel('Flugbericht', `${esc(STATIONS[r.from]?.name || '')} → ${esc(STATIONS[r.station].name)}${r.ship?.name ? ' · ' + esc(r.ship.name) : ''}`, (body, rebuild, close) => {
      const net = r.ship?.cargo?.schrott || 0;
      const dmg = r.hull0 != null ? Math.max(0, Math.round((r.hull0 - r.hull1) * 100)) : null;
      body.innerHTML = `<div class="debrief">
        ${tile('MISSIONSZEIT', mmss(r.time), r.jumps ? `${r.jumps} Hyperraumsprung${r.jumps > 1 ? 'e' : ''}` : 'Flugzeit im Cockpit')}
        ${tile('VERDIENT', (r.earned > 0 ? '+' : '') + fmt(r.earned) + ' Cr', `Kontostand ${r.net >= 0 ? '+' : '−'}${fmt(Math.abs(r.net))} Cr (inkl. Treibstoff)`, r.earned > 0 ? 'good' : '')}
        ${tile('TRÜMMER', `${r.salvage} t`, net ? `im Netz: ${net} t · ≈ ${fmt(net * salvPrice)} Cr hier` : r.salvage ? 'verkauft' : 'keine eingesammelt', r.salvage ? 'amber' : '')}
        ${tile('ABSCHÜSSE', r.kills, r.kills ? 'bestätigt' : '—')}
        ${dmg != null ? tile('SCHADEN', dmg ? `−${dmg} %` : 'keiner', dmg ? `Rumpf ${Math.round(r.hull1 * 100)} % · Reparatur ≈ ${fmt(r.repair)} Cr` : `Rumpf ${Math.round(r.hull1 * 100)} %`, dmg > 25 ? 'bad' : dmg ? 'warn' : 'good') : tile('SCHIFF', 'geliehen', 'Schäden zahlt der Eigner')}
        ${tile('KONTO', fmt(g.credits) + ' Cr', '')}
      </div>
      <div class="drow">${net ? `<button class="btn warm" data-sell>Schrott verkaufen · +${fmt(net * salvPrice)} Cr</button>` : ''}<button class="btn" data-ok>Weiter</button></div>`;
      body.querySelector('[data-sell]')?.addEventListener('click', () => {
        const n = r.ship.cargo.schrott || 0; delete r.ship.cargo.schrott;
        addCredits(g, n * salvPrice, `${n} t Bergungsschrott verkauft`); this.sfx('coins'); this.game.save(); rebuild();
      });
      body.querySelector('[data-ok]').onclick = () => { this.sfx(); close(); };
    }, { side });
    this.sfx('blip');
  }

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
      attack: [['Angriffsmodus', (s) => `${Math.floor(s.attackTime / 60)}:${String(s.attackTime % 60).padStart(2, '0')}`, ' min']],
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
      ${st.missiles > 0 ? `<div class="ammo"><span>RAKETEN ${Math.min(ship.missiles ?? st.missiles, st.missiles)} / ${st.missiles}</span>${(ship.missiles ?? st.missiles) < st.missiles ? '<button class="btn small" data-ammo="all">Nachladen · kostenlos</button>' : '<span class="good">voll</span>'}<span class="dim" style="font-size:12px">Wird bei jedem Andocken kostenlos aufgefüllt.</span></div>`
        : '<div class="ammo dim">Keine Raketenschächte. Raketenwerfer nachrüsten (rechts): Jede Stufe bringt zwei geladene Raketen.</div>'}
      </div><div>
      <div class="balance"><span>KONTOSTAND</span><b>${fmt(g.credits)} Cr</b></div>
      <h4 style="font-family:var(--f-head);letter-spacing:.14em;margin:0 0 10px">UPGRADES</h4><table class="grid">`;
    for (const [k, u] of Object.entries(UPGRADES)) {
      if (u.fighterOnly && !cls.fighter) continue;
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
      this.pv.onWings = (open) => this.game.audio?.wings?.(open);
    }
    this.pvWrap.classList.remove('big');
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
    body.querySelectorAll('[data-ammo]').forEach(bt => bt.onclick = () => { ship.missiles = st.missiles; this.sfx('blip'); this.game.save(); rebuild(); });
    body.querySelector('[data-repair]')?.addEventListener('click', () => {
      if (g.credits < repairCost) { this.sfx('error'); this.notify('Nicht genug Kredits'); return; }
      g.credits -= repairCost; ship.hull = 1; this.sfx('coins'); rebuild();
    });
    body.querySelectorAll('[data-up]').forEach(b => b.onclick = () => {
      const k = b.dataset.up, lv = ship.upgrades[k] || 0, p = upgradePrice(ship.cls, k, lv);
      if (g.credits < p) { this.sfx('error'); return; }
      if (k === 'missiles') delete ship.missiles;   // the two new racks come loaded (undefined = full)
      g.credits -= p; ship.upgrades[k] = lv + 1; logEntry(g, `${UPGRADES[k].name} Stufe ${lv + 1} eingebaut`); this.sfx('coins'); this.game.save();
      this.pv?.refreshMods(ship.upgrades); this.game.mode?.refreshParkedShip?.();
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
        <div class="row"><span class="warm">${fmt(c.price)} Cr</span>${locked ? '<span class="bad">Nur mit Konsortiums-Reputation</span>' : `<button class="btn small" data-buy="${id}" ${g.credits < c.price ? 'disabled' : ''}>Kaufen</button>`}</div></div>`;
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

  /** Resale value: 55 % of the hull price plus half of what the mods cost. */
  shipValue(s) {
    const c = SHIP_CLASSES[s.cls];
    return Math.round((c.price || 20000) * 0.55 + Object.entries(s.upgrades).reduce((a, [k, l]) => { let v = 0; for (let i = 0; i < l; i++) v += upgradePrice(s.cls, k, i) * 0.5; return a + v; }, 0));
  }

  /** Hangar: your ships as a list, the selected one turning in 3D with its numbers, resale value and actions. */
  hangarList(body, rebuild) {
    const g = this.g;
    if (!g.ships.length) { body.innerHTML = '<p class="dim">Kein Schiff im Hangar.</p>'; return; }
    const sel = g.ships.find(s => s.uid === this.hangarSel) || g.ships.find(s => s.uid === g.activeShip) || g.ships[0];
    this.hangarSel = sel.uid;
    const c = SHIP_CLASSES[sel.cls], st = shipStats(sel), val = this.shipValue(sel), active = sel.uid === g.activeShip;
    const mods = Object.entries(sel.upgrades).filter(([, l]) => l > 0).map(([k, l]) => `${UPGRADES[k].name} ${k === 'jump' ? JUMP_CLASS[l] : l}`);
    const last = g.ships.length <= 1, loaded = cargoUsed(sel) > 0;
    body.innerHTML = `<div class="hangar"><div class="hlist">${g.ships.map(s => `<div class="hship${s === sel ? ' on' : ''}" data-pick="${s.uid}">
        <b>${esc(s.name)}</b><span>${esc(SHIP_CLASSES[s.cls].name)}</span><span>Rumpf ${Math.round(s.hull * 100)} %${s.uid === g.activeShip ? ' · <em class="good">aktiv</em>' : ''}</span></div>`).join('')}
        <p class="dim" style="font-size:13px;line-height:1.5;margin-top:10px">Mindestens ein Schiff bleibt immer im Hangar. Neue Schiffe gibt es unter „Schiffe kaufen“.</p></div>
      <div class="hmain"><div class="svslot"></div>
        <div class="hinfo"><div><h4>${esc(sel.name)}</h4><div class="dim">${esc(c.name)} · ${esc(c.maker)} · ${esc(c.role)}</div>
          <div class="hstats"><span>Rumpf <b>${Math.round(sel.hull * 100)} %</b></span><span>Schild <b>${Math.round(st.shield)}</b></span><span>Tempo <b>${Math.round(st.speed)} m/s</b></span><span>Laser <b>${Math.round(st.laserDmg * st.laserRate)} DPS</b></span><span>Fracht <b>${st.cargo}</b></span><span>Raketen <b>${st.missiles}</b></span><span>Sprung <b>${JUMP_CLASS[st.jump]}</b></span></div>
          <div class="dim" style="font-size:13px;margin-top:6px">${mods.length ? 'Mods: ' + esc(mods.join(' · ')) : 'Keine Mods'}</div></div>
          <div class="hsell"><label>VERKAUFSWERT</label><b class="warm">${fmt(val)} Cr</b>
            <div class="drow" style="justify-content:flex-end;margin-top:8px">${active ? '<span class="good" style="align-self:center">Aktives Schiff</span>' : `<button class="btn small warm" data-act="${sel.uid}">Aktivieren</button>`}
            <button class="btn small" data-sell="${sel.uid}" ${last || loaded ? 'disabled' : ''} title="${last ? 'Dein einziges Schiff kann nicht verkauft werden' : loaded ? 'Erst die Fracht ausladen' : ''}">Verkaufen</button></div>
            ${last ? '<div class="dim" style="font-size:12px;margin-top:4px">Dein einziges Schiff: unverkäuflich</div>' : loaded ? '<div class="dim" style="font-size:12px;margin-top:4px">Fracht an Bord: erst ausladen</div>' : ''}</div></div></div></div>`;
    if (!this.pvWrap || this.pvShip !== sel.uid) {
      this.disposePreview();
      this.pvWrap = document.createElement('div'); this.pvWrap.className = 'shipview big';
      this.pvWrap.innerHTML = '<canvas></canvas>';
      this.pv = new ShipPreview(this.pvWrap.querySelector('canvas'), sel); this.pvShip = sel.uid; this.pvKey = null;
    }
    this.pvWrap.classList.add('big');
    body.querySelector('.svslot').replaceWith(this.pvWrap);
    requestAnimationFrame(() => this.pv?.resize());
    body.querySelectorAll('[data-pick]').forEach(d => d.onclick = () => { this.hangarSel = d.dataset.pick; this.sfx('blip'); rebuild(); });
    body.querySelectorAll('[data-act]').forEach(b => b.onclick = () => { g.activeShip = b.dataset.act; this.sfx(); this.game.save(); rebuild(); });
    body.querySelectorAll('[data-sell]').forEach(b => b.onclick = () => {
      const s = g.ships.find(x => x.uid === b.dataset.sell);
      if (!s || g.ships.length <= 1) return;
      if (s.cls === 'spacewing' && !confirm('Teos Spacewing wirklich verkaufen? Mags wird das nicht gefallen.')) return;
      g.ships = g.ships.filter(x => x !== s); addCredits(g, this.shipValue(s), `${s.name} verkauft`);
      if (g.activeShip === s.uid) g.activeShip = g.ships[0]?.uid;
      this.hangarSel = g.activeShip; this.sfx('coins'); this.game.save(); rebuild();
    });
  }

  // ------------------------------------------------------------------ cabin terminal
  openTerminal() {
    this.panel('Terminal', 'Kabine 4-117 · Hochstation Cassini', (body, rebuild) => {
      const g = this.g;
      body.innerHTML = `<div class="split"><div>
        ${this.pilotStats()}
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
    // the active mission's target system is pre-selected, its zone is tagged
    const goalZones = new Set([...g.jobs.filter(j => !j.done).map(j => j.kind === 'fracht' ? STATIONS[j.to].zone : j.zone),
      ...(STORY[g.story]?.zone && g.flags['accepted:' + g.story] && !g.flags['done:' + g.story] ? [STORY[g.story].zone] : [])]);
    const navZone = flight?.navGoal?.zone || [...goalZones][0];
    let selMoon = navZone && navZone !== here ? moonOfZone(navZone) : hereMoon, selZone = null;
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
          const row = $(`<div style="margin-top:10px"><div><b>${esc(z.name)}</b>${zid === here ? ' <span class="good">(hier)</span>' : ''}${z.hostile ? ' <span class="bad">feindlich</span>' : ''}${goalZones.has(zid) ? ' <span class="goaltag">AUFTRAG</span>' : ''}</div></div>`);
          if (flight && zid !== here) {
            const jump = mid !== hereMoon;
            const t = travelInfo(here, zid);
            const borrowed = flight.player.record?.uid?.startsWith('TEMP');   // story ships: the owner pays the fuel
            const pass = jump && storyJumpPass(g) === mid;                       // story patron's beacon pulls the ship over
            const fuelCost = borrowed || pass ? 0 : jump ? Math.round((260 + M.jump * 180) * (g.flags.zoll ? 1.4 : 1)) : Math.round(t.fuel * (g.flags.zoll ? 26 : 18));
            const b = $(`<button class="btn ${jump ? 'warm' : ''} small" style="margin-top:6px">${jump ? 'Hyperraumsprung' : 'Raumsprung'} · ${pass ? 'Sprungfreigabe' : fuelCost + ' Cr'}</button>`);
            const blocked = flight.ships.some(s => s.alive && flight.isHostile(s, flight.player) && s.pos.distanceTo(flight.player.pos) < 2500);
            if (jump && jumpCls < M.jump && !pass) b.disabled = true, b.textContent = `Sprungtriebwerk Klasse ${JUMP_CLASS[M.jump]} nötig (Werft)`;
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
  /** Controls: rebind keys, configure a joystick / gamepad (live view of axes and buttons), mouse and sound options. */
  controlsPanel(initialTab = 'tasten') {
    let tab = initialTab;
    const H = (t) => `<h4 style="font-family:var(--f-head);letter-spacing:.14em;margin:0 0 8px">${t}</h4>`;
    this.panel('Tastenbelegung', 'Tastatur, Joystick, Gamepad · alle Belegungen frei wählbar', (body, rebuild, close, w) => {
      w.querySelector('.tabs')?.remove();
      this.tabs(body, [['tasten', 'Tastatur'], ['joystick', 'Joystick / Gamepad'], ['optionen', 'Maus & Ton']], tab, (k) => { tab = k; rebuild(); });
      if (tab === 'joystick') return this.padConfig(body, rebuild);
      if (tab === 'optionen') {
        body.innerHTML = `<div style="max-width:520px">${H('MAUS')}<p class="dim">Empfindlichkeit</p><input type="range" min="0.3" max="2.5" step="0.1" value="${this.game.settings.mouseSens}" data-sens style="width:100%">
          <label style="display:block;margin-top:10px"><input type="checkbox" data-inv ${this.game.settings.invertY ? 'checked' : ''}> Y-Achse invertieren (Maus und Stick)</label>
          ${H('<br>TON')}<p class="dim">Lautstärke</p><input type="range" min="0" max="1" step="0.05" value="${this.game.settings.volume}" data-vol style="width:100%"></div>`;
        body.querySelector('[data-sens]').oninput = (e) => { this.game.settings.mouseSens = +e.target.value; this.game.saveSettings(); };
        body.querySelector('[data-inv]').onchange = (e) => { this.game.settings.invertY = e.target.checked; this.game.saveSettings(); };
        body.querySelector('[data-vol]').oninput = (e) => { this.game.settings.volume = +e.target.value; this.game.applyVolume(); this.game.saveSettings(); };
        return;
      }
      // keyboard: two slots per action, click a slot and press a key
      const row = (id) => {
        const ks = keysFor(id);
        return `<tr><td>${esc(ACTION[id].label)}</td>${[0, 1].map(i => `<td><button class="keycap${ks[i] ? '' : ' empty'}" data-bind="${id}" data-slot="${i}" title="Klicken und neue Taste drücken · Rechtsklick löscht">${ks[i] ? esc(keyLabel(ks[i])) : '+'}</button></td>`).join('')}</tr>`;
      };
      const group = (ctx) => ACTIONS.filter(a => a[2] === ctx).map(a => row(a[0])).join('');
      body.innerHTML = `<div class="split keys"><div>${H('IM ALL')}<table class="grid kb">${group('flug')}</table></div>
        <div>${H('AUF DER STATION')}<table class="grid kb">${group('station')}${group('beide')}</table>
        ${H('<br>FEST')}<table class="grid kb fixed">${[['Maus', 'Lenken / Umsehen · links Laser · rechts Rakete'], ['Mausrad', 'Schub'], ['1–4', 'Schubstufen 25–100 %'], ['F12', 'Vollbild an/aus'], ['Esc', 'Menü'], ['1–4', 'Antwort im Gespräch'], ['Leertaste / E', 'Gespräch weiter']].map(([k, v]) => `<tr><td>${v}</td><td><span class="keycap static">${k}</span></td></tr>`).join('')}</table>
        <div class="drow" style="justify-content:flex-start"><button class="btn small" data-reset>Standardbelegung</button></div>
        <p class="dim" style="font-size:13px;line-height:1.5">Tasten werden nach ihrer Position auf der Tastatur gespeichert. Angezeigt wird die Beschriftung deines Layouts (auf deutschen Tastaturen sind Y und Z vertauscht).</p></div></div>`;
      body.querySelectorAll('[data-bind]').forEach(btn => {
        btn.onclick = () => {
          if (this.capture) return;
          btn.textContent = 'Taste …'; btn.classList.add('wait');
          input.enabled = false;
          const done = (code) => {
            removeEventListener('keydown', onKey, true); this.capture = null; input.enabled = true;
            if (code) { const stolen = bindKey(btn.dataset.bind, +btn.dataset.slot, code); if (stolen.length) this.notify(`${esc(keyLabel(code))} war belegt mit: ${esc(stolen.join(', '))} (dort entfernt)`); this.sfx('blip'); }
            rebuild();
          };
          const onKey = (e) => {
            e.preventDefault(); e.stopImmediatePropagation();
            if (e.code === 'Escape') return done(null);
            if (e.code === 'F12') return;
            done(e.code);
          };
          this.capture = onKey;
          addEventListener('keydown', onKey, true);
        };
        btn.oncontextmenu = (e) => { e.preventDefault(); bindKey(btn.dataset.bind, +btn.dataset.slot, null); this.sfx(); rebuild(); };
      });
      body.querySelector('[data-reset]').onclick = () => { resetKeys(); this.sfx(); rebuild(); };
    }, { onClose: () => { if (this.capture) { removeEventListener('keydown', this.capture, true); this.capture = null; input.enabled = true; } } });
  }

  /** Joystick / gamepad tab: device, live axes and buttons, flight axes and button bindings. */
  padConfig(body, rebuild) {
    const pads = input.gamepads();
    if (!pads.length) {
      body.innerHTML = `<div class="padnone"><b>Kein Joystick oder Gamepad erkannt.</b><p>Gerät anschließen und einmal einen Knopf drücken: Browser melden Joysticks erst nach dem ersten Tastendruck. Diese Seite aktualisiert sich dann von selbst.</p>
        <p class="dim">Unterstützt werden alle Geräte, die der Browser als Gamepad meldet: Xbox- und PlayStation-Controller, Flugsticks wie Thrustmaster TCA Sidestick, T.16000M oder Logitech Extreme 3D.</p></div>`;
      const wait = () => { if (!body.isConnected) return; if (input.gamepads().length) rebuild(); else requestAnimationFrame(wait); };
      requestAnimationFrame(wait);
      return;
    }
    let gp = pads.find(p => p.id === this.padSel) || pads.find(p => p.id === input.lastPadId) || pads[0];
    this.padSel = gp.id;
    const prof = JSON.parse(JSON.stringify(profileFor(gp)));
    const commit = () => { saveProfile(gp, prof); };
    const nA = gp.axes.length, nB = gp.buttons.length;
    const HAT = ['oben', 'oben rechts', 'rechts', 'unten rechts', 'unten', 'unten links', 'links', 'oben links'];
    const flightAxes = () => new Set(Object.values(prof.axes || {}).filter(Boolean).map(A => A.i));
    const padActs = ACTIONS.filter(a => !['pitchDown', 'pitchUp', 'yawLeft', 'yawRight', 'walkFwd', 'walkBack', 'walkLeft', 'walkRight'].includes(a[0]));
    body.innerHTML = `<div class="padcfg">
      <div class="padhead">${pads.length > 1 ? `<select data-dev>${pads.map(p => `<option value="${esc(p.id)}" ${p === gp ? 'selected' : ''}>${esc(padName(p.id))}</option>`).join('')}</select>` : ''}
        <div><b>${esc(padName(gp.id))}</b><span class="dim"> · ${gp.mapping === 'standard' ? 'Gamepad (Standardbelegung)' : 'Joystick'} · ${nA} Achsen · ${nB} Knöpfe</span></div>
        <button class="btn small" data-reset>Standard für dieses Gerät</button></div>
      <div class="split"><div>
        <h4>ACHSEN <span class="dim">live</span></h4><div class="axmon">${gp.axes.map((_, i) => `<div class="ax" data-ax="${i}"><label>${i + 1}</label><div class="tr"><i></i></div><span></span></div>`).join('')}</div>
        <h4>KNÖPFE <span class="dim">live</span></h4><div class="btmon">${gp.buttons.map((_, i) => `<i data-bt="${i}">${i + 1}</i>`).join('')}</div>
        <h4>FLUGACHSEN</h4><table class="grid kb">${AXES.map(([k, l]) => { const A = prof.axes?.[k]; return `<tr><td>${l}</td>
          <td><select data-axis="${k}"><option value="">keine</option>${gp.axes.map((_, i) => `<option value="${i}" ${A && A.i === i ? 'selected' : ''}>Achse ${i + 1}</option>`).join('')}</select></td>
          <td><label class="dim"><input type="checkbox" data-inv="${k}" ${A?.inv ? 'checked' : ''}> umkehren</label></td>
          <td><button class="btn small" data-learn="${k}">bewegen…</button></td></tr>`; }).join('')}</table>
        <p class="dim" style="margin:8px 0 2px">Totzone</p><input type="range" min="0" max="0.3" step="0.01" value="${prof.deadzone ?? (gp.mapping === 'standard' ? 0.12 : 0.06)}" data-dz style="width:100%">
        <p class="dim" style="font-size:13px;line-height:1.5">Ein Schubhebel zählt erst, wenn er einmal bewegt wurde. Die Tastatur-Schubtasten bleiben nutzbar, bis der Hebel sich wieder bewegt.</p>
      </div><div>
        <h4>KNÖPFE BELEGEN</h4><table class="grid kb padacts">${padActs.map(a => `<tr><td>${esc(a[1])}</td><td class="chips">${(prof.buttons?.[a[0]] || []).map(bd => `<span class="keycap static">${esc(padLabel(bd))}</span>`).join('')}</td>
          <td class="num nowrap"><button class="mini" data-pb="${a[0]}" title="Klicken, dann Knopf oder Coolie-Hat am Gerät drücken">+ Knopf</button>${(prof.buttons?.[a[0]] || []).length ? `<button class="mini" data-pclr="${a[0]}" title="Belegung löschen">✕</button>` : ''}</td></tr>`).join('')}</table>
      </div></div></div>`;
    body.querySelector('[data-dev]')?.addEventListener('change', (e) => { this.padSel = e.target.value; rebuild(); });
    body.querySelector('[data-reset]').onclick = () => { resetProfile(gp); this.sfx(); rebuild(); };
    body.querySelectorAll('[data-axis]').forEach(sel => sel.onchange = () => { prof.axes ||= {}; prof.axes[sel.dataset.axis] = sel.value === '' ? null : { i: +sel.value, inv: !!prof.axes[sel.dataset.axis]?.inv }; commit(); rebuild(); });
    body.querySelectorAll('[data-inv]').forEach(cb => cb.onchange = () => { const A = prof.axes?.[cb.dataset.inv]; if (A) { A.inv = cb.checked; commit(); } });
    body.querySelector('[data-dz]').oninput = (e) => { prof.deadzone = +e.target.value; commit(); };
    body.querySelectorAll('[data-pclr]').forEach(b => b.onclick = () => { delete prof.buttons[b.dataset.pclr]; commit(); this.sfx(); rebuild(); });
    // learning: the next axis / button that moves is taken
    let learn = null;
    const startLearn = (btn, kind, key) => {
      const g0 = input.gamepads().find(p => p.id === gp.id) || gp;
      learn = { kind, key, rest: g0.axes.slice(), pressed: g0.buttons.map(b => b.pressed), btn };
      btn.textContent = kind === 'axis' ? 'jetzt bewegen…' : 'drücken…'; btn.classList.add('wait');
    };
    body.querySelectorAll('[data-learn]').forEach(b => b.onclick = () => startLearn(b, 'axis', b.dataset.learn));
    body.querySelectorAll('[data-pb]').forEach(b => b.onclick = () => startLearn(b, 'button', b.dataset.pb));
    const axEls = [...body.querySelectorAll('[data-ax]')], btEls = [...body.querySelectorAll('[data-bt]')];
    const tick = () => {
      if (!body.isConnected) return;
      const g = input.gamepads().find(p => p.id === gp.id);
      if (!g) { rebuild(); return; }
      const used = flightAxes();
      g.axes.forEach((v, i) => {
        const e = axEls[i]; if (!e) return;
        const hat = Math.abs(v) > 1.05 || (learn && Math.abs(learn.rest[i]) > 1.05);
        e.querySelector('i').style.cssText = hat ? `left:${Math.abs(v) > 1.05 ? 50 : (v + 1) * 50}%;width:4px` : `left:${Math.min(50, (v + 1) * 50)}%;width:${Math.abs(v) * 50}%`;
        e.querySelector('span').textContent = Math.abs(v) > 1.05 ? 'Hat ·' : v.toFixed(2);
        e.classList.toggle('used', used.has(i));
      });
      g.buttons.forEach((b, i) => btEls[i]?.classList.toggle('on', b.pressed));
      if (learn) {
        if (learn.kind === 'axis') {
          let bi = -1, bd = 0.5;
          g.axes.forEach((v, i) => { if (Math.abs(learn.rest[i]) > 1.05) return; const d = Math.abs(v - learn.rest[i]); if (d > bd) { bd = d; bi = i; } });
          if (bi >= 0) { prof.axes ||= {}; prof.axes[learn.key] = { i: bi, inv: !!prof.axes[learn.key]?.inv }; commit(); learn = null; this.sfx('blip'); rebuild(); return; }
        } else {
          let bd = null;
          const bi = g.buttons.findIndex((b, i) => b.pressed && !learn.pressed[i]);
          if (bi >= 0) bd = { b: bi };
          else g.axes.forEach((v, i) => {
            if (bd || used.has(i)) return;
            const r = learn.rest[i];
            if (Math.abs(r) > 1.05 && Math.abs(v) <= 1.05) { const k = Math.round((v + 1) * 3.5); bd = { a: i, v: -1 + k * 2 / 7, hat: HAT[(k + 8) % 8] }; }   // POV hat (Chrome reports it on one axis)
            else if (Math.abs(r) <= 1.05 && Math.abs(v - r) > 0.7) bd = { a: i, v: Math.sign(v - r) };
          });
          if (bd) {
            const list = prof.buttons[learn.key] ||= [];
            if (!list.some(x => JSON.stringify(x) === JSON.stringify(bd))) list.push(bd);
            commit(); learn = null; this.sfx('blip'); rebuild(); return;
          }
        }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  pause() {
    if (this.pauseEl) return;
    this.game.setPaused(true);
    const inFlight = !!this.game.mode?.isFlight;
    const wrap = this.panel('Menü', `${esc(this.g.callsign)} · Tag ${this.g.day} · ${fmt(this.g.credits)} Cr`, (body) => {
      body.innerHTML = `<div class="pausemenu">
        <button class="btn warm" data-a="resume">Weiter <small>Esc</small></button>
        <button class="btn" data-a="controls">Tastenbelegung &amp; Optionen</button>
        <button class="btn" data-a="save" ${inFlight ? 'disabled' : ''}>Spiel speichern${inFlight ? ' <small>nur angedockt</small>' : ''}</button>
        <div class="pmrow"><button class="btn small" data-a="export">Spielstand als JSON herunterladen</button><button class="btn small" data-a="import">JSON-Spielstand laden</button></div>
        <button class="btn" data-a="full">Vollbild an/aus <small>F12</small></button>
        <button class="btn" data-a="title">Hauptmenü</button>
        <p class="dim">Das Spiel speichert automatisch im Browser (beim Andocken und nach wichtigen Ereignissen). Die JSON-Datei ist deine Sicherung, auch für einen anderen Rechner, und enthält deine Tastenbelegung, die Joystick-Einstellungen und die Optionen.${inFlight ? ' Im Flug enthält sie den Stand beim Abflug.' : ''}</p></div>`;
      body.querySelector('[data-a="resume"]').onclick = () => wrap._close();
      body.querySelector('[data-a="controls"]').onclick = () => this.controlsPanel();
      body.querySelector('[data-a="save"]').onclick = () => { this.game.save(); this.notify('Gespeichert'); this.sfx('coins'); };
      body.querySelector('[data-a="export"]').onclick = () => { if (!inFlight) this.game.save(); this.exportSave(); };
      body.querySelector('[data-a="import"]').onclick = () => this.importSave();
      body.querySelector('[data-a="full"]').onclick = () => this.game.toggleFullscreen();
      body.querySelector('[data-a="title"]').onclick = () => {
        if (inFlight && !confirm('Zurück ins Hauptmenü? Der Flug seit dem letzten Andocken geht verloren.')) return;
        wrap._close(); this.game.toTitle();
      };
    }, { narrow: true, onClose: () => { this.pauseEl = null; this.game.setPaused(false); } });
    this.pauseEl = wrap;
  }

  /** Download the save as a JSON file. */
  exportSave() {
    const json = state.exportJSON();
    if (!json) { this.notify('Noch kein Spielstand vorhanden.'); return; }
    const g = JSON.parse(json).state;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    a.download = `spacewing-${String(g.callsign).replace(/[^\w-]+/g, '_')}-tag${g.day}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    this.notify('Spielstand als JSON gespeichert'); this.sfx('coins');
  }

  /** Pick a JSON save file and continue from it (replaces the browser save). */
  importSave() {
    const f = document.createElement('input');
    f.type = 'file'; f.accept = '.json,application/json';
    f.onchange = async () => {
      const file = f.files?.[0]; if (!file) return;
      try {
        const g = state.parseJSON(await file.text());
        if (state.hasSave() && !confirm(`Spielstand „${g.callsign}“ (Tag ${g.day}, ${fmt(g.credits)} Cr) laden? Der aktuelle Stand im Browser wird ersetzt.`)) return;
        const ex = g._extras || {};
        state.set(g); state.save();
        const keys = importControls(ex.controls);
        if (ex.settings) { Object.assign(this.game.settings, ex.settings); this.game.saveSettings(); this.game.applyVolume(); }
        this.closeAllModals(); this.pauseEl = null; this.game.setPaused(false);
        this.notify(`Spielstand geladen: ${esc(g.callsign)}, Tag ${g.day}${keys ? '<br><span class="dim">Tastenbelegung und Joystick übernommen</span>' : ''}`);
        this.game.continueGame();
      } catch (e) { this.sfx('error'); this.notify(esc(e.message)); }
    };
    f.click();
  }

  closeAllModals() { while (this.closeTop()); }

  cockpit() {}
}
