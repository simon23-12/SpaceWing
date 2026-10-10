import * as THREE from 'three';
import { STATIONS, COMMODITIES, SHIP_CLASSES, MOONS, MOON_ORDER, moonOfZone, moonOfStation, JUMP_CLASS } from './data.js';
import { ZONES, travelInfo } from '../space/universe.js';
import { addCredits, logEntry, fmt, activeShip, cargoFree } from './state.js';
import { STORY } from './story.js';

class Abort extends Error {}

/** Coroutine helpers bound to a flight. Scripts are async functions using these. */
export function scriptContext(flight) {
  const waits = [];
  let dead = false;
  const ctx = {
    flight,
    get player() { return flight.player; },
    tick(dt) {
      for (let i = waits.length - 1; i >= 0; i--) {
        const w = waits[i];
        let done = false;
        try { done = w.test(dt); } catch (e) { console.error(e); done = true; }
        if (done) { waits.splice(i, 1); w.res(); }
      }
    },
    kill() { dead = true; for (const w of waits) w.rej(new Abort()); waits.length = 0; },
    until(test) { if (dead) return Promise.reject(new Abort()); return new Promise((res, rej) => waits.push({ test, res, rej })); },
    wait(sec) { let t = 0; return ctx.until(dt => (t += dt) >= sec); },
    say(who, text, faction = 'neutral', dur) { flight.say(who, text, faction, dur); },
    /** say and wait until the comm queue is empty */
    async talk(lines) {
      for (const [who, text, fac] of lines) flight.say(who, text, fac || 'neutral');
      await ctx.until(() => !flight.hud.commBusy);
    },
    objective(t) { flight.objective(t); },
    near(pos, r) { return flight.player.alive && flight.player.pos.distanceTo(pos) < r; },
    async spawnWave(defs) {
      const out = [];
      for (const d of defs) out.push(await flight.spawn(d));
      return out;
    },
    alive(list) { return list.filter(s => s.alive && flight.ships.includes(s)); },
    around(center, dist, spread = 300) {
      return center.clone().add(new THREE.Vector3().randomDirection().multiplyScalar(dist)).add(new THREE.Vector3().randomDirection().multiplyScalar(spread));
    },
    pirates(n, center, opts = {}) {
      const defs = [];
      for (let i = 0; i < n; i++) {
        defs.push({ cls: opts.cls || 'wespe', faction: opts.faction || 'schakale', name: opts.name ? `${opts.name} ${i + 1}` : `Schakal ${['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Fox', 'Golf', 'Hotel'][i % 8]}`,
          pos: ctx.around(center, opts.dist || 2600, 400), lookAt: flight.player.pos,
          ai: { mode: 'attack', skill: opts.skill ?? 0.5, aggroRange: 9000, fleeAt: opts.fleeAt }, tags: ['hostileGroup'], upgrades: opts.upgrades });
      }
      return ctx.spawnWave(defs).then(list => { for (const s of list) s.target = opts.target || flight.player; return list; });
    },
  };
  return ctx;
}

// ============================================================================ jobs (generated)

function rnd(seed) { let s = seed >>> 0; return () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9 >>> 0) / 4294967296); }

const STATION_IDS = () => Object.keys(STATIONS).filter(s => !STATIONS[s].locked);
/** Stations / zones in moon systems the player has unlocked (the levels). */
const openStations = (g) => STATION_IDS().filter(s => MOONS[moonOfStation(s)]?.unlock(g));
const openZones = (g) => MOON_ORDER.filter(m => MOONS[m].unlock(g)).flatMap(m => MOONS[m].zones).filter(z => !ZONES[z].hostile);
const jumpNote = (from, toZone) => { const a = moonOfZone(from), b = moonOfZone(toZone); return a === b ? '' : ` Sprungklasse ${JUMP_CLASS[MOONS[b].jump]} nötig.`; };

function cargoJob(g, r, station, to, id, tier) {
  const coms = Object.keys(COMMODITIES).filter(c => !COMMODITIES[c].illegal && !COMMODITIES[c].salvage);
  const com = coms[Math.floor(r() * coms.length)];
  const local = moonOfStation(to) === moonOfStation(station);
  const amount = Math.max(2, Math.min(local ? 7 : 99, 3 + Math.floor(r() * (local ? 5 : 6 + tier * 8))));
  const dist = travelInfo(STATIONS[station].zone, STATIONS[to].zone).distance;
  const risk = r() < 0.35 + tier * 0.05 ? 1 + Math.floor(r() * (1 + tier)) : 0;
  const pay = Math.round(((local ? 330 : 260) + dist / 1000 * 0.55 + amount * 22 + risk * (local ? 260 : 650)) / 10) * 10;
  const client = ['Kollektiv-Versorgung', 'Hallström Nachfolge GmbH', 'Ringgilde Clan Abara', 'Konsortiums-Logistik', 'Freie Händler Rhea', 'Dr. Ibe Medizintechnik', 'Inktomi Bergbau AG', 'Depotverwaltung L4'][Math.floor(r() * 8)];
  return { id, kind: 'fracht', from: station, to, com, amount, pay, risk, client,
    title: `Fracht: ${amount} ${COMMODITIES[com].unit} ${COMMODITIES[com].name}`,
    text: `${client} sucht einen Piloten für ${amount} ${COMMODITIES[com].unit} ${COMMODITIES[com].name} nach ${STATIONS[to].name}.${risk ? ' Piratenaktivität auf der Route gemeldet.' : ''}${local ? ` Kein Sprung nötig: Fusionsbrand im ${MOONS[moonOfStation(station)].name}-System.` : jumpNote(STATIONS[station].zone, STATIONS[to].zone)}` };
}

/** Freight inside the current moon system never runs out: the board is topped up whenever it runs low. */
function topUpLocal(g, station, board) {
  const local = openStations(g).filter(s => s !== station && moonOfStation(s) === moonOfStation(station));
  if (!local.length) return;
  const tier = Math.min(4, Math.floor((g.earned || 0) / 15000));
  const r = rnd(g.day * 104729 + (g.jobSeq = (g.jobSeq || 0) + 1) * 7477);
  while (board.jobs.filter(j => j.kind === 'fracht' && local.includes(j.to)).length < 3) {
    board.jobs.unshift(cargoJob(g, r, station, local[Math.floor(r() * local.length)], `L${g.day}-${station}-${g.jobSeq}-${board.jobs.length}`, tier));
  }
}

export function generateJobs(g, station) {
  const key = station + ':' + g.day;
  if (g.jobBoard[station]?.key === key) { topUpLocal(g, station, g.jobBoard[station]); return g.jobBoard[station].jobs; }
  const r = rnd(g.day * 7919 + station.length * 31 + (g.kills || 0));
  const jobs = [];
  const others = openStations(g).filter(s => s !== station);
  const n = 3 + Math.floor(r() * 3);
  const tier = Math.min(4, Math.floor((g.earned || 0) / 15000));
  for (let i = 0; i < n; i++) {
    let kind = r() < 0.5 ? 'fracht' : r() < 0.6 ? 'kopfgeld' : 'eskorte';
    if (kind === 'fracht' && !others.length) kind = r() < 0.6 ? 'kopfgeld' : 'eskorte';
    const id = `J${g.day}-${station}-${i}`;
    if (kind === 'fracht') {
      jobs.push(cargoJob(g, r, station, others[Math.floor(r() * others.length)], id, tier));
    } else if (kind === 'kopfgeld') {
      const zones = openZones(g).filter(z => z !== 'iapetus');
      const zone = zones[Math.floor(r() * zones.length)];
      const count = 2 + Math.floor(r() * (2 + tier));
      const pay = Math.round((700 + count * 420 + tier * 300) / 10) * 10;
      jobs.push({ id, kind, zone, count, pay, client: 'Söldnerbörse',
        title: `Kopfgeld: ${count} Schakale bei ${ZONES[zone].name.split(' ·')[0]}`,
        text: `Eine Schakal-Rotte lauert bei ${ZONES[zone].name}. Zahlung pro Abschuss, Bonus bei Vollzug.${jumpNote(STATIONS[station].zone, zone)}` });
    } else {
      const zone = STATIONS[station].zone;
      const pay = Math.round((1200 + tier * 500 + r() * 600) / 10) * 10;
      jobs.push({ id, kind, zone, station, pay, client: ['Kollektiv-Tanker „Tropfen“', 'Frachter „Maria Celeste“', 'Erzschlepper „Sturkopf“'][Math.floor(r() * 3)],
        title: `Eskorte: Frachter sicher zur ${STATIONS[station].name}`,
        text: 'Ein Frachter trifft gleich im Orbit ein und bittet um Begleitschutz bis zur Andockbucht.' });
    }
  }
  g.jobBoard[station] = { key, jobs };
  topUpLocal(g, station, g.jobBoard[station]);
  return g.jobBoard[station].jobs;
}

export function acceptJob(game, job) {
  const g = game.state;
  if (g.jobs.length >= 4) return 'Du hast schon vier offene Aufträge.';
  if (job.kind === 'fracht') {
    const ship = activeShip(g);
    if (!ship) return 'Du hast kein Schiff.';
    if (cargoFree(ship) < job.amount) return `Nicht genug Frachtraum (${cargoFree(ship)} frei).`;
    ship.cargo['job:' + job.id] = job.amount;
  }
  g.jobs.push({ ...job, progress: 0 });
  const board = g.jobBoard[g.location];
  if (board) board.jobs = board.jobs.filter(j => j.id !== job.id);
  logEntry(g, `Auftrag angenommen: ${job.title}`);
  return null;
}

export function abandonJob(game, job) {
  const g = game.state;
  g.jobs = g.jobs.filter(j => j.id !== job.id);
  for (const s of g.ships) delete s.cargo['job:' + job.id];
  g.rep.cassini = (g.rep.cassini || 0) - 2;
  logEntry(g, `Auftrag abgebrochen: ${job.title}`);
}

/** Called on docking: completes delivery jobs. Returns list of messages. */
export function onDockJobs(game, station) {
  const g = game.state, msgs = [];
  for (const j of [...g.jobs]) {
    if (j.kind === 'fracht' && j.to === station) {
      const ship = g.ships.find(s => s.cargo['job:' + j.id]);
      if (!ship) continue;
      delete ship.cargo['job:' + j.id];
      addCredits(g, j.pay, `Fracht geliefert (${j.client})`);
      g.jobs = g.jobs.filter(x => x !== j);
      msgs.push(`Lieferung abgeschlossen: +${fmt(j.pay)} Cr`);
    }
    if ((j.kind === 'kopfgeld' || j.kind === 'eskorte') && j.done) {
      addCredits(g, j.pay, j.title);
      g.jobs = g.jobs.filter(x => x !== j);
      msgs.push(`${j.title}: +${fmt(j.pay)} Cr`);
    }
  }
  return msgs;
}

// ============================================================================ the zone director

/** Runs story scripts, job events and ambient traffic for one flight zone. */
export class Director {
  constructor(game, zoneId, opts = {}) {
    this.game = game;
    this.zoneId = zoneId;
    this.opts = opts;
  }

  async start(flight) {
    this.ctx = scriptContext(flight);
    const g = this.game.state;
    const run = (fn) => fn(this.ctx, this.game).catch(e => { if (!(e instanceof Abort)) console.error(e); });
    if (flight.opts.sim) { run((c) => simScript(c, this.game, flight.opts.sim)); return; }
    // story
    const st = STORY[g.story];
    if (st && st.flight && (!st.zone || st.zone === this.zoneId || st.anyZone)) {
      if (!st.requires || g.flags[st.requires]) {
        if (g.flags['accepted:' + g.story]) run(st.flight);
      }
    }
    // jobs in this zone
    for (const j of g.jobs) {
      if (j.kind === 'kopfgeld' && j.zone === this.zoneId && !j.done) run((c) => bountyScript(c, this.game, j));
      if (j.kind === 'eskorte' && j.zone === this.zoneId && !j.done) run((c) => escortScript(c, this.game, j));
      if (j.kind === 'fracht' && j.risk && STATIONS[j.to].zone === this.zoneId && this.opts.spawn === 'arrive' && !j.ambushed) {
        j.ambushed = true;
        run((c) => ambushScript(c, this.game, j.risk + 1));
      }
    }
    // random encounters on arrival
    if (this.opts.spawn === 'arrive' && !g.flags.noRandom && !this.storyActive()) {
      const danger = ZONES[this.zoneId].hostile ? 1 : this.zoneId === 'rings' || this.zoneId === 'mimas' ? 0.25 : 0.12;
      if (Math.random() < danger) run((c) => ambushScript(c, this.game, 2));
    }
    run((c) => trafficScript(c, this.game, this.zoneId));
    flight.on('destroyed', (s, killer) => {
      if (s.faction === 'schakale' && killer && killer.isPlayer) {
        const bounty = 120 + Math.round(Math.random() * 80);
        addCredits(g, bounty, 'Abschussprämie Schakal');
        flight.hud.showToast(`Abschuss bestätigt · +${bounty} Cr`, 2);
        this.game.audio?.coins();
      }
    });
  }

  storyActive() {
    const g = this.game.state, st = STORY[g.story];
    return st && g.flags['accepted:' + g.story] && (!st.zone || st.zone === this.zoneId);
  }

  update(flight, dt) {
    this.ctx?.tick(dt);
    // combat music intensity
    const near = flight.ships.filter(s => s.alive && flight.isHostile(s, flight.player) && s.pos.distanceTo(flight.player.pos) < 4000).length;
    this.game.audio?.setCombat(Math.min(1, near / 3));
  }

  dispose() { this.ctx?.kill(); }
}

// ============================================================================ combat simulator

export const SIM_SCENARIOS = {
  drohnen: { name: 'Zieldrohnen', desc: 'Sechs Drohnen, die nicht zurückschießen. Zum Üben von Zielen und Vorhalten.', waves: [{ n: 6, drone: true }] },
  rotte: { name: 'Schakal-Rotte', desc: 'Drei Wespen, wie bei einem Überfall im Rhea-System.', waves: [{ n: 3, skill: 0.45 }] },
  staffel: { name: 'Staffelangriff', desc: 'Zwei Wellen Wespen, die zweite besser bewaffnet.', waves: [{ n: 3, skill: 0.5 }, { n: 4, skill: 0.6, upgrades: { lasers: 2 } }] },
  lanzen: { name: 'Lanzen-Duell', desc: 'Zwei Abfangjäger vom Typ Lanze. Schnell, wendig, schwer zu treffen.', waves: [{ n: 2, cls: 'lanze', name: 'Sim-Lanze', skill: 0.8, upgrades: { lasers: 2 } }] },
  korsar: { name: 'Kanonenboot', desc: 'Eine schwer gepanzerte Corsair mit Rückenturm und zwei Begleitjägern. Raketen helfen.', waves: [{ n: 2, skill: 0.55 }, { n: 1, cls: 'corsair', name: 'Sim-Corsair', skill: 0.7 }] },
};

async function simScript(c, game, id) {
  const f = c.flight, p = f.player, S = SIM_SCENARIOS[id], g = game.state;
  await c.wait(1.5);
  c.say('Simulator', `Simulation „${S.name}“ startet. Keine echten Schäden, keine Kosten. Abbrechen mit L.`, 'cassini');
  const t0 = f.time;
  for (let w = 0; w < S.waves.length; w++) {
    const W = S.waves[w];
    c.objective(`${S.name} · Welle ${w + 1} von ${S.waves.length}`);
    await c.wait(w ? 3 : 2.5);
    const center = p.pos.clone().addScaledVector(p.forward(new THREE.Vector3()), 1600).add(new THREE.Vector3((Math.random() - 0.5) * 800, (Math.random() - 0.5) * 300, 0));
    let wave;
    if (W.drone) {
      wave = await c.spawnWave(Array.from({ length: W.n }, (_, i) => ({ cls: 'wespe', faction: 'neutral', name: `Zieldrohne ${i + 1}`, paint: '#7fd4ff',
        pos: center.clone().add(new THREE.Vector3().randomDirection().multiplyScalar(250)), tags: ['noFriendlyFire', 'objective'],
        ai: { mode: 'patrol', center: center.clone(), radius: 450, aggressive: false } })));
      wave.forEach(d => { d.stats = { ...d.stats, speed: 90 + Math.random() * 60 }; d.shield = 0; d.maxShield = 1; d.hull = d.maxHull = 90; });
    } else wave = await c.pirates(W.n, center, { cls: W.cls, name: W.name || 'Sim-Wespe', skill: W.skill, upgrades: W.upgrades, dist: 300 });
    await c.until(() => c.alive(wave).length === 0);
  }
  const sec = Math.round(f.time - t0);
  g.simBest = g.simBest || {};
  const best = g.simBest[id];
  if (!best || sec < best) g.simBest[id] = sec;
  f.hud.showToast(`SIMULATION ABGESCHLOSSEN · ${sec} s${!best || sec < best ? ' · NEUE BESTZEIT' : ''}`, 4);
  c.say('Simulator', 'Simulation abgeschlossen. Beende die Übung.', 'cassini');
  c.objective('Simulation abgeschlossen');
  await c.wait(4);
  game.endSim(f, true);
}

async function bountyScript(c, game, job) {
  const f = c.flight;
  await c.wait(4);
  c.say('Söldnerbörse', `Kopfgeldziel in Reichweite: ${job.count} Schakale. Viel Glück, Pilot.`, 'cassini');
  c.objective(`Kopfgeld: ${job.count} Schakale ausschalten`);
  const center = f.player.pos.clone().add(new THREE.Vector3(1, 0.2, -1).normalize().multiplyScalar(3500));
  const wave = await c.pirates(job.count, center, { dist: 400, skill: 0.45 + Math.random() * 0.2 });
  await c.until(() => c.alive(wave).length === 0 || !f.player.alive);
  if (!f.player.alive) return;
  job.done = true;
  c.objective('Kopfgeld erfüllt – zum Kassieren an einer Station andocken');
  c.say('Söldnerbörse', 'Abschüsse bestätigt. Die Prämie wird beim nächsten Andocken ausgezahlt.', 'cassini');
}

async function ambushScript(c, game, n) {
  const f = c.flight, p = f.player;
  await c.wait(5 + Math.random() * 6);
  // in the home system (Rhea) a raid can always be outrun: the raiders are slower than the player's afterburner
  const escapable = moonOfZone(f.zoneId) === 'rhea';
  const dir = new THREE.Vector3().randomDirection(); dir.y *= 0.3;
  const wave = await c.pirates(n, p.pos.clone().addScaledVector(dir.normalize(), 3000), { dist: 300, skill: 0.4 + Math.random() * 0.25 });
  if (escapable) for (const s of wave) s.stats = { ...s.stats, speed: Math.min(s.stats.speed, p.stats.speed * 0.9), boost: Math.min(s.stats.boost, p.stats.boost * 0.7) };
  c.say(wave[0].name, ['Hübsche Fracht hast du da. Wäre schade drum.', 'Schakale grüßen! Ladung abwerfen oder sterben.', 'Halt still, das tut nur kurz weh.'][Math.floor(Math.random() * 3)], 'schakale');
  if (escapable) {
    c.say('Bordcomputer', 'Warnung: Schakale auf Abfangkurs. Die Wespen sind langsamer als unser Nachbrenner. Ausweichen ist möglich.', 'neutral');
    c.objective('Überfall! Mit dem Nachbrenner entkommen [Shift] oder kämpfen (Prämie und Trümmer)');
  }
  let far = 0, engaged = false;
  const fled = await c.until(dt => {
    const alive = c.alive(wave);
    if (!alive.length) return true;
    const d = Math.min(...alive.map(s => s.pos.distanceTo(p.pos)));
    if (d < 1600) engaged = true;
    far = escapable && engaged && d > 2800 ? far + dt : 0;
    return far > 2.5;
  }).then(() => c.alive(wave).length > 0);
  if (!fled) { if (escapable) c.objective(''); return; }
  c.say(wave.find(s => s.alive).name, 'Verdammt, der ist zu schnell. Abdrehen, Jungs!', 'schakale');
  f.hud.showToast('ENTKOMMEN', 2.5);
  c.objective('');
  for (const s of c.alive(wave)) s.ai = { mode: 'flee', t: 0 };
}

async function escortScript(c, game, job) {
  const f = c.flight;
  await c.wait(3);
  const st = f.station.pos.clone();
  const start = st.clone().add(new THREE.Vector3(-0.6, 0.15, 0.8).normalize().multiplyScalar(6500));
  const fr = await f.spawn({ cls: 'mule', faction: 'neutral', name: job.client, pos: start, lookAt: st, paint: '#2f6fd1', tags: ['objective', 'ally'],
    ai: { mode: 'goto', point: f.station.dock.pos.clone().addScaledVector(f.station.dock.dir, 400), throttle: 0.55, arrive: 200, aggressive: false } });
  fr.cargoLabel = 'Schutzbefohlen';
  c.say(job.client, 'Hier spricht der Frachter. Wir haben Sie auf dem Schirm – bleiben Sie bitte nah dran.', 'neutral');
  c.objective(`Eskortiere ${job.client} zur Andockbucht`);
  let attacked = false;
  await c.until(() => {
    if (!fr.alive) return true;
    if (!attacked && fr.pos.distanceTo(st) < 4200) {
      attacked = true;
      c.pirates(2 + Math.floor(Math.random() * 2), fr.pos.clone().add(new THREE.Vector3(0, 400, 0)), { dist: 1800, target: fr, skill: 0.5 });
      c.say(job.client, 'Kontakt! Schakale auf Abfangkurs – helfen Sie uns!', 'neutral');
    }
    return fr.ai.mode !== 'goto';
  });
  if (!fr.alive) { c.objective('Eskorte gescheitert'); game.state.jobs = game.state.jobs.filter(j => j !== job); logEntry(game.state, 'Eskorte gescheitert.'); return; }
  job.done = true;
  c.say(job.client, 'Wir sind sicher an der Bucht. Danke, Pilot – die Zahlung ist angewiesen.', 'neutral');
  c.objective('Eskorte erfüllt – zum Kassieren andocken');
  f.jumpOut(fr);
}

async function trafficScript(c, game, zoneId) {
  const f = c.flight;
  if (!f.station) return;
  const g = game.state;
  const center = f.station.pos;
  const list = [];
  const pool = zoneId === 'titan' ? [['lanze', 'konsortium', 'Lanze'], ['mule', 'konsortium', 'Raffinerieschlepper']]
    : zoneId === 'enceladus' ? [['mule', 'kollektiv', 'Wassertanker'], ['kestrel', 'kollektiv', 'Kollektiv-Wache']]
    : zoneId === 'rings' ? [['mule', 'ringgilde', 'Erzschlepper'], ['corsair', 'ringgilde', 'Gilden-Corsair']]
    : zoneId === 'phoebe' ? [] : [['mule', 'neutral', 'Frachter'], ['kestrel', 'cassini', 'Stationswache']];
  if (!pool.length) return;
  const names = ['Morgenrot', 'Kassiopeia', 'Sturkopf', 'Ilse', 'Halbmond', 'Ferne Küste', 'Gute Hoffnung', 'Tante Ruth'];
  for (let i = 0; i < 3; i++) {
    const [cls, fac, label] = pool[i % pool.length];
    const p = center.clone().add(new THREE.Vector3().randomDirection().multiplyScalar(1800 + Math.random() * 2500));
    const s = await f.spawn({ cls, faction: fac, name: `${label} „${names[(i + g.day) % names.length]}“`, pos: p,
      paint: fac === 'kollektiv' ? '#2f6fd1' : fac === 'ringgilde' ? '#4f8a52' : null,
      ai: { mode: 'patrol', center: center.clone(), radius: 3000, skill: 0.6, aggroRange: 2500 } });
    list.push(s);
  }
  if (zoneId === 'rhea' && g.flags.zoll && !g.flags.zollGone) {
    const k = await f.spawn({ cls: 'korvette', faction: 'liga', name: 'Zollkorvette „Unbestechlich“', pos: center.clone().add(new THREE.Vector3(2600, 600, -1800)), ai: { mode: 'idle', throttle: 0.0 }, invulnerable: true });
    k.obj.lookAt(center); k.obj.rotateY(Math.PI);
  }
}
