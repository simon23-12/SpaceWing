import * as THREE from 'three';

const _v = new THREE.Vector3(), _l = new THREE.Vector3(), _q = new THREE.Quaternion();

/** Turn the ship's nose toward a world point. Returns angle (rad) between nose and target. */
export function steerTo(ship, point, rollToUp = true, gain = 2.2) {
  _q.copy(ship.quat).invert();
  _l.copy(point).sub(ship.pos).applyQuaternion(_q);   // target in ship-local coordinates
  const len = _l.length() || 1;
  const ang = Math.acos(THREE.MathUtils.clamp(-_l.z / len, -1, 1));
  // pitch: +y wants nose up; yaw: -x wants nose left (positive yaw)
  let pitch = Math.atan2(_l.y, -_l.z) * gain;
  let yaw = Math.atan2(-_l.x, -_l.z) * gain;
  if (_l.z > 0) { // behind: commit to a hard turn
    yaw = _l.x > 0 ? -1 : 1;
    pitch = _l.y > 0 ? 0.6 : -0.6;
  }
  ship.input.pitch = THREE.MathUtils.clamp(pitch, -1, 1);
  ship.input.yaw = THREE.MathUtils.clamp(yaw, -1, 1);
  // bank into turns a little, otherwise level out against the local "up"
  ship.input.roll = rollToUp ? THREE.MathUtils.clamp(-ship.input.yaw * 0.4 - _l.x / len * 0.6, -1, 1) * 0.6 : 0;
  return ang;
}

export function leadPoint(shooter, target, boltSpeed, out = new THREE.Vector3()) {
  const rel = _v.copy(target.pos).sub(shooter.pos);
  const dv = target.vel.clone().sub(shooter.vel);
  const t = rel.length() / boltSpeed;
  return out.copy(target.pos).addScaledVector(dv, t * 1.0);
}

/**
 * AI behaviours. ai = { mode: 'attack'|'escort'|'goto'|'idle'|'flee'|'patrol', ... }
 * flight provides: ships, hostileTo(ship), fire(ship), player, time
 */
export function updateAI(ship, flight, dt) {
  const ai = ship.ai;
  if (!ai) return;
  ai.t = (ai.t || 0) + dt;
  const inp = ship.input;
  inp.fire = false; inp.boost = false;

  // pick targets for aggressive ships
  if ((ai.mode === 'attack' || ai.mode === 'patrol' || ai.mode === 'escort') && (!ship.target || !ship.target.alive) && ai.aggressive !== false) {
    ship.target = flight.nearestHostile(ship, ai.aggroRange || 4000);
    if (ship.target && ai.mode === 'patrol') ai.mode = 'attack';
  }

  switch (ai.mode) {
    case 'attack': {
      const tgt = ship.target;
      if (!tgt || !tgt.alive) { ai.mode = ai.fallback || 'patrol'; inp.throttle = 0.5; break; }
      const dist = ship.pos.distanceTo(tgt.pos);
      if (ai.evadeT > 0) {
        ai.evadeT -= dt;
        steerTo(ship, ai.evadePt);
        inp.throttle = 1; inp.boost = dist < 400 && Math.random() < 0.5;
        break;
      }
      const lead = leadPoint(ship, tgt, 900);
      const ang = steerTo(ship, lead);
      inp.throttle = dist > 900 ? 1 : dist > 300 ? 0.75 : 0.45;
      inp.boost = dist > 2500;
      const skill = ai.skill ?? 0.6;
      if (ang < 0.05 + (1 - skill) * 0.03 && dist < 1200) inp.fire = true;
      // break off when too close or when hurt
      if (dist < 140 || (ship.time - ship.lastHit < 0.1 && Math.random() < 0.15 * (1 - skill * 0.5))) {
        ai.evadeT = 1.5 + Math.random() * 2;
        const r = new THREE.Vector3().randomDirection().multiplyScalar(900);
        ai.evadePt = ship.pos.clone().add(ship.forward(new THREE.Vector3()).multiplyScalar(600)).add(r);
      }
      if (ai.fleeAt && ship.hull / ship.maxHull < ai.fleeAt) ai.mode = 'flee';
      break;
    }
    case 'escort': {
      const lead = ai.leader;
      if (!lead || !lead.alive) { ai.mode = 'patrol'; break; }
      if (ship.target && ship.target.alive && ship.pos.distanceTo(ship.target.pos) < (ai.defendRange || 1800)) {
        const la = leadPoint(ship, ship.target, 900);
        const ang = steerTo(ship, la);
        inp.throttle = 0.8; if (ang < 0.07) inp.fire = true;
        break;
      }
      const slot = ai.offset.clone().applyQuaternion(lead.quat).add(lead.pos);
      const d = ship.pos.distanceTo(slot);
      const ahead = slot.clone().addScaledVector(lead.forward(new THREE.Vector3()), 300);
      steerTo(ship, d > 60 ? slot : ahead);
      const leadSpeed = lead.speed();
      inp.throttle = THREE.MathUtils.clamp((leadSpeed + d * 0.6) / ship.stats.speed, 0, 1);
      inp.boost = d > 1500;
      break;
    }
    case 'goto': {
      const d = ship.pos.distanceTo(ai.point);
      steerTo(ship, ai.point);
      inp.throttle = d > 400 ? (ai.throttle ?? 1) : THREE.MathUtils.clamp(d / 400, 0.1, 1) * (ai.throttle ?? 1);
      if (d < (ai.arrive || 120)) { if (ai.onArrive) ai.onArrive(ship); ai.mode = ai.then || 'idle'; }
      break;
    }
    case 'patrol': {
      if (!ai.point || ship.pos.distanceTo(ai.point) < 200 || ai.t > 25) {
        ai.t = 0;
        const c = ai.center || ship.pos;
        ai.point = c.clone().add(new THREE.Vector3().randomDirection().multiplyScalar(ai.radius || 1500));
      }
      steerTo(ship, ai.point);
      inp.throttle = 0.45;
      break;
    }
    case 'flee': {
      const away = ship.pos.clone().multiplyScalar(2).sub(flight.player ? flight.player.pos : new THREE.Vector3());
      steerTo(ship, away.add(new THREE.Vector3(0, 2000, 0)));
      inp.throttle = 1; inp.boost = true;
      if (ai.t > 12) flight.jumpOut(ship);
      break;
    }
    case 'idle':
    default:
      inp.pitch = inp.yaw = inp.roll = 0;
      inp.throttle = ai.throttle || 0;
  }
  if (inp.fire) flight.fireGuns(ship);
  // turrets on AI capital ships
  if (ship.stats.turret || ship.cls === 'korvette') flight.turretFire(ship, dt, ai.turretSkill ?? 0.5);
}
