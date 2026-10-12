import * as THREE from 'three';
const _wq = new THREE.Quaternion();
import { assets } from '../core/assets.js';

const texCache = new Map();
function shipTex(id, name, srgb) {
  const key = id + '/' + name;
  if (!texCache.has(key)) {
    const t = assets.tex(`assets/ships/${id}/${name}.jpg`);
    t.flipY = false;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = 8;
    texCache.set(key, t);
  }
  return texCache.get(key);
}

const plumeVert = `
  varying vec2 vUv; varying vec3 vN; varying vec3 vV;
  #include <common>
  #include <logdepthbuf_pars_vertex>
  void main(){
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
    #include <logdepthbuf_vertex>
  }`;
const plumeFrag = `
  uniform vec3 color; uniform float power, time, boost, seed, layer;
  varying vec2 vUv; varying vec3 vN; varying vec3 vV;
  #include <logdepthbuf_pars_fragment>
  float h(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  float vnoise(vec3 p){
    vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(h(i), h(i + vec3(1,0,0)), f.x), mix(h(i + vec3(0,1,0)), h(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(h(i + vec3(0,0,1)), h(i + vec3(1,0,1)), f.x), mix(h(i + vec3(0,1,1)), h(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  void main(){
    #include <logdepthbuf_fragment>
    float along = clamp(vUv.y, 0.0, 1.0);                       // 1 at the nozzle, 0 at the tail
    float facing = pow(abs(dot(normalize(vN), normalize(vV))), layer > 0.5 ? 1.6 : 2.6);
    // turbulent plasma: noise streaming away from the nozzle, faster with more thrust
    vec3 q = vec3(vUv.x * 7.0, along * 9.0 - time * (10.0 + 18.0 * power), seed);
    float turb = 0.55 + 0.45 * vnoise(q) * (0.6 + 0.4 * vnoise(q * 2.3 + 7.0));
    float fall = pow(along, mix(2.6, 1.1, power));
    // shock diamonds in the core, strong on afterburner
    float diam = mix(1.0, 0.55 + 0.45 * pow(0.5 + 0.5 * cos(along * 46.0 - time * 3.0), 3.0), (0.25 + 0.75 * boost) * (1.0 - layer));
    float flick = 0.9 + 0.1 * sin(time * 73.0 + seed * 9.0);
    float a = facing * fall * turb * diam * flick * power;
    // white-hot near the nozzle, engine colour further out, a warmer fringe on the outer layer
    vec3 hot = mix(color, vec3(1.0), smoothstep(0.55, 1.0, along) * (1.0 - layer) * facing);
    vec3 c = mix(hot, color * vec3(1.15, 0.95, 0.85), layer * (1.0 - along));
    gl_FragColor = vec4(c * a * (layer > 0.5 ? 0.75 : 1.8), 1.0);
  }`;

// Nozzle disc seen from behind: white-hot core, engine colour, a darker lip, slow turbulent swirl.
const nozzleVert = `
  attribute vec3 nzOff; varying vec3 vOff;
  #include <common>
  #include <logdepthbuf_pars_vertex>
  void main(){
    vOff = nzOff;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
  }`;
const nozzleFrag = `
  uniform vec3 color; uniform float power, time;
  varying vec3 vOff;
  #include <logdepthbuf_pars_fragment>
  void main(){
    #include <logdepthbuf_fragment>
    float r = clamp(length(vOff), 0.0, 1.0);
    float lvl = max(color.r, max(color.g, color.b));     // the hangar dims engines through the colour
    vec3 tint = color / max(lvl, 1e-4);
    float ang = atan(vOff.y, vOff.x);
    float swirl = 0.88 + 0.12 * sin(ang * 9.0 + r * 7.0 - time * 6.0) * sin(ang * 4.0 - time * 2.3);
    float rings = 0.92 + 0.08 * sin(r * 28.0 - time * (8.0 + 14.0 * power));
    vec3 core = mix(vec3(1.0), pow(tint, vec3(1.7)), smoothstep(0.0, 0.5 - 0.2 * (1.0 - power), r));
    float bright = mix(1.0, 0.32, smoothstep(0.25, 1.0, r)) * (0.4 + 1.6 * power);
    vec3 c = core * bright * swirl * rings;
    c *= mix(1.0, 0.35, smoothstep(0.86, 1.0, r));   // the nozzle lip stays darker
    gl_FragColor = vec4(c * lvl * 1.6, 1.0);
  }`;

/** Per vertex: offset from the centre of its disc, in disc radii (glow meshes hold several joined discs). */
function nozzleOffsets(geo) {
  const pos = geo.attributes.position, n = pos.count, parent = new Int32Array(n).map((_, i) => i);
  const find = i => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
  const idx = geo.index ? geo.index.array : Array.from({ length: n }, (_, i) => i);
  for (let i = 0; i < idx.length; i += 3) { const a = find(idx[i]); parent[find(idx[i + 1])] = a; parent[find(idx[i + 2])] = a; }
  // glTF splits vertices at hard edges: also merge pieces that share a position (cap + side of one disc)
  const key = new Map();
  for (let i = 0; i < n; i++) {
    const k = `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
    if (key.has(k)) parent[find(i)] = find(key.get(k)); else key.set(k, i);
  }
  const groups = new Map();
  for (let i = 0; i < n; i++) { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(i); }
  const off = new Float32Array(n * 3), c = new THREE.Vector3(), p = new THREE.Vector3();
  for (const vs of groups.values()) {
    c.set(0, 0, 0);
    for (const i of vs) c.add(p.fromBufferAttribute(pos, i));
    c.divideScalar(vs.length);
    let R = 1e-6;
    for (const i of vs) R = Math.max(R, p.fromBufferAttribute(pos, i).distanceTo(c));
    for (const i of vs) { p.fromBufferAttribute(pos, i).sub(c).divideScalar(R); off.set([p.x, p.y, p.z], i * 3); }
  }
  geo.setAttribute('nzOff', new THREE.BufferAttribute(off, 3));
}

let glowTex = null;
function nozzleGlowTex() {
  if (glowTex) return glowTex;
  const s = 128, cv = document.createElement('canvas'); cv.width = cv.height = s;
  const g = cv.getContext('2d'), grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.2, 'rgba(255,255,255,0.55)'); grd.addColorStop(0.5, 'rgba(255,255,255,0.12)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, s, s);
  glowTex = new THREE.CanvasTexture(cv); glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

/** Exhaust: a hot inner cone with shock diamonds, a wider soft outer cone and a glow at the nozzle. Points along +Z. */
function makePlume(radius, color) {
  const g = new THREE.Group();
  const mk = (rTop, rTip, layer) => {
    const geo = new THREE.CylinderGeometry(rTop, rTip, 1, 28, 18, true);
    geo.translate(0, -0.5, 0);            // nozzle at y=0 (uv.y = 1), tail at y=-1
    geo.rotateX(-Math.PI / 2);            // extend along +Z (backwards)
    const mat = new THREE.ShaderMaterial({
      vertexShader: plumeVert, fragmentShader: plumeFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { color: { value: new THREE.Color(color) }, power: { value: 0.5 }, time: { value: 0 }, boost: { value: 0 }, seed: { value: Math.random() * 10 }, layer: { value: layer } },
    });
    const m = new THREE.Mesh(geo, mat); m.frustumCulled = false;
    g.add(m);
    return m;
  };
  const core = mk(radius * 0.6, radius * 0.05, 0);
  const outer = mk(radius * 1.35, radius * 0.45, 1);
  outer.scale.set(1, 1, 0.8);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: nozzleGlowTex(), color: new THREE.Color(color).multiplyScalar(1.4), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  glow.scale.setScalar(radius * 3.2);
  g.add(glow);
  g.userData = { core, outer, glow, mats: [core.material, outer.material], len: 1, radius };
  return g;
}

/** Replace zero-length / NaN normals (degenerate faces) which would poison the bloom pass. */
export function sanitizeNormals(geo) {
  const n = geo.attributes.normal;
  if (!n) return;
  for (let i = 0; i < n.count; i++) {
    const x = n.getX(i), y = n.getY(i), z = n.getZ(i);
    const l = Math.hypot(x, y, z);
    if (!(l > 1e-6)) n.setXYZ(i, 0, 1, 0);
    else if (Math.abs(l - 1) > 1e-3) n.setXYZ(i, x / l, y / l, z / l);
  }
  n.needsUpdate = true;
}

/** Loaded ship visual: hull with baked PBR, glows, glass, plumes, hardpoints. */
export class ShipModel {
  static async load(id, opts = {}) {
    const root = await assets.model(`assets/ships/${id}/model.glb`);
    return new ShipModel(id, root, opts);
  }

  constructor(id, root, opts) {
    this.id = id;
    this.root = new THREE.Group();
    this.root.add(root);
    this.exhausts = []; this.guns = []; this.cockpit = null; this.glows = []; this.plumes = [];
    this.paint = new THREE.Color(opts.paint || '#ffffff');
    this.paintAmount = { value: opts.paint ? 0.85 : 0.0 };
    const paintUniform = { value: this.paint };
    const engineColor = new THREE.Color(opts.engineColor || '#7fb6ff');
    root.traverse(o => {
      const n = o.name || '';
      if (o.isMesh && n.startsWith('hull')) {
        const mat = new THREE.MeshStandardMaterial({
          map: shipTex(id, 'base', true), normalMap: shipTex(id, 'normal', false),
          roughnessMap: shipTex(id, 'orm', false), metalnessMap: shipTex(id, 'orm', false), aoMap: shipTex(id, 'orm', false),
          roughness: 1, metalness: 1, aoMapIntensity: 1.0, envMapIntensity: 1.0,
        });
        if (opts.emit) { mat.emissiveMap = shipTex(id, 'emit', true); mat.emissive = new THREE.Color(1, 1, 1); mat.emissiveIntensity = 2; }
        const mask = shipTex(id, 'mask', false);
        mat.onBeforeCompile = (sh) => {
          sh.uniforms.paintColor = paintUniform; sh.uniforms.paintAmount = this.paintAmount; sh.uniforms.paintMask = { value: mask };
          sh.fragmentShader = sh.fragmentShader
            .replace('#include <common>', '#include <common>\nuniform vec3 paintColor; uniform float paintAmount; uniform sampler2D paintMask;')
            .replace('#include <map_fragment>', `#include <map_fragment>
              { float pm = texture2D(paintMask, vMapUv).r * paintAmount;
                float lum = dot(diffuseColor.rgb, vec3(0.299,0.587,0.114));
                diffuseColor.rgb = mix(diffuseColor.rgb, paintColor * lum * 2.2, pm); }`);
        };
        // derivative-based tangents (baked tangents can be degenerate -> NaN); glTF normal maps need y flipped then
        o.geometry.deleteAttribute('tangent');
        sanitizeNormals(o.geometry);
        mat.normalScale.set(1, -1);
        o.material = mat;
        o.castShadow = o.receiveShadow = true;
        this.hull = o;
      } else if (o.isMesh && n.startsWith('glow')) {
        const hex = (o.userData && o.userData.glow_color) || '#ffffff';
        const isEngine = n.includes('engine');
        const c = isEngine ? engineColor.clone() : new THREE.Color(hex);
        if (isEngine) {
          if (!o.geometry.attributes.nzOff) nozzleOffsets(o.geometry);
          o.material = new THREE.ShaderMaterial({ vertexShader: nozzleVert, fragmentShader: nozzleFrag,
            uniforms: { color: { value: c.clone() }, power: { value: 0.5 }, time: { value: Math.random() * 10 } } });
          o.material.color = o.material.uniforms.color.value;
        } else o.material = new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(4), toneMapped: false });
        this.glows.push({ mesh: o, base: c, engine: isEngine, blink: n.includes('white') });
      } else if (o.isMesh && n.startsWith('glass')) {
        o.material = new THREE.MeshPhysicalMaterial({ color: 0x0a1016, metalness: 0.0, roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 2.2, transparent: true, opacity: 0.9 });
      } else if (n.startsWith('exhaust')) this.exhausts.push(o);
      else if (n.startsWith('gun')) this.guns.push(o);
      else if (n === 'cockpit') this.cockpit = o;
    });
    for (const ex of this.exhausts) {
      const p = makePlume(opts.plumeRadius || 0.45, engineColor);
      ex.add(p);
      this.plumes.push(p);
    }
    const box = new THREE.Box3().setFromObject(root);
    this.radius = box.getBoundingSphere(new THREE.Sphere()).radius;
    this.length = box.max.z - box.min.z;
    this.time = 0;
    // fighters: wings / fins / canards on hinges (empties 'hinge_<part>' from the Blender export). Their meshes,
    // lights and exhaust/gun points hang under the hinge, which turns between the cruise and the attack pose.
    this.wings = [];
    root.updateMatrixWorld(true);
    const hinges = [];
    root.traverse(o => { if (o.name.startsWith('hinge_') && o.userData?.part) hinges.push(o); });
    for (const h of hinges) {
      const movers = [];
      root.traverse(o => { if (o !== h && o.userData?.part === h.userData.part && !o.name.startsWith('hinge_')) movers.push(o); });
      for (const o of movers) h.attach(o);
      this.wings.push({ pivot: h, axis: new THREE.Vector3(...h.userData.axis).normalize(), q0: h.quaternion.clone(), cruise: h.userData.cruise || 0, attack: h.userData.attack || 0 });
    }
    this.wingK = 0; this.wingTarget = 0;
    this.setWingPose(0);
  }

  /** 0 = cruise pose, 1 = attack pose (wings spread, fins in X ...). */
  setWingPose(k) {
    this.wingK = k;
    const e = k * k * (3 - 2 * k);
    for (const w of this.wings) w.pivot.quaternion.copy(w.q0).multiply(_wq.setFromAxisAngle(w.axis, w.cruise + (w.attack - w.cruise) * e));
  }

  setPaint(hex) { this.paint.set(hex); this.paintAmount.value = hex ? 0.85 : 0; }

  /** throttle 0..1, boost bool */
  update(dt, throttle, boost = false) {
    this.time += dt;
    if (this.wings.length && this.wingK !== this.wingTarget) {
      const step = dt / 0.9;   // a deliberate ~1 s servo movement
      this.setWingPose(this.wingTarget > this.wingK ? Math.min(this.wingTarget, this.wingK + step) : Math.max(this.wingTarget, this.wingK - step));
    }
    const p = Math.min(1, 0.15 + throttle * 0.85) * (boost ? 1.45 : 1);
    this.boostK = (this.boostK || 0) + ((boost ? 1 : 0) - (this.boostK || 0)) * Math.min(1, dt * 4);
    for (const pl of this.plumes) {
      const U = pl.userData;
      // the plume length follows thrust with a little lag, so throttle changes look like the jet growing and collapsing
      const target = (0.5 + 4.6 * throttle) * (1 + this.boostK * 0.9);
      U.len += (target - U.len) * Math.min(1, dt * 5);
      const flick = 1 + 0.06 * Math.sin(this.time * 41 + U.radius * 13) + 0.04 * Math.sin(this.time * 97);
      for (const m of U.mats) { m.uniforms.power.value = p; m.uniforms.time.value = this.time; m.uniforms.boost.value = this.boostK; }
      U.core.scale.set(1 + this.boostK * 0.1, 1 + this.boostK * 0.1, U.len * flick);
      U.outer.scale.set(1 + this.boostK * 0.25, 1 + this.boostK * 0.25, U.len * 0.8 * flick);
      U.glow.material.opacity = Math.min(1, 0.35 + p * 0.55) * flick;
      U.glow.scale.setScalar(U.radius * (1.9 + p * 1.1 + this.boostK * 1.0));
    }
    for (const g of this.glows) {
      if (g.engine) { const u = g.mesh.material.uniforms; u.power.value = p; u.time.value += dt; }
      else if (g.blink) g.mesh.visible = (this.time % 1.4) < 0.08;
    }
  }
}
