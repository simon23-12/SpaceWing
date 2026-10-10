// Static game data: ship classes, upgrades, commodities, stations, factions.

export const FACTIONS = {
  player:     { name: 'Du', color: '#7fd4ff' },
  neutral:    { name: 'Zivil', color: '#c8c8c8' },
  cassini:    { name: 'Hochstation Cassini', color: '#8fd18f' },
  kollektiv:  { name: 'Enceladus-Kollektiv', color: '#6fc3ff' },
  konsortium: { name: 'Titan-Konsortium', color: '#f2c35a' },
  ringgilde:  { name: 'Ringgilde', color: '#d39a6a' },
  liga:       { name: 'Liga der Inneren Welten', color: '#9fb4ff' },
  archiv:     { name: 'Das Archiv', color: '#d7b8ff' },
  schakale:   { name: 'Schakale von Phoebe', color: '#ff5a4a' },
};

// Base stats. speed m/s, accel m/s², turn rad/s, shield/hull HP, energy units.
export const SHIP_CLASSES = {
  spacewing: {
    name: 'SW-2 „Spacewing“', maker: 'Hawker-Lindqvist', role: 'Kurierjäger', price: 22000,
    hull: 260, shield: 150, speed: 230, boost: 430, accel: 80, turn: 1.7, cargo: 8, guns: 2, missiles: 4,
    energy: 100, regen: 18, laserDmg: 14, laserRate: 7, turret: false, length: 12.6, engine: '#7fb6ff',
    desc: 'Ein 40 Jahre alter Kurierjäger. Wendig, zäh, eigensinnig. Teo Okafor hat ihn geliebt.',
  },
  sankt_rostig: {
    name: '„Sankt Rostig“', maker: 'Mule MT-3 (Bj. 2220)', role: 'Eisfrachter', price: 0, npcOnly: true,
    hull: 1100, shield: 260, speed: 150, boost: 230, accel: 28, turn: 0.55, cargo: 40, guns: 1, missiles: 0,
    energy: 120, regen: 16, laserDmg: 12, laserRate: 4, turret: true, length: 42, engine: '#ffb070', jump: 1,
    desc: 'Mags Okafors Eisfrachter. Mehr Rost als Rumpf, aber er hat noch nie eine Ladung verloren.',
  },
  mule: {
    name: 'Mule MT-3', maker: 'Brandt & Söhne, Ganymed', role: 'Frachter', price: 95000,
    hull: 1200, shield: 420, speed: 165, boost: 250, accel: 32, turn: 0.6, cargo: 60, guns: 1, missiles: 2,
    energy: 130, regen: 18, laserDmg: 13, laserRate: 4, turret: true, length: 42, engine: '#8fc4ff',
    desc: 'Das Arbeitstier des Saturnsystems. Langsam, gutmütig, mit viel Platz für Fracht.',
  },
  kestrel: {
    name: 'Kestrel K-9', maker: 'Okonkwo Defence', role: 'Mehrzweckjäger', price: 145000,
    hull: 420, shield: 340, speed: 285, boost: 490, accel: 105, turn: 2.0, cargo: 10, guns: 2, missiles: 8,
    energy: 140, regen: 26, laserDmg: 18, laserRate: 8, turret: false, length: 13.8, engine: '#9fd0ff',
    desc: 'Ausgemusterte Milizmaschine mit vorwärts gepfeilten Flügeln. Ein echter Jäger.',
  },
  corsair: {
    name: 'Corsair HG-4', maker: 'Rook-Varga Werften', role: 'Schweres Kanonenboot', price: 320000,
    hull: 950, shield: 650, speed: 215, boost: 380, accel: 60, turn: 1.15, cargo: 24, guns: 2, missiles: 12,
    energy: 200, regen: 34, laserDmg: 24, laserRate: 6, turret: true, length: 20, engine: '#ff9a5a',
    desc: 'Gepanzerter Keil mit Rückenturm. Wer eine Corsair fliegt, wird selten angegriffen.',
  },
  lanze: {
    name: 'Lanze L-1', maker: 'Konsortiums-Werft Kraken-Hafen', role: 'Abfangjäger', price: 260000, needsRep: { konsortium: 40 },
    hull: 380, shield: 440, speed: 330, boost: 560, accel: 120, turn: 2.25, cargo: 4, guns: 2, missiles: 6,
    energy: 160, regen: 30, laserDmg: 20, laserRate: 9, turret: false, length: 15.4, engine: '#ffd28a',
    desc: 'Weiß und Gold, schnell wie ein Gerücht. Nur für Freunde des Konsortiums.',
  },
  wespe: {
    name: 'Wespe', maker: 'Eigenbau', role: 'Piratenjäger', price: 0, npcOnly: true,
    hull: 170, shield: 90, speed: 265, boost: 420, accel: 95, turn: 2.0, cargo: 2, guns: 2, missiles: 0,
    energy: 90, regen: 18, laserDmg: 8, laserRate: 3.6, length: 11, engine: '#ff7a2a',
  },
  korvette: {
    name: 'Zollkorvette', maker: 'Liga-Marine', role: 'Korvette', price: 0, npcOnly: true,
    hull: 9000, shield: 5000, speed: 95, boost: 120, accel: 8, turn: 0.22, cargo: 400, guns: 4, missiles: 0,
    energy: 500, regen: 60, laserDmg: 30, laserRate: 2, length: 86, engine: '#a8d4ff',
  },
};

export const UPGRADES = {
  engine:   { name: 'Antrieb',        desc: '+8 % Geschwindigkeit und Schub',  base: 2500 },
  shield:   { name: 'Schildgenerator', desc: '+15 % Schildkapazität',          base: 2800 },
  armor:    { name: 'Rumpfpanzerung', desc: '+15 % Rumpfstruktur',            base: 2200 },
  lasers:   { name: 'Laserkanonen',   desc: '+12 % Schaden, +5 % Feuerrate',   base: 3200 },
  missiles: { name: 'Raketenwerfer',  desc: '+2 Raketen, schnellere Zielerfassung', base: 3000 },
  cargo:    { name: 'Frachtraum',     desc: '+20 % Ladekapazität',             base: 1800 },
  reactor:  { name: 'Energiekern',    desc: '+15 % Energie-Regeneration',     base: 2600 },
  jump:     { name: 'Sprungtriebwerk', desc: 'Hyperraumsprung zu anderen Monden. I: Enceladus, Mimas · II: Titan · III: Iapetus', fixed: [2500, 8000, 20000], max: 3 },
};
export const MAX_UPGRADE = 5;
export const maxLevel = (key) => UPGRADES[key].max || MAX_UPGRADE;

export function upgradePrice(shipId, key, level) {
  if (UPGRADES[key].fixed) return UPGRADES[key].fixed[level];
  const cls = SHIP_CLASSES[shipId];
  const f = 0.6 + (cls.price || 20000) / 120000;
  return Math.round(UPGRADES[key].base * Math.pow(level + 1, 1.55) * f / 50) * 50;
}

export const PAINTS = [
  { id: null, name: 'Werkslack', hex: null },
  { id: 'kobalt', name: 'Kobaltblau', hex: '#2f6fd1' },
  { id: 'rot', name: 'Signalrot', hex: '#c8352a' },
  { id: 'gold', name: 'Konsortiumsgold', hex: '#d1a23a' },
  { id: 'schwarz', name: 'Nachtschwarz', hex: '#2a2c30' },
  { id: 'weiss', name: 'Eisweiß', hex: '#e8ecef' },
  { id: 'gruen', name: 'Ringgilde-Grün', hex: '#4f8a52' },
  { id: 'violett', name: 'Archiv-Violett', hex: '#7a52b8' },
];
export const PAINT_PRICE = 600;

/** Effective ship stats including upgrades. */
export function shipStats(ship) {
  const c = SHIP_CLASSES[ship.cls];
  const u = ship.upgrades || {};
  const L = k => u[k] || 0;
  return {
    ...c,
    speed: c.speed * (1 + 0.08 * L('engine')), boost: c.boost * (1 + 0.08 * L('engine')), accel: c.accel * (1 + 0.08 * L('engine')),
    turn: c.turn * (1 + 0.03 * L('engine')),
    shield: c.shield * (1 + 0.15 * L('shield')), hull: c.hull * (1 + 0.15 * L('armor')),
    laserDmg: c.laserDmg * (1 + 0.12 * L('lasers')), laserRate: c.laserRate * (1 + 0.05 * L('lasers')),
    missiles: c.missiles + 2 * L('missiles'), lockTime: 1.6 / (1 + 0.15 * L('missiles')),
    cargo: Math.round(c.cargo * (1 + 0.2 * L('cargo'))), regen: c.regen * (1 + 0.15 * L('reactor')),
    jump: Math.max(c.jump || 0, L('jump')),
  };
}

export const COMMODITIES = {
  wasser:     { name: 'Wasser-Eis', unit: 't', base: 45 },
  helium3:    { name: 'Helium-3', unit: 'kg', base: 410 },
  methan:     { name: 'Methan-Treibstoff', unit: 't', base: 95 },
  nahrung:    { name: 'Hydrokultur-Nahrung', unit: 't', base: 125 },
  medizin:    { name: 'Medizin', unit: 'Kiste', base: 360 },
  erz:        { name: 'Ring-Erz', unit: 't', base: 70 },
  elektronik: { name: 'Elektronik', unit: 'Kiste', base: 290 },
  luxus:      { name: 'Luxusgüter', unit: 'Kiste', base: 640 },
  waffen:     { name: 'Waffen (Konterbande)', unit: 'Kiste', base: 880, illegal: true },
};

// Station markets: multipliers < 1 = produced here (cheap), > 1 = in demand.
export const STATIONS = {
  cassini:  { name: 'Hochstation Cassini', zone: 'rhea', faction: 'cassini', walkable: true, apartment: 6000, flat: 'Kabine 4-117 (Ringgang, Deck 4)',
    market: { wasser: 1.1, helium3: 1.0, methan: 1.05, nahrung: 1.2, medizin: 1.1, erz: 1.15, elektronik: 0.75, luxus: 1.0 },
    blurb: 'Freihafen im Rhea-Orbit. Neutral, laut, voll.' },
  quelle:   { name: 'Quelle (Enceladus)', zone: 'enceladus', faction: 'kollektiv', apartment: 9000, flat: 'Wohnzelle im Eisschacht 3',
    market: { wasser: 0.45, nahrung: 0.7, methan: 1.45, helium3: 1.3, medizin: 1.5, elektronik: 1.35, erz: 1.1 },
    blurb: 'Genossenschaftliche Eisförderung an den Tigerstreifen.' },
  kraken:   { name: 'Kraken-Hafen (Titan)', zone: 'titan', faction: 'konsortium', apartment: 30000, flat: 'Penthouse über dem Methanmeer',
    market: { methan: 0.5, helium3: 0.62, luxus: 0.7, wasser: 1.7, nahrung: 1.45, medizin: 1.2, elektronik: 1.1, erz: 1.3 },
    blurb: 'Goldfassaden über dem Methanmeer.' },
  ringgilde: { name: 'Gildenhalle (Ringrand)', zone: 'rings', faction: 'ringgilde',
    market: { erz: 0.45, wasser: 0.75, nahrung: 1.5, medizin: 1.55, elektronik: 1.3, methan: 1.2, luxus: 1.4 },
    blurb: 'Zusammengeschweißte Habitate zwischen Eisbrocken.' },
  herschel: { name: 'Herschel-Depot (Mimas)', zone: 'mimas', faction: 'neutral', apartment: 12000, flat: 'Bunkerkoje am Kraterrand',
    market: { waffen: 0.75, erz: 0.8, luxus: 1.5, medizin: 1.4, elektronik: 1.2, helium3: 1.1 },
    blurb: 'Keine Fragen, keine Papiere.' },
  gewoelbe: { name: 'Das Gewölbe (Iapetus)', zone: 'iapetus', faction: 'archiv', locked: true, apartment: 18000, flat: 'Archivzelle im Äquatorgrat',
    market: { elektronik: 1.6, nahrung: 1.35, medizin: 1.2, luxus: 1.1 },
    blurb: 'Eine Universität im Äquatorgrat. Offiziell.' },
};

export const RANKS = [
  [0, 'Brotlos'], [5000, 'Tagelöhner'], [20000, 'Frachtpilot'], [60000, 'Söldner'], [150000, 'Veteran'], [400000, 'Legende der Ringe'],
];

/*
 * The five moon systems are the levels of the game. Each has its own orbit zone(s), station and mood.
 * Jumping between moons needs a jump drive of the given class on the ship and the moon to be unlocked.
 */
export const MOONS = {
  rhea: {
    name: 'Rhea', zones: ['rhea'], station: 'cassini', jump: 0, color: '#c8d0d8',
    tag: 'Freihafen', mood: { tint: [1.0, 0.98, 0.95], amt: 0.0, exposure: 1.0, music: 'space' },
    desc: 'Grauer Eismond mit hellen Kraterstrahlen. Hier dreht sich Hochstation Cassini: neutral, laut, voll. Dein Zuhause.',
    unlock: () => true, why: '',
  },
  enceladus: {
    name: 'Enceladus', zones: ['enceladus'], station: 'quelle', jump: 1, color: '#bfe6ff',
    tag: 'Wasser', mood: { tint: [0.86, 0.95, 1.08], amt: 0.35, exposure: 1.08, music: 'space_ice' },
    desc: 'Der weißeste Körper des Sonnensystems. Aus den Tigerstreifen am Südpol schießen Wasserfontänen ins All. Das Kollektiv fördert das Eis, von dem alle leben.',
    unlock: (g) => !!(g.flags.m1done || g.flags['accepted:eisfracht']), why: 'Erste Tour mit Mags (Storymission 1)',
  },
  mimas: {
    name: 'Mimas', zones: ['mimas', 'rings'], station: 'herschel', jump: 1, color: '#d0b8a8',
    tag: 'Schwarzmarkt', mood: { tint: [1.08, 0.9, 0.82], amt: 0.4, exposure: 0.92, music: 'space_dark' },
    desc: 'Der „Todesstern“: ein Mond mit einem Krater, fast ein Drittel so groß wie er selbst. Im Herschel-Krater liegt das Depot, am Ringrand schürft die Ringgilde.',
    unlock: (g) => !!(g.flags['done:zoll'] || g.earned >= 20000), why: 'Storymission „Ordnung durch Zoll“ oder Rang Frachtpilot',
  },
  titan: {
    name: 'Titan', zones: ['titan'], station: 'kraken', jump: 2, color: '#f2b25a',
    tag: 'Konsortium', mood: { tint: [1.12, 0.92, 0.7], amt: 0.55, exposure: 1.05, music: 'space_gold' },
    desc: 'Eine orange Dunstkugel, größer als Merkur, mit Methanmeeren unter der Wolkendecke. Sitz des Titan-Konsortiums und seiner goldenen Flotte.',
    unlock: (g) => !!g.flags['done:zoll'], why: 'Storymission „Ordnung durch Zoll“',
  },
  iapetus: {
    name: 'Iapetus', zones: ['iapetus', 'phoebe'], station: 'gewoelbe', jump: 3, color: '#b9a0e8',
    tag: 'Archiv', mood: { tint: [0.95, 0.9, 1.1], amt: 0.45, exposure: 0.95, music: 'space_myst' },
    desc: 'Zweifarbig wie ein Yin-Yang: eine Hälfte schwarz wie Teer, die andere schneeweiß, dazu ein Gebirgsgrat genau am Äquator. Dahinter, weit draußen, kreist Phoebe.',
    unlock: (g) => !!(g.flags['done:funkstille'] || g.flags.gewoelbeOpen || g.flags['accepted:gewoelbe']), why: 'Storymission „Funkstille“',
  },
};
export const MOON_ORDER = ['rhea', 'enceladus', 'mimas', 'titan', 'iapetus'];
export const moonOfZone = (zone) => Object.keys(MOONS).find(k => MOONS[k].zones.includes(zone));
export const moonOfStation = (st) => moonOfZone(STATIONS[st].zone);
export const JUMP_CLASS = ['–', 'I', 'II', 'III'];
