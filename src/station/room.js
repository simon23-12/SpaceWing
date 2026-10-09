import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { assets } from '../core/assets.js';
import { input } from '../core/input.js';
import { SkyLayer } from '../space/skyLayer.js';
import { zoneAnchor } from '../space/universe.js';
import { ShipModel, sanitizeNormals } from '../space/shipModel.js';

const EXPOSURE = { kabine: 2.2, bruecke: 1.35, bar: 1.6, hangar: 1.4, aussicht: 1.8 };
const ROOM_NAMES = { bruecke: 'Kommandodeck', bar: 'Bar „Cassini-Spalt“', hangar: 'Hangar 7', kabine: 'Kabine 4-117', aussicht: 'Aussichtsplattform' };

const holoVert = `#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vN; varying vec3 vV; varying vec3 vW;
void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix)*normal); vV = normalize(cameraPosition - w.xyz);
  gl_Position = projectionMatrix * viewMatrix * w;
  #include <logdepthbuf_vertex>
}`;
const holoFrag = `uniform vec3 color; uniform float time, flicker;
#include <logdepthbuf_pars_fragment>
varying vec3 vN; varying vec3 vV; varying vec3 vW;
void main(){
  #include <logdepthbuf_fragment>
  float f = pow(1.0 - abs(dot(normalize(vN), vV)), 1.8);
  float scan = 0.65 + 0.35 * sin(vW.y * 90.0 - time * 6.0);
  float band = smoothstep(0.0, 0.05, fract(vW.y * 1.3 - time * 0.4)) * 0.3 + 0.7;
  float fl = 1.0 - flicker * step(0.97, fract(sin(floor(time * 24.0)) * 43758.5));
  gl_FragColor = vec4(color * (0.25 + f * 1.6) * scan * band * fl, 1.0);
}`;

export function holoMaterial(color) {
  return new THREE.ShaderMaterial({ vertexShader: holoVert, fragmentShader: holoFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { color: { value: new THREE.Color(color) }, time: { value: 0 }, flicker: { value: 1 } } });
}

/** First-person walkable room with Blender-baked lighting. */
export class RoomMode {
  constructor(game, roomId, spawnKey = 'default') {
    this.game = game;
    this.roomId = roomId;
    this.spawnKey = spawnKey;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 2000);
    this.vel = new THREE.Vector3();
    this.pos = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.onGround = false;
    this.radius = 0.32; this.height = 1.75;
    this.animated = [];
    this.npcs = [];
    this.time = 0;
    this.isRoom = true;
  }

  async init() {
    const dir = `assets/rooms/${this.roomId}`;
    const [gltf, meta] = await Promise.all([assets.gltf(`${dir}/model.glb`), assets.getJSON(`${dir}/meta.json`)]);
    this.meta = meta;
    const lm = await assets.texAsync(`${dir}/lightmap.jpg`);
    lm.flipY = false; lm.colorSpace = THREE.SRGBColorSpace; lm.anisotropy = 8;
    const root = gltf.scene.clone(true);
    const scale = (meta.lightScale || 2) * (EXPOSURE[this.roomId] || 1.4);
    const colliders = [];
    root.traverse(o => {
      if (!o.isMesh) return;
      const n = o.name;
      if (n.startsWith('room')) {
        o.material = new THREE.MeshBasicMaterial({ map: lm, color: new THREE.Color(scale, scale, scale) });
        o.updateMatrixWorld(true);
        const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld);
        for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k);
        colliders.push(g.index ? g.toNonIndexed() : g);
      } else if (n.startsWith('glow') || n.startsWith('glow_')) {
        const hex = o.userData.glow_color || '#ffffff';
        o.material = new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(n.includes('sign') || n.includes('neon') ? 3.5 : 2.5), toneMapped: false });
      } else if (n.startsWith('glass')) {
        o.material = new THREE.MeshPhysicalMaterial({ color: 0x0a1218, roughness: 0.02, metalness: 0, transparent: true, opacity: 0.12, envMapIntensity: 1.5, depthWrite: false, side: THREE.DoubleSide });
        o.renderOrder = 5;
      } else if (n.startsWith('screen')) {
        this.setupScreen(o, n.replace('screen_', ''));
      } else if (n.startsWith('field')) {
        o.material = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 0.55, 1.0).multiplyScalar(0.5), transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
      }
    });
    this.scene.add(root);
    // collision BVH
    const merged = mergeGeometries(colliders, false);
    this.bvh = new MeshBVH(merged);
    // lights for dynamic objects + environment captured from the baked room
    this.scene.add(new THREE.HemisphereLight(0xffe8d0, 0x202028, 0.5));
    for (const l of (meta.lights || []).slice(0, 6)) {
      const p = new THREE.PointLight(new THREE.Color(l.color), Math.min(40, l.energy * 0.12), 14, 2);
      p.position.fromArray(l.pos);
      this.scene.add(p);
    }
    // markers
    this.markers = (meta.markers || []).map(m => ({ ...m, pos: new THREE.Vector3(...m.pos), dir: new THREE.Vector3(...m.dir) }));
    const sp = this.markers.find(m => m.kind === 'spawn' && m.id === this.spawnKey) || this.markers.find(m => m.kind === 'spawn');
    this.pos.copy(sp.pos);
    this.yaw = Math.atan2(-sp.dir.x, -sp.dir.z);
    // sky outside the windows
    this.sky = new SkyLayer();
    this.sky.setOrigin(...zoneAnchor('rhea'));
    const win = new THREE.Vector3(...(meta.window_dir || [0, 0, -1])).normalize();
    const anchor = zoneAnchor('rhea');
    const toSat = new THREE.Vector3(-anchor[0], -anchor[1], -anchor[2]).normalize();
    // rotate room space so the window looks a little past Saturn
    const tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.roomId === 'aussicht' ? 0.0 : 0.32);
    const look = toSat.clone().applyQuaternion(tilt);
    this.spaceQ = new THREE.Quaternion().setFromUnitVectors(win, look);
    this.roomEnv();
    await this.populate();
    this.game.renderer.setLayers(this.sky, { scene: this.scene, camera: this.camera });
    this.ui();
  }

  roomEnv() {
    const r = this.game.renderer.gl;
    const rt = new THREE.WebGLCubeRenderTarget(128, { type: THREE.HalfFloatType });
    const cc = new THREE.CubeCamera(0.1, 200, rt);
    const c = this.markers.find(m => m.kind === 'spawn').pos.clone(); c.y = 1.6;
    cc.position.copy(c); this.scene.add(cc); cc.update(r, this.scene); this.scene.remove(cc);
    const pm = new THREE.PMREMGenerator(r);
    this.envTex = pm.fromCubemap(rt.texture).texture;
    this.scene.environment = this.envTex;
    pm.dispose(); rt.dispose();
  }

  async populate() {
    const g = this.game.state;
    const npcRoot = await assets.gltf('assets/npcs/model.glb').catch(() => null);
    const getNpc = (name) => {
      if (!npcRoot) return null;
      const src = npcRoot.scene.getObjectByName(name);
      if (!src) return null;
      const o = src.clone(true);
      o.position.set(0, 0, 0); o.rotation.set(0, 0, 0);
      o.traverse(m => { if (m.isMesh) { sanitizeNormals(m.geometry); if (m.material) m.material.envMapIntensity = 1.2; } });
      return o;
    };
    for (const m of this.markers) {
      if (m.kind === 'npc') {
        if (m.id === 'mags' && (g.flags['accepted:eisfracht'] && !g.flags.m1done)) continue;
        if (m.id === 'mags' && g.flags.m3done && !g.flags.m4rescued) continue;
        const o = getNpc(m.seated ? m.id + '_seated' : m.id) || getNpc(m.id);
        if (!o) continue;
        o.position.copy(m.pos);
        o.rotation.y = Math.atan2(m.dir.x, m.dir.z);
        this.scene.add(o);
        this.npcs.push({ id: m.id, obj: o, base: o.position.clone() });
        if (m.id === 'mags' && g.flags.m4rescued && !g.flags.m5done) {
          const j = getNpc('juno');
          if (j) { j.position.copy(m.pos).add(new THREE.Vector3(1.1, 0, 0.3)); j.rotation.y = o.rotation.y - 0.6; this.scene.add(j); this.npcs.push({ id: 'juno', obj: j, base: j.position.clone() }); }
        }
      }
      if (m.kind === 'band') {
        const colors = ['#5fd8ff', '#ff6ad8', '#9f8aff'];
        ['band_bass', 'band_sax', 'band_keys'].forEach((nm, i) => {
          const o = getNpc(nm);
          if (!o) return;
          const mat = holoMaterial(colors[i]);
          o.traverse(x => { if (x.isMesh) x.material = mat; });
          const a = -0.9 + i * 0.9;
          o.position.copy(m.pos).add(new THREE.Vector3(Math.sin(a) * 1.3, 0, Math.cos(a) * 1.3 - 0.4));
          o.rotation.y = Math.atan2(m.dir.x, m.dir.z) + (i - 1) * 0.25;
          this.scene.add(o);
          this.animated.push({ obj: o, mat, base: o.position.clone(), phase: i * 1.7, kind: 'band' });
        });
        const light = new THREE.PointLight(0xc080ff, 6, 8, 2); light.position.copy(m.pos).add(new THREE.Vector3(0, 2, 0)); this.scene.add(light);
      }
    }
    if (this.meta.holo) this.holoTable(new THREE.Vector3(...this.meta.holo));
    if (this.meta.pad) {
      const ship = this.game.launchShipRecord();
      if (ship) {
        const model = await ShipModel.load(ship.cls, { paint: ship.paint, engineColor: '#7fb6ff' });
        const p = new THREE.Vector3(...this.meta.pad);
        const box = new THREE.Box3().setFromObject(model.root);
        model.root.position.copy(p).add(new THREE.Vector3(0, -box.min.y + 0.4, 0));
        model.root.rotation.y = Math.PI / 2;
        if (model.length > 30) { model.root.position.x -= 4; }
        this.scene.add(model.root);
        this.shipModel = model;
      }
    }
    if (this.roomId === 'bar') this.game.audio?.setMusic('jazz', { pos: this.markers.find(m => m.kind === 'band')?.pos.toArray() || [0, 1, 0] });
    else this.game.audio?.setMusic('station');
  }

  holoTable(pos) {
    const grp = new THREE.Group();
    grp.position.copy(pos).add(new THREE.Vector3(0, 0.65, 0));
    const mat = holoMaterial('#ffcf7a');
    const sat = new THREE.Mesh(new THREE.SphereGeometry(0.32, 48, 24), mat);
    sat.scale.y = 0.9;
    grp.add(sat);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.75, 96), holoMaterial('#ffe0a0'));
    ring.rotation.x = -Math.PI / 2 + 0.35;
    grp.add(ring);
    const moons = [];
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), holoMaterial('#7fd4ff'));
      m.userData = { r: 0.95 + i * 0.12, s: 0.6 / (1 + i * 0.6), a: i * 1.3 };
      grp.add(m); moons.push(m);
    }
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.6, 1.3, 48, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 0.5, 0.8), transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    beam.position.y = -0.3; grp.add(beam);
    this.scene.add(grp);
    this.animated.push({ obj: grp, kind: 'holo', sat, ring, moons, mats: [mat, ring.material, ...moons.map(m => m.material)] });
  }

  setupScreen(o, kind) {
    const c = document.createElement('canvas'); c.width = 1024; c.height = 540;
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.flipY = false;
    o.material = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, color: new THREE.Color(1.6, 1.6, 1.6) });
    this.screens = this.screens || [];
    this.screens.push({ c, tex, kind, t: 0 });
    this.drawScreen(this.screens[this.screens.length - 1]);
  }

  drawScreen(s) {
    const g = this.game.state, x = s.c.getContext('2d');
    const W = 1024, H = 540;
    x.fillStyle = '#04121c'; x.fillRect(0, 0, W, H);
    x.strokeStyle = 'rgba(120,200,255,.35)'; x.strokeRect(12, 12, W - 24, H - 24);
    x.fillStyle = '#7fd4ff'; x.font = '600 44px Rajdhani, sans-serif';
    const title = { boerse: 'SÖLDNERBÖRSE · AKTUELLE AUFTRÄGE', werft: 'WERFT & MARKT · LENKA BRANDVOLD', kabine: 'KABINE 4-117 · MIETE BEZAHLT' }[s.kind] || 'CASSINI';
    x.fillText(title, 36, 70);
    x.font = '30px Barlow, sans-serif'; x.fillStyle = '#d8e6ef';
    let lines = [];
    if (s.kind === 'boerse') {
      const jobs = (g.jobBoard.cassini?.jobs) || [];
      lines = jobs.slice(0, 7).map(j => `${j.title.slice(0, 44)}  ·  ${j.pay.toLocaleString('de-DE')} Cr`);
      if (!lines.length) lines = ['Neue Aufträge am Terminal abrufen.'];
    } else if (s.kind === 'werft') {
      lines = ['Kestrel K-9 ........ 145.000 Cr', 'Mule MT-3 ........... 95.000 Cr', 'Corsair HG-4 ....... 320.000 Cr', 'Lackierungen ab 600 Cr', 'Upgrades für alle Klassen', g.flags.zoll ? 'Helium-3: +25 % wegen Saturnzoll' : 'Helium-3: Normalpreis'];
    } else {
      lines = [`Pilot: ${g.callsign}`, `Kredits: ${g.credits.toLocaleString('de-DE')}`, `Tag ${g.day}`, 'Nachrichten: ' + (g.flags.zoll ? 'Liga erhebt Saturnzoll!' : 'Keine neuen.')];
    }
    lines.forEach((l, i) => x.fillText(l, 40, 130 + i * 52));
    x.fillStyle = 'rgba(127,212,255,.08)'; for (let y = 0; y < H; y += 4) x.fillRect(0, y, W, 1);
    s.tex.needsUpdate = true;
  }

  ui() {
    const root = document.getElementById('ui');
    this.uiEl = document.createElement('div');
    this.uiEl.innerHTML = `<div class="crosshair"></div><div class="roomlabel">${ROOM_NAMES[this.roomId] || ''}</div><div class="roomprompt hidden"></div><div class="clicktoplay">KLICKEN ZUM UMSEHEN · WASD GEHEN · E BENUTZEN · TAB ÜBERSICHT</div>`;
    this.uiEl.style.cssText = 'position:fixed;inset:0;pointer-events:none';
    root.appendChild(this.uiEl);
    this.promptEl = this.uiEl.querySelector('.roomprompt');
    this.ctp = this.uiEl.querySelector('.clicktoplay');
    this.ctp.style.pointerEvents = 'auto';
    this.ctp.onclick = () => { input.lock(this.game.renderer.gl.domElement); };
    this.uiEl.appendChild(this.game.ui.topbar());
  }

  // ------------------------------------------------------------------ update
  update(dt) {
    this.time += dt;
    const modal = this.game.ui.modalOpen;
    this.ctp.classList.toggle('hidden', input.locked || modal);
    if (!modal && input.locked) this.move(dt); else this.vel.set(0, this.vel.y, 0), this.move(dt, true);
    // camera
    this.camera.position.set(this.pos.x, this.pos.y + this.height - 0.12 + Math.sin(this.time * 9) * this.bob * 0.025, this.pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    // sky follows rotated camera
    this.sky.camera.quaternion.copy(this.spaceQ).multiply(this.camera.quaternion);
    this.sky.camera.fov = this.camera.fov; this.sky.camera.aspect = this.camera.aspect; this.sky.camera.updateProjectionMatrix();
    this.sky.update(dt);
    // animation
    for (const a of this.animated) {
      if (a.kind === 'band') {
        a.mat.uniforms.time.value = this.time;
        a.obj.position.y = a.base.y + Math.abs(Math.sin(this.time * 2.2 * Math.PI * 132 / 60 / 2 + a.phase)) * 0.04;
        a.obj.rotation.z = Math.sin(this.time * 1.1 + a.phase) * 0.04;
      } else if (a.kind === 'holo') {
        a.mats.forEach(m => m.uniforms.time.value = this.time);
        a.sat.rotation.y += dt * 0.3; a.ring.rotation.z += dt * 0.05;
        a.moons.forEach(m => { m.userData.a += dt * m.userData.s; m.position.set(Math.cos(m.userData.a) * m.userData.r, Math.sin(m.userData.a) * m.userData.r * 0.34, Math.sin(m.userData.a) * m.userData.r * 0.94); });
      }
    }
    for (const n of this.npcs) n.obj.position.y = n.base.y + Math.sin(this.time * 1.4 + n.base.x) * 0.006;
    if (this.screens) for (const s of this.screens) { s.t += dt; if (s.t > 2) { s.t = 0; this.drawScreen(s); } }
    // audio listener
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    this.game.audio?.setListener(this.camera.position, fwd, new THREE.Vector3(0, 1, 0));
    // interaction
    if (!modal) this.interact();
  }

  move(dt, frozen = false) {
    if (!frozen) {
      this.yaw -= input.mouse.dx * 0.0022 * (this.game.settings.mouseSens || 1);
      this.pitch -= input.mouse.dy * 0.0022 * (this.game.settings.mouseSens || 1) * (this.game.settings.invertY ? -1 : 1);
      this.pitch = THREE.MathUtils.clamp(this.pitch, -1.45, 1.45);
    }
    const f = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const r = new THREE.Vector3(-f.z, 0, f.x);
    const wish = new THREE.Vector3();
    if (!frozen) {
      if (input.down('KeyW')) wish.add(f); if (input.down('KeyS')) wish.sub(f);
      if (input.down('KeyD')) wish.add(r); if (input.down('KeyA')) wish.sub(r);
    }
    const speed = input.down('ShiftLeft') ? 6.0 : 3.4;
    if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(speed);
    const k = this.onGround ? 12 : 2;
    this.vel.x += (wish.x - this.vel.x) * Math.min(1, k * dt);
    this.vel.z += (wish.z - this.vel.z) * Math.min(1, k * dt);
    this.vel.y -= 18 * dt;
    this.bob = this.onGround ? Math.min(1, Math.hypot(this.vel.x, this.vel.z) / 3.4) : 0;
    const steps = 3;
    for (let i = 0; i < steps; i++) this.collide(dt / steps);
    if (this.pos.y < -20) { const sp = this.markers.find(m => m.kind === 'spawn'); this.pos.copy(sp.pos); this.vel.set(0, 0, 0); }
  }

  collide(dt) {
    const r = this.radius;
    this.pos.addScaledVector(this.vel, dt);
    const seg = new THREE.Line3(new THREE.Vector3(this.pos.x, this.pos.y + r, this.pos.z), new THREE.Vector3(this.pos.x, this.pos.y + this.height - r, this.pos.z));
    const box = new THREE.Box3().setFromPoints([seg.start, seg.end]).expandByScalar(r);
    const tp = new THREE.Vector3(), cp = new THREE.Vector3();
    this.bvh.shapecast({
      intersectsBounds: b => b.intersectsBox(box),
      intersectsTriangle: tri => {
        const d = tri.closestPointToSegment(seg, tp, cp);
        if (d < r) {
          const depth = r - d;
          const dir = cp.sub(tp).normalize();
          seg.start.addScaledVector(dir, depth); seg.end.addScaledVector(dir, depth);
        }
      },
    });
    const np = new THREE.Vector3(seg.start.x, seg.start.y - r, seg.start.z);
    const delta = np.clone().sub(this.pos);
    this.onGround = delta.y > Math.abs(dt * this.vel.y * 0.25);
    const off = Math.max(0, delta.length() - 1e-5);
    delta.normalize().multiplyScalar(off);
    this.pos.add(delta);
    if (this.onGround) this.vel.y = 0;
    else if (off > 0) this.vel.addScaledVector(delta.normalize(), -delta.normalize().dot(this.vel));
  }

  interact() {
    let best = null, bd = 2.6;
    const eye = this.camera.position;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const g = this.game.state;
    for (const m of this.markers) {
      if (m.kind === 'spawn') continue;
      let p = m.pos.clone(); p.y += m.kind === 'npc' ? 1.2 : m.kind === 'door' ? 1.4 : 1.0;
      if (m.kind === 'ship' && this.shipModel) { p = this.shipModel.root.position.clone(); }
      const range = m.kind === 'ship' ? 14 : m.kind === 'band' ? 6 : bd;
      const to = p.clone().sub(eye); const d = to.length();
      if (d > range) continue;
      const dot = to.normalize().dot(fwd);
      if (dot < (m.kind === 'ship' ? 0.6 : 0.75)) continue;
      if (m.kind === 'npc' && !this.npcs.some(n => n.id === m.id)) continue;
      const score = d * (1.6 - dot);
      if (!best || score < best.score) best = { m, score };
    }
    const m = best?.m;
    const label = m ? this.labelFor(m) : '';
    this.promptEl.classList.toggle('hidden', !label);
    if (label) this.promptEl.innerHTML = `<b>[E]</b> ${label}`;
    if (m && input.hit('KeyE')) this.game.onInteract(this, m);
    if (input.hit('Tab') && this.game.state.location === 'cassini') this.game.toOverview();
  }

  labelFor(m) {
    const names = { mags: 'Mit Mags sprechen', kix: 'Mit Kix sprechen', oduya: 'Mit Femi Oduya sprechen', haendler: 'Mit Lenka sprechen', juno: 'Mit Juno sprechen' };
    if (m.kind === 'npc') return names[m.id] || 'Sprechen';
    if (m.kind === 'door') return m.label ? (m.id === 'bruecke' ? m.label : 'Zu: ' + m.label.replace(/[„“]/g, '')) : 'Tür';
    if (m.kind === 'ship') return this.game.launchShipRecord() ? `Einsteigen: ${this.game.launchShipRecord().name} · Start` : 'Kein Schiff';
    if (m.kind === 'band') return 'Roche-Grenze (live aus Kraken-Hafen)';
    return m.label || 'Benutzen';
  }

  dispose() {
    this.uiEl?.remove();
    input.unlock();
    this.envTex?.dispose();
  }
}
