import * as THREE from 'three';

/** Dynamic parts of the walkable deck: sliding doors and the glass lift up to the observation dome. */

const UP = new THREE.Vector3(0, 1, 0);

function hazardTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#c8901a'; x.fillRect(0, 0, 256, 256);
  x.fillStyle = '#1c1c1e';
  for (let i = -256; i < 512; i += 64) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i + 32, 0); x.lineTo(i + 32 - 256, 256); x.lineTo(i - 256, 256); x.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
let HAZ = null;

export class DeckDoor {
  constructor(d, scene, audio) {
    this.id = d.id; this.kind = d.kind; this.level = d.level; this.audio = audio; this.wanted = false;
    this.pos = new THREE.Vector3(...d.pos);
    this.normal = new THREE.Vector3(...d.normal).normalize();
    this.tan = new THREE.Vector3().crossVectors(UP, this.normal).normalize();
    this.w = d.w; this.h = d.h;
    this.open = 0;
    this.group = new THREE.Group();
    this.group.position.copy(this.pos);
    this.group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(this.tan, UP, this.normal));
    let mat;
    if (this.kind === 'lift') {
      mat = new THREE.MeshPhysicalMaterial({ color: 0x9fc8e8, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide });
    } else if (this.kind === 'heavy') {
      HAZ = HAZ || hazardTexture();
      const t = HAZ.clone(); t.needsUpdate = true; t.repeat.set(this.w / 2 / 1.2, this.h / 1.2);
      mat = new THREE.MeshStandardMaterial({ map: t, roughness: 0.6, metalness: 0.4 });
    } else {
      mat = new THREE.MeshStandardMaterial({ color: 0x6d7076, roughness: 0.42, metalness: 0.85 });
    }
    const strip = new THREE.MeshBasicMaterial({ color: new THREE.Color('#7fdcff').multiplyScalar(2), toneMapped: false });
    this.leaves = [-1, 1].map(s => {
      const g = new THREE.Group();
      const leaf = new THREE.Mesh(new THREE.BoxGeometry(this.w / 2 + 0.04, this.h, this.kind === 'lift' ? 0.03 : 0.09), mat);
      leaf.position.set(0, this.h / 2, 0);
      g.add(leaf);
      if (this.kind !== 'lift') {
        const led = new THREE.Mesh(new THREE.BoxGeometry(0.03, this.h * 0.6, 0.1), strip);
        led.position.set(-s * (this.w / 4 - 0.03), this.h / 2, 0);
        g.add(led);
      }
      this.group.add(g);
      return { g, s };
    });
    this.layout();
    scene.add(this.group);
  }

  layout() {
    const half = this.w / 4 + 0.02;
    for (const { g, s } of this.leaves) g.position.x = s * (half + this.open * (this.w / 2 - 0.02));
  }

  update(dt, actors, lift) {
    let want = false;
    for (const a of actors) {
      const dx = a.x - this.pos.x, dz = a.z - this.pos.z;
      if (dx * dx + dz * dz < (this.kind === 'heavy' ? 3.2 : 2.4) ** 2 && Math.abs(a.y - this.pos.y) < 2.2) { want = true; break; }
    }
    if (this.kind === 'lift' && lift && !lift.at(this.level)) want = false;
    const target = want ? 1 : 0;
    if (want !== this.wanted) { this.wanted = want; this.audio?.door?.(want, this.pos, this.kind === 'heavy'); }
    const sp = this.kind === 'heavy' ? 1.4 : 2.6;
    this.open += Math.sign(target - this.open) * Math.min(Math.abs(target - this.open), sp * dt);
    this.layout();
  }

  /** Keep a capsule (feet position np, radius r) out of the doorway while the door is (mostly) shut. */
  pushOut(np, r, height) {
    if (this.open > 0.72) return;
    const rel = np.clone().sub(this.pos);
    if (np.y > this.pos.y + this.h || np.y + height < this.pos.y) return;
    const lat = rel.dot(this.tan);
    if (Math.abs(lat) > this.w / 2 + r * 0.5) return;
    const dn = rel.dot(this.normal);
    const lim = r + 0.06;
    if (Math.abs(dn) >= lim) return;
    np.addScaledVector(this.normal, (dn >= 0 ? 1 : -1) * lim - dn);
  }
}

export class Lift {
  constructor(m, scene, doors, audio) {
    this.center = new THREE.Vector3(...m.pos);
    this.y0 = this.center.y + m.y0; this.y1 = this.center.y + m.y1;
    this.r = m.r;
    this.y = this.y0; this.level = 0; this.target = 0; this.moving = false;
    this.doors = doors;
    this.audio = audio;
    const plat = new THREE.Group();
    const deckMat = new THREE.MeshStandardMaterial({ color: 0x3a3e44, roughness: 0.5, metalness: 0.8 });
    const disk = new THREE.Mesh(new THREE.CylinderGeometry(this.r, this.r, 0.12, 48), deckMat);
    disk.position.y = -0.06; plat.add(disk);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(this.r - 0.06, 0.025, 8, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color('#7fdcff').multiplyScalar(2.5), toneMapped: false }));
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.01; plat.add(ring);
    const rail = new THREE.Mesh(new THREE.TorusGeometry(this.r - 0.05, 0.02, 6, 48, Math.PI * 1.25), deckMat);
    rail.rotation.x = Math.PI / 2; rail.rotation.z = -Math.PI * 0.125; rail.position.y = 1.0; plat.add(rail);
    this.light = new THREE.PointLight(0x9fd8ff, 3, 5, 2); this.light.position.y = 2.2; plat.add(this.light);
    plat.position.copy(this.center); plat.position.y = this.y;
    scene.add(plat);
    this.plat = plat;
  }

  levelY(l) { return l ? this.y1 : this.y0; }
  at(l) { return !this.moving && this.level === l; }
  snap(l) { this.level = this.target = l; this.y = this.levelY(l); this.moving = false; this.plat.position.y = this.y; }

  call(l) {
    if (this.moving) return;
    if (this.level === l) return;
    this.target = l; this.moving = true; this.wait = 0.7;   // doors close first
    this.audio?.blip?.();
  }

  update(dt) {
    if (!this.moving) return;
    if (this.wait > 0) { this.wait -= dt; return; }
    const goal = this.levelY(this.target);
    const d = goal - this.y;
    const v = Math.sign(d) * Math.min(Math.abs(d), dt * Math.min(3.2, 0.6 + Math.abs(d) * 1.2, 0.6 + Math.abs(this.y - this.levelY(this.level)) * 1.6));
    this.y += v;
    this.plat.position.y = this.y;
    if (Math.abs(goal - this.y) < 1e-3) { this.y = goal; this.level = this.target; this.moving = false; this.plat.position.y = this.y; }
  }

  /** Stand on the platform; keep people out of the open hole while the platform is elsewhere. */
  carry(np, r) {
    const dx = np.x - this.center.x, dz = np.z - this.center.z;
    const h = Math.hypot(dx, dz);
    if (h < this.r - 0.05 && np.y > this.y - 0.7 && np.y < this.y + 0.45) { np.y = this.y; return true; }
    const guard = 1.62 + r;
    if (h < guard && np.y > this.y1 - 1.2 && !(this.at(1)) && h > 1e-3) {
      np.x = this.center.x + dx / h * guard; np.z = this.center.z + dz / h * guard;
    }
    return false;
  }

  /** Interaction offered to the player at this position, or null. */
  marker(p) {
    const dx = p.x - this.center.x, dz = p.z - this.center.z;
    const h = Math.hypot(dx, dz);
    if (this.moving) return null;
    if (h < this.r && Math.abs(p.y - this.y) < 0.6) {
      const up = this.level === 0;
      return { kind: 'lift', level: up ? 1 : 0, label: up ? 'Lift: hinauf zur Aussichtskuppel' : 'Lift: hinab zu Deck 4', pos: new THREE.Vector3(this.center.x, this.y + 1.2, this.center.z) };
    }
    const lvl = Math.abs(p.y - this.y1) < 2 ? 1 : Math.abs(p.y - this.y0) < 2 ? 0 : -1;
    if (lvl >= 0 && h < 3.6 && this.level !== lvl) return { kind: 'lift', level: lvl, label: 'Lift rufen', pos: new THREE.Vector3(this.center.x, this.levelY(lvl) + 1.3, this.center.z) };
    return null;
  }
}
