import * as THREE from 'three';

function radialTexture(stops, size = 128) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [p, col] of stops) grd.addColorStop(p, col);
  g.fillStyle = grd; g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export const TEX = {
  soft: radialTexture([[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,0.6)'], [1, 'rgba(255,255,255,0)']]),
  flash: radialTexture([[0, 'rgba(255,255,255,1)'], [0.1, 'rgba(255,240,210,0.9)'], [0.35, 'rgba(255,150,60,0.35)'], [1, 'rgba(0,0,0,0)']], 256),
  smoke: radialTexture([[0, 'rgba(120,110,100,0.55)'], [0.5, 'rgba(70,65,60,0.25)'], [1, 'rgba(0,0,0,0)']]),
};

const LOGDEPTH_V = `#include <common>\n#include <logdepthbuf_pars_vertex>\n`;

/** GPU particle pool: points with per-particle colour, size and life (updated on CPU). */
export class Particles {
  constructor(scene, max = 4000, tex = TEX.soft, blending = THREE.AdditiveBlending) {
    this.max = max; this.n = 0;
    this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3); this.size = new Float32Array(max);
    this.life = new Float32Array(max); this.maxLife = new Float32Array(max); this.grow = new Float32Array(max);
    this.c0 = new Float32Array(max * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex }, scale: { value: window.innerHeight / 2 } },
      vertexShader: LOGDEPTH_V + `attribute float size; attribute vec3 color; varying vec3 vColor; uniform float scale;
        void main(){ vColor = color; vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = size * scale / max(-mv.z, 0.1); gl_Position = projectionMatrix * mv;
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: `uniform sampler2D map; varying vec3 vColor;
        #include <logdepthbuf_pars_fragment>
        void main(){
          #include <logdepthbuf_fragment>
          vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vColor * t.rgb * t.a, blendAlpha(t.a)); }`
        .replace('blendAlpha(t.a)', blending === THREE.AdditiveBlending ? '1.0' : 't.a'),
      transparent: true, depthWrite: false, blending,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  emit(p, v, color, size, life, grow = 0) {
    let i = this.n < this.max ? this.n++ : Math.floor(Math.random() * this.max);
    this.pos.set([p.x, p.y, p.z], i * 3); this.vel.set([v.x, v.y, v.z], i * 3);
    this.c0.set([color.r, color.g, color.b], i * 3);
    this.size[i] = size; this.life[i] = life; this.maxLife[i] = life; this.grow[i] = grow;
  }

  update(dt) {
    for (let i = 0; i < this.n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        const j = --this.n;
        if (i !== j) {
          for (let k = 0; k < 3; k++) { this.pos[i * 3 + k] = this.pos[j * 3 + k]; this.vel[i * 3 + k] = this.vel[j * 3 + k]; this.c0[i * 3 + k] = this.c0[j * 3 + k]; }
          this.size[i] = this.size[j]; this.life[i] = this.life[j]; this.maxLife[i] = this.maxLife[j]; this.grow[i] = this.grow[j];
        }
        i--; continue;
      }
      const f = this.life[i] / this.maxLife[i];
      for (let k = 0; k < 3; k++) { this.pos[i * 3 + k] += this.vel[i * 3 + k] * dt; this.col[i * 3 + k] = this.c0[i * 3 + k] * f; }
      this.size[i] += this.grow[i] * dt;
    }
    const g = this.points.geometry;
    g.setDrawRange(0, this.n);
    g.attributes.position.needsUpdate = g.attributes.color.needsUpdate = g.attributes.size.needsUpdate = true;
    this.points.material.uniforms.scale.value = window.innerHeight / 2;
  }
}

/** Laser bolts as stretched additive quads (billboarded around their axis). */
export class Bolts {
  constructor(scene, max = 400) {
    this.list = [];
    this.max = max;
    const geo = new THREE.PlaneGeometry(1, 1);
    this.mats = new Map();
    this.geo = geo;
    this.scene = scene;
    this.pool = [];
  }

  material(color) {
    if (!this.mats.has(color)) {
      const c = new THREE.Color(color);
      this.mats.set(color, new THREE.ShaderMaterial({
        uniforms: { color: { value: c } },
        vertexShader: LOGDEPTH_V + `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
          #include <logdepthbuf_vertex>
        }`,
        fragmentShader: `uniform vec3 color; varying vec2 vUv;
          #include <logdepthbuf_pars_fragment>
          void main(){
          #include <logdepthbuf_fragment>
          float x = clamp(abs(vUv.x - 0.5) * 2.0, 0.0, 1.0); float y = clamp(abs(vUv.y - 0.5) * 2.0, 0.0, 1.0);
          float core = (1.0 - x*x) * (1.0 - y*y*y*y);
          vec3 c = mix(color, vec3(1.0), core*core*core) * core * 5.0;
          gl_FragColor = vec4(c, 1.0); }`,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      }));
    }
    return this.mats.get(color);
  }

  fire(pos, dir, speed, inheritVel, owner, dmg, color, life = 2.2, len = 14, width = 0.55) {
    let m = this.pool.pop();
    if (!m) { m = new THREE.Mesh(this.geo, this.material(color)); m.frustumCulled = false; }
    m.material = this.material(color);
    m.scale.set(width, len, 1);
    m.position.copy(pos);
    this.scene.add(m);
    const vel = dir.clone().multiplyScalar(speed).add(inheritVel);
    this.list.push({ mesh: m, vel, dir: dir.clone(), owner, dmg, life, len, color });
    if (this.list.length > this.max) this.remove(0);
  }

  remove(i) {
    const b = this.list[i];
    this.scene.remove(b.mesh); this.pool.push(b.mesh);
    this.list.splice(i, 1);
  }

  /** hitTest(prev, next, bolt) -> true if consumed */
  update(dt, camera, hitTest) {
    const tmp = new THREE.Vector3(), prev = new THREE.Vector3(), side = new THREE.Vector3();
    for (let i = this.list.length - 1; i >= 0; i--) {
      const b = this.list[i];
      b.life -= dt;
      prev.copy(b.mesh.position);
      b.mesh.position.addScaledVector(b.vel, dt);
      if (b.life <= 0 || hitTest(prev, b.mesh.position, b)) { this.remove(i); continue; }
      // orient: long axis (Y) along velocity, face the camera
      const axis = tmp.copy(b.vel).normalize();
      const toCam = side.copy(camera.position).sub(b.mesh.position).normalize();
      const x = new THREE.Vector3().crossVectors(axis, toCam).normalize();
      const z = new THREE.Vector3().crossVectors(x, axis);
      b.mesh.matrix.makeBasis(x, axis, z);
      b.mesh.quaternion.setFromRotationMatrix(b.mesh.matrix);
    }
  }
}

/** Streaks of dust around the camera to sell velocity. */
export class SpaceDust {
  constructor(scene, n = 700, range = 160) {
    this.n = n; this.range = range;
    this.p = new Float32Array(n * 3);
    for (let i = 0; i < n * 3; i++) this.p[i] = (Math.random() - 0.5) * range * 2;
    this.lines = new Float32Array(n * 6);
    this.colors = new Float32Array(n * 6);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.lines, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    this.mesh = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  update(cam, vel, intensity = 1) {
    const r = this.range, cx = cam.position.x, cy = cam.position.y, cz = cam.position.z;
    const sp = vel.length();
    const k = Math.min(0.05, 6 / Math.max(sp, 1));
    for (let i = 0; i < this.n; i++) {
      for (let a = 0; a < 3; a++) {
        const c = a === 0 ? cx : a === 1 ? cy : cz;
        let v = this.p[i * 3 + a];
        if (v - c > r) v -= 2 * r; else if (v - c < -r) v += 2 * r;
        this.p[i * 3 + a] = v;
      }
      const x = this.p[i * 3], y = this.p[i * 3 + 1], z = this.p[i * 3 + 2];
      this.lines[i * 6] = x; this.lines[i * 6 + 1] = y; this.lines[i * 6 + 2] = z;
      this.lines[i * 6 + 3] = x - vel.x * k; this.lines[i * 6 + 4] = y - vel.y * k; this.lines[i * 6 + 5] = z - vel.z * k;
      const d = Math.hypot(x - cx, y - cy, z - cz) / r;
      const b = Math.max(0, 1 - d) * 0.35 * intensity * Math.min(1, sp / 40 + 0.15);
      this.colors[i * 6] = this.colors[i * 6 + 1] = this.colors[i * 6 + 2] = b;
      this.colors[i * 6 + 3] = this.colors[i * 6 + 4] = this.colors[i * 6 + 5] = 0;
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.color.needsUpdate = true;
  }
}

/** Shield bubble flash on hit. */
const shieldMat = new THREE.ShaderMaterial({
  uniforms: { hit: { value: new THREE.Vector3(0, 0, 1) }, amount: { value: 0 }, color: { value: new THREE.Color(0.4, 0.75, 1.0) } },
  vertexShader: LOGDEPTH_V + `varying vec3 vN; varying vec3 vP; varying vec3 vV;
    void main(){ vN = normalize(normal); vP = normalize(position); vec4 mv = modelViewMatrix*vec4(position,1.0); vV = normalize(-mv.xyz);
      vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * mv;
      #include <logdepthbuf_vertex>
    }`,
  fragmentShader: `uniform vec3 hit; uniform float amount; uniform vec3 color; varying vec3 vN; varying vec3 vP; varying vec3 vV;
    #include <logdepthbuf_pars_fragment>
    void main(){
      #include <logdepthbuf_fragment>
      float rim = pow(1.0 - abs(dot(vN, vV)), 2.5);
      float spot = pow(max(dot(vP, normalize(hit)), 0.0), 24.0);
      float hex = 0.6 + 0.4 * sin(vP.x * 40.0) * sin(vP.y * 40.0) * sin(vP.z * 40.0);
      gl_FragColor = vec4(color * (rim * 0.06 + spot * 1.1 * hex) * amount, 1.0); }`,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
});
const shieldGeo = new THREE.SphereGeometry(1, 32, 20);

export function makeShield(radius) {
  const m = new THREE.Mesh(shieldGeo, shieldMat.clone());
  m.scale.set(radius * 0.62, radius * 0.32, radius * 0.8);
  m.visible = false;
  m.userData.t = 0;
  return m;
}

export class Explosions {
  constructor(scene) {
    this.scene = scene;
    this.fire = new Particles(scene, 3000, TEX.flash);
    this.sparks = new Particles(scene, 2000, TEX.soft);
    this.smoke = new Particles(scene, 1200, TEX.smoke, THREE.NormalBlending);
    this.flashes = [];
    this.debris = [];
    this.debrisGeo = new THREE.BoxGeometry(1, 1, 1);
    this.debrisMat = new THREE.MeshStandardMaterial({ color: 0x3a3634, roughness: 0.7, metalness: 0.5, emissive: 0xff5a1a, emissiveIntensity: 0.6 });
  }

  boom(pos, size = 10, vel = new THREE.Vector3()) {
    const v = new THREE.Vector3(), c = new THREE.Color();
    for (let i = 0; i < 70; i++) {
      v.randomDirection().multiplyScalar(size * (0.5 + Math.random() * 2.5)).add(vel);
      c.setHSL(0.06 + Math.random() * 0.06, 1, 0.5 + Math.random() * 0.3).multiplyScalar(3);
      this.fire.emit(pos, v, c, size * (0.5 + Math.random()), 0.5 + Math.random() * 0.9, size * 1.5);
    }
    for (let i = 0; i < 90; i++) {
      v.randomDirection().multiplyScalar(size * (4 + Math.random() * 10)).add(vel);
      c.setRGB(4, 2.4, 1.2);
      this.sparks.emit(pos, v, c, 0.6 + Math.random() * 0.8, 0.4 + Math.random() * 1.3);
    }
    for (let i = 0; i < 25; i++) {
      v.randomDirection().multiplyScalar(size * (0.3 + Math.random())).add(vel.clone().multiplyScalar(0.5));
      c.setRGB(1, 1, 1);
      this.smoke.emit(pos, v, c, size * (1 + Math.random()), 2 + Math.random() * 2.5, size * 0.8);
    }
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Mesh(this.debrisGeo, this.debrisMat);
      m.scale.set(Math.random() * size * 0.15 + 0.2, Math.random() * size * 0.1 + 0.1, Math.random() * size * 0.2 + 0.2);
      m.position.copy(pos);
      this.scene.add(m);
      this.debris.push({ m, v: new THREE.Vector3().randomDirection().multiplyScalar(size * (1 + Math.random() * 3)).add(vel), w: new THREE.Vector3().randomDirection().multiplyScalar(4), life: 5 + Math.random() * 3 });
    }
    const light = new THREE.PointLight(0xffaa66, size * 400, size * 30, 2);
    light.position.copy(pos);
    this.scene.add(light);
    this.flashes.push({ light, life: 0.6, max: 0.6, i0: size * 400 });
  }

  hit(pos, normal, shield) {
    const v = new THREE.Vector3(), c = new THREE.Color();
    for (let i = 0; i < 12; i++) {
      v.randomDirection().add(normal).multiplyScalar(20 + Math.random() * 40);
      if (shield) c.setRGB(1.2, 2.4, 4); else c.setRGB(4, 2.2, 0.8);
      this.sparks.emit(pos, v, c, 0.4 + Math.random() * 0.5, 0.2 + Math.random() * 0.4);
    }
    c.setRGB(shield ? 1 : 3, shield ? 2 : 1.6, shield ? 4 : 0.8);
    this.fire.emit(pos, normal.clone().multiplyScalar(5), c, 2.5, 0.15, 10);
  }

  update(dt) {
    this.fire.update(dt); this.sparks.update(dt); this.smoke.update(dt);
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i]; f.life -= dt;
      f.light.intensity = f.i0 * Math.max(0, f.life / f.max) ** 2;
      if (f.life <= 0) { this.scene.remove(f.light); this.flashes.splice(i, 1); }
    }
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i]; d.life -= dt;
      d.m.position.addScaledVector(d.v, dt);
      d.m.rotation.x += d.w.x * dt; d.m.rotation.y += d.w.y * dt;
      d.m.material === this.debrisMat;
      if (d.life <= 0) { this.scene.remove(d.m); this.debris.splice(i, 1); }
    }
  }
}
