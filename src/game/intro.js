import * as THREE from 'three';
import { SkyLayer } from '../space/skyLayer.js';
import { Station } from '../space/station.js';
import { ShipModel } from '../space/shipModel.js';
import { BODIES, SUN_DIR, zoneAnchor } from '../space/universe.js';
import { RoomMode } from '../station/room.js';
import { MOONS } from './data.js';

/*
 * Opening cinematic after "Neues Spiel" (about a minute, skippable with Space / Enter / Esc):
 * the Saturn system from outside, Hochstation Cassini, then the deck, the bar, your cabin and the empty hangar.
 * Everything is rendered live with the game's own scenes (sky layer, station model, the walkable deck in cine mode).
 * Narration lines are { who, text } objects, so tools/extract_lines.mjs collects them for the voice-over.
 */

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const SUN = V(...SUN_DIR).normalize();
const UP = V(0, 1, 0);
const body = (id) => V(...BODIES[id].pos);
const ease = (k) => { k = THREE.MathUtils.clamp(k, 0, 1); return 0.5 * k + 0.5 * k * k * (3 - 2 * k); };
const lerpV = (a, b, k) => a.clone().lerp(b, k);
/** Unit vector: the sun's horizontal direction turned by az degrees around +Y, raised by el degrees. */
const sunAz = (az, el) => {
  const h = V(SUN_DIR[0], 0, SUN_DIR[2]).normalize().applyAxisAngle(V(0, 1, 0), az * Math.PI / 180);
  return h.multiplyScalar(Math.cos(el * Math.PI / 180)).setY(Math.sin(el * Math.PI / 180));
};
const esc = (s) => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

// station shot: Cassini against Saturn (the camera stands on the far side of the station)
const RHEA = V(...zoneAnchor('rhea'));
const TO_SAT = RHEA.clone().negate().normalize();
const SIDE = new THREE.Vector3().crossVectors(TO_SAT, UP).normalize();

/** Shots in order. layer: 'sky' (system scale, km), 'station' (Cassini, metres), 'room' (deck in cine mode). */
const SHOTS = [
  {
    id: 'saturn', dur: 8.5, layer: 'sky', fov: 42, cap: ['SATURN', 'Im Jahr 2260'], big: true,
    lines: [{ at: 0.9, to: 8.0, who: 'erzaehler', text: '2260. Seit über hundert Jahren leben Menschen am Saturn, verteilt auf seine Monde und Ringe.' }],
    cam(k) {
      const pos = sunAz(THREE.MathUtils.lerp(74, 64, k), 14).multiplyScalar(THREE.MathUtils.lerp(470000, 365000, ease(k)));
      return { pos, look: V(0, 34000, 0) };
    },
  },
  {
    id: 'titan', dur: 8, layer: 'sky', fov: 38, cap: ['TITAN', 'Methanseen · Helium-3-Raffinerien'],
    lines: [{ at: 0.5, to: 7.6, who: 'erzaehler', text: 'Titan liefert Methan. Aus Saturns Wolken kommt Helium-3, der Treibstoff für alles, was fliegt.' }],
    cam(k) {
      // seen from the side of the sunlight: a half-lit Titan with its haze glowing at the rim, Saturn behind
      const T = body('titan'), out = T.clone().normalize();
      const perp = new THREE.Vector3().crossVectors(SUN, UP).normalize();
      const n = out.clone().addScaledVector(perp, 1.1).addScaledVector(UP, 0.12).normalize().applyAxisAngle(UP, THREE.MathUtils.lerp(0.05, -0.05, k));
      const pos = T.clone().addScaledVector(n, THREE.MathUtils.lerp(19000, 16500, ease(k)));
      const toT = T.clone().sub(pos).normalize(), toS = pos.clone().negate().normalize();
      return { pos, dir: toT.lerp(toS, 0.5).normalize() };
    },
  },
  {
    id: 'enceladus', dur: 8, layer: 'sky', fov: 40, cap: ['ENCELADUS', 'Eisgeysire · Wasser für das ganze System'],
    lines: [{ at: 0.5, to: 7.6, who: 'erzaehler', text: 'Enceladus liefert Wasser. Jeder Mond braucht die anderen, und keiner traut dem anderen.' }],
    cam(k) {
      // the south-pole geysers against Saturn, sunlight from the side so the plumes glow
      const E = body('enceladus'), out = E.clone().normalize();
      const perp = new THREE.Vector3().crossVectors(SUN, UP).normalize();
      const n = out.clone().addScaledVector(perp, 0.9).addScaledVector(SUN, -0.55).addScaledVector(UP, -0.25).normalize().applyAxisAngle(UP, THREE.MathUtils.lerp(-0.06, 0.06, k));
      const pos = E.clone().addScaledVector(n, THREE.MathUtils.lerp(3600, 3000, ease(k)));
      const toE = E.clone().add(V(0, -480, 0)).sub(pos).normalize(), toS = pos.clone().negate().normalize();
      return { pos, dir: toE.lerp(toS, 0.12).normalize() };
    },
  },
  {
    id: 'cassini', dur: 9, layer: 'station', fov: 40, cap: ['RHEA-ORBIT', 'Hochstation Cassini · Freihafen'],
    lines: [
      { at: 0.6, to: 5.2, who: 'erzaehler', text: 'Rhea. Hochstation Cassini: ein neutraler Freihafen mit vierzigtausend Einwohnern.' },
      { at: 5.4, to: 8.6, who: 'erzaehler', text: 'Händler, Schmuggler, Gestrandete. Und Söldner.' },
    ],
    cam(k) {
      const e = ease(k);
      const pos = TO_SAT.clone().multiplyScalar(-THREE.MathUtils.lerp(1750, 1080, e)).addScaledVector(SIDE, THREE.MathUtils.lerp(520, 160, e)).addScaledVector(UP, THREE.MathUtils.lerp(-420, -230, e));
      return { pos, look: V(0, THREE.MathUtils.lerp(-60, -150, e), 0) };
    },
  },
  {
    id: 'deck', dur: 7, layer: 'room', fov: 55, cap: ['DECK 4', 'Kommandodeck · Söldnerbörse'],
    lines: [{ at: 0.5, to: 6.7, who: 'erzaehler', text: 'Einer davon bist du. Jahrelang Begleitschutz im Geschützturm von Hallström-Frachtern. Nie am Steuer.' }],
    cam(k) { const e = ease(k); return { pos: lerpV(V(6.2, 1.9, 8.4), V(3.0, 1.75, 7.2), e), look: lerpV(V(-1, 1.3, -6), V(-3, 1.3, -6), e) }; },
  },
  {
    id: 'bar', dur: 7, layer: 'room', fov: 52, cap: ['BAR „CASSINI-SPALT“', 'Ringgang · Deck 4'],
    lines: [{ at: 0.5, to: 6.7, who: 'erzaehler', text: 'Dann kam der Saturnzoll, und Hallström ging pleite. Geld war schon immer knapp. Jetzt erst recht.' }],
    cam(k) { const e = ease(k); return { pos: lerpV(V(-24, 1.7, 8.2), V(-27, 1.6, 6.6), e), look: lerpV(V(-31, 1.2, -0.5), V(-31.5, 1.2, -1), e) }; },
  },
  {
    id: 'kabine', dur: 7, layer: 'room', fov: 58, cap: ['KABINE 4-117', 'Dein Zuhause'],
    lines: [{ at: 0.5, to: 6.7, who: 'erzaehler', text: 'Immerhin: Die Kabine gehört dir. Klein, mit Fenster zum Saturn, abbezahlt. Viel mehr besitzt du nicht.' }],
    cam(k) { const e = ease(k); return { pos: lerpV(V(-20.3, 1.55, 13.0), V(-20.1, 1.45, 15.0), e), look: lerpV(V(-20, 1.3, 19), V(-19.8, 1.35, 19), e) }; },
  },
  {
    id: 'lizenz', dur: 7, layer: 'room', fov: 50, card: true,
    lines: [
      { at: 0.4, to: 3.5, who: 'erzaehler', text: 'Jeden freien Kredit hast du in den Flugschein gesteckt.' },
      { at: 3.6, to: 6.7, who: 'erzaehler', text: 'Seit gestern ist es amtlich: Du darfst Raumschiffe fliegen.' },
    ],
    cam(k) { const e = ease(k); return { pos: lerpV(V(-21.6, 1.5, 15.2), V(-21.3, 1.45, 15.8), e), look: lerpV(V(-18.5, 1.3, 19), V(-18.8, 1.25, 19), e) }; },
  },
  {
    id: 'hangar', dur: 7, layer: 'room', fov: 50, cap: ['HANGAR 7', 'Startplatz 7-C'],
    lines: [
      { at: 0.7, to: 3.6, who: 'erzaehler', text: 'Jetzt fehlt nur noch eins:' },
      { at: 3.8, to: 6.8, who: 'erzaehler', text: 'ein Raumschiff.' },
    ],
    cam(k) { const e = ease(k); return { pos: lerpV(V(29, 2.4, 2.5), V(33, 4.4, 4.2), e), look: lerpV(V(47, 0.6, 11), V(47, 0.4, 11), e) }; },
  },
];
const FADE = 0.55;

export class IntroMode {
  constructor(game) {
    this.game = game;
    this.kind = 'intro';
    this.t = 0;
    this.total = SHOTS.reduce((s, x) => s + x.dur, 0);
    this.shot = null;
    this.line = null;
    this.done = false;
    this.sky = new SkyLayer();
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.5, 2e5);
    this.traffic = [];
  }

  async init() {
    const sc = this.scene;
    const sun = new THREE.DirectionalLight(0xfff1e0, 3.4); sun.position.copy(SUN).multiplyScalar(1000);
    const sat = new THREE.DirectionalLight(0xe8d2a8, 0.35); sat.position.copy(TO_SAT).multiplyScalar(1000);
    sc.add(sun, sat, new THREE.AmbientLight(0x202430, 0.4));
    this.sky.setOrigin(RHEA.x, RHEA.y, RHEA.z);
    if (this.sky.plumeMat) this.sky.plumeMat.uniforms.gain.value = 3;   // the geysers read better on the big screen
    // the deck loads in the background of the same loading screen; its camera is driven by the room shots
    this.room = new RoomMode(this.game, 'kabine', 'default', { cine: (room) => this.roomCam(room) });
    const [station, mule, kestrel] = await Promise.all([
      Station.load({ id: 'cassini', model: 'station_cassini', pos: [0, 0, 0] }),
      ShipModel.load('mule', { engineColor: '#ffb070' }),
      ShipModel.load('kestrel', { engineColor: '#7fb6ff' }),
      this.room.init(),
    ]);
    this.station = station; sc.add(station.root);
    this.captureEnvironment();
    // a freighter heading for the docking bay below the station, and a fighter crossing further out
    const c0 = SHOTS[3].cam(0).pos, c1 = SHOTS[3].cam(0.5).pos;
    this.traffic.push({ m: mule, from: c0.clone().addScaledVector(TO_SAT, 100).addScaledVector(SIDE, -90).addScaledVector(UP, 45), to: V(0, -410, 0), thr: 0.6,
      k: (k) => k * k });   // pulls away from the camera, then on into the bay
    this.traffic.push({ m: kestrel, from: c1.clone().addScaledVector(TO_SAT, 100).addScaledVector(SIDE, 200).addScaledVector(UP, 30), to: c1.clone().addScaledVector(TO_SAT, 170).addScaledVector(SIDE, -260).addScaledVector(UP, 8), thr: 1,
      k: (k) => THREE.MathUtils.clamp((k - 0.3) / 0.4, 0, 1) });
    for (const tr of this.traffic) sc.add(tr.m.root);
    this.ui();
    this.warmUp();
  }

  /** Render one frame of every scene behind the loading screen: compiles the shader variants the post-processing
   *  chain really uses and uploads all textures, so the cuts between scenes do not stall (ANGLE/D3D compiles slowly). */
  warmUp() {
    const R = this.game.renderer;
    let t0 = 0;
    this.silent = true;
    for (const S of SHOTS) {
      if (S.layer !== 'room' || S.id === 'deck' || S.id === 'bar' || S.id === 'hangar') { this.seek(t0 + 1); R.render(0); }
      t0 += S.dur;
    }
    this.seek(0);
    this.silent = false;
    this.line = null;
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

  ui() {
    const g = this.game.state;
    const el = document.createElement('div');
    el.className = 'intro';
    el.innerHTML = `<div class="lb top"></div><div class="lb bot"></div>
      <div class="cap"><b></b><span></span></div>
      <div class="isub"></div>
      <div class="card"><div class="ch"><span>FLUGAUFSICHT RHEA</span><span>Nr. 4117-2260-C</span></div>
        <div class="cb"><svg viewBox="0 0 64 64" class="emb"><circle cx="32" cy="32" r="13" fill="none" stroke="currentColor" stroke-width="2.5"/><ellipse cx="32" cy="32" rx="28" ry="8" fill="none" stroke="currentColor" stroke-width="2" transform="rotate(-18 32 32)"/></svg>
          <div><div class="lbl">PILOTENLIZENZ</div><div class="nm${(g?.callsign || '').length > 9 ? ' long' : ''}">${esc(g?.callsign || 'Wren')}</div>
          <div class="row">Klasse <b>C · Raumfahrzeuge bis 400 t</b></div><div class="row">Ausgestellt <b>Hochstation Cassini, 2260</b></div></div></div>
        <div class="stamp">BESTANDEN</div></div>
      <button class="iskip"><b>Leertaste</b> Überspringen ▸▸</button>
      <div class="blk"></div>`;
    el.querySelector('.iskip').onclick = () => this.skip();
    document.getElementById('ui').appendChild(el);
    this.el = el;
    this.capEl = el.querySelector('.cap');
    this.subEl = el.querySelector('.isub');
    this.cardEl = el.querySelector('.card');
    this.blkEl = el.querySelector('.blk');
  }

  /** Resolves when the cinematic has finished (true) or was skipped (false). */
  play() { return new Promise(res => { this.resolve = res; }); }

  skip() {
    if (this.done) return;
    this.done = true;
    this.game.audio?.stopVoice?.();
    this.resolve?.(false);
  }

  /** Hand the loaded deck over to the game (it is then no longer disposed with the intro). */
  takeRoom() { const r = this.room; this.room = null; return r; }

  update(dt) {
    if (this.done) return;
    this.t += dt;
    if (this.t >= this.total) {
      this.done = true;
      this.blkEl.style.opacity = 1;
      this.resolve?.(true);
      return;
    }
    this.apply(dt);
  }

  /** Dev helper: jump to a time in seconds. */
  seek(t) { this.t = t; this.shot = null; this.apply(0); }

  apply(dt) {
    let t0 = 0, S = SHOTS[0];
    for (const s of SHOTS) { if (this.t < t0 + s.dur) { S = s; break; } t0 += s.dur; }
    const lt = this.t - t0, k = lt / S.dur;
    if (S !== this.shot) this.enterShot(S);
    // per-shot fades through black (the first one fades in longer from the loading screen)
    const fin = S === SHOTS[0] ? 1.6 : FADE;
    this.blkEl.style.opacity = Math.max(0, 1 - lt / fin, 1 - (S.dur - lt) / FADE).toFixed(3);
    this.el.classList.toggle('open', this.t > 0.4 && this.t < this.total - 1.2);
    const c = S.cam(k);
    if (S.layer === 'sky') {
      this.sky.setOrigin(c.pos.x, c.pos.y, c.pos.z);
      const cam = this.sky.camera;
      cam.position.set(0, 0, 0); cam.up.copy(UP);
      cam.lookAt(c.dir ? c.dir : c.look.clone().sub(c.pos));
      cam.fov = S.fov; cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix();
      this.sky.update(dt);
    } else if (S.layer === 'station') {
      this.camera.position.copy(c.pos); this.camera.up.copy(UP); this.camera.lookAt(c.look);
      this.camera.fov = S.fov; this.camera.updateProjectionMatrix();
      this.sky.setOrigin(RHEA.x + c.pos.x / 1000, RHEA.y + c.pos.y / 1000, RHEA.z + c.pos.z / 1000);
      this.sky.syncCamera(this.camera);
      this.sky.update(dt);
      this.station.update(dt);
      for (const tr of this.traffic) {
        const p = lerpV(tr.from, tr.to, tr.k(k));
        tr.m.root.position.copy(p);
        tr.m.root.quaternion.setFromUnitVectors(V(0, 0, -1), tr.to.clone().sub(tr.from).normalize());
        tr.m.update(dt, tr.thr, false);
      }
    } else {
      this.roomShot = { S, c };
      this.room.update(dt);
    }
    this.overlay(S, lt);
  }

  roomCam(room) {
    const { S, c } = this.roomShot;
    room.camera.position.copy(c.pos); room.camera.up.copy(UP); room.camera.lookAt(c.look);
    if (room.camera.fov !== S.fov) { room.camera.fov = S.fov; room.camera.updateProjectionMatrix(); }
  }

  enterShot(S) {
    this.shot = S;
    const R = this.game.renderer;
    if (S.layer === 'sky') { R.setLayers(this.sky, null); R.setMood(null); }
    else if (S.layer === 'station') { R.setLayers(this.sky, { scene: this.scene, camera: this.camera }); R.setMood(MOONS.rhea.mood); }
    else { R.setLayers(this.room.sky, { scene: this.room.scene, camera: this.room.camera }); R.setMood(null); }
    const [h, sub] = S.cap || ['', ''];
    this.capEl.classList.toggle('big', !!S.big);
    this.capEl.querySelector('b').textContent = h;
    this.capEl.querySelector('span').textContent = sub;
    this.capEl.classList.remove('on');
    this.cardEl.classList.remove('on', 'stamped');
    this.stamped = false;
  }

  overlay(S, lt) {
    this.capEl.classList.toggle('on', !!S.cap && lt > 0.5 && lt < S.dur - 0.9);
    const L = S.lines.find(l => lt >= l.at && lt < l.to) || null;
    if (L !== this.line) {
      this.line = L;
      this.subEl.classList.toggle('on', !!L);
      if (L) {
        this.subEl.textContent = L.text;
        const A = this.game.audio;
        if (!this.silent && A?.voiceLength?.(L.text)) A.speak(L.text);
      }
    }
    if (S.card) {
      this.cardEl.classList.toggle('on', lt > 0.6 && lt < S.dur - 0.5);
      if (!this.stamped && lt > 3.7) { this.stamped = true; this.cardEl.classList.add('stamped'); this.game.audio?.lockTone?.(); }
    }
  }

  dispose() {
    this.done = true;
    this.el?.remove();
    this.envTex?.dispose();
    this.room?.dispose();
    this.game.renderer.setMood(null);
  }
}
