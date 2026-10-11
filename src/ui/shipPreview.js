import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ShipModel } from '../space/shipModel.js';
import { Particles, TEX } from '../space/effects.js';

/*
 * Workshop preview: the player's ship on a turntable. Selecting a mod plays a short install sequence:
 * the old part is highlighted, lifts out of the hull and fades, the new part drops in as a hologram,
 * materialises and sparks. Works without credits, so you can see what you would get.
 */

const OLD = () => new THREE.MeshStandardMaterial({ color: 0x6f6458, roughness: 0.75, metalness: 0.35, emissive: 0xff7a2a, emissiveIntensity: 0, transparent: true });
const NEW = () => new THREE.MeshStandardMaterial({ color: 0x6a6f76, roughness: 0.55, metalness: 0.6, emissive: 0x4ad0ff, emissiveIntensity: 0, transparent: true });
// accents of the shown module: dark metal once fitted (the cyan only shows while it materialises)
const GLOW = () => new THREE.MeshStandardMaterial({ color: 0x33363b, roughness: 0.7, metalness: 0.4, emissive: 0x4ad0ff, emissiveIntensity: 0, transparent: true });

function box(w, h, d, mat) { return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); }
function cyl(r1, r2, h, mat, seg = 20) { return new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg), mat); }

/** Build one version of a module. q = 0 (old, worn) or 1 (new), L = scale of the ship. Returns {group, pieces[]} at local origin. */
function buildPart(key, q, L, mats) {
  const g = new THREE.Group(), m = q ? mats.new : mats.old, glow = mats.glow, s = L / 12.6;
  const add = (o, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => { o.position.set(x * s, y * s, z * s); o.rotation.set(rx, ry, rz); o.scale.multiplyScalar(s); g.add(o); return o; };
  switch (key) {
    case 'engine': {   // thrust nozzle: worn short cone -> long cooled bell with a glowing throat
      add(cyl(0.62, q ? 0.82 : 0.7, q ? 1.3 : 0.8, m, 28), 0, 0, 0, Math.PI / 2);
      if (q) { add(new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.05, 8, 32), glow), 0, 0, 0.55); for (let i = 0; i < 6; i++) add(box(0.06, 0.06, 1.2, m), Math.cos(i) * 0.78, Math.sin(i) * 0.78, 0); }
      break;
    }
    case 'shield': {   // shield emitter on the spine
      add(cyl(0.45, 0.55, 0.25, m, 24));
      add(new THREE.Mesh(new THREE.SphereGeometry(q ? 0.42 : 0.32, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), q ? glow : m), 0, 0.12, 0);
      if (q) for (let i = 0; i < 3; i++) add(new THREE.Mesh(new THREE.TorusGeometry(0.55 + i * 0.12, 0.025, 6, 32), glow), 0, 0.15 + i * 0.08, 0, Math.PI / 2);
      break;
    }
    case 'armor': {    // flank plates
      for (const sx of [-1, 1]) {
        add(box(0.12, q ? 0.75 : 0.6, q ? 3.6 : 3.0, m), sx * 2.1, 0, -0.5, 0, 0, sx * -0.15);
        if (q) add(box(0.13, 0.12, 3.4, glow), sx * 2.12, 0.28, -0.5, 0, 0, sx * -0.15);
      }
      break;
    }
    case 'lasers': {   // barrels at the gun mounts
      add(cyl(q ? 0.09 : 0.07, q ? 0.11 : 0.08, q ? 2.6 : 1.6, m, 12), 0, 0, 0, Math.PI / 2);
      if (q) for (let i = 0; i < 4; i++) add(new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.03, 6, 16), glow), 0, 0, -0.4 - i * 0.35);
      break;
    }
    case 'missiles': { // pod under the hull
      add(box(1.4, 0.5, 2.0, m));
      for (let i = 0; i < (q ? 6 : 4); i++) add(cyl(0.11, 0.11, q ? 1.9 : 1.4, q ? mats.new : m, 10), -0.45 + (i % 3) * 0.45, i < 3 ? 0.12 : -0.12, -0.15, Math.PI / 2);
      if (q) for (let i = 0; i < 3; i++) add(new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.3, 10), glow), -0.45 + i * 0.45, 0.12, -1.25, -Math.PI / 2);
      break;
    }
    case 'cargo': {    // belly container
      add(box(q ? 2.0 : 1.6, q ? 0.8 : 0.65, q ? 3.6 : 2.8, m));
      for (let i = 0; i < 4; i++) add(box(q ? 2.05 : 1.65, 0.06, 0.08, q ? glow : m), 0, 0.35, -1.2 + i * 0.8);
      break;
    }
    case 'reactor': {  // fusion core on the back
      add(cyl(0.5, 0.5, 0.9, m, 24));
      add(cyl(0.32, 0.32, 0.95, q ? glow : m, 24));
      if (q) for (let i = 0; i < 2; i++) add(new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.05, 8, 32), glow), 0, -0.25 + i * 0.5, 0, Math.PI / 2);
      break;
    }
    case 'salvage': {  // scoop arm with a net emitter under the nose
      add(box(0.25, 0.25, 1.6, m), 0, 0, 0, 0.35);
      add(cyl(0.3, q ? 0.55 : 0.4, 0.4, m, 16), 0, -0.3, -0.75, 0.2);
      if (q) add(new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.04, 8, 32), glow), 0, -0.45, -0.8, Math.PI / 2 + 0.2);
      break;
    }
    case 'jump': {     // jump drive ring around the stern
      add(new THREE.Mesh(new THREE.TorusGeometry(q ? 2.4 : 2.0, q ? 0.16 : 0.12, 12, 48), m));
      if (q) { add(new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.05, 8, 64), glow), 0, 0, 0.12); for (let i = 0; i < 8; i++) add(box(0.25, 0.25, 0.4, m), Math.cos(i * Math.PI / 4) * 2.4, Math.sin(i * Math.PI / 4) * 2.4, 0); }
      break;
    }
    default: add(box(1, 0.4, 1, m));
  }
  return g;
}

/** Where a module sits on a ship, in the model's own frame (b = its bounding box there, L = length). */
function modAnchors(m, key, b, L, local) {
  const s = L / 12.6, top = b.max.y, bottom = b.min.y, mid = (b.min.z + b.max.z) / 2;
  switch (key) {
    case 'engine': return (m.exhausts.length ? m.exhausts.map(local) : [new THREE.Vector3(0, 0, b.max.z)]).map(p => p.add(new THREE.Vector3(0, 0, -0.5 * s)));
    case 'lasers': return (m.guns.length ? m.guns.map(local) : [new THREE.Vector3(0, 0, b.min.z)]).map(p => p.add(new THREE.Vector3(0, 0, 0.9 * s)));
    case 'shield': return [new THREE.Vector3(0, top - 0.15 * s, mid + L * 0.12)];
    case 'reactor': return [new THREE.Vector3(0, top - 0.1 * s, mid + L * 0.28)];
    case 'missiles': return [new THREE.Vector3(0, bottom - 0.05 * s, mid - L * 0.06)];
    case 'cargo': return [new THREE.Vector3(0, bottom - 0.05 * s, mid + L * 0.2)];
    case 'salvage': return [new THREE.Vector3(0, bottom + 0.1, b.min.z + L * 0.18)];
    case 'jump': return [new THREE.Vector3(0, 0, b.max.z - L * 0.12)];
    default: return [new THREE.Vector3(0, 0, mid)];
  }
}

const MOD_KEYS = ['engine', 'lasers', 'shield', 'armor', 'reactor', 'missiles', 'cargo', 'salvage', 'jump'];
// where a fitted module sits: on top of the hull, under it, on the flanks, or at the guns / nozzles
const MOD_MOUNT = { shield: 'top', reactor: 'top', jump: 'top', missiles: 'bottom', cargo: 'bottom', salvage: 'bottom', armor: 'side', engine: 'nozzle', lasers: 'gun' };
const MOD_MAT = () => new THREE.MeshStandardMaterial({ color: 0x5a5e64, roughness: 0.62, metalness: 0.55 });
const MOD_DARK = () => new THREE.MeshStandardMaterial({ color: 0x33363b, roughness: 0.7, metalness: 0.4 });

/**
 * A fitted module, small and in plain metal (no lights). Built at the origin with its mounting face at y = 0:
 * top parts grow upwards, bottom parts downwards, side plates outwards (+x), nozzle/gun parts along the z axis.
 * s = ship scale (length / 12.6), lv = upgrade level (a touch bigger per level).
 */
function fittedPart(key, s, lv, m, d) {
  const g = new THREE.Group(), k = s * (1 + 0.04 * (Math.min(lv, 5) - 1));
  const add = (geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => { const o = new THREE.Mesh(geo, mat); o.position.set(x * k, y * k, z * k); o.rotation.set(rx, ry, rz); o.scale.setScalar(k); g.add(o); return o; };
  switch (key) {
    case 'shield':   // low emitter dome on a flat plinth
      add(new THREE.CylinderGeometry(0.3, 0.34, 0.06, 20), d, 0, 0.03);
      add(new THREE.SphereGeometry(0.22, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), m, 0, 0.05).scale.set(k, k * 0.55, k);
      break;
    case 'reactor':  // squat cooling stack with fins
      add(new THREE.CylinderGeometry(0.18, 0.2, 0.22, 16), m, 0, 0.11);
      for (let i = 0; i < 4; i++) add(new THREE.BoxGeometry(0.03, 0.16, 0.42), d, 0, 0.09, 0, 0, i * Math.PI / 4, 0);
      break;
    case 'jump':     // flat drive coil lying on the spine
      add(new THREE.TorusGeometry(0.26, 0.045, 8, 28), m, 0, 0.05, 0, Math.PI / 2);
      add(new THREE.CylinderGeometry(0.1, 0.12, 0.08, 14), d, 0, 0.04);
      break;
    case 'missiles': // slim pod with two tubes
      add(new THREE.BoxGeometry(0.42, 0.14, 1.1), m, 0, -0.07);
      for (const x of [-0.11, 0.11]) add(new THREE.CylinderGeometry(0.07, 0.07, 1.0, 10), d, x, -0.16, -0.05, Math.PI / 2);
      break;
    case 'cargo':    // flat belly container
      add(new THREE.BoxGeometry(0.8, 0.22, 1.3), m, 0, -0.11);
      for (let i = 0; i < 3; i++) add(new THREE.BoxGeometry(0.82, 0.03, 0.05), d, 0, -0.12, -0.45 + i * 0.45);
      break;
    case 'salvage':  // small scoop under the nose
      add(new THREE.BoxGeometry(0.12, 0.08, 0.5), d, 0, -0.04);
      add(new THREE.CylinderGeometry(0.1, 0.16, 0.12, 14), m, 0, -0.1, -0.25);
      break;
    case 'armor':    // thin plate on the flank (outward = +x)
      add(new THREE.BoxGeometry(0.05, 0.32, 1.6), m, 0.025, 0, 0);
      add(new THREE.BoxGeometry(0.06, 0.04, 1.5), d, 0.03, 0.1, 0);
      break;
    case 'engine':   // collar around the nozzle, scaled to it later
      add(new THREE.TorusGeometry(1, 0.08, 8, 28), d);
      break;
    case 'lasers':   // barrel extension with a muzzle ring (forward = -z)
      add(new THREE.CylinderGeometry(0.035, 0.045, 0.5, 10), d, 0, 0, -0.25, Math.PI / 2);
      add(new THREE.CylinderGeometry(0.06, 0.06, 0.07, 10), m, 0, 0, -0.47, Math.PI / 2);
      break;
  }
  return g;
}

/**
 * Installed mods are visible on the hull, but quietly: each upgrade with a level adds a small module in plain
 * metal, placed by casting rays onto the hull so nothing floats. Used in flight, in the hangar and in the
 * previews. Returns the group (child of model.root, name 'mods').
 */
export function fitMods(model, upgrades = {}) {
  const root = model.root;
  root.getObjectByName('mods')?.removeFromParent();
  const g = new THREE.Group(); g.name = 'mods';
  const keys = MOD_KEYS.filter(k => (upgrades[k] || 0) > 0);
  if (!keys.length) { root.add(g); return g; }
  // measure in the model's own frame
  const saved = root.matrix.clone(), parent = root.parent;
  parent?.remove(root);
  root.position.set(0, 0, 0); root.quaternion.identity(); root.scale.set(1, 1, 1); root.updateMatrixWorld(true);
  const hull = []; root.traverse(o => { if (o.isMesh && o.name.startsWith('hull')) hull.push(o); });
  const b = new THREE.Box3(); hull.forEach(o => b.expandByObject(o));
  if (b.isEmpty()) b.setFromObject(root);
  const L = model.length || (b.max.z - b.min.z), s = L / 12.6, mid = (b.min.z + b.max.z) / 2;
  const ray = new THREE.Raycaster();
  const hit = (from, dir) => { ray.set(from, dir); ray.far = 1e4; return ray.intersectObjects(hull, false)[0]?.point || null; };
  // first hull surface along a vertical line at (x, z); tries a few spots towards the middle if it misses
  const surface = (x, z, up) => {
    for (const f of [0, 0.25, 0.5, 0.75]) {
      const zz = z + (mid - z) * f;
      const p = hit(new THREE.Vector3(x, up ? b.max.y + 2 : b.min.y - 2, zz), new THREE.Vector3(0, up ? -1 : 1, 0));
      if (p) return p;
    }
    return null;
  };
  const m = MOD_MAT(), d = MOD_DARK(), embed = 0.02 * s;
  const place = (k, part, pos) => { part.position.copy(pos); part.userData.key = k; g.add(part); };
  for (const k of keys) {
    const lv = upgrades[k], mount = MOD_MOUNT[k];
    if (mount === 'top' || mount === 'bottom') {
      const z = { shield: mid + L * 0.08, reactor: mid + L * 0.24, jump: b.max.z - L * 0.2, missiles: mid - L * 0.05, cargo: mid + L * 0.18, salvage: b.min.z + L * 0.22 }[k];
      const p = surface(0, z, mount === 'top');
      if (p) place(k, fittedPart(k, s, lv, m, d), p.add(new THREE.Vector3(0, mount === 'top' ? -embed : embed, 0)));
    } else if (mount === 'side') {
      const y = (b.min.y + b.max.y) / 2;
      for (const sx of [-1, 1]) {
        const p = hit(new THREE.Vector3(sx * (b.max.x + 2), y, mid), new THREE.Vector3(-sx, 0, 0));
        if (!p) continue;
        const part = fittedPart(k, s, lv, m, d);
        if (sx < 0) part.rotation.y = Math.PI;
        place(k, part, p.add(new THREE.Vector3(-sx * embed, 0, 0)));
      }
    } else if (mount === 'nozzle') {
      // a collar round each nozzle, sized from the engine-glow vertices next to that nozzle (several nozzles share one mesh)
      const verts = [];
      for (const x of model.glows.filter(x => x.engine)) {
        const pa = x.mesh.geometry.attributes.position, v = new THREE.Vector3();
        for (let i = 0; i < pa.count; i++) verts.push(v.fromBufferAttribute(pa, i).applyMatrix4(x.mesh.matrixWorld).clone());
      }
      for (const ex of model.exhausts) {
        const p = ex.getWorldPosition(new THREE.Vector3());
        let r = 0, zc = 0, n = 0;
        for (const v of verts) {
          const dxy = Math.hypot(v.x - p.x, v.y - p.y);
          if (Math.abs(v.z - p.z) < 0.08 * L && dxy < 0.12 * L) { r = Math.max(r, dxy); zc += v.z; n++; }
        }
        if (!n || r < 0.01 * L) continue;
        const part = fittedPart(k, 1, lv, m, d); part.scale.setScalar(r * 1.04);
        place(k, part, new THREE.Vector3(p.x, p.y, zc / n - 0.03 * s));
      }
    } else if (mount === 'gun') {
      for (const gun of model.guns) place(k, fittedPart(k, s, lv, m, d), gun.getWorldPosition(new THREE.Vector3()));
    }
  }
  g.traverse(o => { if (o.isMesh) o.userData.mod = true; });
  root.add(g);
  saved.decompose(root.position, root.quaternion, root.scale);
  parent?.add(root);
  root.updateMatrixWorld(true);
  return g;
}

export class ShipPreview {
  constructor(canvas, rec) {
    this.canvas = canvas;
    this.r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.r.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.r.toneMapping = THREE.ACESFilmicToneMapping; this.r.toneMappingExposure = 1.1;
    this.scene = new THREE.Scene();
    const pm = new THREE.PMREMGenerator(this.r);
    this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; pm.dispose();
    this.scene.environmentIntensity = 0.6;
    this.cam = new THREE.PerspectiveCamera(32, 1, 0.1, 500);
    const key = new THREE.DirectionalLight(0xfff0dd, 2.6); key.position.set(4, 6, 5); this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x6fb8ff, 2.2); rim.position.set(-5, 2, -6); this.scene.add(rim);
    this.scene.add(new THREE.AmbientLight(0x30384a, 0.6));
    this.turn = new THREE.Group(); this.scene.add(this.turn);
    this.sparks = new Particles(this.scene, 600, TEX.soft);
    this.mats = { old: OLD(), new: NEW(), glow: GLOW('#4ad0ff') };
    this.t = 0; this.anim = null;
    this.rec = rec;
    this.ready = this.load(rec);
    this.resize();
    this._onResize = () => this.resize(); addEventListener('resize', this._onResize);
    const loop = () => { if (this.dead) return; this.raf = requestAnimationFrame(loop); this.frame(); };
    this.last = performance.now(); loop();
  }

  async load(rec) {
    this.model = await ShipModel.load(rec.cls, { paint: rec.paint, engineColor: '#7fb6ff', plumeRadius: 0.45 });
    const root = this.model.root;
    const box = new THREE.Box3().setFromObject(root);
    const c = box.getCenter(new THREE.Vector3());
    root.position.sub(c);
    this.turn.add(root);
    this.L = this.model.length; this.box = box.translate(c.clone().negate());
    // floor ring under the ship
    const ring = new THREE.Mesh(new THREE.RingGeometry(this.L * 0.62, this.L * 0.64, 96), new THREE.MeshBasicMaterial({ color: 0x4ad0ff, transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = this.box.min.y - 0.4; this.scene.add(ring);
    const grid = new THREE.PolarGridHelper(this.L * 0.6, 12, 4, 64, 0x2a4a60, 0x1a2a38); grid.position.y = ring.position.y - 0.01; this.scene.add(grid);
    this.root = root;
    this.mods = fitMods(this.model, rec.upgrades);
  }

  resize() {
    const w = this.canvas.clientWidth || 400, h = this.canvas.clientHeight || 260;
    this.r.setSize(w, h, false); this.cam.aspect = w / h; this.cam.updateProjectionMatrix();
  }

  setPaint(hex) { this.model?.setPaint(hex); }

  /** Anchor (in ship space) and orientation for a module. */
  anchorsFor(key) {
    const inv = new THREE.Matrix4().copy(this.turn.matrixWorld).invert();
    this.turn.updateMatrixWorld(true);
    return modAnchors(this.model, key, this.box, this.L, (o) => o.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv));
  }

  /** Re-fit the installed mods (after buying one). */
  refreshMods(upgrades) { if (this.model) { this.mods = fitMods(this.model, upgrades); this.rec.upgrades = upgrades; } }

  /** Play the install sequence for an upgrade (level = the level it would get). */
  async showUpgrade(key, level) {
    if (!this.root) await this.ready;
    this.clearAnim();
    // attack mode: no part to fit, the preview shows the wings going into attack pose and back
    if (key === 'attack') { this.wingDemo = 0; return; }
    const L = this.L, mats = { old: OLD(), new: NEW(), glow: GLOW('#4ad0ff') };
    const parts = this.anchorsFor(key).map(p => {
      const o = buildPart(key, 0, L, mats), n = buildPart(key, 1, L, mats);
      const grow = 1 + 0.05 * level;
      o.position.copy(p); n.position.copy(p); n.scale.setScalar(grow);
      this.turn.add(o, n);
      return { o, n, p: p.clone() };
    });
    this.anim = { key, parts, mats, t: 0, sparked: false };
    for (const c of this.mods?.children || []) c.visible = c.userData.key !== key;
    this.turnTarget = key === 'engine' || key === 'jump' ? Math.PI * 0.85 : key === 'lasers' || key === 'salvage' ? 0.2 : null;
  }

  clearAnim() {
    if (this.wingDemo != null) { this.wingDemo = null; if (this.model) this.model.wingTarget = 0; }
    if (!this.anim) return;
    for (const { o, n } of this.anim.parts) { this.turn.remove(o, n); }
    for (const c of this.mods?.children || []) c.visible = true;
    for (const m of Object.values(this.anim.mats)) m.dispose();
    this.anim = null; this.turnTarget = null;
  }

  frame() {
    const now = performance.now(), dt = Math.min(0.05, (now - this.last) / 1000); this.last = now;
    this.t += dt;
    if (!this.root) { this.r.render(this.scene, this.cam); return; }
    // turntable: slow spin, or swing round to show the part being fitted
    if (this.turnTarget != null) {
      let d = this.turnTarget - this.turn.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d));
      this.turn.rotation.y += d * Math.min(1, dt * 2);
    } else this.turn.rotation.y += dt * 0.35;
    const L = this.L;
    this.cam.position.set(Math.sin(0.6) * L * 1.55, L * 0.55, Math.cos(0.6) * L * 1.55);
    this.cam.lookAt(0, -L * 0.04, 0);
    const A = this.anim;
    let thr = 0.25, boost = false;
    if (A) {
      A.t += dt;
      const t = A.t, lift = L * 0.22;
      const k1 = THREE.MathUtils.smoothstep(t, 0.5, 1.4);     // old part out
      const k2 = THREE.MathUtils.smoothstep(t, 1.3, 2.3);     // new part in
      const k3 = THREE.MathUtils.smoothstep(t, 2.3, 3.1);     // materialise
      A.mats.old.emissiveIntensity = t < 0.5 ? 0.6 + 0.4 * Math.sin(t * 25) : Math.max(0, 0.6 * (1 - k1));
      A.mats.old.opacity = 1 - THREE.MathUtils.smoothstep(t, 1.0, 1.5);
      A.mats.new.opacity = THREE.MathUtils.smoothstep(t, 1.25, 1.6);
      A.mats.new.wireframe = t < 2.2;
      A.mats.new.emissiveIntensity = t < 2.3 ? 1.6 : 1.6 * (1 - k3);
      A.mats.glow.emissiveIntensity = A.mats.new.emissiveIntensity;
      A.mats.glow.opacity = A.mats.new.opacity;
      for (const P of A.parts) {
        P.o.position.copy(P.p).add(new THREE.Vector3(0, lift * k1 * 1.6, 0)); P.o.rotation.set(k1 * 0.6, k1 * 1.4, 0);
        P.o.visible = t < 1.6;
        P.n.position.copy(P.p).add(new THREE.Vector3(0, lift * 1.6 * (1 - k2), 0)); P.n.rotation.set(0, (1 - k2) * -1.2, 0);
        P.n.visible = t > 1.2;
      }
      if (t > 2.3 && !A.sparked) {
        A.sparked = true;
        for (const P of A.parts) {
          const wp = P.p.clone().applyMatrix4(this.turn.matrixWorld);
          for (let i = 0; i < 50; i++) this.sparks.emit(wp, new THREE.Vector3().randomDirection().multiplyScalar(2 + Math.random() * 6).add(new THREE.Vector3(0, 2, 0)),
            new THREE.Color(1.5, 1.1, 0.6).multiplyScalar(2), 0.08 * L / 12.6 + Math.random() * 0.06, 0.4 + Math.random() * 0.6, 0);
        }
      }
      if (A.key === 'engine' && t > 2.3) { thr = 1; boost = t < 3.6; }
      if (t > 6) { A.t = 0; A.sparked = false; }        // loop the sequence while the mod stays selected
    }
    if (this.wingDemo != null) {
      const prev = this.model.wingTarget;
      this.wingDemo += dt;
      this.model.wingTarget = this.wingDemo % 4 < 2 ? 1 : 0;
      if (this.model.wings.length && prev !== this.model.wingTarget) this.onWings?.(this.model.wingTarget === 1);
    }
    this.model.update(dt, thr, boost);
    this.sparks.update(dt);
    this.r.render(this.scene, this.cam);
  }

  dispose() {
    this.dead = true; cancelAnimationFrame(this.raf); removeEventListener('resize', this._onResize);
    this.clearAnim(); this.r.dispose();
  }
}
