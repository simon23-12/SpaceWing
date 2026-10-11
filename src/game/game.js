import * as THREE from 'three';
import { Renderer } from '../core/renderer.js';
import { Audio } from '../core/audio.js';
import { input } from '../core/input.js';
import { keysFor } from '../core/bindings.js';
import { assets } from '../core/assets.js';
import { UI } from '../ui/ui.js';
import { state, newGame, activeShip, logEntry, addCredits, fmt, addShip } from './state.js';
import { STATIONS, shipStats, MOONS, MOON_ORDER, JUMP_CLASS, moonOfStation, SHIP_CLASSES, towFee } from './data.js';
import { STORY, npcDialogue, finaleChoice, kroneEnding, PEOPLE } from './story.js';
import { Director, onDockJobs, generateJobs, SIM_SCENARIOS, simMedal, simReward, MEDALS } from './missions.js';
import { FlightMode } from '../space/flight.js';
import { checkGadgets, GADGETS } from '../station/gadgets.js';
import { RoomMode } from '../station/room.js';
import { IntroMode } from './intro.js';
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
    // Esc while the mouse is captured never reaches the page: the lost pointer lock opens the menu instead
    input.onPadConnected = (gp, name) => this.ui.notify(`<b style="color:var(--accent)">${gp.mapping === 'standard' ? 'GAMEPAD' : 'JOYSTICK'} ERKANNT</b><br>${name.replace(/[<>&]/g, '')}<br><span class="dim">Belegung: Menü (Esc) → Tastenbelegung → Joystick</span>`);
    input.onLockLost = () => setTimeout(() => {
      if (performance.now() - (this.escT || 0) < 300 || this.ui.modalOpen) return;
      if (this.mode?.isRoom || (this.mode?.isFlight && this.mode.state === 'flying')) this.ui.pause();
    }, 60);
    // in fullscreen, keep Esc for the game menu (Chrome/Edge keyboard lock); F12 toggles fullscreen
    document.addEventListener('fullscreenchange', () => {
      if (document.fullscreenElement) navigator.keyboard?.lock?.(['Escape']).catch(() => {});
      else navigator.keyboard?.unlock?.();
    });
    addEventListener('pointerdown', () => { this.audio.start(); this.applyVolume(); if (this.mode?.kind === 'title') this.audio.setMusic('menu'); }, { once: false });
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
    input.pollPad();
    if (input.pad?.hit('menu') && (this.mode?.isRoom || this.mode?.isFlight) && !this.ui.modalOpen) this.ui.pause();
    else if (input.actHit('menu') && !this.ui.modalOpen && (this.mode?.isRoom || this.mode?.isFlight)) this.ui.pause();
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
    if (this.mode?.kind === 'intro') {
      if (['Escape', 'Space', 'Enter', 'NumpadEnter'].includes(e.code)) { e.preventDefault(); this.mode.skip(); }
      return;
    }
    // pilot status: anywhere on a station (walking, deck overview, docked menu), never in flight
    if (keysFor('stats').includes(e.code) && !e.repeat && input.enabled && this.state && ['room', 'overview', 'dock'].includes(this.mode?.isRoom ? 'room' : this.mode?.kind) && !this.ui.dlg) {
      if (this.ui.statsEl || !this.ui.modalOpen) { e.preventDefault(); this.ui.toggleStats(); }
      return;
    }
    if (e.code === 'Escape') {
      this.escT = performance.now();
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
    this.sortie = null;
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
    logEntry(this.state, 'Flugschein bestanden. 40 Kredits, kein Schiff.');
    const { room, watched } = await this.playIntro();
    await this.enterRoom('kabine', 'default', { intro: true, room, watched });
  }

  /** Opening cinematic (skippable). Returns the deck it loaded, so the game starts without a second loading screen. */
  async playIntro() {
    await this.leaveMode();
    this.ui.clear();
    const ld = this.ui.loading('HOCHSTATION CASSINI · RHEA-ORBIT');
    const intro = new IntroMode(this);
    try { await intro.init(); } catch (e) { console.error(e); ld.done(); intro.dispose(); return { room: null, watched: false }; }
    ld.done();
    this.audio.setMusic('menu');
    this.mode = intro;
    this.fadeIn(0.3);
    const watched = await intro.play();
    await this.fadeOut(watched ? 0.3 : 0.6);
    const room = intro.takeRoom();
    await this.leaveMode();
    return { room, watched };
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
    for (const G of checkGadgets(g)) { this.ui.notify(`<b style="color:var(--warm)">NEU IN DEINER KABINE</b><br>${G.name}`); logEntry(g, `Erinnerungsstück: ${G.name}`); }
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
    for (const s of g.ships) delete s.missiles;   // the hangar crew reloads the missile racks for free (undefined = full)
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
    let room = opts.room;
    if (room) room.beginPlay(roomId, spawn);
    else {
      const ld = this.ui.loading('LADE ' + roomId.toUpperCase());
      room = new RoomMode(this, roomId, spawn);
      try { await room.init(); } catch (e) { console.error(e); ld.done(); this.ui.notify('Raum konnte nicht geladen werden.'); return this.toOverview(); }
      ld.done();
    }
    this.mode = room;
    await this.fadeIn(0.6);
    if (opts.intro) await this.intro(opts.watched);
    this.checkStationEvents();
  }

  /** Morning briefing in the cabin. After the full cinematic the first line (where and when) is left out. */
  async intro(watched = false) {
    const g = this.state;
    const steps = [
      { who: 'comp', text: 'Hochstation Cassini, Rhea-Orbit. 2260. Kabine 4-117: klein, abbezahlt und mit Fenster zum Saturn.' },
      { who: 'comp', text: `Guten Morgen, ${g.callsign}. Kontostand: 40 Kredits. Flugschein: gültig. Schiff: keins. Arbeitgeber: keiner, seit Hallström Logistik am Zollbeschluss der Liga pleitegegangen ist.` },
      { who: 'comp', text: 'Empfehlung: Arbeit finden. Die Bar „Cassini-Spalt“ liegt am Ende des Ringgangs, links aus deiner Tür. Barkeeper wissen alles.' },
    ];
    await this.ui.dialog(watched ? steps.slice(1) : steps);
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
    if (m.kind === 'gadget') {
      const G = GADGETS[m.id];
      if (m.id !== 'espresso') { this.ui.notify(`<b style="color:var(--warm)">${G.name}</b><br>${G.text}`); return; }
      if (g.credits < 1) { this.ui.notify('Kein Kredit, kein Espresso.'); return; }
      g.credits -= 1; this.ui.refreshTopbar(); this.audio.espresso?.(); room.brewEspresso?.();
      this.ui.notify(['Ein Espresso. Schwarz wie der Raum zwischen den Ringen. −1 Cr', 'Kurz, stark, heiß. Deck 4 hat schlechtere Ideen gehabt. −1 Cr', 'Die Maschine zischt zufrieden. −1 Cr'][Math.floor(Math.random() * 3)]);
      return;
    }
    if (m.kind === 'band') { this.ui.notify('„Roche-Grenze“ – Saffi Lindqvist (Gesang, hier: Saxofon-Hologramm), Bass, Rhodes. Live mit 2,3 s Lichtverzögerung.'); return; }
    if (m.kind === 'terminal') {
      if (m.id === 'boerse') return this.ui.openBoerse();
      if (m.id === 'hangar_werft') return this.ui.openWerkstatt();
      if (m.id === 'sim') return g.flags.m1done ? this.ui.openSim() : this.ui.notify('Simulator gesperrt. Erst nach deiner ersten Tour mit Mags.');
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
    for (const s of g.ships) s.hull = Math.min(1, s.hull + 0.02);
    this.save();
    this.ui.notify(`Tag ${g.day}. Du fühlst dich ausgeruht.`);
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
    // flight report: what changed between undocking and the next docking (shown after landing)
    this.sortie = { time: 0, from: g.location, credits0: g.credits, earned0: g.earned, kills0: g.kills, salvage: 0, rec, hull0: rec.hull ?? 1, temp: !!rec.uid?.startsWith('TEMP') };
    this.keepPointer = !!this.mode?.isRoom;
    if (this.mode?.isRoom && this.mode.launchCine && this.mode.roomId === 'hangar') await this.mode.launchCine();
    await this.startFlight(zone, 'undock', rec);
  }

  async startFlight(zone, spawn, rec, extra = {}) {
    await this.fadeOut(0.5);
    await this.leaveMode();
    this.keepPointer = false;
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
    if (this.sortie) { this.sortie.time += flight.time; this.sortie.jumps = (this.sortie.jumps || 0) + (jumped ? 1 : 0); }
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
    const sortie = this.sortie; this.sortie = null;
    if (sortie) sortie.time += flight.time;
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
    if (sortie) this.ui.debrief(this.sortieReport(sortie, stationId));
  }

  /** Numbers for the flight report after docking. */
  sortieReport(s, stationId) {
    const g = this.state, rec = s.rec;
    const st = rec && !s.temp && SHIP_CLASSES[rec.cls] ? shipStats(rec) : null;
    const hull1 = s.temp ? null : rec?.hull ?? 1;
    return {
      time: s.time, station: stationId, from: s.from, jumps: s.jumps || 0,
      earned: g.earned - s.earned0, net: g.credits - s.credits0, kills: g.kills - s.kills0,
      salvage: s.salvage, net_t: s.temp ? 0 : rec?.cargo?.schrott || 0,
      hull0: s.temp ? null : s.hull0, hull1, repair: st && hull1 < 0.999 ? Math.round((1 - hull1) * st.hull * 6) : 0,
      ship: rec,
    };
  }

  /** Ships the simulator can load: your own (with their mods) and stock test profiles of ships sold in opened moon systems. */
  simShips() {
    const g = this.state, out = g.ships.map(s => ({ key: s.uid, rec: s, own: true }));
    const profiles = [['mule', 'rhea'], ['kestrel', 'enceladus'], ['corsair', 'mimas'], ['lanze', 'titan']];
    for (const [cls, moon] of profiles) if (MOONS[moon].unlock(g)) out.push({ key: 'probe:' + cls, rec: { cls, name: SHIP_CLASSES[cls].name, upgrades: {}, paint: null, cargo: {} }, own: false });
    return out;
  }

  /** Combat simulator: fly a copy of one of your ships (or a test profile), nothing is lost. */
  async startSim(id, shipKey) {
    const g = this.state;
    const pick = this.simShips().find(s => s.key === shipKey) || this.simShips().find(s => s.key === g.activeShip);
    if (!pick) { this.ui.notify('Ohne eigenes Schiff gibt es keine Simulation.'); return; }
    g.simShip = pick.key;
    // missiles: the simulator loads every rack it has (undefined = full)
    const rec = { ...pick.rec, uid: 'TEMP-SIM', hull: 1, cargo: {}, missiles: undefined, upgrades: { ...pick.rec.upgrades } };
    this.simRun = { id, shipKey: pick.key, shipName: pick.rec.name, own: pick.own };
    await this.startFlight('sim', 'arrive', rec, { sim: id });
  }

  /** result: { won, sec, hull, ally } from the sim script, or null when shot down / aborted. */
  async endSim(flight, result) {
    if (this.mode !== flight) return;
    const g = this.state, run = this.simRun || { id: flight.opts.sim };
    const S = SIM_SCENARIOS[run.id];
    const r = result || { won: false, sec: Math.round(flight.time), hull: 0 };
    const medal = simMedal(S, r);
    g.simMedals ||= {}; g.simBest ||= {};
    const before = g.simMedals[run.id] || 0;
    let reward = 0;
    if (medal > before) { reward = Math.round(simReward(S, medal) - simReward(S, before)); g.simMedals[run.id] = medal; }
    let newBest = false;
    if (r.won && S.kind === 'clear' && (!g.simBest[run.id] || r.sec < g.simBest[run.id])) { g.simBest[run.id] = r.sec; newBest = true; }
    if (reward) addCredits(g, reward, `Simulator: ${MEDALS[medal]} in „${S.name}“`);
    await this.fadeOut(0.6);
    await this.enterRoom('bruecke', 'from_sim');
    this.save();
    this.ui.simReport({ ...run, S, r, medal, before, reward, newBest, aborted: !result && flight.player.alive });
  }

  async onPlayerDead(flight) {
    const g = this.state;
    if (this.mode !== flight) return;   // left the flight meanwhile (menu → title)
    this.sortie = null;
    if (flight.opts.sim) return this.endSim(flight, null);
    await this.fadeOut(1.2);
    await this.leaveMode();
    this.ui.clear();
    const temp = flight.player.record?.uid?.startsWith('TEMP');
    // the salvage tug hauls the wreck back to Cassini: 1000 Cr for the Spacewing, more for bigger hulls
    const ship = temp ? null : flight.player.record;
    let fee = ship ? Math.min(g.credits, towFee(ship)) : 0;
    if (temp) g.flags.m1stage = 0;
    g.credits -= fee;
    if (ship) ship.hull = Math.min(ship.hull ?? 1, 0.45);   // patched up enough to fly, but it wants a proper repair
    g.location = 'cassini'; g.docked = true;
    logEntry(g, temp ? 'Abgeschossen. Rettungskapsel geborgen.' : `Abgeschossen. Abschleppdienst nach Cassini: −${fmt(fee)} Cr`);
    this.mode = { kind: 'cutscene', render3D: false };
    // the dialogue sits below the fade layer, so show a backdrop and fade back in first (otherwise the screen stays black)
    const bg = document.createElement('div');
    bg.className = 'overview';
    bg.innerHTML = `<div class="img" style="inset:0;background-image:url(${assets.url('assets/ui/hangar.jpg')});filter:brightness(.55) saturate(.8)"></div>`;
    document.getElementById('ui').appendChild(bg);
    await this.fadeIn(0.8);
    await this.ui.dialog([
      { who: temp ? 'mags' : 'comp', text: temp ? 'Rettungskapsel geborgen. Der Eisvogel hat mehr abbekommen, als mir lieb ist. Wir versuchen es noch mal, und diesmal triffst du.'
        : `Rettungskapsel von einem Bergungsschlepper aufgenommen. Dein Schiff wurde nach Hangar 7 geschleppt: ${fmt(fee)} Kredits für den Abschleppdienst. Rumpf ${Math.round(ship.hull * 100)} Prozent, bitte bei Yara reparieren lassen.` },
    ]);
    await this.fadeOut(0.5);
    bg.remove();
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
