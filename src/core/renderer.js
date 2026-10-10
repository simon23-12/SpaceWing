import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

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

// Replaces NaN/Inf pixels before bloom so one bad fragment can never smear into a black block.
const SanitizeShader = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
    void main(){ vec4 c = texture2D(tDiffuse, vUv);
      bool ok = (c.r > -1.0 && c.r < 60000.0) && (c.g > -1.0 && c.g < 60000.0) && (c.b > -1.0 && c.b < 60000.0);
      gl_FragColor = ok ? vec4(c.rgb, 1.0) : vec4(0.0, 0.0, 0.0, 1.0); }`,
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
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.55, 0.6, 0.82);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.passFar);
    this.composer.addPass(this.passNear);
    this.composer.addPass(new ShaderPass(SanitizeShader));
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
    u.flash.value = 0;
  }

  render(dt) {
    this.grade.uniforms.time.value += dt;
    this.composer.render(dt);
  }
}
