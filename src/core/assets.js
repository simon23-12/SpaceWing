import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const BASE = import.meta.env.BASE_URL;

class Assets {
  constructor() {
    this.manager = new THREE.LoadingManager();
    this.texLoader = new THREE.TextureLoader(this.manager);
    this.gltfLoader = new GLTFLoader(this.manager);
    this.gltfLoader.setMeshoptDecoder(MeshoptDecoder);   // NPCs are meshopt-compressed (tools/pack_npcs.sh)
    this.textures = new Map();
    this.models = new Map();
    this.json = new Map();
    this.onProgress = null;
    this.manager.onProgress = (url, loaded, total) => this.onProgress && this.onProgress(loaded, total, url);
  }

  url(p) { return BASE + p; }

  tex(path) {
    if (!this.textures.has(path)) this.textures.set(path, this.texLoader.load(this.url(path)));
    return this.textures.get(path);
  }

  texAsync(path) {
    return new Promise((res, rej) => {
      if (this.textures.has(path) && this.textures.get(path).image) return res(this.textures.get(path));
      const t = this.texLoader.load(this.url(path), res, undefined, rej);
      this.textures.set(path, t);
    });
  }

  /** Loads a GLB once; returns a fresh clone each call. */
  async model(path) {
    if (!this.models.has(path)) this.models.set(path, this.gltfLoader.loadAsync(this.url(path)));
    const gltf = await this.models.get(path);
    return gltf.scene.clone(true);
  }

  async gltf(path) {
    if (!this.models.has(path)) this.models.set(path, this.gltfLoader.loadAsync(this.url(path)));
    return this.models.get(path);
  }

  async getJSON(path) {
    if (!this.json.has(path)) this.json.set(path, fetch(this.url(path)).then(r => r.json()));
    return this.json.get(path);
  }

  /** Resolves once the loading manager has nothing pending. */
  idle() {
    return new Promise(res => {
      const check = () => {
        if (!this.manager.itemsLoading) res(); else setTimeout(check, 50);
      };
      check();
    });
  }
}

export const assets = new Assets();

// track loading count on the manager
const m = assets.manager;
m.itemsLoading = 0;
const s = m.itemStart.bind(m), e = m.itemEnd.bind(m), er = m.itemError.bind(m);
m.itemStart = (u) => { m.itemsLoading++; s(u); };
m.itemEnd = (u) => { m.itemsLoading--; e(u); };
m.itemError = (u) => { m.itemsLoading--; er(u); };
