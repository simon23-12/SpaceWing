import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const _sv = new THREE.Vector3(), _sz = new THREE.Vector2();

// Final grade: subtle vignette + film grain + chromatic fringe at the edges.
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, vignette: { value: 0.32 }, grain: { value: 0.035 }, hit: { value: 0 }, tint: { value: [1, 1, 1] }, tintAmt: { value: 0 }, flash: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float time, vignette, grain, hit, tintAmt, flash; uniform vec3 tint; varying vec2 vUv;
    float rnd(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)) + time*61.0) * 43758.5453); }
    void main(){
      vec2 c = vUv - 0.5; float d = dot(c,c);
      vec2 off = c * d * 0.012;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + off).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - off).b;
      float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(col, mix(col, vec3(lum), 0.25) * tint, tintAmt);
      col *= 1.0 - vignette * smoothstep(0.08, 0.6, d);
      col += (rnd(vUv*1000.0) - 0.5) * grain;
      col = mix(col, vec3(1.0,0.25,0.15), hit * smoothstep(0.05, 0.45, d));
      col = mix(col, vec3(0.85, 0.93, 1.0), flash);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

// Replaces NaN/Inf pixels before bloom so one bad fragment can never smear into a black block. Very hot pixels
// (a sun glint on a mirror-smooth canopy) are capped too, or the bloom smears them into a glowing square.
const SanitizeShader = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
    void main(){ vec4 c = texture2D(tDiffuse, vUv);
      bool ok = (c.r > -1.0 && c.r < 60000.0) && (c.g > -1.0 && c.g < 60000.0) && (c.b > -1.0 && c.b < 60000.0);
      gl_FragColor = ok ? vec4(min(c.rgb, vec3(14.0)), 1.0) : vec4(0.0, 0.0, 0.0, 1.0); }`,
};

// Lens flare of the sun: glare, a faint anamorphic streak, a halo ring and a few ghosts mirrored through the
// screen centre. Visibility is read from the frame itself (the sun's own pixels), so the ship, a moon or a
// station wall in front of the sun dims the flare without any extra occlusion pass.
const FlareShader = {
  uniforms: { tDiffuse: { value: null }, sunPos: { value: [0.5, 0.5] }, aspect: { value: 1 }, strength: { value: 0 }, px: { value: [0.001, 0.001] } },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec2 sunPos, px; uniform float aspect, strength; varying vec2 vUv;
    float lum(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
    float tap(vec2 o){ return smoothstep(1.2, 3.0, lum(texture2D(tDiffuse, sunPos + o * px).rgb)); }
    vec3 ghost(vec2 p, vec2 at, float r, vec3 col){
      float d = length(p - at) / r;
      return col * (smoothstep(1.0, 0.82, d) * (0.55 + 0.45 * d * d) + 0.25 * smoothstep(1.6, 0.0, d));
    }
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      if (strength <= 0.0) { gl_FragColor = vec4(c, 1.0); return; }
      float vis = (tap(vec2(0.0)) * 2.0 + tap(vec2(3.0, 0.0)) + tap(vec2(-3.0, 0.0)) + tap(vec2(0.0, 3.0)) + tap(vec2(0.0, -3.0))
                 + tap(vec2(2.0, 2.0)) + tap(vec2(-2.0, 2.0)) + tap(vec2(2.0, -2.0)) + tap(vec2(-2.0, -2.0))) / 10.0;
      vis *= strength;
      if (vis <= 0.001) { gl_FragColor = vec4(c, 1.0); return; }
      vec2 asp = vec2(aspect, 1.0);
      vec2 p = (vUv - 0.5) * asp, s = (sunPos - 0.5) * asp;
      vec2 d = p - s; float r = length(d);
      vec3 warm = vec3(1.0, 0.86, 0.66);
      vec3 f = vec3(0.0);
      // soft glare around the disc and a thin, cool anamorphic streak
      f += warm * (exp(-r * 11.0) * 0.16 + exp(-r * 40.0) * 0.5);
      f += vec3(0.55, 0.7, 1.0) * exp(-abs(d.y) * 500.0) * exp(-abs(d.x) * 5.5) * 0.22;
      // faint chromatic halo ring
      float ring = r - 0.29;
      f += vec3(exp(-pow((ring + 0.006) * 70.0, 2.0)), exp(-pow(ring * 70.0, 2.0)), exp(-pow((ring - 0.006) * 70.0, 2.0)))
           * vec3(0.9, 0.75, 0.6) * 0.0055 * smoothstep(0.05, 0.25, r);
      // ghosts along the line through the centre
      f += ghost(p, s * -0.35, 0.035, vec3(0.30, 0.55, 0.45)) * 0.10;
      f += ghost(p, s * -0.62, 0.075, vec3(0.45, 0.35, 0.75)) * 0.07;
      f += ghost(p, s * 0.42, 0.022, vec3(0.9, 0.6, 0.3)) * 0.12;
      f += ghost(p, s * -1.05, 0.13, vec3(0.35, 0.5, 0.8)) * 0.03;
      f += ghost(p, s * -1.4, 0.045, vec3(0.8, 0.5, 0.35)) * 0.08;
      f += ghost(p, s * -0.15, 0.012, vec3(0.6, 0.85, 1.0)) * 0.16;
      // slight veiling glare over the whole frame when looking into the sun
      f += warm * 0.012;
      gl_FragColor = vec4(c + f * vis, 1.0);
    }`,
};

export class Renderer {
  constructor(canvas) {
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', logarithmicDepthBuffer: true, stencil: false });
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1.0;
    this.gl.autoClear = false;

    const size = this.gl.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.gl, rt);
    this.passFar = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
    this.passNear = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
    this.passNear.clear = false;
    this.passNear.clearDepth = true;
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.3, 0.45, 0.9);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.passFar);
    this.composer.addPass(this.passNear);
    this.composer.addPass(new ShaderPass(SanitizeShader));
    this.flare = new ShaderPass(FlareShader);
    this.composer.addPass(this.flare);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.composer.addPass(this.grade);
    window.addEventListener('resize', () => this.resize());
    this.cameras = [];
    this.resize();
  }

  /** far: {scene, camera} rendered first (km units), near: {scene, camera} on top (m units). near may be null. */
  setLayers(far, near) {
    this.passFar.scene = far.scene; this.passFar.camera = far.camera;
    this.far = far;
    this.passNear.enabled = !!near;
    if (near) { this.passNear.scene = near.scene; this.passNear.camera = near.camera; }
    this.cameras = [far.camera, near && near.camera].filter(Boolean);
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.gl.setSize(w, h, false);
    this.composer.setSize(w, h);
    for (const c of this.cameras) { c.aspect = w / h; c.updateProjectionMatrix(); }
  }

  /** Per-moon colour mood (null resets). */
  setMood(m) {
    const u = this.grade.uniforms;
    u.tint.value = m ? m.tint : [1, 1, 1];
    u.tintAmt.value = m ? m.amt : 0;
    this.gl.toneMappingExposure = m ? m.exposure : 1.0;
    u.flash.value = 0; u.hit.value = 0;
  }

  /**
   * Warm-up behind the loading screen: compile every shader of the scene and upload its textures now, so the
   * first frames (and the first look into another room) do not stutter. Hidden objects are included.
   */
  async warm(scene, camera) {
    const hidden = [];
    scene.traverse(o => { if (!o.visible) { hidden.push(o); o.visible = true; } });
    const seen = new Set();
    scene.traverse(o => {
      for (const m of [].concat(o.material || [])) {
        for (const k of ['map', 'lightMap', 'aoMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'alphaMap']) {
          const t = m[k];
          if (t && !seen.has(t) && t.image) { seen.add(t); try { this.gl.initTexture(t); } catch { } }
        }
      }
    });
    try { await (this.gl.compileAsync ? this.gl.compileAsync(scene, camera) : this.gl.compile(scene, camera)); } catch (e) { console.warn('warm-up', e); }
    for (const o of hidden) o.visible = false;
  }

  /** Where the far layer's sun lands on screen; the flare fades out towards the edges and behind the camera. */
  updateFlare() {
    const u = this.flare.uniforms, sun = this.far?.sunSprite, cam = this.far?.camera;
    u.strength.value = 0;
    if (!sun || !sun.visible || !cam) return;
    cam.updateMatrixWorld();
    _sv.copy(sun.position).applyMatrix4(cam.matrixWorldInverse);
    if (_sv.z >= 0) return;
    _sv.applyMatrix4(cam.projectionMatrix);
    const x = _sv.x * 0.5 + 0.5, y = _sv.y * 0.5 + 0.5;
    const edge = Math.min(x, 1 - x, y, 1 - y);
    if (edge < 0.003) return;
    u.sunPos.value = [x, y];
    u.strength.value = Math.min(1, edge / 0.06);
    u.aspect.value = cam.aspect;
    const size = this.gl.getDrawingBufferSize(_sz);
    u.px.value = [1 / size.x, 1 / size.y];
  }

  render(dt) {
    this.grade.uniforms.time.value += dt;
    this.updateFlare();
    this.composer.render(dt);
  }
}
