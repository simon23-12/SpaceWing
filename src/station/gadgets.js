import * as THREE from 'three';
import { ShipModel } from '../space/shipModel.js';

/*
 * Gadgets and keepsakes in cabin 4-117. The espresso machine is there from the start; everything else turns up
 * in the display shelf as the story goes on (conditions are checked whenever you are on a station).
 * Models are small procedural objects (or real ship models scaled down), lit by the room's environment.
 */

const M = {
  steel: () => new THREE.MeshStandardMaterial({ color: 0xd8dce2, roughness: 0.3, metalness: 0.55 }),
  black: () => new THREE.MeshStandardMaterial({ color: 0x16181b, roughness: 0.5, metalness: 0.3 }),
  gold: () => new THREE.MeshStandardMaterial({ color: 0xe0b552, roughness: 0.25, metalness: 1.0 }),
  brass: () => new THREE.MeshStandardMaterial({ color: 0xb8893d, roughness: 0.35, metalness: 0.9 }),
  rust: () => new THREE.MeshStandardMaterial({ color: 0x7a4a2a, roughness: 0.8, metalness: 0.5 }),
  ceramic: () => new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.3, metalness: 0.0 }),
  wood: () => new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.55, metalness: 0.0 }),
  velvet: () => new THREE.MeshStandardMaterial({ color: 0x3a1020, roughness: 0.95, metalness: 0.0 }),
  glow: (c, k = 2.5) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), toneMapped: false }),
  glass: (c = 0x9fd8ff, o = 0.35) => new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.05, metalness: 0, transmission: 0.6, transparent: true, opacity: o }),
};

function mesh(geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); return m;
}
function plinth(g, w = 0.16) { g.add(mesh(new THREE.BoxGeometry(w, 0.025, w * 0.8), M.black(), 0, 0.0125, 0)); }

function labelTex(text, color = '#e8d8b0', bg = null, w = 256, h = 64, font = '600 34px Rajdhani, sans-serif') {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'); if (bg) { x.fillStyle = bg; x.fillRect(0, 0, w, h); }
  x.fillStyle = color; x.font = font; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, w / 2, h / 2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/** Simple stand-in espresso machine (about 30 x 38 x 34 cm), faces +Z. */
function espresso() {
  const g = new THREE.Group(), st = M.steel(), bl = M.black();
  g.add(mesh(new THREE.BoxGeometry(0.3, 0.34, 0.3), st, 0, 0.17 + 0.02, -0.02));
  g.add(mesh(new THREE.BoxGeometry(0.31, 0.02, 0.36), bl, 0, 0.01, 0.0));                       // drip tray base
  g.add(mesh(new THREE.BoxGeometry(0.24, 0.012, 0.12), st, 0, 0.026, 0.1));                      // grille
  g.add(mesh(new THREE.BoxGeometry(0.3, 0.03, 0.24), bl, 0, 0.375, -0.02));                       // top / cup warmer
  for (const x of [-0.07, 0.07]) {                                                                // cups on top
    g.add(mesh(new THREE.CylinderGeometry(0.03, 0.024, 0.05, 16), M.ceramic(), x, 0.415, -0.02));
  }
  g.add(mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.05, 20), st, 0, 0.27, 0.15));             // group head
  const pf = new THREE.Group(); pf.position.set(0, 0.235, 0.16);                                  // portafilter
  pf.add(mesh(new THREE.CylinderGeometry(0.042, 0.038, 0.035, 20), st));
  pf.add(mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.13, 10), bl, 0, 0, 0.08, Math.PI / 2));
  g.add(pf);
  g.add(mesh(new THREE.CylinderGeometry(0.03, 0.024, 0.05, 16), M.ceramic(), 0, 0.058, 0.15)); // espresso cup under the spout
  const gauge = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.012, 24), M.glow('#ffcf7a', 1.6), -0.08, 0.31, 0.131, Math.PI / 2);
  g.add(gauge);
  g.add(mesh(new THREE.TorusGeometry(0.031, 0.005, 6, 24), st, -0.08, 0.31, 0.135));
  g.add(mesh(new THREE.SphereGeometry(0.008, 8, 6), M.glow('#ff3a2a', 3), 0.1, 0.31, 0.132));    // power light
  g.add(mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.12, 8), st, 0.12, 0.25, 0.14, 0.4));       // steam wand
  g.add(mesh(new THREE.BoxGeometry(0.1, 0.012, 0.03), bl, 0.08, 0.36, 0.13));                      // buttons
  g.userData.cup = g.children.find(o => o.position.y === 0.058);
  return g;
}

/** The real machine: Blender model with baked PBR textures (blender/ships.py prop_espresso); procedural one as fallback. */
async function espressoModel() {
  try {
    const m = await ShipModel.load('prop_espresso');
    m.update(0, 0);
    m.root.traverse(o => { if (o.isMesh && o.name.startsWith('hull')) o.material.envMapIntensity = 2.2; });
    const g = new THREE.Group(); g.add(m.root);
    // warm under-cabinet light so the chrome has something to catch in the dim galley
    const l = new THREE.PointLight(0xffd6a0, 0.55, 1.4, 2); l.position.set(0, 0.75, 0.4); g.add(l);
    return g;
  } catch { return espresso(); }
}

/** Keepsakes. when(g): condition; text: memory shown when you look at it. */
export const GADGETS = {
  espresso: { name: 'Espressomaschine', text: 'Eine „Cassini Classico“, älter als die Station. Der beste Espresso auf Deck 4, für 1 Kredit.', when: () => true, build: espressoModel },
  eisvogel_modell: { name: 'Modell des Eisvogels', text: 'Geschenk von Mags nach der ersten Tour. „Damit du nicht vergisst, wer dich zum Fliegen gebracht hat.“', when: (g) => g.flags['done:eisfracht'],
    build: async () => { const g = new THREE.Group(); plinth(g, 0.24); try { const m = await ShipModel.load('eisvogel'); const s = 0.26 / m.length; m.root.scale.setScalar(s); m.root.position.y = 0.09; m.root.rotation.y = 0.6; for (const p of m.plumes) p.visible = false; g.add(m.root); } catch { } g.add(mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.06, 6), M.black(), 0, 0.055, 0)); return g; } },
  fluegel: { name: 'Pilotenschwingen', text: 'Mags hat sie dir nach der Flugstunde an die Jacke gesteckt. Ringgilde, Klasse III. Inoffiziell.', when: (g) => g.flags['done:flugschule'],
    build: () => { const g = new THREE.Group(); plinth(g); const gd = M.gold(); g.add(mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.01, 24), gd, 0, 0.09, 0, Math.PI / 2));
      for (const s of [-1, 1]) for (let i = 0; i < 4; i++) g.add(mesh(new THREE.BoxGeometry(0.05 - i * 0.008, 0.008, 0.006), gd, s * (0.04 + i * 0.012), 0.1 - i * 0.012, 0, 0, 0, s * (0.25 + i * 0.12)));
      g.add(mesh(new THREE.BoxGeometry(0.01, 0.06, 0.01), M.black(), 0, 0.055, -0.01)); return g; } },
  schakal_wappen: { name: 'Schakal-Wappen', text: 'Aus dem Wrack deines ersten Abschusses geschnitten. Das Wappen der Schakale von Phoebe, auf einer Platte, die viel zu neu ist.', when: (g) => g.kills >= 1,
    build: () => { const g = new THREE.Group(); const plate = mesh(new THREE.BoxGeometry(0.16, 0.13, 0.01), M.rust(), 0, 0.075, 0, -0.18); g.add(plate);
      const em = mesh(new THREE.PlaneGeometry(0.12, 0.1), new THREE.MeshStandardMaterial({ map: labelTex('▲ SCHAKAL ▲', '#c8281c', null, 256, 128, '700 40px Rajdhani, sans-serif'), transparent: true, roughness: 0.8 }), 0, 0.075, 0.006, -0.18); g.add(em); return g; } },
  schrott: { name: 'Schrottskulptur', text: 'Das erste Stück Bergungsschrott, das du eingesammelt hast. Yara hat es dir zu einer Skulptur verschweißt.', when: (g) => g.flags.firstSalvage,
    build: () => { const g = new THREE.Group(); plinth(g); const r = M.rust(); g.add(mesh(new THREE.DodecahedronGeometry(0.045, 0), r, 0, 0.075, 0, 0.4, 0.3)); g.add(mesh(new THREE.BoxGeometry(0.02, 0.09, 0.015), M.steel(), 0.03, 0.12, 0.01, 0, 0, 0.5)); g.add(mesh(new THREE.TorusGeometry(0.03, 0.006, 6, 16), r, -0.02, 0.13, 0, 0.8)); return g; } },
  tropfen: { name: 'Flasche Enceladus-Wasser', text: 'Von der Crew der „Tropfen 7“. Die Hälfte ihrer Ladung nahm die Liga, das hier wollten sie dir geben.', when: (g) => g.flags['done:zoll'],
    build: () => { const g = new THREE.Group(); g.add(mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.14, 20), M.glass(0x9fd8ff, 0.5), 0, 0.07, 0)); g.add(mesh(new THREE.CylinderGeometry(0.028, 0.032, 0.09, 20), M.glow('#3a8acf', 0.9), 0, 0.05, 0));
      g.add(mesh(new THREE.CylinderGeometry(0.012, 0.016, 0.03, 12), M.black(), 0, 0.155, 0)); return g; } },
  lanze: { name: 'Goldene Lanzennadel', text: 'Kapitän Morrow hat sie dir gegeben. „Für den Fall, dass Sie die Seite wechseln.“', when: (g) => g.flags['done:lanzen'],
    build: () => { const g = new THREE.Group(); g.add(mesh(new THREE.BoxGeometry(0.12, 0.04, 0.08), M.velvet(), 0, 0.02, 0)); g.add(mesh(new THREE.ConeGeometry(0.008, 0.09, 8), M.gold(), 0, 0.045, 0, 0, 0, Math.PI / 2)); return g; } },
  brille: { name: 'Mags’ Fliegerbrille', text: 'Aus dem treibenden Eisvogel geborgen. Mags sagt, du sollst sie behalten, bis sie wieder fliegen kann.', when: (g) => g.flags['done:funkstille'],
    build: () => { const g = new THREE.Group(); plinth(g, 0.18); for (const s of [-1, 1]) { g.add(mesh(new THREE.TorusGeometry(0.025, 0.007, 8, 20), M.brass(), s * 0.032, 0.05, 0)); g.add(mesh(new THREE.CircleGeometry(0.024, 20), M.glass(0xffb050, 0.5), s * 0.032, 0.05, 0.002)); }
      g.add(mesh(new THREE.TorusGeometry(0.06, 0.006, 6, 24, Math.PI), M.black(), 0, 0.05, -0.02, Math.PI / 2)); return g; } },
  kristall: { name: 'Archivkristall', text: 'Ein Datenkristall aus dem Gewölbe von Iapetus. Juno sagt, er enthält eine einzige Zahl.', when: (g) => g.flags['done:gewoelbe'],
    build: () => { const g = new THREE.Group(); plinth(g); g.add(mesh(new THREE.OctahedronGeometry(0.04, 0), M.glow('#b98aff', 1.6), 0, 0.085, 0, 0, 0.5)); return g; } },
  pokal: { name: 'Simulator-Pokal', text: 'Die ganze Grundausbildung im Gefechtssimulator in Gold. Femi hat ihn graviert: „Zu gut für die Börse.“', when: (g) => ['drohnen', 'rotte', 'ausweichen', 'geleit', 'staffel'].every(k => g.simMedals?.[k] === 3),
    build: () => { const g = new THREE.Group(); const gd = M.gold(); g.add(mesh(new THREE.BoxGeometry(0.07, 0.03, 0.07), M.black(), 0, 0.015, 0)); g.add(mesh(new THREE.CylinderGeometry(0.008, 0.012, 0.05, 10), gd, 0, 0.055, 0));
      g.add(mesh(new THREE.LatheGeometry([0.004, 0.025, 0.04, 0.045].map((r, i) => new THREE.Vector2(r, i * 0.022)), 20), gd, 0, 0.08, 0)); return g; } },
  sprung: { name: 'Sprungkompass', text: 'Ein altes Navigationsinstrument, das Lenka dir beim Einbau des Sprungtriebwerks dazugelegt hat.', when: (g) => g.ships?.some(s => (s.upgrades?.jump || 0) > 0),
    build: () => { const g = new THREE.Group(); plinth(g); const b = M.brass(); g.add(mesh(new THREE.TorusGeometry(0.05, 0.004, 6, 32), b, 0, 0.08, 0)); g.add(mesh(new THREE.TorusGeometry(0.042, 0.004, 6, 32), b, 0, 0.08, 0, Math.PI / 2, 0.5));
      g.add(mesh(new THREE.SphereGeometry(0.012, 12, 8), M.glow('#7fd4ff', 1.5), 0, 0.08, 0)); return g; } },
  apartment: { name: 'Schlüsselkarte', text: 'Der Schlüssel zu deinem zweiten Zuhause. Ab jetzt geht es per Transit-Kapsel hin und her.', when: (g) => Object.keys(g.apartments || {}).length >= 2,
    build: () => { const g = new THREE.Group(); g.add(mesh(new THREE.BoxGeometry(0.085, 0.054, 0.003), new THREE.MeshStandardMaterial({ map: labelTex('TRANSIT', '#7fd4ff', '#10202c'), roughness: 0.4 }), 0, 0.035, 0, -0.3)); g.add(mesh(new THREE.BoxGeometry(0.06, 0.01, 0.04), M.black(), 0, 0.005, -0.01)); return g; } },
};

/** Award newly earned keepsakes. Returns the list of new ones. */
export function checkGadgets(g) {
  g.gadgets ||= [];
  const out = [];
  for (const [id, G] of Object.entries(GADGETS)) {
    if (g.gadgets.includes(id)) continue;
    try { if (G.when(g)) { g.gadgets.push(id); if (id !== 'espresso') out.push(G); } } catch { }
  }
  return out;
}
