import * as THREE from 'three';
import { assets } from '../core/assets.js';
import { bakedMaterial } from './station.js';

const KINDS = {
  ring: { tint: [1.75, 1.8, 1.9], spread: [14000, 380, 14000], sizes: [1.5, 70], minDist: 1200, dust: 9000, dustCol: [0.42, 0.4, 0.38] },
  ice:  { tint: [1.85, 1.95, 2.1], spread: [9000, 3500, 9000], sizes: [2, 45], minDist: 1300, dust: 1800, dustCol: [0.45, 0.48, 0.55] },
  rock: { tint: [0.75, 0.72, 0.68], spread: [9000, 4000, 9000], sizes: [2, 55], minDist: 1300, dust: 1200, dustCol: [0.3, 0.28, 0.26] },
};

/** Instanced field of Blender-baked rocks/ice chunks with simple sphere collision. */
export class Debris {
  static async create(kind, count) {
    const gltf = await assets.gltf('assets/rocks/model.glb');
    return new Debris(kind, count, gltf.scene);
  }

  constructor(kind, count, src) {
    const K = KINDS[kind];
    this.root = new THREE.Group();
    const mat = bakedMaterial('assets/rocks', { emit: false, tint: K.tint });
    const geos = [];
    src.traverse(o => { if (o.isMesh) { o.geometry.deleteAttribute('tangent'); geos.push(o.geometry); } });
    this.items = [];
    const rnd = mulberry(kind.length * 977 + count);
    const per = Math.ceil(count / geos.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    geos.forEach((g, gi) => {
      g.computeBoundingSphere();
      const base = g.boundingSphere.radius || 1;
      const im = new THREE.InstancedMesh(g, mat, per);
      im.frustumCulled = false;
      for (let i = 0; i < per; i++) {
        do {
          p.set((rnd() - 0.5) * K.spread[0], (rnd() - 0.5) * K.spread[1] * (kind === 'ring' ? rnd() : 1), (rnd() - 0.5) * K.spread[2]);
        } while (p.length() < K.minDist);
        const size = K.sizes[0] + Math.pow(rnd(), 5) * (K.sizes[1] - K.sizes[0]);
        q.setFromEuler(new THREE.Euler(rnd() * 6.3, rnd() * 6.3, rnd() * 6.3));
        s.set(size * (0.7 + rnd() * 0.6), size * (0.6 + rnd() * 0.5), size * (0.7 + rnd() * 0.6)).divideScalar(base);
        m4.compose(p, q, s);
        im.setMatrixAt(i, m4);
        this.items.push({ p: p.clone(), r: size * 0.85, spin: (rnd() - 0.5) * 0.08, im, i, q: q.clone(), s: s.clone() });
      }
      this.root.add(im);
    });
    // fine particles (glints) for density
    const n = K.dust;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (rnd() - 0.5) * K.spread[0] * 1.6;
      pos[i * 3 + 1] = (rnd() - 0.5) * K.spread[1] * 1.2;
      pos[i * 3 + 2] = (rnd() - 0.5) * K.spread[2] * 1.6;
    }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.dust = new THREE.Points(pg, new THREE.PointsMaterial({ color: new THREE.Color(...K.dustCol), size: 1.2, sizeAttenuation: false, transparent: true, opacity: 0.55, depthWrite: false }));
    this.root.add(this.dust);
    this.big = this.items.filter(it => it.r > 6);
  }

  update() {}

  collide(pos, r) {
    for (const it of this.big) {
      const d = pos.distanceTo(it.p);
      if (d < it.r + r) return pos.clone().sub(it.p).normalize().multiplyScalar(it.r + r - d);
    }
    return null;
  }

  hitTest(p) {
    for (const it of this.big) if (p.distanceToSquared(it.p) < it.r * it.r) return true;
    return false;
  }
}

function mulberry(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
