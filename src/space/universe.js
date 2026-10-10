// Saturn system data. Units: km, Saturn-centric. Ring plane = XZ, +Y = Saturn north.
// Artistic licence: inner moon orbits are inclined a few degrees so the rings are not seen exactly edge-on.
const deg = Math.PI / 180;

export const SUN_DIR = (() => {
  const el = 13 * deg, az = 205 * deg;
  return [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)];
})();

export const SATURN = { radius: 60268, polar: 54364, ringInner: 66900, ringOuter: 141000 };

function orbitPos(r, angleDeg, incl = 0) {
  const a = angleDeg * deg;
  return [r * Math.cos(a), r * Math.sin(a) * Math.sin(incl * deg), r * Math.sin(a) * Math.cos(incl * deg)];
}

export const BODIES = {
  mimas:     { name: 'Mimas',     radius: 198,  pos: orbitPos(185539, 120, 16), tex: 'mimas' },
  enceladus: { name: 'Enceladus', radius: 252,  pos: orbitPos(237948, 250, 14), tex: 'enceladus' },
  tethys:    { name: 'Tethys',    radius: 531,  pos: orbitPos(294619, 300, 9), tex: 'tethys' },
  dione:     { name: 'Dione',     radius: 561,  pos: orbitPos(377396, 70, 11), tex: 'dione' },
  rhea:      { name: 'Rhea',      radius: 764,  pos: orbitPos(527108, 115, 12), tex: 'rhea' },
  titan:     { name: 'Titan',     radius: 2575, pos: orbitPos(1221870, 235, 7), tex: 'titan', atmosphere: [1.0, 0.62, 0.25] },
  iapetus:   { name: 'Iapetus',   radius: 735,  pos: orbitPos(3560820, 190, 15.5), tex: 'iapetus' },
  phoebe:    { name: 'Phoebe',    radius: 107,  pos: orbitPos(12960000, 30, 5), tex: 'phoebe' },
};

// Flight zones: a local area (metres) around an anchor point in the system.
// offset: [w_sun, w_saturn, w_up, distance km] relative to the anchor body (see zoneAnchor).
export const ZONES = {
  rhea: {
    name: 'Rhea-Orbit · Hochstation Cassini', body: 'rhea', offset: [0.8, 0.6, 0.25, 1650],
    station: { id: 'cassini', model: 'station_cassini', pos: [0, 0, 0] },
  },
  inktomi: {
    name: 'Rhea-System · Bergbauposten Inktomi', body: 'rhea', offset: [0.55, -0.35, 0.55, 1080],
    station: { id: 'inktomi', model: 'station_small', pos: [0, 0, 0], tint: [1.08, 0.96, 0.84] }, debris: 'rock',
  },
  lagrange: {
    name: 'Rhea-System · Frachtdepot L4', body: 'rhea', offset: [-0.35, 0.25, -0.3, 12500],
    station: { id: 'lagrange', model: 'station_cassini', pos: [0, 0, 0], tint: [0.86, 0.94, 1.08] },
  },
  sim: {
    name: 'GEFECHTSSIMULATOR · Übungsraum', body: 'rhea', offset: [0.3, 0.85, 0.45, 6000],
  },
  enceladus: {
    name: 'Enceladus · Geysirfeld „Quelle“', body: 'enceladus', offset: [0.7, 0.5, -0.6, 560],
    station: { id: 'quelle', model: 'station_small', pos: [0, 0, 0], tint: [0.82, 0.95, 1.12] }, geysers: true, debris: 'ice',
  },
  titan: {
    name: 'Titan-Orbit · Kraken-Hafen', body: 'titan', offset: [0.8, 0.5, 0.2, 5200],
    station: { id: 'kraken', model: 'station_cassini', pos: [0, 0, 0], tint: [1.0, 0.85, 0.55] },
  },
  rings: {
    name: 'Mimas-System · Ringrand der Ringgilde', anchor: [-104000 * Math.cos(1.2), 0.05, 104000 * Math.sin(1.2)],
    station: { id: 'ringgilde', model: 'station_small', pos: [0, 0, 0] }, debris: 'ring',
  },
  mimas: {
    name: 'Mimas · Herschel-Depot im Todesstern-Krater', body: 'mimas', offset: [0.8, 0.6, 0.3, 420],
    station: { id: 'herschel', model: 'station_small', pos: [0, 0, 0], tint: [1.1, 0.78, 0.66] }, debris: 'rock',
  },
  iapetus: {
    name: 'Iapetus · Das Gewölbe', body: 'iapetus', offset: [0.9, 0.3, 0.2, 1500],
    station: { id: 'gewoelbe', model: 'station_small', pos: [0, 0, 0], tint: [0.88, 0.82, 1.1] },
  },
  phoebe: {
    name: 'Iapetus-System · Phoebe, Schakalnest', body: 'phoebe', offset: [0.9, 0.2, 0.1, 230],
    station: { id: 'schakalnest', model: 'station_small', pos: [0, 0, 0] }, debris: 'rock', hostile: true,
  },
};

const norm = v => { const l = Math.hypot(...v); return v.map(c => c / l); };

/** System position (km) of a zone's local origin. Offsets are expressed as weights of
 *  [towards sun, towards Saturn, ring-plane normal] so the moon below is lit and Saturn is in view. */
export function zoneAnchor(zoneId) {
  const z = ZONES[zoneId];
  if (z.anchor) return z.anchor;
  const b = BODIES[z.body];
  const toSat = norm(b.pos.map(c => -c));
  const [ws, wt, wu, dist] = z.offset;
  const d = norm([0, 1, 2].map(i => SUN_DIR[i] * ws + toSat[i] * wt + (i === 1 ? wu : 0)));
  return [b.pos[0] + d[0] * dist, b.pos[1] + d[1] * dist, b.pos[2] + d[2] * dist];
}

export function travelInfo(from, to) {
  const a = zoneAnchor(from), b = zoneAnchor(to);
  const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  // Brachistochrone at ~0.3 g for game purposes
  const acc = 3e-3; // km/s^2
  const hours = (2 * Math.sqrt(d / acc)) / 3600;
  const fuel = Math.max(2, Math.round(Math.sqrt(d) / 40));
  return { distance: d, hours, fuel };
}
