import * as THREE from 'three';
import { ShipModel } from '../space/shipModel.js';
import { NPC } from './npc.js';

/*
 * Hangar 7 at work: visiting ships on the other pads that take off and land, their pilots standing by,
 * technicians walking their rounds, an astromech-style maintenance droid and small floor droids scurrying about.
 * Everything is placed in the hangar's own frame (three.js local coordinates of the hangar part).
 */

const VISITORS = [['kestrel', '#2f6fd1'], ['mule', null], ['corsair', '#c8352a'], ['kreuzschnabel', null], ['gabelweihe', null], ['mule', '#4f8a52'], ['lanze', '#d1a23a'], ['kestrel', null]];
const PILOTS = ['crew_c', 'crew_e', 'gast_tomas', 'gast_rana'];
const BAY_X = 58, OUTSIDE_X = 95, FLOOR = 0.2;

const rnd = (a, b) => a + Math.random() * (b - a);
const smooth = (k) => k * k * (3 - 2 * k);

export class HangarLife {
  constructor(room) {
    this.room = room;
    this.H = room.parts.hangar;
    this.pads = (this.H.meta.pads || []).slice(1).map((p, i) => ({ i: i + 1, pos: new THREE.Vector3(...p), ship: null, wait: rnd(10, 40) }));
    this.droids = [];
    this.flyers = [];
  }

  /** hangar-local -> world */
  w(x, y, z) { return this.H.toWorld([x, y, z]); }

  async init() {
    const jobs = [];
    // two of the three visitor pads start occupied
    this.pads.forEach((pad, k) => { if (k < 2) jobs.push(this.parkVisitor(pad, true)); });
    // technicians on their rounds (walkers use the room's walking code)
    const rounds = [
      [[-8, 0, 6], [14, 0, 6], [14, 0, 20], [30, 0, 20], [30, 0, 8], [48, 0, 12]],
      [[-6, 0, -8], [20, 0, -8], [20, 0, 4], [34, 0, -12], [50, 0, -12]],
      [[-4, 0, 35], [0, 0, 30], [16, 0, 33], [36, 0, 34], [50, 0, 34]],
    ];
    const crew = ['crew_a', 'crew_b', 'crew_a'];
    rounds.forEach((r, k) => jobs.push(this.walker(crew[k], r.map(p => this.w(...p)), 1.0 + k * 0.15)));
    // droids
    jobs.push(this.droid('prop_droid', 0.7, [[-4, 9], [10, 14], [22, 6], [12, -6], [0, -10]]));
    jobs.push(this.droid('prop_droid', 0.6, [[28, 12], [52, 12], [52, 16], [30, 16]]));
    for (let k = 0; k < 3; k++) jobs.push(this.droid('prop_mousedroid', 2.4, null));
    await Promise.all(jobs);
  }

  // ------------------------------------------------------------------ people
  async npc(id, pos, yaw, clip) {
    const n = await NPC.create(id, { clip }).catch(() => null);
    if (!n) return null;
    n.root.position.copy(pos); n.root.rotation.y = yaw;
    this.room.scene.add(n.root);
    n.update(0, null);
    n.calibrate(pos.y, false, 0.5);
    const rec = { id, obj: n.root, base: n.root.position.clone(), npc: n, room: 'hangar' };
    this.room.npcs.push(rec);
    return rec;
  }

  async walker(id, path, speed) {
    const rec = await this.npc(id, path[0].clone(), 0, 'walk');
    if (rec) { rec.walk = { path, i: 1, dir: 1, speed }; this.room.walkers.push(rec); }
  }

  /** A pilot waiting by a parked ship (removed again when the ship leaves). */
  async pilotFor(pad) {
    const id = PILOTS[(pad.i + Math.floor(Math.random() * PILOTS.length)) % PILOTS.length];
    const a = rnd(0, Math.PI * 2);
    const local = pad.pos.clone().add(new THREE.Vector3(Math.cos(a) * 9.5, 0, Math.sin(a) * 9.5));
    const pos = this.w(local.x, 0, local.z);
    const look = this.w(pad.pos.x, 0, pad.pos.z);
    const rec = await this.npc(id, pos, Math.atan2(look.x - pos.x, look.z - pos.z), Math.random() < 0.5 ? 'phone' : 'idle');
    pad.pilot = rec;
  }

  dropPilot(pad) {
    const rec = pad.pilot; if (!rec) return;
    this.room.scene.remove(rec.obj);
    this.room.npcs = this.room.npcs.filter(n => n !== rec);
    rec.npc?.dispose?.();
    pad.pilot = null;
  }

  // ------------------------------------------------------------------ ships
  async loadShip() {
    const [cls, paint] = VISITORS[Math.floor(Math.random() * VISITORS.length)];
    const model = await ShipModel.load(cls, { paint, engineColor: '#9fd0ff' }).catch(() => null);
    if (!model) return null;
    const box = new THREE.Box3().setFromObject(model.root);
    model.lift = -box.min.y + 0.3;
    model.box = box;
    for (const pl of model.plumes) pl.visible = false;
    this.H.root.add(model.root);
    return model;
  }

  setEngines(model, on) {
    for (const pl of model.plumes) pl.visible = on;
    for (const gl of model.glows) if (gl.engine) gl.mesh.material.color.copy(gl.base).multiplyScalar(on ? 1 : 0.06);
  }

  /** Place a visiting ship on a pad, nose towards the hall (it came in through the bay), with a collision box. */
  async parkVisitor(pad, initial = false) {
    const m = await this.loadShip();
    if (!m) return;
    m.root.position.set(pad.pos.x, FLOOR + m.lift, pad.pos.z);
    m.root.rotation.y = Math.PI / 2 + rnd(-0.25, 0.25);
    this.setEngines(m, false);
    pad.ship = m; pad.state = 'parked'; pad.wait = initial ? rnd(25, 70) : rnd(40, 90);
    this.addBox(pad);
    this.pilotFor(pad);
  }

  addBox(pad) {
    const m = pad.ship; m.root.updateMatrixWorld(true);
    const local = new THREE.Box3().setFromObject(m.root).applyMatrix4(m.root.matrixWorld.clone().invert());
    pad.box = { box: local, inv: m.root.matrixWorld.clone().invert(), m: m.root.matrixWorld.clone() };
    (this.room.shipBoxes ||= []).push(pad.box);
  }

  removeBox(pad) {
    if (pad.box) this.room.shipBoxes = this.room.shipBoxes.filter(b => b !== pad.box);
    pad.box = null;
  }

  sound(local, vol) {
    const d = this.w(local.x, local.y, local.z).distanceTo(this.room.pos);
    const v = vol * Math.max(0, 1 - d / 90);
    if (v > 0.02) this.room.game.audio?.play?.('burn', v, 1.3);
  }

  updatePad(pad, dt) {
    pad.wait -= dt;
    const m = pad.ship;
    if (!m) {   // empty pad: a new ship comes in after a while
      if (pad.wait <= 0 && !pad.loading) {
        pad.loading = true;
        this.loadShip().then(s => {
          pad.loading = false; if (!s) { pad.wait = 20; return; }
          pad.ship = s; pad.state = 'arriving'; pad.t = 0;
          pad.from = new THREE.Vector3(OUTSIDE_X, 7, pad.pos.z * 0.6 + 11.5 * 0.4);
          s.root.position.copy(pad.from); s.root.rotation.y = Math.PI / 2;
          this.setEngines(s, true); this.sound(pad.from, 0.35);
        });
      }
      return;
    }
    if (pad.state === 'parked') {
      m.update(dt, 0, false);
      if (pad.wait <= 0) {
        pad.state = 'leaving'; pad.t = 0; this.removeBox(pad); this.dropPilot(pad);
        pad.yaw0 = m.root.rotation.y; this.setEngines(m, true); this.sound(pad.pos, 0.3);
      }
      return;
    }
    pad.t += dt;
    const t = pad.t, root = m.root;
    if (pad.state === 'arriving') {
      // fly in through the bay, brake over the pad, settle down
      const k = smooth(Math.min(1, t / 7));
      const above = new THREE.Vector3(pad.pos.x, FLOOR + m.lift + 3.5, pad.pos.z);
      root.position.lerpVectors(pad.from, above, k);
      root.rotation.z = Math.sin(k * Math.PI) * 0.08;
      if (t > 7) {
        const d = Math.min(1, (t - 7) / 2.5);
        root.position.y = above.y - 3.5 * smooth(d);
        if (d >= 1) { pad.state = 'parked'; pad.wait = rnd(40, 90); this.setEngines(m, false); root.rotation.z = 0; this.addBox(pad); this.pilotFor(pad); }
      }
      m.update(dt, t < 6 ? 0.6 : 0.2, false);
    } else if (pad.state === 'leaving') {
      // lift off, turn on the spot towards the bay, then accelerate out
      const lift = smooth(Math.min(1, t / 2)) * 3.5;
      const turn = smooth(THREE.MathUtils.clamp((t - 1.5) / 2.5, 0, 1));
      root.rotation.y = pad.yaw0 + (-Math.PI / 2 - pad.yaw0) * turn;
      const go = Math.max(0, t - 4);
      root.position.set(pad.pos.x + 3 * go * go + 4 * go, FLOOR + m.lift + lift, pad.pos.z + (11.5 - pad.pos.z) * smooth(Math.min(1, go / 3)) * 0.6);
      m.update(dt, go > 0 ? 1 : 0.3, go > 1.5);
      if (root.position.x > OUTSIDE_X) {
        this.H.root.remove(root);
        pad.ship = null; pad.state = null; pad.wait = rnd(15, 45);
      }
    }
  }

  // ------------------------------------------------------------------ droids
  async droid(kind, speed, route) {
    const m = await ShipModel.load(kind).catch(() => null);
    if (!m) return;
    const local = route ? new THREE.Vector3(route[0][0], 0, route[0][1]) : this.freeSpot();
    m.root.position.set(local.x, FLOOR, local.z);
    this.H.root.add(m.root);
    this.droids.push({ m, kind, speed, route, i: 1, target: route ? null : this.freeSpot(), pause: 0, t: Math.random() * 10 });
  }

  /** A random spot on the floor away from the pads and the workshop corner. */
  freeSpot() {
    for (let k = 0; k < 20; k++) {
      const p = new THREE.Vector3(rnd(-12, 54), 0, rnd(-14, 37));
      if (p.x < -8 && p.z < -10) continue;   // workshop
      if ([[2, 0], ...this.pads.map(pd => [pd.pos.x, pd.pos.z])].some(([x, z]) => Math.hypot(p.x - x, p.z - z) < 9.5)) continue;
      return p;
    }
    return new THREE.Vector3(12, 0, 12);
  }

  updateDroid(d, dt) {
    d.t += dt;
    const root = d.m.root;
    if (d.pause > 0) { d.pause -= dt; root.position.y = FLOOR + (d.kind === 'prop_droid' ? Math.abs(Math.sin(d.t * 3)) * 0.01 : 0); return; }
    const tgt = d.route ? new THREE.Vector3(d.route[d.i][0], 0, d.route[d.i][1]) : d.target;
    const to = tgt.clone().sub(root.position).setY(0);
    const dist = to.length();
    if (dist < 0.4) {
      if (d.route) { d.i = (d.i + 1) % d.route.length; d.pause = rnd(1.5, 5); }
      else { d.target = this.freeSpot(); d.pause = rnd(0.3, 2.5); }
      return;
    }
    // forward is -Z for these models (like the ships)
    const want = Math.atan2(-to.x, -to.z);
    let da = want - root.rotation.y; da = Math.atan2(Math.sin(da), Math.cos(da));
    root.rotation.y += da * Math.min(1, dt * (d.kind === 'prop_droid' ? 2.5 : 8));
    if (Math.abs(da) < 0.5) root.position.addScaledVector(to.normalize(), Math.min(dist, d.speed * dt));
    // the astromech waddles, the floor droids buzz
    root.rotation.z = d.kind === 'prop_droid' ? Math.sin(d.t * 6) * 0.04 : 0;
    root.position.y = FLOOR + (d.kind === 'prop_mousedroid' ? Math.abs(Math.sin(d.t * 30)) * 0.004 : 0);
    d.m.update(dt, 0, false);
  }

  update(dt) {
    for (const pad of this.pads) this.updatePad(pad, dt);
    for (const d of this.droids) this.updateDroid(d, dt);
  }
}
