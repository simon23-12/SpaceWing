import * as THREE from 'three';
import { Renderer } from '../core/renderer.js';
import { Audio } from '../core/audio.js';
import { input } from '../core/input.js';
import { assets } from '../core/assets.js';
import { UI } from '../ui/ui.js';
import { state, newGame, activeShip, logEntry, addCredits, fmt, addShip } from './state.js';
import { STATIONS, shipStats, MOONS, MOON_ORDER, JUMP_CLASS, moonOfStation } from './data.js';
import { STORY, npcDialogue, finaleChoice, kroneEnding, PEOPLE } from './story.js';
import { Director, onDockJobs, generateJobs } from './missions.js';
import { FlightMode } from '../space/flight.js';
import { RoomMode } from '../station/room.js';
import { ZONES } from '../space/universe.js';

const SETTINGS_KEY = 'spacewing.settings';

export class Game {
  constructor() {
    this.renderer = new Renderer(document.getElementById('c'));
    this.audio = new Audio();
    this.ui = new UI(this);
    this.mode = null;
    this.paused = false;
    this.settings = { mouseSens: 1, invertY: false, volume: 0.8 };
    try { Object.assign(this.settings, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); } catch { }
    this.clock = new THREE.Clock();
    if (import.meta.env.DEV) window.__S = { state, newGame, addShip };
    addEventListener('keydown', (e) => this.onKey(e));
    addEventListener('pointerdown', () => { this.audio.start(); this.applyVolume(); }, { once: false });
    const loop = () => { requestAnimationFrame(loop); this.frame(); };
    loop();
  }

  get state() { return state.g; }
  saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); } catch { } }
  applyVolume() { if (this.audio.master) this.audio.master.gain.value = this.settings.volume; }
  save() { if (this.state && !this.mode?.isFlight) state.save(); }
  fadeOut(s) { return this.ui.fadeOut(s); }
  fadeIn(s) { return this.ui.fadeIn(s); }
  setPaused(p) { this.paused = p; if (this.mode?.isFlight) this.mode.paused = p; }

  frame() {
    const dt = Math.min(0.1, this.clock.getDelta());
    if (this.mode && !this.paused && this.mode.update) this.mode.update(dt);
    if (this.mode && this.mode.render3D !== false) this.renderer.render(dt);
    input.endFrame();
  }

  /** F12: real fullscreen (the browser's own F12 shortcut is suppressed while the game has focus). */
  toggleFullscreen() {
    const d = document;
    if (d.fullscreenElement) { d.exitFullscreen?.(); return; }
    const p = d.documentElement.requestFullscreen?.({ navigationUI: 'hide' });
    p?.then(() => { if (this.mode?.isRoom || this.mode?.isFlight) input.lock(this.renderer.gl.domElement); }).catch(() => this.ui.notify('Vollbild wurde vom Browser abgelehnt.'));
  }

  onKey(e) {
    if (e.code === 'F12') { e.preventDefault(); if (!e.repeat) this.toggleFullscreen(); return; }
    if (e.code === 'Escape') {
      if (this.ui.dlg) return;
      if (this.ui.closeTop()) return;
      if (this.mode && this.mode.kind !== 'title') this.ui.pause();
    }
  }

  onModalClosed() { this.ui.refreshTopbar(); }

  // ------------------------------------------------------------------ boot / title
  async boot() {
    await this.toTitle();
  }

  async toTitle() {
    await this.leaveMode();
    this.ui.clear();
    this.audio.setMusic('menu');
    this.mode = { kind: 'title', render3D: false };
    this.ui.title({
      hasSave: state.hasSave(),
      onNew: (cs) => this.startNew(cs),
      onContinue: () => this.continueGame(),
    });
    await this.fadeIn(0.8);
  }

  async startNew(callsign) {
    this.audio.start(); this.applyVolume();
    await this.fadeOut(0.6);
    this.ui.clear();
    state.set(newGame(callsign));
    logEntry(this.state, 'Auf Hochstation Cassini gestrandet. 40 Kredits.');
    await this.enterRoom('kabine', 'default', { intro: true });
  }

  async continueGame() {
    this.audio.start(); this.applyVolume();
    const g = state.load();
    if (!g) return this.startNew('Wren');
    await this.fadeOut(0.5);
    this.ui.clear();
    await this.enterStation(g.location, { fromSave: true });
  }

  async leaveMode() {
    const m = this.mode;
    if (!m) return;
    if (m.director) m.director.dispose();
    m.dispose?.();
    this.ui.closeOverview();
    this.audio.setEngine(false);
    this.renderer.setMood(null);
    this.mode = null;
  }

  // ------------------------------------------------------------------ station
  /** Announce moons that became reachable since the last check (the game's levels). */
  checkUnlocks() {
    const g = this.state;
    g.moonsOpen = g.moonsOpen || ['rhea'];
    for (const id of MOON_ORDER) {
      if (g.moonsOpen.includes(id) || !MOONS[id].unlock(g)) continue;
      g.moonsOpen.push(id);
      const M = MOONS[id];
      logEntry(g, `Neues Ziel freigeschaltet: ${M.name} (Sprungklasse ${JUMP_CLASS[M.jump]})`);
      this.ui.notify(`<b style="color:${M.color}">NEUER MOND: ${M.name.toUpperCase()}</b><br>${STATIONS[M.station].name} · Sprungtriebwerk Klasse ${JUMP_CLASS[M.jump]} nötig`);
      this.audio?.coins?.();
    }
  }

  async enterStation(stationId, opts = {}) {
    const g = this.state;
    g.location = stationId; g.docked = true;
    this.checkUnlocks();
    if (STATIONS[stationId].walkable) return this.toOverview();
    return this.dockMenu(stationId);
  }

  async toOverview() {
    await this.leaveMode();
    this.ui.clear();
    input.unlock();
    this.audio.setMusic('station');
    this.mode = { kind: 'overview', render3D: false };
    await this.ui.overview((id) => this.onOverviewPick(id));
    generateJobs(this.state, 'cassini');
    this.save();
    await this.fadeIn(0.6);
    this.checkStationEvents();
  }

  async onOverviewPick(id) {
    if (id === 'walk') return this.enterRoom('bruecke', 'default');
    if (id === 'boerse') return this.ui.openBoerse();
    if (id === 'werft') return this.ui.openWerft();
    if (id === 'karte') return this.ui.openMap(null);
    if (['bar', 'hangar', 'kabine', 'aussicht'].includes(id)) return this.enterRoom(id, 'default');
  }

  async enterRoom(roomId, spawn = 'default', opts = {}) {
    await this.fadeOut(0.4);
    await this.leaveMode();
    this.ui.clear();
    const ld = this.ui.loading('LADE ' + roomId.toUpperCase());
    const room = new RoomMode(this, roomId, spawn);
    try { await room.init(); } catch (e) { console.error(e); ld.done(); this.ui.notify('Raum konnte nicht geladen werden.'); return this.toOverview(); }
    ld.done();
    this.mode = room;
    await this.fadeIn(0.6);
    if (opts.intro) await this.intro();
    this.checkStationEvents();
  }

  async intro() {
    const g = this.state;
    await this.ui.dialog([
      { who: 'comp', text: 'Hochstation Cassini, Rhea-Orbit. 2260. Kabine 4-117: klein, gemietet, aber mit Fenster zum Saturn.' },
      { who: 'comp', text: `Guten Morgen, ${g.callsign}. Kontostand: 40 Kredits. Bezahlte Miete: noch drei Nächte. Arbeitgeber: Hallström Logistik, insolvent seit dem Zollbeschluss der Liga.` },
      { who: 'comp', text: 'Empfehlung: Arbeit finden. Die Bar „Cassini-Spalt“ liegt am Ende des Ringgangs, links aus deiner Tür. Barkeeper wissen alles.' },
    ]);
  }

  /** Events that fire when entering a station view (finale choice, notes). */
  async checkStationEvents() {
    const g = this.state;
    if (g.story === 'kassini' && !g.flags.ending && this.mode?.roomId === 'bar') {
      await this.ui.dialog(finaleChoice(this));
      this.save();
    }
  }

  async dockMenu(stationId) {
    await this.leaveMode();
    this.ui.clear();
    input.unlock();
    this.audio.setMusic('station');
    const st = STATIONS[stationId];
    this.mode = { kind: 'dock', render3D: false };
    const el = document.createElement('div');
    el.className = 'overview';
    const bg = { gewoelbe: 'assets/ui/vault.jpg', kraken: 'assets/ui/kraken.jpg', quelle: 'assets/ui/quelle.jpg', herschel: 'assets/ui/herschel.jpg' }[stationId] || 'assets/ui/dock.jpg';
    const M = MOONS[moonOfStation(stationId)];
    el.innerHTML = `<div class="img" style="inset:0;background-image:url(${assets.url(bg)}), url(${assets.url('assets/stations/station_small/preview.jpg')});filter:brightness(.8)"></div>`;
    el.appendChild(this.ui.topbar());
    const panel = document.createElement('div');
    panel.className = 'sidehint';
    panel.style.cssText = 'top:80px;bottom:auto;left:40px;max-width:480px;display:flex;flex-direction:column;gap:10px;padding:20px';
    panel.innerHTML = `<div style="letter-spacing:.3em;font-family:var(--f-head);color:${M?.color || '#9fd6ff'}">${(M?.name || '').toUpperCase()} · ${M?.tag || ''}</div><b style="font-size:24px">${st.name.toUpperCase()}</b><div>${st.blurb}</div>
      <button class="btn" data-a="boerse">Söldnerbörse</button><button class="btn" data-a="markt">Markt</button><button class="btn" data-a="werft">Werft &amp; Reparatur</button>
      ${st.apartment ? `<button class="btn" data-a="apt">${this.state.apartments?.[stationId] ? '⌂ Apartment &amp; Transit' : 'Apartment kaufen'}</button>` : ''}
      <button class="btn" data-a="map">Systemkarte</button>
      <button class="btn warm" data-a="launch">Abflug</button>`;
    panel.querySelector('[data-a="boerse"]').onclick = () => this.ui.openBoerse();
    panel.querySelector('[data-a="markt"]').onclick = () => this.ui.openMarket();
    panel.querySelector('[data-a="werft"]').onclick = () => this.ui.openWerft();
    panel.querySelector('[data-a="launch"]').onclick = () => this.launch();
    panel.querySelector('[data-a="apt"]')?.addEventListener('click', () => this.ui.openApartment(stationId));
    panel.querySelector('[data-a="map"]').onclick = () => this.ui.openMap(null);
    el.appendChild(panel);
    document.getElementById('ui').appendChild(el);
    generateJobs(this.state, stationId);
    this.save();
    await this.fadeIn(0.6);
  }

  // ------------------------------------------------------------------ interactions in rooms
  async onInteract(room, m) {
    const g = this.state;
    this.audio.click();
    if (m.kind === 'npc' || m.kind === 'person') {
      input.unlock();
      room.setTalking?.(m.id, true);
      await this.ui.dialog(npcDialogue(this, m.id));
      room.setTalking?.(m.id, false);
      this.checkUnlocks();
      this.save(); return;
    }
    if (m.kind === 'ship') return this.launch();
    if (m.kind === 'band') { this.ui.notify('„Roche-Grenze“ – Saffi Lindqvist (Gesang, hier: Saxofon-Hologramm), Bass, Rhodes. Live mit 2,3 s Lichtverzögerung.'); return; }
    if (m.kind === 'terminal') {
      if (m.id === 'boerse') return this.ui.openBoerse();
      if (m.id === 'hangar_werft') return this.ui.openWerkstatt();
      if (m.id === 'werft') return this.ui.openWerft();
      if (m.id === 'karte') return this.ui.openMap(null);
      if (m.id === 'kabine_terminal') return this.ui.openTerminal();
      if (m.id === 'bett') return this.sleep();
      if (m.id === 'bar_order') {
        if (g.credits < 12) { this.ui.notify('Kix: „Kein Geld, kein Whisky.“'); return; }
        g.credits -= 12; this.ui.notify('Kix schiebt dir einen synthetischen Whisky rüber. −12 Cr'); this.ui.refreshTopbar(); return;
      }
    }
  }

  async sleep() {
    const g = this.state;
    await this.fadeOut(1.0);
    g.day++;
    // rent once the first three nights are over
    const rentDue = g.day > 3 && !g.apartments?.[g.location];
    if (rentDue) { const rent = 25; g.credits -= rent; logEntry(g, `Kabinenmiete −${rent} Cr`); }
    for (const s of g.ships) s.hull = Math.min(1, s.hull + 0.02);
    this.save();
    this.ui.notify(`Tag ${g.day}. ${rentDue ? 'Kabinenmiete abgebucht.' : 'Du fühlst dich ausgeruht.'}`);
    this.ui.refreshTopbar();
    await this.fadeIn(1.0);
  }

  // ------------------------------------------------------------------ flight
  launchShipRecord() {
    const g = this.state;
    const st = STORY[g.story];
    if (st && st.ship && g.flags['accepted:' + g.story] && !g.flags['done:' + g.story]) return st.ship;
    return activeShip(g);
  }

  async launch() {
    const g = this.state;
    const rec = this.launchShipRecord();
    if (!rec) { this.ui.notify('Du hast kein Schiff. Noch nicht.'); return; }
    if (rec.hull !== undefined && rec.hull < 0.15) { this.ui.notify('Der Rumpf ist zu beschädigt. Erst reparieren (Werft).'); return; }
    const zone = STATIONS[g.location].zone;
    g.docked = false;
    this.save();
    await this.startFlight(zone, 'undock', rec);
  }

  async startFlight(zone, spawn, rec, extra = {}) {
    await this.fadeOut(0.5);
    await this.leaveMode();
    this.ui.clear();
    const ld = this.ui.loading('START · ' + ZONES[zone].name.toUpperCase());
    const director = new Director(this, zone, { spawn });
    const f = new FlightMode(this, { zone, spawn, playerRecord: rec, mission: director, ...extra });
    f.isFlight = true;
    f.director = director;
    try { await f.init(); } catch (e) { console.error(e); ld.done(); this.ui.notify('Fehler beim Laden der Zone'); return this.enterStation(this.state.location); }
    ld.done();
    this.mode = f;
    this.audio.setEngine(true);
    this.audio.setMusic('space');
    f.on('docked', (id) => this.onDocked(f, id));
    f.on('playerDead', () => this.onPlayerDead(f));
    await this.fadeIn(0.8);
    const lockOnClick = () => { if (this.mode === f && !this.ui.modalOpen) input.lock(this.renderer.gl.domElement); };
    this.renderer.gl.domElement.addEventListener('mousedown', lockOnClick);
    f._unlock = () => this.renderer.gl.domElement.removeEventListener('mousedown', lockOnClick);
    const prevDispose = f.dispose.bind(f);
    f.dispose = () => { f._unlock(); prevDispose(); };
  }

  travel(flight, zoneId, jump = false) {
    input.unlock();
    flight.travelTo(zoneId, () => this.arrive(flight, zoneId), { jump });
  }

  /** Transit capsule between two owned apartments (no flight). */
  async teleport(stationId) {
    const g = this.state;
    if (!g.apartments?.[stationId] || !g.apartments?.[g.location]) { this.ui.notify('Transit nur zwischen eigenen Apartments.'); return; }
    const M = MOONS[moonOfStation(stationId)];
    await this.fadeOut(0.5);
    await this.leaveMode();
    this.ui.clear();
    this.mode = { kind: 'transit', render3D: false };
    this.audio?.burn?.();
    await this.ui.transitScreen(`TRANSIT · ${M.name.toUpperCase()}`, STATIONS[stationId].flat);
    g.day += 1;
    logEntry(g, `Transit nach ${STATIONS[stationId].name}`);
    g.location = stationId; g.docked = true;
    this.save();
    await this.enterStation(stationId);
  }

  async arrive(flight, zoneId) {
    const rec = flight.player.record;
    const jumped = !!flight.travel?.jump;
    this.syncShipState(flight);
    if (jumped) this.state.day += 1;
    await this.startFlight(zoneId, 'arrive', rec, { jumped });
  }

  syncShipState(flight) {
    const p = flight.player;
    const rec = p.record;
    if (rec && rec.uid && !rec.uid.startsWith('TEMP')) rec.hull = Math.max(0.05, p.hull / p.maxHull);
  }

  async onDocked(flight, stationId) {
    const g = this.state;
    this.syncShipState(flight);
    await this.leaveMode();
    this.ui.clear();
    g.location = stationId; g.docked = true;
    const msgs = onDockJobs(this, stationId);
    // story hooks
    const st = STORY[g.story];
    let dlg = null;
    if (g.flags.ending === 'krone' && stationId === 'kraken' && !g.flags['done:kassini']) dlg = kroneEnding(this);
    else if (st && st.onDock && g.flags['accepted:' + g.story]) dlg = st.onDock(this, stationId);
    const scene = dlg && dlg[0]?.scene;
    if (dlg) {
      this.mode = { kind: 'cutscene', render3D: false };
      const bg = document.createElement('div');
      bg.className = 'overview';
      const img = { hangar: 'assets/ui/hangar.jpg', bar: 'assets/ui/bar.jpg', kraken: 'assets/ui/kraken.jpg', vault: 'assets/ui/vault.jpg', quelle: 'assets/ui/dock.jpg' }[scene] || 'assets/ui/overview.jpg';
      bg.innerHTML = `<div class="img" style="inset:0;background-image:url(${assets.url(img)}), url(${assets.url('assets/ui/overview.jpg')})"></div>`;
      document.getElementById('ui').appendChild(bg);
      await this.fadeIn(0.6);
      await this.ui.dialog(dlg);
      bg.remove();
      if (g.flags.endingShown && !g.flags.creditsShown) { g.flags.creditsShown = true; await this.credits(); }
    }
    for (const m of msgs) this.ui.notify(m);
    if (msgs.length) this.audio.coins();
    this.save();
    await this.enterStation(stationId);
  }

  async onPlayerDead(flight) {
    const g = this.state;
    await this.fadeOut(1.2);
    await this.leaveMode();
    this.ui.clear();
    const st = STORY[g.story];
    const temp = flight.player.record?.uid?.startsWith('TEMP');
    let fee = Math.min(g.credits, Math.round(800 + g.earned * 0.02));
    if (temp) { fee = 0; g.flags.m1stage = 0; }
    g.credits -= fee;
    const ship = activeShip(g);
    if (ship && !temp) ship.hull = 0.3;
    g.location = 'cassini';
    logEntry(g, `Abgeschossen. Bergung und Notreparatur: −${fmt(fee)} Cr`);
    this.mode = { kind: 'cutscene', render3D: false };
    await this.ui.dialog([
      { who: temp ? 'mags' : 'comp', text: temp ? 'Rettungskapsel geborgen. Der Eisvogel hat mehr abbekommen, als mir lieb ist. Wir versuchen es noch mal, und diesmal triffst du.' : `Rettungskapsel von einem Bergungsschlepper aufgenommen. Bergung und Notreparatur kosten ${fmt(fee)} Kredits. Willkommen zurück auf Cassini.` },
    ]);
    this.save();
    await this.enterStation('cassini');
  }

  async credits() {
    const g = this.state;
    const text = {
      foederation: 'ENDE · DIE FÖDERATION DES SATURN<br><br>Die Monde haben sich zusammengetan, ohne Krone und ohne Zoll. Die Vesper-Prognose sagt dreißig schwere Jahre voraus. Vielleicht werden es weniger.',
      zoll: 'ENDE · ORDNUNG DURCH ZOLL<br><br>Der Saturn ist ein Protektorat der Liga. Es ist ruhig, und die Ruhe hat ihren Preis. Die Prognose zählt die Jahre bis zum nächsten Bruch.',
      krone: 'ENDE · DIE KRONE<br><br>Aurelia Varga ist Kaiserin des Saturn. Du bist reich. Die Prognose sagt tausend Jahre Ordnung voraus und erwähnt keinen einzigen Namen.',
    }[g.flags.endingShown];
    const el = document.createElement('div');
    el.className = 'modal';
    el.innerHTML = `<div class="panel" style="width:min(760px,92vw)"><div class="body" style="text-align:center;padding:40px;font-size:20px;line-height:1.6">${text}<br><br><span class="dim" style="font-size:15px">SPACEWING SATURN<br>Danke fürs Spielen. Das System bleibt offen für freies Spiel.</span><br><br><button class="btn warm">Weiter</button></div></div>`;
    document.getElementById('ui').appendChild(el);
    await new Promise(r => el.querySelector('button').onclick = r);
    el.remove();
  }
}
