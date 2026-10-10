import { COMMODITIES, STATIONS, SHIP_CLASSES, shipStats, RANKS } from './data.js';

const KEY = 'spacewing.save.v1';

export function newGame(callsign = 'Wren') {
  return {
    version: 1,
    callsign,
    credits: 40,
    earned: 0,
    day: 1,
    location: 'cassini',     // station id when docked
    docked: true,
    ships: [],               // owned ships {uid, cls, name, upgrades:{}, paint:null, hull:1, cargo:{}}
    activeShip: null,
    rep: { kollektiv: 0, konsortium: 0, ringgilde: 0, liga: 0, cassini: 0, archiv: 0 },
    flags: {},               // story flags
    story: 'prolog',         // current story mission id
    jobs: [],                // accepted generated jobs
    jobBoard: {},            // station -> generated offers
    prices: {},              // station -> commodity -> current factor
    kills: 0,
    log: [],
  };
}

let current = null;

export const state = {
  get g() { return current; },
  set(g) { current = g; },
  save() { try { localStorage.setItem(KEY, JSON.stringify(current)); } catch { } },
  load() {
    try { const s = localStorage.getItem(KEY); if (s) { current = JSON.parse(s); return current; } } catch { }
    return null;
  },
  hasSave() { try { return !!localStorage.getItem(KEY); } catch { return false; } },
  wipe() { try { localStorage.removeItem(KEY); } catch { } },
};

let uidc = 1;
export function addShip(g, cls, name) {
  const s = { uid: 'S' + Date.now().toString(36) + (uidc++), cls, name: name || SHIP_CLASSES[cls].name, upgrades: {}, paint: null, hull: 1, cargo: {} };
  g.ships.push(s);
  if (!g.activeShip) g.activeShip = s.uid;
  return s;
}

export function activeShip(g) { return g.ships.find(s => s.uid === g.activeShip) || null; }

export function cargoUsed(ship) { return Object.values(ship.cargo || {}).reduce((a, b) => a + b, 0); }

export function cargoFree(ship) { return shipStats(ship).cargo - cargoUsed(ship); }

export function addCredits(g, n, reason) {
  g.credits = Math.round(g.credits + n);
  if (n > 0) g.earned += n;
  if (reason) logEntry(g, `${n > 0 ? '+' : ''}${fmt(n)} Cr – ${reason}`);
}

export function logEntry(g, text) {
  g.log.unshift({ day: g.day, text });
  if (g.log.length > 60) g.log.length = 60;
}

export function rank(g) {
  let r = RANKS[0][1];
  for (const [min, name] of RANKS) if (g.earned >= min) r = name;
  return r;
}

export function fmt(n) { return Math.round(n).toLocaleString('de-DE'); }

// ------------------------------------------------------------------ market

function hash(str) { let h = 2166136261; for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0) / 4294967296; }

/** Event-driven price modifiers set by the story. */
export function storyPriceMod(g, station, com) {
  let m = 1;
  if (g.flags.zoll) { if (com === 'helium3') m *= 1.25; if (com === 'luxus') m *= 1.1; }
  if (g.flags.embargo) {
    if (station === 'quelle' && (com === 'methan' || com === 'helium3')) m *= 1.8;
    if (station === 'kraken' && (com === 'wasser' || com === 'nahrung')) m *= 1.6;
    if (com === 'medizin') m *= 1.2;
  }
  if (g.flags.krieg && com === 'waffen') m *= 1.5;
  return m;
}

export function price(g, station, com, side = 'buy') {
  const st = STATIONS[station];
  const base = COMMODITIES[com].base;
  const f = (st.market[com] ?? 1.25);
  const drift = 0.88 + 0.24 * hash(station + com + g.day);
  const p = base * f * drift * storyPriceMod(g, station, com);
  return Math.max(1, Math.round(side === 'buy' ? p * 1.04 : p * 0.96));
}

export function availableAt(station, com) {
  const st = STATIONS[station];
  return com in st.market && !COMMODITIES[com].salvage && (st.market[com] < 1.2 || com === 'waffen');
}
