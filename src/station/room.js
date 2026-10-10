import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { assets } from '../core/assets.js';
import { input } from '../core/input.js';
import { SkyLayer } from '../space/skyLayer.js';
import { zoneAnchor } from '../space/universe.js';
import { ShipModel } from '../space/shipModel.js';
import { NPC } from './npc.js';
import { DeckDoor, Lift } from './deck.js';
import { BARKS, PEOPLE } from '../game/story.js';

/*
 * Hochstation Cassini, Deck 4: one continuous, walkable level. Every room (Blender-baked GLB + lightmap)
 * is placed by the transform in assets/rooms/deck/meta.json and joined by the baked corridors of 'deck'.
 * Sliding doors and the glass lift to the observation dome are dynamic.
 */

const PARTS = ['bruecke', 'bar', 'kabine', 'hangar', 'aussicht', 'deck'];
const EXPOSURE = { kabine: 1.6, bruecke: 1.35, bar: 1.6, hangar: 1.4, aussicht: 5.0, deck: 1.5 };
const ROOM_NAMES = { bruecke: 'Kommandodeck', bar: 'Bar „Cassini-Spalt“', hangar: 'Hangar 7', kabine: 'Kabine 4-117', aussicht: 'Aussichtskuppel' };
// which parts can be seen from inside a part (the rest is hidden for speed)
const SEES = { bar: ['bar', 'deck', 'bruecke'], kabine: ['kabine', 'deck'], hangar: ['hangar', 'deck', 'bruecke'], aussicht: ['aussicht', 'deck'] };
const PATRONS = ['gast_kesh', 'gast_rana', 'gast_tomas', 'gast_ilse', 'crew_c', 'crew_e'];

const holoVert = `#include <common>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
varying vec3 vN; varying vec3 vV; varying vec3 vW;
void main(){
  #include <skinbase_vertex>
  #include <beginnormal_vertex>
  #include <skinnormal_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  vec4 w = modelMatrix * vec4(transformed,1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix)*objectNormal); vV = normalize(cameraPosition - w.xyz);
  gl_Position = projectionMatrix * viewMatrix * w;
  #include <logdepthbuf_vertex>
}`;
const holoFrag = `uniform vec3 color; uniform float time, flicker;
#include <logdepthbuf_pars_fragment>
varying vec3 vN; varying vec3 vV; varying vec3 vW;
void main(){
  #include <logdepthbuf_fragment>
  float f = pow(clamp(1.0 - abs(dot(normalize(vN), vV)), 0.0, 1.0), 1.8);
  float scan = 0.65 + 0.35 * sin(vW.y * 90.0 - time * 6.0);
  float band = smoothstep(0.0, 0.05, fract(vW.y * 1.3 - time * 0.4)) * 0.3 + 0.7;
  float fl = 1.0 - flicker * step(0.97, fract(sin(floor(time * 24.0)) * 43758.5));
  gl_FragColor = vec4(color * (0.22 + f * 1.5) * scan * band * fl, 1.0);
}`;

export function holoMaterial(color) {
  return new THREE.ShaderMaterial({ vertexShader: holoVert, fragmentShader: holoFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { color: { value: new THREE.Color(color) }, time: { value: 0 }, flicker: { value: 1 } } });
}

/** First-person walkable station deck with Blender-baked lighting. roomId = where the player starts. */
export class RoomMode {
  constructor(game, roomId = 'bruecke', spawnKey = 'default') {
    this.game = game;
    this.roomId = roomId;          // part the player is currently in (updated while walking)
    this.startRoom = roomId;
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
    this.walkers = [];
    this.doors = [];
    this.parts = {};
    this.time = 0;
    this.isRoom = true;
  }

  async init() {
    const deckMeta = await assets.getJSON('assets/rooms/deck/meta.json');
    this.deckMeta = deckMeta;
    const loaded = await Promise.all(PARTS.map(async id => {
      const dir = `assets/rooms/${id}`;
      const [gltf, meta, lm] = await Promise.all([assets.gltf(`${dir}/model.glb`), assets.getJSON(`${dir}/meta.json`), assets.texAsync(`${dir}/lightmap.jpg`)]);
      return { id, gltf, meta, lm };
    }));
    const colliders = [];
    this.markers = [];
    this.lightDefs = [];
    for (const { id, gltf, meta, lm } of loaded) {
      lm.flipY = false; lm.colorSpace = THREE.SRGBColorSpace; lm.anisotropy = 8;
      const root = gltf.scene.clone(true);
      const L = deckMeta.layout[id] || { pos: [0, 0, 0], rotY: 0 };
      root.position.fromArray(L.pos); root.rotation.y = L.rotY;
      root.updateMatrixWorld(true);
      const scale = (meta.lightScale || 2) * (EXPOSURE[id] || 1.4);
      root.traverse(o => {
        if (!o.isMesh) return;
        const n = o.name;
        if (n.startsWith('room')) {
          o.material = new THREE.MeshBasicMaterial({ map: lm, color: new THREE.Color(scale, scale, scale) });
          colliders.push(this.colliderGeo(o));
        } else if (n.startsWith('glow')) {
          const hex = o.userData.glow_color || '#ffffff';
          o.material = new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(n.includes('sign') || n.includes('emblem') ? 1.25 : n.includes('neon') ? 2.2 : 2.0), toneMapped: false });
        } else if (n.startsWith('glass') || /porthole|booth_glass|dome/.test(n)) {
          o.material = new THREE.MeshPhysicalMaterial({ color: 0x0a1218, roughness: 0.03, metalness: 0, transparent: true, opacity: 0.08, envMapIntensity: 0.18, depthWrite: false, side: THREE.DoubleSide });
          o.renderOrder = 5;
          if (!/dome/.test(n)) colliders.push(this.colliderGeo(o));
        } else if (n.startsWith('screen')) {
          this.setupScreen(o, n.replace('screen_', ''));
        } else if (n.startsWith('pic_')) {
          // framed prints on the walls: their own texture, not part of the lightmap
          const art = n.slice(4).split('_')[0];
          const t = assets.tex(`assets/art/${art}.jpg`); t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
          o.material = new THREE.MeshBasicMaterial({ map: t, color: new THREE.Color(0.82, 0.8, 0.78) });
        } else if (n.startsWith('field')) {
          o.visible = false;
        } else if (n.startsWith('hull')) {
          o.material = new THREE.MeshStandardMaterial({ color: 0x4a4e55, roughness: 0.55, metalness: 0.5 });
        }
      });
      this.scene.add(root);
      const toWorld = (p) => new THREE.Vector3(...p).applyMatrix4(root.matrixWorld);
      const dirWorld = (d) => new THREE.Vector3(...d).applyAxisAngle(new THREE.Vector3(0, 1, 0), L.rotY);
      for (const m of meta.markers || []) this.markers.push({ ...m, room: id, pos: toWorld(m.pos), dir: dirWorld(m.dir) });
      for (const l of meta.lights || []) this.lightDefs.push({ pos: toWorld(l.pos), color: new THREE.Color(l.color), energy: l.energy, room: id });
      this.parts[id] = { id, root, meta, toWorld, inv: root.matrixWorld.clone().invert() };
    }
    this.bvh = new MeshBVH(mergeGeometries(colliders, false));
    // dynamic lights: a fixed pool, re-aimed at the nearest baked light sources (no shader recompiles)
    this.scene.add(new THREE.HemisphereLight(0xffe8d0, 0x202028, 0.5));
    this.lightPool = Array.from({ length: 6 }, () => { const p = new THREE.PointLight(0xffffff, 0, 14, 2); this.scene.add(p); return p; });
    const sun = new THREE.DirectionalLight(0xfff2e0, 1.6); sun.position.set(-0.6, 0.5, -0.4); this.scene.add(sun);
    // sky outside the windows: the panorama windows look north (-Z), a little past Saturn
    this.sky = new SkyLayer();
    const anchor = zoneAnchor('rhea');
    this.sky.setOrigin(...anchor);
    const toSat = new THREE.Vector3(-anchor[0], -anchor[1], -anchor[2]).normalize();
    const look = toSat.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.32));
    this.spaceQ = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), look);
    // the cabin window faces the other way: give it its own view with Saturn slowly drifting past (the ring turns)
    const kab = this.parts.kabine;
    if (kab?.meta.window_dir) {
      this.kabWin = new THREE.Vector3(...kab.meta.window_dir).applyAxisAngle(new THREE.Vector3(0, 1, 0), deckMeta.layout.kabine?.rotY || 0).normalize();
      this.kabLook = toSat.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -0.22).add(new THREE.Vector3(0, -0.08, 0)).normalize();
      this.spaceQK = new THREE.Quaternion();
    }
    // doors and lift
    for (const d of deckMeta.doors || []) this.doors.push(new DeckDoor(d, this.scene, this.game.audio));
    if (deckMeta.lift) this.lift = new Lift(deckMeta.lift, this.scene, this.doors.filter(d => d.kind === 'lift'), this.game.audio);
    // spawn
    const sp = this.findSpawn(this.startRoom, this.spawnKey);
    this.pos.copy(sp.pos);
    this.yaw = Math.atan2(-sp.dir.x, -sp.dir.z);
    if (this.lift && this.startRoom === 'aussicht') this.lift.snap(1);
    this.roomId = null;
    this.updateRoom(true);
    this.roomEnvs();
    await this.populate();
    this.game.renderer.setLayers(this.sky, { scene: this.scene, camera: this.camera });
    this.ui();
  }

  colliderGeo(o) {
    o.updateMatrixWorld(true);
    const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld);
    for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k);
    return g.index ? g.toNonIndexed() : g;
  }

  findSpawn(room, key) {
    const ms = this.markers.filter(m => m.kind === 'spawn' && m.room === room);
    return ms.find(m => m.id === key) || ms.find(m => m.id === 'default') || this.markers.find(m => m.kind === 'spawn');
  }

  /** Which part contains a world position (interior bounds from each room's meta). */
  partAt(p) {
    for (const id of ['kabine', 'bar', 'hangar', 'aussicht', 'bruecke']) {
      const P = this.parts[id]; if (!P) continue;
      const it = P.meta.interior; if (!it) continue;
      const l = p.clone().applyMatrix4(P.inv);
      const bx = l.x, by = -l.z, bz = l.y;
      if (it[0] === 'box') {
        const [, x0, x1, y0, y1, z0, z1] = it;
        if (bx > x0 - 0.05 && bx < x1 + 0.05 && by > y0 - 0.05 && by < y1 + 0.05 && bz > z0 - 0.5 && bz < z1) return id;
      } else if (it[0] === 'dome') {
        if (Math.hypot(bx, by) < it[1] && bz > it[2] - 0.5 && bz < it[1]) return id;
      }
    }
    return 'deck';
  }

  updateRoom(force = false) {
    const id = this.partAt(this.pos);
    if (id === this.roomId && !force) return;
    const prev = this.roomId;
    this.roomId = id;
    const sees = SEES[id] || PARTS;
    for (const [pid, P] of Object.entries(this.parts)) P.root.visible = sees.includes(pid);
    for (const n of this.npcs) { n.obj.visible = sees.includes(n.room); if (n.extra) n.extra.visible = n.obj.visible; }
    if (this.envs) this.scene.environment = this.envs[id] || this.envs.bruecke;
    if (this.labelEl) this.labelEl.textContent = this.areaName();
    if (id === 'bar') this.game.audio?.setMusic('jazz', { pos: (this.markers.find(m => m.kind === 'band')?.pos || new THREE.Vector3()).toArray() });
    else if (id === 'aussicht') this.game.audio?.setMusic('dome');
    else if (prev === 'bar' || prev === 'aussicht' || prev === null) this.game.audio?.setMusic('station');
    if (!force) this.game.checkStationEvents?.();
  }

  areaName() {
    if (this.roomId !== 'deck') return ROOM_NAMES[this.roomId] || '';
    const p = this.pos;
    if (p.x < -2) return 'Ringgang · Deck 4';
    if (p.z > -1) return 'Zugang Hangar 7';
    return 'Lift-Lobby · Aussichtskuppel';
  }

  roomEnvs() {
    const r = this.game.renderer.gl;
    const pm = new THREE.PMREMGenerator(r);
    this.envs = {};
    const vis = Object.values(this.parts).map(P => [P, P.root.visible]);
    for (const P of Object.values(this.parts)) P.root.visible = true;
    for (const id of PARTS) {
      const sp = this.markers.find(m => m.kind === 'spawn' && m.room === id && m.id === 'default');
      if (!sp) continue;
      const rt = new THREE.WebGLCubeRenderTarget(64, { type: THREE.HalfFloatType });
      const cc = new THREE.CubeCamera(0.1, 200, rt);
      cc.position.copy(sp.pos); cc.position.y += 1.6;
      this.scene.add(cc); cc.update(r, this.scene); this.scene.remove(cc);
      this.envs[id] = pm.fromCubemap(rt.texture).texture;
      rt.dispose();
    }
    pm.dispose();
    for (const [P, v] of vis) P.root.visible = v;
    this.scene.environment = this.envs[this.roomId] || this.envs.bruecke;
  }

  async populate() {
    const g = this.game.state;
    const add = async (id, m, opts = {}) => {
      try {
        const n = await NPC.create(id, { seated: m.seated, ...opts });
        n.root.position.copy(m.pos);
        n.root.rotation.y = Math.atan2(m.dir.x, m.dir.z);
        this.scene.add(n.root);
        const rec = { id, obj: n.root, base: n.root.position.clone(), npc: n, room: m.room, marker: m };
        this.npcs.push(rec);
        return rec;
      } catch (e) { console.warn('NPC', id, e); return null; }
    };
    const jobs = [];
    let patron = 0;
    for (const m of this.markers) {
      if (m.kind === 'npc') {
        if (m.id === 'mags' && (g.flags['accepted:eisfracht'] && !g.flags.m1done)) continue;
        if (m.id === 'mags' && g.flags.m3done && !g.flags.m4rescued) continue;
        if (m.id === 'kix') { jobs.push(this.addKix(m)); continue; }
        jobs.push(add(m.id, m, { clip: m.id === 'oduya' ? 'idle' : m.id === 'haendler' ? 'fold' : undefined }).then(rec => {
          if (rec && m.id === 'mags' && g.flags.m4rescued && !g.flags.m5done) {
            const jm = { ...m, seated: false, pos: m.pos.clone().add(new THREE.Vector3(1.1, 0, 0.4)), dir: m.dir.clone() };
            return add('juno', jm, { clip: 'fold' });
          }
        }));
      } else if (m.kind === 'patron') {
        const id = PATRONS[patron++ % PATRONS.length];
        jobs.push(add(id, m, m.seated ? { clip: Math.random() < 0.5 ? 'sit_talk' : 'sit', talkClip: 'sit_talk' } : { clip: Math.random() < 0.5 ? 'drink' : 'rail', talkClip: 'talk' }));
      } else if (m.kind === 'crew') {
        if (m.id === 'hc0') continue;   // old spot of Yara (before her workshop), still in older deck bakes
        jobs.push(add(m.id === 'yara' ? 'crew_d' : 'crew_b', m, m.seated ? { clip: 'sit' } : m.id === 'yara' ? { clip: 'fold' } : { clip: 'phone' })
          .then(r => { if (r && m.id === 'yara') r.obj.rotation.y += Math.PI; }));   // Yara turns from her bench to the visitor
      } else if (m.kind === 'band') {
        jobs.push(this.addBand(m));
      }
    }
    // a crew member walking the Ringgang
    const path = this.markers.filter(m => m.kind === 'walk').map(m => m.pos);
    if (path.length > 1) {
      jobs.push(add('crew_a', { pos: path[0].clone(), dir: new THREE.Vector3(1, 0, 0), room: 'deck' }, { clip: 'walk', speed: 1 }).then(rec => {
        if (rec) { rec.walk = { path, i: 1, dir: 1, speed: 1.25 }; this.walkers.push(rec); }
      }));
    }
    const holo = this.parts.bruecke?.meta.holo;
    if (holo) this.holoTable(this.parts.bruecke.toWorld(holo));
    const pad = this.parts.hangar?.meta.pad;
    if (pad) {
      const ship = this.game.launchShipRecord();
      const hRot = this.deckMeta.layout.hangar.rotY;
      if (ship) jobs.push(this.parkShip(ship.cls, ship.paint, this.parts.hangar.toWorld(pad), -Math.PI / 2 + hRot).then(m => { this.shipModel = m; }));
      // Teo's old Spacewing waits in a corner until Mags gives it away
      const g = this.game.state;
      if (!g.flags.m1done && ship?.cls !== 'spacewing') jobs.push(this.parkShip('spacewing', null, this.parts.hangar.toWorld([-13, 0, 4]), hRot + 0.15));
    }
    await Promise.all(jobs);
    const sees = SEES[this.roomId] || PARTS;
    for (const n of this.npcs) { n.obj.visible = sees.includes(n.room); if (n.extra) n.extra.visible = n.obj.visible; }
  }

  /** A parked ship model in the hangar, with a box collider so nobody walks into it. */
  async parkShip(cls, paint, pos, rotY) {
    const model = await ShipModel.load(cls, { paint, engineColor: '#7fb6ff' }).catch(() => null);
    if (!model) return null;
    const box = new THREE.Box3().setFromObject(model.root);
    model.root.position.copy(pos).add(new THREE.Vector3(0, -box.min.y + 0.3, 0));
    model.root.rotation.y = rotY;
    for (const pl of model.plumes) pl.visible = false;
    for (const gl of model.glows) if (gl.engine) gl.mesh.material.color.copy(gl.base).multiplyScalar(0.06);
    this.parts.hangar.root.attach(model.root);
    model.root.updateMatrixWorld(true);
    (this.shipBoxes ||= []).push({ box, inv: model.root.matrixWorld.clone().invert(), m: model.root.matrixWorld.clone() });
    return model;
  }

  /** Push a standing capsule out of the parked ships' boxes (in the ship's own frame, horizontally). */
  pushOutShips(np, r) {
    for (const s of this.shipBoxes || []) {
      const l = np.clone().applyMatrix4(s.inv), b = s.box;
      if (l.y > b.max.y || l.y + this.height < b.min.y) continue;
      const dx0 = l.x - (b.min.x - r), dx1 = (b.max.x + r) - l.x, dz0 = l.z - (b.min.z - r), dz1 = (b.max.z + r) - l.z;
      if (dx0 <= 0 || dx1 <= 0 || dz0 <= 0 || dz1 <= 0) continue;
      const m = Math.min(dx0, dx1, dz0, dz1);
      if (m === dx0) l.x -= dx0; else if (m === dx1) l.x += dx1; else if (m === dz0) l.z -= dz0; else l.z += dz1;
      np.copy(l.applyMatrix4(s.m));
    }
  }

  async addKix(m) {
    // Kix is a robot: the stylised model stays (no human asset needed)
    const root = await assets.gltf('assets/npcs/model.glb').catch(() => null);
    const src = root?.scene.getObjectByName('kix');
    if (!src) return;
    const o = src.clone(true);
    o.position.copy(m.pos); o.rotation.set(0, Math.atan2(m.dir.x, m.dir.z), 0);
    this.scene.add(o);
    this.npcs.push({ id: 'kix', obj: o, base: o.position.clone(), room: m.room, marker: m, robot: true });
  }

  async addBand(m) {
    const colors = ['#5fd8ff', '#ff6ad8', '#9f8aff'];
    const cast = [['band_bass', 'idle'], ['band_sax', 'talk'], ['band_keys', 'keys']];
    await Promise.all(cast.map(async ([id, clip], i) => {
      const n = await NPC.create(id, { clip, speed: i === 0 ? 0.8 : 1 }).catch(() => null);
      if (!n) return;
      const mat = holoMaterial(colors[i]);
      n.override(mat);
      const a = -0.9 + i * 0.9;
      n.root.position.copy(m.pos).add(new THREE.Vector3(Math.sin(a) * 1.3, 0, Math.cos(a) * 1.3 - 0.4));
      n.root.rotation.y = Math.atan2(m.dir.x, m.dir.z) + (i - 1) * 0.25;
      this.scene.add(n.root);
      // simple holographic instruments
      const inst = new THREE.Group(); inst.position.copy(n.root.position); inst.rotation.y = n.root.rotation.y;
      if (id === 'band_bass') {
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.85, 0.2), mat); body.position.set(0.32, 0.7, 0.28); body.rotation.z = -0.15; inst.add(body);
        const neck = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.95, 0.04), mat); neck.position.set(0.24, 1.55, 0.28); neck.rotation.z = -0.15; inst.add(neck);
      } else if (id === 'band_keys') {
        const keys = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.07, 0.32), mat); keys.position.set(0, 0.98, 0.5); inst.add(keys);
        const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.95), mat); stand.position.set(0, 0.48, 0.5); inst.add(stand);
      } else {
        const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.5), mat); stand.position.set(0, 0.75, 0.38); inst.add(stand);
        const mic = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 8), mat); mic.position.set(0, 1.52, 0.33); inst.add(mic);
      }
      this.scene.add(inst);
      this.npcs.push({ id, obj: n.root, base: n.root.position.clone(), npc: n, room: m.room, marker: m, holo: true, extra: inst });
      this.animated.push({ kind: 'band', mat });
    }));
    const light = new THREE.PointLight(0xc080ff, 6, 8, 2); light.position.copy(m.pos).add(new THREE.Vector3(0, 2, 0)); this.scene.add(light);
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
    for (let i = 0; i < 5; i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), holoMaterial('#7fd4ff'));
      m.userData = { r: 0.95 + i * 0.14, s: 0.6 / (1 + i * 0.6), a: i * 1.3 };
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
    this.screens.push({ c, tex, kind, t: Math.random() * 2 });
    this.drawScreen(this.screens[this.screens.length - 1]);
  }

  drawScreen(s) {
    const g = this.game.state, x = s.c.getContext('2d');
    const W = 1024, H = 540;
    x.fillStyle = '#04121c'; x.fillRect(0, 0, W, H);
    x.strokeStyle = 'rgba(120,200,255,.35)'; x.strokeRect(12, 12, W - 24, H - 24);
    x.fillStyle = '#7fd4ff'; x.font = '600 44px Rajdhani, sans-serif';
    const title = { boerse: 'SÖLDNERBÖRSE · AKTUELLE AUFTRÄGE', werft: 'WERFT & MARKT · LENKA BRANDVOLD', kabine: 'KABINE 4-117 · ' + (g.apartments?.cassini ? 'EIGENTUM' : 'MIETE BEZAHLT') }[s.kind] || 'CASSINI';
    x.fillText(title, 36, 70);
    x.font = '30px Barlow, sans-serif'; x.fillStyle = '#d8e6ef';
    let lines = [];
    if (s.kind === 'boerse') {
      const jobs = (g.jobBoard.cassini?.jobs) || [];
      lines = jobs.slice(0, 7).map(j => `${j.title.slice(0, 44)}  ·  ${j.pay.toLocaleString('de-DE')} Cr`);
      if (!lines.length) lines = ['Neue Aufträge am Terminal abrufen.'];
    } else if (s.kind === 'werft') {
      lines = ['Kestrel K-9 ........ 145.000 Cr', 'Mule MT-3 ........... 95.000 Cr', 'Corsair HG-4 ....... 320.000 Cr', 'Sprungtriebwerke ab 2.500 Cr', 'Mods & Lack: Werkstatt Hangar 7', g.flags.zoll ? 'Helium-3: +25 % wegen Saturnzoll' : 'Helium-3: Normalpreis'];
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
    this.uiEl.innerHTML = `<div class="crosshair"></div><div class="roomlabel"></div><div class="roomprompt hidden"></div><div class="clicktoplay" style="background:none"></div><div class="roomsub"></div>`;
    this.uiEl.style.cssText = 'position:fixed;inset:0;pointer-events:none';
    root.appendChild(this.uiEl);
    this.labelEl = this.uiEl.querySelector('.roomlabel');
    this.labelEl.textContent = this.areaName();
    this.promptEl = this.uiEl.querySelector('.roomprompt');
    this.subEl = this.uiEl.querySelector('.roomsub');
    this.ctp = this.uiEl.querySelector('.clicktoplay');
    this.ctp.style.pointerEvents = 'auto';
    this.ctp.onclick = () => { input.lock(this.game.renderer.gl.domElement); };
    this.uiEl.appendChild(this.game.ui.topbar());
  }

  // ------------------------------------------------------------------ update
  update(dt) {
    this.time += dt;
    const modal = this.game.ui.modalOpen || this.game.ui.dlg;
    this.ctp.classList.toggle('hidden', input.locked || !!modal);
    if (!modal && input.locked) this.move(dt); else { this.vel.x = 0; this.vel.z = 0; this.move(dt, true); }
    this.camera.position.set(this.pos.x, this.pos.y + this.height - 0.12 + Math.sin(this.time * 9) * this.bob * 0.025, this.pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    let sq = this.spaceQ;
    if (this.roomId === 'kabine' && this.spaceQK) {
      const drift = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.sin(this.time * Math.PI * 2 / 150) * 0.28);
      sq = this.spaceQK.setFromUnitVectors(this.kabWin, this.kabLook).multiply(drift);
    }
    this.sky.camera.quaternion.copy(sq).multiply(this.camera.quaternion);
    this.sky.camera.fov = this.camera.fov; this.sky.camera.aspect = this.camera.aspect; this.sky.camera.updateProjectionMatrix();
    this.sky.update(dt);
    this.updateRoom();
    const actors = [this.pos, ...this.walkers.map(w => w.obj.position)];
    for (const d of this.doors) d.update(dt, actors, this.lift);
    this.lift?.update(dt);
    // light pool follows the player
    this._lt = (this._lt || 0) - dt;
    if (this._lt <= 0) {
      this._lt = 0.25;
      const near = this.lightDefs.map(l => [l, l.pos.distanceToSquared(this.pos)]).sort((a, b) => a[1] - b[1]).slice(0, this.lightPool.length);
      this.lightPool.forEach((p, i) => {
        const l = near[i]?.[0];
        if (!l) { p.intensity = 0; return; }
        p.position.copy(l.pos); p.color.copy(l.color); p.intensity = Math.min(40, l.energy * 0.12);
      });
    }
    for (const a of this.animated) {
      if (a.kind === 'band') a.mat.uniforms.time.value = this.time;
      else if (a.kind === 'holo') {
        a.mats.forEach(m => m.uniforms.time.value = this.time);
        a.sat.rotation.y += dt * 0.3; a.ring.rotation.z += dt * 0.05;
        a.moons.forEach(m => { m.userData.a += dt * m.userData.s; m.position.set(Math.cos(m.userData.a) * m.userData.r, Math.sin(m.userData.a) * m.userData.r * 0.34, Math.sin(m.userData.a) * m.userData.r * 0.94); });
      }
    }
    for (const w of this.walkers) this.walk(w, dt);
    for (const n of this.npcs) {
      if (!n.obj.visible) continue;
      if (n.npc) n.npc.update(dt, n.holo ? null : this.camera.position);
      else n.obj.position.y = n.base.y + Math.sin(this.time * 1.4 + n.base.x) * 0.006;
    }
    if (this.screens) for (const s of this.screens) { s.t += dt; if (s.t > 2) { s.t = 0; this.drawScreen(s); } }
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    this.game.audio?.setListener(this.camera.position, fwd, new THREE.Vector3(0, 1, 0));
    if (!modal) { this.interact(); this.barks(dt); }
  }

  /** Crew walking a marker path; stops and looks at the player when close. */
  walk(w, dt) {
    const W = w.walk, o = w.obj;
    const near = o.position.distanceTo(this.pos) < 1.6 || w.talking;
    if (near) { if (!W.stopped) { W.stopped = true; w.npc.play(w.talking ? 'talk' : 'idle', 0.4); } return; }
    if (W.stopped) { W.stopped = false; w.npc.play('walk', 0.4); }
    const tgt = W.path[W.i];
    const to = tgt.clone().sub(o.position); to.y = 0;
    const d = to.length();
    if (d < 0.3) {
      if (W.i + W.dir < 0 || W.i + W.dir >= W.path.length) W.dir *= -1;
      W.i += W.dir;
      return;
    }
    const want = Math.atan2(to.x, to.z);
    let da = want - o.rotation.y; da = Math.atan2(Math.sin(da), Math.cos(da));
    o.rotation.y += da * Math.min(1, dt * 4);
    if (Math.abs(da) < 0.6) o.position.addScaledVector(to.normalize(), Math.min(d, W.speed * dt));
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
    if (this.pos.y < -20) { const sp = this.findSpawn('bruecke', 'default'); this.pos.copy(sp.pos); this.vel.set(0, 0, 0); }
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
    // closed doors and the lift are dynamic colliders
    for (const d of this.doors) d.pushOut(np, r, this.height);
    this.pushOutShips(np, r);
    const liftGround = this.lift ? this.lift.carry(np, r) : false;
    const delta = np.clone().sub(this.pos);
    this.onGround = liftGround || delta.y > Math.abs(dt * this.vel.y * 0.25);
    const off = Math.max(0, delta.length() - 1e-5);
    delta.normalize().multiplyScalar(off);
    this.pos.add(delta);
    if (this.onGround) this.vel.y = 0;
    else if (off > 0) this.vel.addScaledVector(delta.normalize(), -delta.normalize().dot(this.vel));
  }

  interact() {
    let best = null;
    const eye = this.camera.position;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const consider = (m, p, range, minDot) => {
      const to = p.clone().sub(eye); const d = to.length();
      if (d > range) return;
      const dot = to.normalize().dot(fwd);
      if (dot < minDot) return;
      const score = d * (1.6 - dot);
      if (!best || score < best.score) best = { m, score };
    };
    for (const m of this.markers) {
      if (!['npc', 'terminal', 'ship', 'band'].includes(m.kind)) continue;
      let p = m.pos.clone(); p.y += m.kind === 'npc' ? (m.seated ? 0.9 : 1.2) : 1.0;
      if (m.kind === 'ship' && this.shipModel) p = this.shipModel.root.getWorldPosition(new THREE.Vector3());
      if (m.kind === 'npc' && !this.npcs.some(n => n.id === m.id)) continue;
      consider(m, p, m.kind === 'ship' ? 14 : m.kind === 'band' ? 6 : 2.6, m.kind === 'ship' ? 0.6 : 0.75);
    }
    for (const n of this.npcs) {
      if (n.holo || n.marker?.kind === 'npc' || !n.obj.visible) continue;
      const p = n.obj.position.clone(); p.y += n.marker?.seated ? 0.9 : 1.3;
      consider({ kind: 'person', id: n.id }, p, 2.4, 0.8);
    }
    if (this.lift) {
      const lm = this.lift.marker(this.pos);
      if (lm) consider(lm, lm.pos, 3.4, 0.2);
    }
    const m = best?.m;
    const label = m ? this.labelFor(m) : '';
    this.promptEl.classList.toggle('hidden', !label);
    if (label) this.promptEl.innerHTML = `<b>[E]</b> ${label}`;
    if (m && input.hit('KeyE')) {
      if (m.kind === 'lift') this.lift.call(m.level);
      else this.game.onInteract(this, m);
    }
    if (input.hit('Tab')) this.game.toOverview();
  }

  /** People say something when you stop right in front of them and look at them. */
  barks(dt) {
    this.barkCd = (this.barkCd || 0) - dt;
    if (this.subT > 0 && (this.subT -= dt) <= 0) this.subEl.classList.remove('on');
    if (this.barkCd > 0) return;
    const eye = this.camera.position, fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    for (const n of this.npcs) {
      const lines = BARKS[n.id];
      if (!lines || n.holo || n.talking || !n.obj.visible || (n.barkAt && this.time - n.barkAt < 45)) continue;
      const head = n.obj.position.clone(); head.y += n.marker?.seated ? 1.0 : 1.5;
      const to = head.clone().sub(eye), d = Math.hypot(to.x, to.z);
      if (d > 2.4 || to.normalize().dot(fwd) < 0.82) continue;
      n.barkAt = this.time; this.barkCd = 6;
      let i = Math.floor(Math.random() * lines.length);
      if (lines.length > 1 && i === n.lastBark) i = (i + 1) % lines.length;
      n.lastBark = i;
      const text = lines[i], A = this.game.audio, name = this.game.state?.callsign;
      const vl = A?.voiceLength?.(text, name) || 0;
      if (vl) A.speak(text, { name });
      const who = PEOPLE[n.id]?.name || '';
      this.subEl.innerHTML = `<b style="color:${PEOPLE[n.id]?.color || '#9fd6ff'}">${who}</b> ${text}`;
      this.subEl.classList.add('on');
      this.subT = Math.max(2.8, vl + 0.8);
      if (n.npc && !n.walk) { n.npc.setTalking(true); setTimeout(() => { if (!n.talking) n.npc.setTalking(false); }, this.subT * 1000); }
      return;
    }
  }

  /** NPC switches to its talking clip during a conversation. */
  setTalking(id, on) {
    const n = this.npcs.find(x => x.id === id);
    if (!n?.npc) return;
    n.talking = on;
    if (!n.walk) n.npc.setTalking(on);
  }

  labelFor(m) {
    const names = { mags: 'Mit Mags sprechen', oduya: 'Mit Femi Oduya sprechen', haendler: 'Mit Lenka sprechen', juno: 'Mit Juno sprechen', kix: 'Mit Kix sprechen' };
    if (m.kind === 'npc') return names[m.id] || 'Sprechen';
    if (m.kind === 'person') return 'Ansprechen';
    if (m.kind === 'lift') return m.label;
    if (m.kind === 'ship') { const r = this.game.launchShipRecord(); return r ? `Einsteigen: ${r.name}${r.gunner ? ' · in den Kugelturm' : ' · Start'}` : 'Kein Schiff'; }
    if (m.kind === 'band') return '„Roche-Grenze“ (Hologramm, live aus Kraken-Hafen)';
    return m.label || 'Benutzen';
  }

  dispose() {
    this.uiEl?.remove();
    input.unlock();
    for (const e of Object.values(this.envs || {})) e.dispose();
    for (const n of this.npcs) n.npc?.dispose();
  }
}
