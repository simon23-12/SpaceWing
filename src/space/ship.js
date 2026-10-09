import * as THREE from 'three';
import { ShipModel } from './shipModel.js';
import { SHIP_CLASSES, shipStats } from '../game/data.js';
import { makeShield } from './effects.js';

let NEXT_ID = 1;
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3();

export const HOSTILE = {
  schakale: ['player', 'kollektiv', 'konsortium', 'ringgilde', 'liga', 'cassini', 'neutral', 'archiv'],
};

export function hostile(a, b, overrides) {
  if (a === b) return false;
  if (overrides && (overrides.has(a + '>' + b) || overrides.has(b + '>' + a))) return true;
  return (HOSTILE[a] || []).includes(b) || (HOSTILE[b] || []).includes(a);
}

/** A ship in the flight scene. Physics in metres; forward = local -Z. */
export class Ship {
  static async create(opts) {
    const rec = opts.record || { cls: opts.cls, upgrades: opts.upgrades || {}, paint: opts.paint || null };
    const stats = shipStats(rec);
    const model = await ShipModel.load(rec.cls, { paint: rec.paint, engineColor: stats.engine, plumeRadius: stats.length / 28 });
    return new Ship(model, stats, rec, opts);
  }

  constructor(model, stats, record, opts) {
    this.id = NEXT_ID++;
    this.cls = record.cls;
    this.record = record;
    this.stats = stats;
    this.model = model;
    this.name = opts.name || stats.name;
    this.faction = opts.faction || 'neutral';
    this.isPlayer = !!opts.player;
    this.obj = new THREE.Group();
    this.obj.add(model.root);
    this.obj.position.copy(opts.pos || new THREE.Vector3());
    if (opts.quat) this.obj.quaternion.copy(opts.quat);
    this.vel = opts.vel ? opts.vel.clone() : new THREE.Vector3();
    this.angVel = new THREE.Vector3();
    this.input = { pitch: 0, yaw: 0, roll: 0, throttle: 0, boost: false, fire: false, strafeX: 0, strafeY: 0 };
    this.throttle = opts.throttle ?? 0;
    this.maxShield = stats.shield; this.maxHull = stats.hull;
    this.shield = stats.shield; this.hull = stats.hull * (record.hull ?? 1);
    this.energy = stats.energy; this.missiles = stats.missiles;
    this.radius = model.radius;
    this.hitRadius = Math.max(2.5, model.length * 0.42);
    this.alive = true;
    this.target = null;
    this.gunIdx = 0; this.fireCd = 0; this.turretCd = 0; this.missileCd = 0;
    this.lastHit = 0; this.lastShieldHit = -10; this.time = 0;
    this.ai = opts.ai || null;
    this.invulnerable = !!opts.invulnerable;
    this.tags = new Set(opts.tags || []);
    this.flightAssist = true;
    this.shieldMesh = makeShield(this.radius);
    this.obj.add(this.shieldMesh);
    this.autopilot = null;
  }

  get pos() { return this.obj.position; }
  get quat() { return this.obj.quaternion; }
  forward(out = new THREE.Vector3()) { return out.set(0, 0, -1).applyQuaternion(this.obj.quaternion); }
  up(out = new THREE.Vector3()) { return out.set(0, 1, 0).applyQuaternion(this.obj.quaternion); }
  right(out = new THREE.Vector3()) { return out.set(1, 0, 0).applyQuaternion(this.obj.quaternion); }
  speed() { return this.vel.length(); }

  integrate(dt) {
    this.time += dt;
    const s = this.stats, inp = this.input;
    // throttle follows input target
    this.throttle = THREE.MathUtils.clamp(inp.throttle, 0, 1);
    const boosting = inp.boost && this.energy > 5;
    if (boosting) this.energy -= dt * 22; else this.energy = Math.min(s.energy, this.energy + s.regen * dt * 0.6);
    // rotation
    const turn = s.turn * (boosting ? 0.75 : 1);
    const tgt = _v.set(inp.pitch * turn, inp.yaw * turn, inp.roll * turn * 1.4);
    const resp = 1 - Math.exp(-dt * 5);
    this.angVel.lerp(tgt, resp);
    _q.setFromEuler(_e.set(this.angVel.x * dt, this.angVel.y * dt, this.angVel.z * dt, 'XYZ'));
    this.obj.quaternion.multiply(_q).normalize();
    // translation with flight assist
    const fwd = this.forward(new THREE.Vector3());
    const vmax = boosting ? s.boost : s.speed;
    const desired = fwd.clone().multiplyScalar(this.throttle * vmax);
    if (inp.strafeX || inp.strafeY) {
      desired.addScaledVector(this.right(new THREE.Vector3()), inp.strafeX * s.speed * 0.35);
      desired.addScaledVector(this.up(new THREE.Vector3()), inp.strafeY * s.speed * 0.35);
    }
    const acc = s.accel * (boosting ? 2.2 : 1);
    if (this.flightAssist) {
      const dv = desired.sub(this.vel);
      const l = dv.length(), maxdv = acc * dt * (l > vmax * 0.6 ? 1.5 : 1);
      if (l > maxdv) dv.multiplyScalar(maxdv / l);
      this.vel.add(dv);
    } else {
      this.vel.addScaledVector(fwd, acc * this.throttle * dt);
    }
    this.obj.position.addScaledVector(this.vel, dt);
    // shields
    if (this.time - this.lastShieldHit > 3) this.shield = Math.min(this.maxShield, this.shield + this.maxShield * 0.06 * dt);
    this.fireCd -= dt; this.turretCd -= dt; this.missileCd -= dt;
    // shield flash decay
    const sm = this.shieldMesh;
    if (sm.userData.t > 0) {
      sm.userData.t -= dt * 3.5;
      sm.visible = sm.userData.t > 0;
      sm.material.uniforms.amount.value = Math.max(0, sm.userData.t);
    }
    this.model.update(dt, this.throttle * (this.vel.length() / Math.max(vmax, 1) * 0.5 + 0.5), boosting);
  }

  /** Apply damage; returns 'shield' | 'hull' | 'destroyed'. worldPoint optional for shield flash. */
  damage(n, worldPoint) {
    if (!this.alive || this.invulnerable) return 'shield';
    this.lastShieldHit = this.time;
    let res = 'shield';
    if (this.shield > 0) {
      const a = Math.min(this.shield, n);
      this.shield -= a; n -= a;
      if (worldPoint) {
        const local = this.obj.worldToLocal(worldPoint.clone());
        this.shieldMesh.material.uniforms.hit.value.copy(local).normalize();
        this.shieldMesh.userData.t = 1; this.shieldMesh.visible = true;
      }
    }
    if (n > 0) {
      this.hull -= n; res = 'hull';
      if (this.hull <= 0) { this.hull = 0; this.alive = false; res = 'destroyed'; }
    }
    this.lastHit = this.time;
    return res;
  }

  gunPositions() {
    const g = this.model.guns;
    if (!g.length) return [this.obj.localToWorld(new THREE.Vector3(0, 0, -this.radius * 0.6))];
    return g.map(o => o.getWorldPosition(new THREE.Vector3()));
  }
}
