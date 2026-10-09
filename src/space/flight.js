import * as THREE from 'three';
import { SkyLayer } from './skyLayer.js';
import { ZONES, zoneAnchor, BODIES, SATURN, travelInfo } from './universe.js';
import { Ship, hostile } from './ship.js';
import { updateAI, leadPoint, steerTo } from './ai.js';
import { Bolts, Explosions, SpaceDust, Particles, TEX } from './effects.js';
import { HUD } from './hud.js';
import { Station, bakedMaterial } from './station.js';
import { assets } from '../core/assets.js';
import { Debris } from './debris.js';
import { input } from '../core/input.js';
import { FACTIONS } from '../game/data.js';

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion();
const BOLT_SPEED = 900;

export class FlightMode {
  /**
   * opts: { zone, spawn: 'undock'|'arrive'|'pos', playerRecord, mission, from }
   */
  constructor(game, opts) {
    this.game = game;
    this.opts = opts;
    this.zoneId = opts.zone;
    this.zone = ZONES[opts.zone];
    this.anchor = zoneAnchor(opts.zone);
    this.sky = new SkyLayer();
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.25, 2e5);
    this.ships = [];
    this.waypoints = [];
    this.missiles = [];
    this.listeners = {};
    this.hostileOverrides = new Set();
    this.camMode = 'chase';
    this.stick = { x: 0, y: 0 };
    this.time = 0;
    this.lock = null;
    this.radarRange = 5000;
    this.state = 'flying';
    this.paused = false;
  }

  on(ev, fn) { (this.listeners[ev] ||= []).push(fn); }
  emit(ev, ...a) { for (const f of this.listeners[ev] || []) f(...a); }

  async init() {
    const sc = this.scene;
    // lighting: sun + Saturnshine + environment captured from the far layer
    this.sun = new THREE.DirectionalLight(0xfff1e0, 3.4);
    this.sun.position.copy(this.sky.sunDir).multiplyScalar(1000);
    sc.add(this.sun, this.sun.target);
    const toSat = new THREE.Vector3(-this.anchor[0], -this.anchor[1], -this.anchor[2]).normalize();
    this.satLight = new THREE.DirectionalLight(0xe8d2a8, 0.35);
    this.satLight.position.copy(toSat).multiplyScalar(1000);
    sc.add(this.satLight);
    sc.add(new THREE.AmbientLight(0x202430, 0.4));
    this.sky.setOrigin(...this.anchor);
    this.captureEnvironment();

    this.bolts = new Bolts(sc);
    this.fx = new Explosions(sc);
    this.trails = new Particles(sc, 2500, TEX.soft);
    this.dust = new SpaceDust(sc);

    // station
    if (this.zone.station) {
      this.station = await Station.load(this.zone.station);
      sc.add(this.station.root);
      if (!this.zone.hostile) this.addWaypoint('dock', this.station.dock.pos.clone().addScaledVector(this.station.dock.dir, 300), 'Andockbucht ' + this.station.name);
    }
    if (this.zone.debris) {
      this.debris = await Debris.create(this.zone.debris, this.zone.debris === 'ring' ? 2600 : 500);
      sc.add(this.debris.root);
    }
    // player
    const rec = this.opts.playerRecord;
    this.player = await Ship.create({ record: rec, faction: 'player', player: true, name: this.game.state.callsign });
    this.addShip(this.player);
    this.placePlayer(this.opts.spawn);

    this.hud = new HUD();
    this.hud.setZone(this.zone.name);
    await this.loadCockpit();
    this.game.renderer.setLayers(this.sky, { scene: this.scene, camera: this.camera });
    this.updateCamera(1, true);
    if (this.opts.mission) await this.opts.mission.start(this);
    this.emit('ready');
  }

  async loadCockpit() {
    try {
      const gltf = await assets.gltf('assets/cockpit/model.glb');
      const root = gltf.scene.clone(true);
      const mat = bakedMaterial('assets/cockpit', { emit: false });
      this.mfd = [];
      root.traverse(o => {
        if (!o.isMesh) return;
        o.geometry.deleteAttribute('tangent');
        if (o.name.startsWith('hull')) o.material = mat;
        else if (o.name.startsWith('glow')) o.material = new THREE.MeshBasicMaterial({ color: new THREE.Color(o.userData.glow_color || '#ffb040').multiplyScalar(2.5), toneMapped: false });
        else if (o.name.startsWith('screen')) {
          const c = document.createElement('canvas'); c.width = 320; c.height = 240;
          const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.flipY = false;
          o.material = new THREE.MeshBasicMaterial({ map: t, toneMapped: false, color: new THREE.Color(1.4, 1.4, 1.4) });
          this.mfd.push({ name: o.name, c, t });
        }
        o.renderOrder = 10;
      });
      root.visible = false;
      this.cockpit = root;
      this.camera.add(root);
      this.scene.add(this.camera);
    } catch (e) { console.warn('cockpit', e); }
  }

  drawMFD() {
    if (!this.mfd || (this.mfdT = (this.mfdT || 0) + 1) % 6) return;
    const p = this.player;
    for (const m of this.mfd) {
      const x = m.c.getContext('2d');
      x.fillStyle = '#031018'; x.fillRect(0, 0, 320, 240);
      x.font = '600 20px Rajdhani, sans-serif'; x.fillStyle = '#7fd4ff';
      if (m.name === 'screen_l') {
        x.drawImage(this.hud.radar, 50, 10, 220, 220);
      } else if (m.name === 'screen_c') {
        const t = p.target;
        x.fillText('ZIEL', 12, 26);
        if (t && t.alive) {
          x.fillStyle = '#fff'; x.fillText(t.name.slice(0, 22), 12, 60);
          x.fillStyle = '#5ab8ff'; x.fillRect(12, 80, 296 * t.shield / t.maxShield, 14);
          x.fillStyle = '#e8e0c8'; x.fillRect(12, 104, 296 * t.hull / t.maxHull, 14);
          x.fillStyle = '#7fd4ff'; x.fillText(Math.round(p.pos.distanceTo(t.pos)) + ' m', 12, 150);
        } else { x.fillStyle = '#4a6a7a'; x.fillText('KEIN ZIEL', 12, 60); }
      } else {
        x.fillText('SYSTEME', 12, 26);
        const bar = (y, k, c, l) => { x.fillStyle = '#123'; x.fillRect(90, y - 14, 210, 14); x.fillStyle = c; x.fillRect(90, y - 14, 210 * Math.max(0, k), 14); x.fillStyle = '#7fd4ff'; x.fillText(l, 12, y); };
        bar(70, p.shield / p.maxShield, '#5ab8ff', 'SCHILD'); bar(100, p.hull / p.maxHull, p.hull / p.maxHull < 0.3 ? '#ff5a4a' : '#e8e0c8', 'RUMPF');
        bar(130, p.energy / p.stats.energy, '#ffcf7a', 'ENERGIE'); bar(160, p.throttle, '#7fd4ff', 'SCHUB');
        x.fillText(`${Math.round(p.speed())} m/s   RAK ${p.missiles}`, 12, 205);
      }
      x.fillStyle = 'rgba(127,212,255,.07)'; for (let y = 0; y < 240; y += 3) x.fillRect(0, y, 320, 1);
      m.t.needsUpdate = true;
    }
  }

  captureEnvironment() {
    const r = this.game.renderer.gl;
    const rt = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType });
    const cc = new THREE.CubeCamera(1, 3e8, rt);
    this.sky.scene.add(cc);
    const bgi = this.sky.scene.backgroundIntensity;
    this.sky.scene.backgroundIntensity = 1.2;
    cc.update(r, this.sky.scene);
    this.sky.scene.backgroundIntensity = bgi;
    this.sky.scene.remove(cc);
    const pm = new THREE.PMREMGenerator(r);
    this.envTex = pm.fromCubemap(rt.texture).texture;
    this.scene.environment = this.envTex;
    this.scene.environmentIntensity = 1.6;
    pm.dispose(); rt.dispose();
  }

  placePlayer(spawn) {
    const p = this.player;
    if (spawn === 'undock' && this.station) {
      const d = this.station.dock;
      p.obj.position.copy(d.pos).addScaledVector(d.dir, 120);
      p.obj.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), d.dir);
      p.vel.copy(d.dir).multiplyScalar(60);
      p.input.throttle = 0.3;
    } else if (spawn && spawn.isVector3) {
      p.obj.position.copy(spawn);
    } else {
      // arrival: some km out, facing the station
      const s = this.station ? this.station.pos : new THREE.Vector3();
      const dir = new THREE.Vector3(...(this.opts.arriveDir || [0.3, 0.15, 1])).normalize();
      p.obj.position.copy(s).addScaledVector(dir, 5200);
      p.obj.lookAt(s); p.obj.rotateY(Math.PI); // lookAt points +Z; our forward is -Z
      p.vel.copy(dir).multiplyScalar(-120);
      p.input.throttle = 0.5;
    }
    this.camQ = p.quat.clone();
  }

  addShip(s) { this.ships.push(s); this.scene.add(s.obj); return s; }

  async spawn(opts) {
    const s = await Ship.create(opts);
    if (opts.lookAt) { s.obj.lookAt(opts.lookAt); s.obj.rotateY(Math.PI); }
    this.addShip(s);
    return s;
  }

  removeShip(s) {
    s.alive = false;
    this.scene.remove(s.obj);
    this.ships = this.ships.filter(x => x !== s);
    for (const o of this.ships) if (o.target === s) o.target = null;
  }

  jumpOut(s) {
    this.fx.hit(s.pos.clone(), new THREE.Vector3(0, 1, 0), true);
    this.removeShip(s);
    this.emit('jumpOut', s);
  }

  setHostile(a, b, on = true) { const k = a + '>' + b; if (on) this.hostileOverrides.add(k); else this.hostileOverrides.delete(k); }
  isHostile(a, b) { return hostile(a.faction || a, b.faction || b, this.hostileOverrides); }

  nearestHostile(ship, range = 5000) {
    let best = null, bd = range;
    for (const s of this.ships) {
      if (!s.alive || s === ship || !this.isHostile(ship, s)) continue;
      const d = s.pos.distanceTo(ship.pos);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  leadFor(shooter, target) { return leadPoint(shooter, target, BOLT_SPEED, new THREE.Vector3()); }

  addWaypoint(id, pos, label) { this.removeWaypoint(id); const w = { id, pos: pos.clone(), label }; this.waypoints.push(w); return w; }
  removeWaypoint(id) { this.waypoints = this.waypoints.filter(w => w.id !== id); }

  say(speaker, text, faction = 'neutral', dur) {
    const col = (FACTIONS[faction] || FACTIONS.neutral).color;
    this.hud.say(speaker, text, col, dur);
  }
  objective(t) { this.hud.setObjective(t); }

  // ------------------------------------------------------------------ weapons

  fireGuns(ship) {
    if (ship.fireCd > 0 || ship.energy < 2) return;
    const guns = ship.gunPositions();
    const n = ship.stats.guns || 1;
    ship.fireCd = (ship.isPlayer ? 1 : 1.35) / ship.stats.laserRate;
    ship.energy -= ship.isPlayer ? 2.2 : 1;
    const fwd = ship.forward(new THREE.Vector3());
    // converge on ~600 m (player) or the target lead point (AI)
    let aimPoint;
    if (ship.isPlayer) aimPoint = ship.pos.clone().addScaledVector(fwd, 600);
    else if (ship.target) aimPoint = this.leadFor(ship, ship.target);
    const color = ship.isPlayer ? '#ff4a3a' : ship.faction === 'schakale' ? '#4aff6a' : ship.faction === 'konsortium' ? '#ffcc44' : '#5ab0ff';
    const fireOne = (gp) => {
      const dir = aimPoint ? aimPoint.clone().sub(gp).normalize() : fwd.clone();
      if (dir.dot(fwd) < 0.97) dir.copy(fwd);
      if (!ship.isPlayer) dir.add(new THREE.Vector3().randomDirection().multiplyScalar(0.012 + 0.04 * (1 - (ship.ai?.skill ?? 0.5)))).normalize();
      this.bolts.fire(gp, dir, BOLT_SPEED, ship.vel, ship, ship.stats.laserDmg, color);
    };
    if (n >= 2 && guns.length >= 2) { fireOne(guns[ship.gunIdx % guns.length]); fireOne(guns[(ship.gunIdx + 1) % guns.length]); ship.gunIdx += 2; }
    else { fireOne(guns[ship.gunIdx % guns.length]); ship.gunIdx++; }
    const d = ship.pos.distanceTo(this.camera.position);
    this.game.audio?.laser(ship.isPlayer ? 1 : Math.max(0, 1 - d / 1500), ship.isPlayer);
  }

  turretFire(ship, dt, skill = 0.5) {
    if (ship.turretCd > 0) return;
    const tgt = this.nearestHostile(ship, 1600);
    if (!tgt) return;
    ship.turretCd = 0.28;
    const t = ship.model.root.getObjectByName('turret');
    const from = t ? t.getWorldPosition(new THREE.Vector3()) : ship.pos.clone().add(ship.up(new THREE.Vector3()).multiplyScalar(ship.radius * 0.3));
    const lp = this.leadFor(ship, tgt);
    const dir = lp.sub(from).normalize().add(new THREE.Vector3().randomDirection().multiplyScalar(0.03 * (1.2 - skill))).normalize();
    this.bolts.fire(from, dir, BOLT_SPEED, ship.vel, ship, ship.stats.laserDmg * 0.8, ship.isPlayer ? '#ff9a3a' : '#5ab0ff', 2.0, 10, 0.45);
    this.game.audio?.laser(Math.max(0.1, 1 - ship.pos.distanceTo(this.camera.position) / 1500) * 0.6, false);
  }

  fireMissile(ship, target) {
    if (ship.missiles <= 0 || ship.missileCd > 0 || !target) return false;
    ship.missiles--; ship.missileCd = 0.8;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 1.6, 8).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xcfcfcf, metalness: 0.6, roughness: 0.4 }));
    m.position.copy(ship.pos).addScaledVector(ship.up(new THREE.Vector3()), -ship.radius * 0.25);
    m.quaternion.copy(ship.quat);
    this.scene.add(m);
    this.missiles.push({ mesh: m, vel: ship.vel.clone().addScaledVector(ship.forward(new THREE.Vector3()), 60), target, owner: ship, life: 9, dmg: 140 });
    this.game.audio?.missile();
    return true;
  }

  // ------------------------------------------------------------------ player control

  controlPlayer(dt) {
    const p = this.player, inp = p.input;
    if (p.autopilot) return;
    const sens = 0.0024 * (this.game.settings?.mouseSens || 1);
    if (input.locked) {
      this.stick.x += input.mouse.dx * sens;
      this.stick.y += input.mouse.dy * sens * (this.game.settings?.invertY ? -1 : 1);
    }
    const l = Math.hypot(this.stick.x, this.stick.y);
    if (l > 1) { this.stick.x /= l; this.stick.y /= l; }
    if (input.mouse.dx === 0 && input.mouse.dy === 0) { const k = Math.exp(-dt * 0.9); this.stick.x *= k; this.stick.y *= k; }
    const dz = (v) => Math.abs(v) < 0.04 ? 0 : (v - Math.sign(v) * 0.04) / 0.96;
    inp.yaw = -dz(this.stick.x) * 1.0;
    inp.pitch = -dz(this.stick.y);
    // keyboard pitch/yaw fallback (arrows)
    if (input.down('ArrowLeft')) inp.yaw = 1; if (input.down('ArrowRight')) inp.yaw = -1;
    if (input.down('ArrowUp')) inp.pitch = -1; if (input.down('ArrowDown')) inp.pitch = 1;
    inp.roll = (input.down('KeyA') ? 1 : 0) - (input.down('KeyD') ? 1 : 0);
    inp.strafeX = (input.down('KeyE') ? 1 : 0) - (input.down('KeyQ') ? 1 : 0);
    inp.strafeY = (input.down('KeyR') ? 1 : 0) - (input.down('KeyV') ? 1 : 0);
    if (input.down('KeyW')) inp.throttle = Math.min(1, inp.throttle + dt * 0.7);
    if (input.down('KeyS')) inp.throttle = Math.max(0, inp.throttle - dt * 0.7);
    if (input.hit('KeyX') || input.hit('Backspace')) inp.throttle = 0;
    if (input.hit('Digit1')) inp.throttle = 0.25; if (input.hit('Digit2')) inp.throttle = 0.5;
    if (input.hit('Digit3')) inp.throttle = 0.75; if (input.hit('Digit4')) inp.throttle = 1;
    if (input.mouse.wheel) inp.throttle = THREE.MathUtils.clamp(inp.throttle - input.mouse.wheel * 0.08, 0, 1);
    inp.boost = input.down('ShiftLeft') || input.down('ShiftRight');
    if (input.hit('KeyZ')) { p.flightAssist = !p.flightAssist; this.hud.showToast(p.flightAssist ? 'Flughilfe AN' : 'Flughilfe AUS – Newton pur', 2); }
    if ((input.button(0) && input.locked) || input.down('Space')) this.fireGuns(p);
    if (input.hit('KeyT')) this.cycleTarget(true);
    if (input.hit('KeyY')) this.targetAhead();
    if (input.hit('KeyC')) this.camMode = this.camMode === 'chase' ? 'cockpit' : 'chase';
    if (input.hit('KeyH')) this.hud.toggleHelp();
    if ((input.click(2) && input.locked) || input.hit('KeyF')) {
      if (this.lock && this.lock.t >= p.stats.lockTime) { this.fireMissile(p, this.lock.target); this.lock.t = 0; }
      else this.hud.showToast('Keine Zielerfassung', 1.2);
    }
    if (input.hit('KeyL')) this.requestDock();
    if (input.hit('KeyM')) this.game.ui.openMap(this);
    if (input.hit('KeyN') && p.target) this.hud.showToast(`${p.target.name}: ${(FACTIONS[p.target.faction] || {}).name || ''}`, 1.5);
    if (p.turretAuto !== false && p.stats.turret) this.turretFire(p, dt, 0.65);
    // missile lock
    const t = p.target;
    if (t && t.alive && p.missiles > 0) {
      const to = _v.copy(t.pos).sub(p.pos); const d = to.length();
      const ang = to.normalize().angleTo(p.forward(_w));
      if (d < 3500 && ang < 0.35) {
        if (!this.lock || this.lock.target !== t) this.lock = { target: t, t: 0 };
        const before = this.lock.t;
        this.lock.t += dt;
        if (before < p.stats.lockTime && this.lock.t >= p.stats.lockTime) this.game.audio?.lockTone();
      } else this.lock = null;
    } else this.lock = null;
  }

  cycleTarget(hostileFirst) {
    const p = this.player;
    const list = this.ships.filter(s => s !== p && s.alive && s.pos.distanceTo(p.pos) < 12000)
      .sort((a, b) => (this.isHostile(b, p) - this.isHostile(a, p)) || a.pos.distanceTo(p.pos) - b.pos.distanceTo(p.pos));
    if (!list.length) { p.target = null; return; }
    const i = list.indexOf(p.target);
    p.target = list[(i + 1) % list.length];
    this.game.audio?.blip();
  }

  targetAhead() {
    const p = this.player, f = p.forward(new THREE.Vector3());
    let best = null, ba = 0.5;
    for (const s of this.ships) {
      if (s === p || !s.alive) continue;
      const a = _v.copy(s.pos).sub(p.pos).normalize().angleTo(f);
      if (a < ba) { ba = a; best = s; }
    }
    if (best) { p.target = best; this.game.audio?.blip(); }
  }

  // ------------------------------------------------------------------ docking & travel

  canDock() {
    if (!this.station || this.zone.hostile) return false;
    return this.player.pos.distanceTo(this.station.dock.pos) < 3000;
  }

  requestDock() {
    if (this.state !== 'flying') return;
    if (this.missionBlocksDock) { this.hud.showToast(this.missionBlocksDock, 2.5); return; }
    if (!this.station) { this.hud.showToast('Keine Station in Reichweite', 2); return; }
    if (this.zone.hostile) { this.hud.showToast('Andocken verweigert', 2); return; }
    if (!this.canDock()) { this.hud.showToast('Zu weit entfernt – näher als 3 km an die Andockbucht', 2.5); return; }
    if (!this.allowHotDock && this.ships.some(s => s.alive && this.isHostile(s, this.player) && s.pos.distanceTo(this.player.pos) < 3000)) {
      this.hud.showToast('Andocken unmöglich – Feinde in der Nähe', 2.5); return;
    }
    const d = this.station.dock;
    this.say('Flugleitung ' + this.station.name, 'Andockfreigabe erteilt. Leitstrahl aktiv – Autopilot übernimmt.', this.station.faction);
    this.state = 'docking';
    const p = this.player;
    p.autopilot = { stage: 0, pts: [d.pos.clone().addScaledVector(d.dir, 450), d.pos.clone().addScaledVector(d.dir, 30), d.pos.clone().addScaledVector(d.dir, -60)] };
    // already lined up in front of the bay: skip the approach point
    const rel = p.pos.clone().sub(d.pos);
    const along = rel.dot(d.dir), off = rel.clone().addScaledVector(d.dir, -along).length();
    if (along > 0 && along < 700 && off < 150) p.autopilot.stage = 1;
    this.lock = null;
  }

  runAutopilot(dt) {
    const p = this.player, ap = p.autopilot;
    if (!ap) return;
    const target = ap.pts[ap.stage];
    const ang = steerTo(p, target, true, 3);
    const d = p.pos.distanceTo(target);
    const facing = Math.max(0.08, Math.cos(Math.min(ang, Math.PI / 2)));
    p.input.throttle = (ap.stage === 0 ? THREE.MathUtils.clamp(d / 900, 0.15, 0.8) : THREE.MathUtils.clamp(d / 600, 0.12, 0.35)) * facing;
    p.input.boost = false;
    const turnR = p.speed() / Math.max(0.2, p.stats.turn);
    if (d < Math.max(ap.stage === 0 ? 80 : 30, turnR * 0.9)) {
      ap.stage++;
      if (ap.stage >= ap.pts.length) {
        p.autopilot = null;
        this.state = 'docked';
        this.game.fadeOut(0.8).then(() => this.emit('docked', this.zone.station.id));
      }
    }
    if (ap.stage === 2 && !ap.faded) { ap.faded = true; this.game.fadeOut(1.6); }
  }

  /** Fusion-drive transfer to another zone with a sky fly-through. */
  travelTo(zoneId, onArrive) {
    if (this.state !== 'flying') return;
    const from = this.anchor, to = zoneAnchor(zoneId);
    const dir = new THREE.Vector3(to[0] - from[0], to[1] - from[1], to[2] - from[2]).normalize();
    this.state = 'travel';
    this.travel = { t: 0, dir, from, to, zoneId, onArrive, info: travelInfo(this.zoneId, zoneId) };
    this.player.autopilot = { travel: true };
    this.hud.setObjective(`Fusionsbrand nach ${ZONES[zoneId].name}`);
    this.say('Bordcomputer', `Kurs berechnet. Transferzeit ${this.travel.info.hours.toFixed(1)} Stunden. Ausrichtung läuft.`, 'neutral', 3);
  }

  updateTravel(dt) {
    const tr = this.travel, p = this.player;
    tr.t += dt;
    const target = p.pos.clone().addScaledVector(tr.dir, 5000);
    if (tr.t < 2.5) {
      steerTo(p, target, false, 2.5);
      p.input.throttle = 0.3;
      return;
    }
    if (!tr.burn) { tr.burn = true; this.game.audio?.burn(); this.hud.showToast('FUSIONSBRAND', 2); }
    p.input.pitch = p.input.yaw = p.input.roll = 0;
    p.input.throttle = 1; p.input.boost = true; p.energy = p.stats.energy;
    const T = 6.5; // seconds of fly-through
    const k = THREE.MathUtils.clamp((tr.t - 2.5) / T, 0, 1);
    const e = k * k * (3 - 2 * k);
    const o = [0, 1, 2].map(i => tr.from[i] + (tr.to[i] - tr.from[i]) * e);
    this.anchorOverride = o;
    this.warp = Math.sin(k * Math.PI);
    if (k >= 1 && !tr.done) {
      tr.done = true;
      this.game.fadeOut(0.6).then(() => tr.onArrive && tr.onArrive());
    }
  }

  // ------------------------------------------------------------------ main loop

  update(dt) {
    if (this.paused || !this.player) return;
    this.time += dt;
    const p = this.player;
    if (this.state === 'flying' && p.alive) this.controlPlayer(dt);
    if (this.state === 'docking') this.runAutopilot(dt);
    if (this.state === 'travel') this.updateTravel(dt);
    for (const s of this.ships) if (s.alive && !s.isPlayer) updateAI(s, this, dt);
    for (const s of this.ships) if (s.alive) s.integrate(dt);
    this.collisions(dt);
    this.bolts.update(dt, this.camera, (a, b, bolt) => this.boltHit(a, b, bolt));
    this.updateMissiles(dt);
    this.fx.update(dt); this.trails.update(dt);
    if (this.station) this.station.update(dt, this.camera);
    if (this.debris) this.debris.update(dt, this.camera);
    if (this.opts.mission) this.opts.mission.update?.(this, dt);
    this.updateCamera(dt);
    // far layer follows the camera (km)
    const o = this.anchorOverride || this.anchor;
    this.sky.setOrigin(o[0] + this.camera.position.x / 1000, o[1] + this.camera.position.y / 1000, o[2] + this.camera.position.z / 1000);
    this.sky.syncCamera(this.camera);
    this.sky.update(dt);
    this.dust.update(this.camera, p.vel.clone().multiplyScalar(this.warp ? 1 + this.warp * 40 : 1), 1 + (this.warp || 0) * 3);
    this.hud.update(dt, this);
    // docking prompt
    if (this.state === 'flying') {
      const prompt = this.canDock() && !this.missionBlocksDock ? `<b>[L]</b> Andocken an ${this.station.name}` : '';
      this.hud.prompt(prompt);
    } else this.hud.prompt('');
    this.game.audio?.engine(p.throttle, p.input.boost);
    if (!p.alive && !this.deadHandled) { this.deadHandled = true; this.onPlayerDeath(); }
  }

  updateCamera(dt, snap = false) {
    const p = this.player, cam = this.camera;
    const k = snap ? 1 : 1 - Math.exp(-dt * (this.camMode === 'cockpit' ? 30 : 7));
    this.camQ = this.camQ || p.quat.clone();
    this.camQ.slerp(p.quat, k);
    const boostFov = p.input.boost ? 8 : 0;
    const targetFov = (this.camMode === 'cockpit' ? 72 : 66) + boostFov + (this.warp || 0) * 25;
    cam.fov += (targetFov - cam.fov) * Math.min(1, dt * 3);
    cam.updateProjectionMatrix();
    const vis = this.camMode !== 'cockpit';
    p.model.root.visible = vis;
    if (this.cockpit) this.cockpit.visible = this.camMode === 'cockpit';
    this.hud.root.classList.toggle('cockpit', this.camMode === 'cockpit');
    if (this.camMode === 'cockpit') {
      const cp = p.model.cockpit ? p.model.cockpit.getWorldPosition(new THREE.Vector3()) : p.pos.clone();
      cam.position.copy(cp);
      cam.quaternion.copy(p.quat);
      if (this.shake > 0) { cam.position.add(new THREE.Vector3().randomDirection().multiplyScalar(this.shake * 0.04)); this.shake *= Math.exp(-dt * 6); }
      if (cam.near !== 0.05) { cam.near = 0.05; cam.updateProjectionMatrix(); }
      this.drawMFD();
    } else {
      if (cam.near !== 0.25) { cam.near = 0.25; cam.updateProjectionMatrix(); }
      const r = Math.max(p.model.length, 10);
      const off = new THREE.Vector3(0, r * 0.28, r * 1.25).applyQuaternion(this.camQ);
      // a little lag on velocity changes
      const lag = p.vel.clone().multiplyScalar(-0.012);
      cam.position.copy(p.pos).add(off).add(lag);
      cam.quaternion.copy(this.camQ);
      cam.rotateX(-0.08);
      if (this.shake > 0) { cam.position.add(new THREE.Vector3().randomDirection().multiplyScalar(this.shake)); this.shake *= Math.exp(-dt * 6); }
    }
  }

  boltHit(a, b, bolt) {
    const seg = _v.copy(b).sub(a); const L = seg.length();
    if (L === 0) return false;
    seg.divideScalar(L);
    for (const s of this.ships) {
      if (!s.alive || s === bolt.owner) continue;
      if (bolt.owner && !this.isHostile(bolt.owner, s) && !(s.isPlayer || bolt.owner.isPlayer)) continue; // AI don't hurt friends
      const r = s.hitRadius;
      const t = THREE.MathUtils.clamp(_w.copy(s.pos).sub(a).dot(seg), 0, L);
      const closest = a.clone().addScaledVector(seg, t);
      if (closest.distanceToSquared(s.pos) < r * r) {
        this.applyDamage(s, bolt.dmg, closest, bolt.owner);
        return true;
      }
    }
    if (this.station && this.station.hitTest(b)) { this.fx.hit(b.clone(), seg.clone().negate(), false); return true; }
    if (this.debris && this.debris.hitTest(b)) { this.fx.hit(b.clone(), seg.clone().negate(), false); return true; }
    return false;
  }

  applyDamage(s, dmg, point, attacker) {
    if (attacker && attacker.isPlayer && !this.isHostile(attacker, s) && !s.tags.has('noFriendlyFire')) {
      s.friendlyHits = (s.friendlyHits || 0) + 1;
      if (s.friendlyHits === 3) this.say(s.name, 'Hey! Feuer einstellen, verdammt!', s.faction);
      if (s.friendlyHits > 8 && !s.tags.has('ally')) { this.setHostile(s.faction, 'player'); this.say(s.name, 'Das reicht. Feuer frei auf den Angreifer!', s.faction); }
    }
    const res = s.damage(dmg, point);
    const normal = point.clone().sub(s.pos).normalize();
    this.fx.hit(point, normal, res === 'shield');
    if (s.isPlayer) { this.shake = Math.min(1.5, (this.shake || 0) + 0.4); this.game.audio?.hit(res === 'shield'); }
    else if (attacker && attacker.isPlayer) this.game.audio?.hitConfirm();
    if (attacker && !s.isPlayer && s.ai && !s.target && this.isHostile(s, attacker)) s.target = attacker;
    if (res === 'destroyed') this.destroyShip(s, attacker);
  }

  destroyShip(s, killer) {
    const size = Math.max(6, s.model.length * 0.8);
    this.fx.boom(s.pos.clone(), size, s.vel.clone().multiplyScalar(0.4));
    this.game.audio?.explosion(Math.max(0.15, 1 - s.pos.distanceTo(this.camera.position) / 4000), size);
    if (s.isPlayer) { s.alive = false; s.obj.visible = false; return; }
    this.removeShip(s);
    if (killer && killer.isPlayer) this.game.state.kills++;
    this.emit('destroyed', s, killer);
    if (this.player.target === s) this.player.target = null;
  }

  updateMissiles(dt) {
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i];
      m.life -= dt;
      const t = m.target;
      if (t && t.alive) {
        const want = this.leadFor({ pos: m.mesh.position, vel: m.vel }, t).sub(m.mesh.position).normalize();
        const cur = m.vel.clone().normalize();
        cur.lerp(want, Math.min(1, dt * 3.2)).normalize();
        const sp = Math.min(m.vel.length() + 420 * dt, 520);
        m.vel.copy(cur).multiplyScalar(sp);
        m.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), cur);
        if (m.mesh.position.distanceTo(t.pos) < t.hitRadius + 4) { this.applyDamage(t, m.dmg, m.mesh.position.clone(), m.owner); this.fx.boom(m.mesh.position.clone(), 4); m.life = 0; }
      }
      m.mesh.position.addScaledVector(m.vel, dt);
      this.trails.emit(m.mesh.position, new THREE.Vector3().randomDirection().multiplyScalar(2), new THREE.Color(2.5, 1.6, 0.9), 1.4, 0.5, 3);
      if (m.life <= 0) { this.scene.remove(m.mesh); this.missiles.splice(i, 1); }
    }
  }

  collisions(dt) {
    const list = this.ships;
    for (let i = 0; i < list.length; i++) {
      const a = list[i]; if (!a.alive) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j]; if (!b.alive) continue;
        const r = (a.hitRadius + b.hitRadius) * 0.8;
        const d = a.pos.distanceTo(b.pos);
        if (d < r && d > 0) {
          const n = _v.copy(a.pos).sub(b.pos).divideScalar(d);
          const rel = a.vel.clone().sub(b.vel).dot(n);
          const ma = a.stats.hull, mb = b.stats.hull;
          a.pos.addScaledVector(n, (r - d) * mb / (ma + mb));
          b.pos.addScaledVector(n, -(r - d) * ma / (ma + mb));
          if (rel < 0) {
            a.vel.addScaledVector(n, -rel * 1.3 * mb / (ma + mb));
            b.vel.addScaledVector(n, rel * 1.3 * ma / (ma + mb));
            const dmg = Math.abs(rel) * 0.5;
            if (dmg > 5) { this.applyDamage(a, dmg, a.pos.clone().addScaledVector(n, -a.hitRadius), b); this.applyDamage(b, dmg, b.pos.clone().addScaledVector(n, b.hitRadius), a); }
          }
        }
      }
      // station / debris
      for (const obstacle of [this.station, this.debris]) {
        if (!obstacle || a.autopilot) continue;
        const push = obstacle.collide(a.pos, a.hitRadius * 0.7);
        if (push) {
          const n = push.clone().normalize();
          a.pos.add(push);
          const rel = a.vel.dot(n);
          if (rel < 0) {
            a.vel.addScaledVector(n, -rel * 1.4);
            if (-rel > 15 && !(a.autopilot)) this.applyDamage(a, -rel * 0.6, a.pos.clone().addScaledVector(n, -a.hitRadius), null);
          }
        }
      }
    }
  }

  onPlayerDeath() {
    this.player.obj.visible = false;
    this.say('Bordcomputer', 'Rumpfintegrität verloren. Rettungskapsel ausgestoßen.', 'neutral', 4);
    setTimeout(() => this.emit('playerDead'), 3500);
  }

  dispose() {
    this.hud.dispose();
    this.game.ui.cockpit(false);
    this.scene.traverse(o => { if (o.geometry && !o.geometry.userData?.shared) o.geometry.dispose?.(); });
    this.envTex?.dispose();
  }
}
