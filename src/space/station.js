import * as THREE from 'three';
import { assets } from '../core/assets.js';
import { STATIONS } from '../game/data.js';

function tex(dir, name, srgb) {
  const t = assets.tex(`${dir}/${name}.jpg`);
  t.flipY = false; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 8;
  return t;
}

/** Baked-PBR material for Blender-generated hard-surface models (same layout as ships). */
export function bakedMaterial(dir, { emit = true, emissiveIntensity = 3, tint } = {}) {
  const m = new THREE.MeshStandardMaterial({
    map: tex(dir, 'base', true), normalMap: tex(dir, 'normal', false),
    roughnessMap: tex(dir, 'orm', false), metalnessMap: tex(dir, 'orm', false), aoMap: tex(dir, 'orm', false),
    roughness: 1, metalness: 1,
  });
  m.normalScale.set(1, -1);
  if (emit) { m.emissiveMap = tex(dir, 'emit', true); m.emissive = new THREE.Color(1, 1, 1); m.emissiveIntensity = emissiveIntensity; }
  if (tint) m.color = new THREE.Color(...tint);
  return m;
}

export class Station {
  static async load(def) {
    const dir = `assets/stations/${def.model}`;
    const root = await assets.model(`${dir}/model.glb`);
    const meta = await assets.getJSON(`${dir}/meta.json`);
    return new Station(def, root, meta, dir);
  }

  constructor(def, model, meta, dir) {
    this.id = def.id;
    const info = STATIONS[def.id] || {};
    this.name = info.name || { schakalnest: 'Schakalnest' }[def.id] || def.id;
    this.faction = info.faction || 'neutral';
    this.root = new THREE.Group();
    this.root.position.fromArray(def.pos || [0, 0, 0]);
    this.root.add(model);
    const mat = bakedMaterial(dir, { tint: def.tint });
    this.spinners = [];
    this.lights = [];
    model.traverse(o => {
      if (o.isMesh) {
        o.geometry.deleteAttribute('tangent');
        const n = o.name;
        if (n.startsWith('glow')) {
          const hex = o.userData.glow_color || '#ffffff';
          o.material = new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(4), toneMapped: false });
          if (n.includes('blink')) this.lights.push(o);
        } else if (n.startsWith('glass')) {
          o.material = new THREE.MeshPhysicalMaterial({ color: 0x0c141c, roughness: 0.05, metalness: 0, clearcoat: 1, envMapIntensity: 2, transparent: true, opacity: 0.8 });
        } else if (n.startsWith('field')) {
          o.material = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 0.55, 1.0).multiplyScalar(0.6), transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
        } else {
          o.material = mat;
        }
      }
    });
    for (const name of meta.spin || []) {
      const o = model.getObjectByName(name.n);
      if (o) this.spinners.push({ o, rate: name.rate });
    }
    // dock: position + outward direction (station local -> world)
    const d = meta.dock;
    this.dock = {
      pos: new THREE.Vector3(...d.pos).add(this.root.position),
      dir: new THREE.Vector3(...d.dir).normalize(),
    };
    this.colliders = meta.colliders || [];
    this.boundR = meta.radius || 1000;
    this.t = 0;
  }

  get pos() { return this.root.position; }

  update(dt) {
    this.t += dt;
    for (const s of this.spinners) s.o.rotation.y += s.rate * dt;
    for (const l of this.lights) l.visible = (this.t % 2) < 0.15;
  }

  /** Returns a push-out vector if a sphere at p (radius r) intersects the station, else null. */
  collide(p, r) {
    const lp = p.clone().sub(this.root.position);
    if (lp.length() > this.boundR + r) return null;
    let push = null;
    for (const c of this.colliders) {
      let v = null;
      if (c.t === 's') {
        const d = lp.distanceTo(new THREE.Vector3(...c.c));
        if (d < c.r + r) v = lp.clone().sub(new THREE.Vector3(...c.c)).normalize().multiplyScalar(c.r + r - d);
      } else if (c.t === 'torus') { // axis = +Y in station space
        const q = lp.clone().sub(new THREE.Vector3(...c.c));
        const rad = Math.hypot(q.x, q.z) || 1e-6;
        const ring = new THREE.Vector3(q.x / rad * c.R, 0, q.z / rad * c.R);
        const off = q.clone().sub(ring);
        const d = off.length();
        if (d < c.r + r) v = off.normalize().multiplyScalar(c.r + r - d);
      } else if (c.t === 'b') {
        const q = lp.clone().sub(new THREE.Vector3(...c.c));
        const h = c.h;
        const dx = h[0] + r - Math.abs(q.x), dy = h[1] + r - Math.abs(q.y), dz = h[2] + r - Math.abs(q.z);
        if (dx > 0 && dy > 0 && dz > 0) {
          if (dx < dy && dx < dz) v = new THREE.Vector3(Math.sign(q.x) * dx, 0, 0);
          else if (dy < dz) v = new THREE.Vector3(0, Math.sign(q.y) * dy, 0);
          else v = new THREE.Vector3(0, 0, Math.sign(q.z) * dz);
        }
      }
      if (v && (!push || v.lengthSq() > push.lengthSq())) push = v;
    }
    return push;
  }

  hitTest(p) { return !!this.collide(p, 0.5); }
}
