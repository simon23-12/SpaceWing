import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { assets } from '../core/assets.js';

/**
 * Skinned NPCs built from CC0 MakeHuman assets (blender/humans.py) and animated with
 * retargeted CC0 Quaternius clips (assets/npcs/anims.glb). Every character shares the
 * same 'game_engine' skeleton, so one clip set drives all of them.
 */

let animLib = null;
async function loadAnims() {
  if (!animLib) animLib = assets.gltf('assets/npcs/anims.glb').then(g => {
    const clips = new Map(g.animations.map(c => [c.name, c]));
    let pelvisRest = null;
    g.scene.traverse(o => { if (o.name === 'pelvis') pelvisRest = o.position.clone(); });
    return { clips, pelvisRest };
  });
  return animLib;
}

const charCache = new Map();
async function loadChar(id) {
  if (!charCache.has(id)) charCache.set(id, assets.gltf(`assets/npcs/${id}.glb`).then(g => { prepMaterials(g.scene); return g; }));
  return charCache.get(id);
}

function prepMaterials(root) {
  root.traverse(o => {
    if (!o.isMesh) return;
    o.frustumCulled = false;       // skinned bounds are the bind pose; seated poses would pop
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      const n = m.name || '';
      m.envMapIntensity = 0.9;
      if (/_hair|_fedora/.test(n)) {
        m.transparent = false; m.alphaTest = 0.42; m.alphaToCoverage = true; m.side = THREE.DoubleSide; m.depthWrite = true;
      } else if (/_brows|_lashes/.test(n)) {
        m.transparent = true; m.depthWrite = false; m.alphaTest = 0.02; m.side = THREE.DoubleSide;
      } else if (/_skin/.test(n)) {
        m.roughness = 0.5; m.metalness = 0;
      } else if (/_eyes/.test(n)) {
        m.roughness = 0.05;
      }
      if (m.map) m.map.anisotropy = 4;
    }
  });
}

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class NPC {
  /** opts: { clip, talkClip, seated, phase, speed } */
  static async create(id, opts = {}) {
    const [gltf, lib] = await Promise.all([loadChar(id), loadAnims()]);
    return new NPC(id, gltf, lib, opts);
  }

  constructor(id, gltf, lib, opts) {
    this.id = id;
    this.root = SkeletonUtils.clone(gltf.scene);
    this.root.name = 'npc_' + id;
    this.bones = {};
    this.root.traverse(o => { if (o.isBone) this.bones[o.name] = o; });
    this.mixer = new THREE.AnimationMixer(this.root);
    this.lib = lib;
    this.idleClip = opts.clip || (opts.seated ? 'sit' : 'idle');
    this.talkClip = opts.talkClip || (opts.seated ? 'sit_talk' : 'talk');
    this.actions = {};
    this.current = null;
    this.speed = opts.speed ?? (0.9 + Math.random() * 0.2);
    this.play(this.idleClip, 0, opts.phase ?? Math.random());
    // head look-at state
    this.look = { yaw: 0, pitch: 0, w: 0 };
    this.lookLimit = opts.seated ? 1.0 : 1.15;
    this.material = null;
  }

  /** Clip with pelvis translation rescaled to this body's proportions. */
  clipFor(name) {
    if (this.actions[name]) return this.actions[name];
    const src = this.lib.clips.get(name);
    if (!src) return null;
    const clip = src.clone();
    const pel = this.bones.pelvis, ref = this.lib.pelvisRest;
    if (pel && ref) {
      const rest = pel.position.clone();
      const k = rest.length() / Math.max(1e-4, ref.length());
      for (const t of clip.tracks) {
        if (t.name === 'pelvis.position') {
          const v = t.values;
          for (let i = 0; i < v.length; i += 3) {
            v[i] = rest.x + (v[i] - ref.x) * k; v[i + 1] = rest.y + (v[i + 1] - ref.y) * k; v[i + 2] = rest.z + (v[i + 2] - ref.z) * k;
          }
        }
      }
    }
    const a = this.mixer.clipAction(clip);
    this.actions[name] = a;
    return a;
  }

  play(name, fade = 0.45, phase = 0) {
    const a = this.clipFor(name);
    if (!a || a === this.current) return;
    const once = !/idle|sit|talk|walk|keys|fold|rail|phone|dance|no/.test(name) || name === 'interact';
    a.reset();
    a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    a.clampWhenFinished = once;
    a.timeScale = this.speed;
    if (phase) a.time = phase * a.getClip().duration;
    a.play();
    if (this.current && fade > 0) this.current.crossFadeTo(a, fade, false);
    else if (this.current) this.current.stop();
    this.current = a;
    if (once) {
      const back = (e) => { if (e.action === a) { this.mixer.removeEventListener('finished', back); this.play(this.talking ? this.talkClip : this.idleClip, 0.5); } };
      this.mixer.addEventListener('finished', back);
    }
  }

  setTalking(on) {
    this.talking = on;
    this.play(on ? this.talkClip : this.idleClip, 0.6);
  }

  /** dt seconds, lookAt world position (or null). */
  update(dt, lookAt) {
    this.mixer.update(dt);
    const head = this.bones.head, neck = this.bones.neck_01;
    if (!head || !neck) return;
    // target angles in the character's own frame (it faces +Z)
    let tyaw = 0, tpitch = 0, tw = 0;
    if (lookAt) {
      this.root.updateMatrixWorld(true);
      head.getWorldPosition(_v);
      _v2.copy(lookAt).sub(_v);
      const dist = _v2.length();
      this.root.getWorldQuaternion(_q).invert();
      _v2.applyQuaternion(_q);
      const yaw = Math.atan2(_v2.x, _v2.z), pitch = Math.atan2(_v2.y, Math.hypot(_v2.x, _v2.z));
      if (dist < 5.5 && Math.abs(yaw) < 1.9) {
        tyaw = THREE.MathUtils.clamp(yaw, -this.lookLimit, this.lookLimit);
        tpitch = THREE.MathUtils.clamp(pitch, -0.45, 0.35);
        tw = THREE.MathUtils.smoothstep(5.5 - dist, 0, 1.8);
      }
    }
    // nobody to look at: an occasional glance around (small head turns, like people do)
    if (tw < 0.05) {
      const G = this.glance || (this.glance = { t: 2 + Math.random() * 4, yaw: 0, pitch: 0, hold: 0 });
      G.t -= dt;
      if (G.t <= 0) {
        if (G.hold > 0) { G.yaw = 0; G.pitch = 0; G.hold = 0; G.t = 3 + Math.random() * 6; }
        else { G.yaw = (Math.random() - 0.5) * 1.0; G.pitch = (Math.random() - 0.6) * 0.25; G.hold = 1; G.t = 1.2 + Math.random() * 2; }
      }
      tyaw = G.yaw; tpitch = G.pitch; tw = G.hold ? 0.55 : 0;
    }
    const k = 1 - Math.exp(-dt * 4);
    this.look.yaw += (tyaw - this.look.yaw) * k;
    this.look.pitch += (tpitch - this.look.pitch) * k;
    this.look.w += (tw - this.look.w) * (1 - Math.exp(-dt * 2.5));
    if (this.look.w < 0.01) return;
    this.root.updateMatrixWorld(true);
    this.addLook(neck, 0.4);
    this.addLook(head, 0.6);
  }

  addLook(bone, share) {
    const w = this.look.w * share;
    // world-space rotation: yaw about the character's up axis, pitch about its right axis
    this.root.getWorldQuaternion(_q);
    const up = _v.copy(UP).applyQuaternion(_q);
    const right = _v2.set(1, 0, 0).applyQuaternion(_q);
    const qy = new THREE.Quaternion().setFromAxisAngle(up, this.look.yaw * w);
    const qp = new THREE.Quaternion().setFromAxisAngle(right, -this.look.pitch * w);
    const look = qy.multiply(qp);
    bone.getWorldQuaternion(_q2);
    const parentQ = bone.parent.getWorldQuaternion(new THREE.Quaternion());
    bone.quaternion.copy(parentQ.invert().multiply(look.multiply(_q2)));
    bone.updateMatrixWorld(true);
  }

  /** Replace all materials (e.g. hologram band). */
  override(mat) {
    this.root.traverse(o => { if (o.isMesh) o.material = mat; });
  }

  dispose() { this.mixer.stopAllAction(); }
}
