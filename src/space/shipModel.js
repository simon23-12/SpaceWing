import * as THREE from 'three';
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
  varying vec2 vUv;
  #include <common>
  #include <logdepthbuf_pars_vertex>
  void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
  #include <logdepthbuf_vertex>
  }`;
const plumeFrag = `
  uniform vec3 color; uniform float power, time;
  varying vec2 vUv;
  #include <logdepthbuf_pars_fragment>
  void main(){
    #include <logdepthbuf_fragment>
    float along = clamp(vUv.y, 0.0, 1.0);   // 1 at nozzle, 0 at tail
    float across = clamp(abs(vUv.x - 0.5) * 2.0, 0.0, 1.0);
    float core = pow(1.0 - across, 3.0);
    float flick = 0.85 + 0.15 * sin(time * 60.0 + along * 20.0);
    float diamonds = 0.75 + 0.25 * sin(along * 38.0 - time * 40.0);
    float a = core * pow(along, 1.6) * power * flick * diamonds;
    vec3 c = mix(color, vec3(1.0), core * core * core * along * along);
    gl_FragColor = vec4(c * a * 3.0, 1.0);
  }`;

/** Exhaust plume: two crossed planes with additive shader, pointing along +Z (backwards). */
function makePlume(radius, color) {
  const g = new THREE.Group();
  const mat = new THREE.ShaderMaterial({
    vertexShader: plumeVert, fragmentShader: plumeFrag, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { color: { value: new THREE.Color(color) }, power: { value: 0.5 }, time: { value: 0 } },
  });
  const geo = new THREE.PlaneGeometry(radius * 2, 1, 1, 1);
  geo.translate(0, -0.5, 0); // from 0 (nozzle) to -1
  geo.rotateX(-Math.PI / 2); // extend along +Z
  for (let i = 0; i < 2; i++) {
    const m = new THREE.Mesh(geo, mat);
    m.rotation.z = i * Math.PI / 2;
    g.add(m);
  }
  g.userData.mat = mat;
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
        o.material = new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(isEngine ? 2 : 4), toneMapped: false });
        this.glows.push({ mesh: o, base: c, engine: isEngine, blink: n.includes('white') });
      } else if (o.isMesh && n.startsWith('glass')) {
        o.material = new THREE.MeshPhysicalMaterial({ color: 0x0a1016, metalness: 0.0, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 2.2, transparent: true, opacity: 0.9 });
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
  }

  setPaint(hex) { this.paint.set(hex); this.paintAmount.value = hex ? 0.85 : 0; }

  /** throttle 0..1, boost bool */
  update(dt, throttle, boost = false) {
    this.time += dt;
    const p = Math.min(1, 0.15 + throttle * 0.85) * (boost ? 1.6 : 1);
    for (const pl of this.plumes) {
      pl.userData.mat.uniforms.power.value = p;
      pl.userData.mat.uniforms.time.value = this.time;
      pl.scale.set(1, 1, (0.6 + 4.5 * throttle) * (boost ? 1.8 : 1));
    }
    for (const g of this.glows) {
      if (g.engine) g.mesh.material.color.copy(g.base).multiplyScalar(0.5 + 1.5 * p);
      else if (g.blink) g.mesh.visible = (this.time % 1.4) < 0.08;
    }
  }
}
