import * as THREE from 'three';
import { BODIES, SATURN, SUN_DIR } from './universe.js';
import { assets } from '../core/assets.js';

const sunDir = new THREE.Vector3(...SUN_DIR).normalize();

const saturnVert = `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec2 vUv; varying vec3 vN; varying vec3 vLocal; varying vec3 vView;
  void main(){
    vUv = uv; vLocal = position * vec3(1.0, ${(SATURN.polar / SATURN.radius).toFixed(5)}, 1.0);
    vN = normalize(mat3(modelMatrix) * normal * vec3(1.0, ${(SATURN.radius / SATURN.polar).toFixed(5)}, 1.0));
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vView = normalize(cameraPosition - wp.xyz);
    gl_Position = projectionMatrix * viewMatrix * wp;
    #include <logdepthbuf_vertex>
  }`;
const saturnFrag = `
  uniform sampler2D map, ringTex; uniform vec3 sunDir; uniform float rIn, rOut, radius;
  varying vec2 vUv; varying vec3 vN; varying vec3 vLocal; varying vec3 vView;
  #include <logdepthbuf_pars_fragment>
  void main(){
    #include <logdepthbuf_fragment>
    vec3 N = normalize(vN);
    vec3 alb = texture2D(map, vUv).rgb;
    float ndl = dot(N, sunDir);
    float ndv = max(dot(N, vView), 0.0);
    // Minnaert-ish limb darkening for a gas giant
    float lit = pow(max(ndl, 0.0), 0.85) * pow(max(ndv, 1e-4), 0.12);
    // ring shadow: march from surface point toward the sun to the ring plane
    vec3 P = vLocal * radius;
    float shadow = 1.0;
    if (abs(sunDir.y) > 1e-4) {
      float t = -P.y / sunDir.y;
      if (t > 0.0) {
        vec3 H = P + sunDir * t;
        float r = length(H.xz);
        if (r > rIn && r < rOut) {
          float a = texture2D(ringTex, vec2((r - rIn) / (rOut - rIn), 0.5)).a;
          shadow = 1.0 - a * 0.92;
        }
      }
    }
    // faint ringshine on the night side
    float ringshine = 0.018 * smoothstep(0.0, 0.6, -N.y * sign(sunDir.y) + 0.3) * (1.0 - max(ndl, 0.0));
    vec3 col = alb * (lit * shadow * 1.35 + ringshine);
    // terminator warmth + atmospheric rim
    float rim = pow(clamp(1.0 - ndv, 0.0, 1.0), 3.0) * smoothstep(-0.15, 0.3, ndl);
    col += vec3(0.85, 0.72, 0.5) * rim * 0.35;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

const ringVert = `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec3 vLocal; varying vec3 vWorld;
  void main(){
    vLocal = position;
    vec4 wp = modelMatrix * vec4(position, 1.0); vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
    #include <logdepthbuf_vertex>
  }`;
const ringFrag = `
  uniform sampler2D ringTex; uniform vec3 sunDir; uniform float rIn, rOut, radius, polar;
  varying vec3 vLocal; varying vec3 vWorld;
  #include <logdepthbuf_pars_fragment>
  void main(){
    #include <logdepthbuf_fragment>
    float r = length(vLocal.xz);
    if (r < rIn || r > rOut) discard;
    vec4 rt = texture2D(ringTex, vec2((r - rIn) / (rOut - rIn), 0.5));
    float a = rt.a;
    vec3 viewDir = normalize(cameraPosition - vWorld);
    // Saturn's shadow on the rings (oblate spheroid test)
    vec3 P = vLocal; vec3 D = sunDir;
    vec3 Ps = P * vec3(1.0, radius/polar, 1.0); vec3 Ds = normalize(D * vec3(1.0, radius/polar, 1.0));
    float b = dot(Ps, Ds); float c = dot(Ps, Ps) - radius*radius;
    float h = b*b - c;
    float shadow = (h > 0.0 && -b - sqrt(h) > 0.0) ? 0.03 : 1.0;
    // lit face vs. unlit face (diffuse transmission through the ring)
    bool sameSide = sign(cameraPosition.y - 0.0 - (vWorld.y - vLocal.y)) == sign(sunDir.y);
    float mu0 = abs(sunDir.y);
    float phase = 0.5 + 0.5 * pow(max(dot(-viewDir, sunDir), 0.0), 6.0) * 2.0;
    vec3 col;
    if (sameSide) col = rt.rgb * (0.25 + 1.6 * mu0) * 0.95;
    else col = rt.rgb * a * (1.0 - a) * 3.2 * phase + rt.rgb * 0.02;
    col *= shadow;
    // edge-on: opacity rises with path length
    float mu = abs(dot(viewDir, vec3(0.0,1.0,0.0)));
    float alpha = 1.0 - pow(clamp(1.0 - a, 0.0, 1.0), 1.0 / max(mu, 0.04));
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

const atmoVert = `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec3 vN; varying vec3 vView;
  void main(){
    vN = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vView = normalize(cameraPosition - wp.xyz);
    gl_Position = projectionMatrix * viewMatrix * wp;
    #include <logdepthbuf_vertex>
  }`;
const atmoFrag = `
  uniform vec3 sunDir, color; uniform float power, strength;
  varying vec3 vN; varying vec3 vView;
  #include <logdepthbuf_pars_fragment>
  void main(){
    #include <logdepthbuf_fragment>
    float ndv = max(dot(normalize(vN), vView), 0.0);
    float rim = pow(clamp(1.0 - ndv, 0.0, 1.0), power);
    float l = smoothstep(-0.35, 0.4, dot(normalize(vN), sunDir));
    float fwd = pow(max(dot(-vView, sunDir), 0.0), 8.0);
    gl_FragColor = vec4(color * rim * (l + fwd * 2.0) * strength, 1.0);
  }`;

const plumeVert = `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec3 vP; varying vec3 vW; varying vec3 vN;
  void main(){ vP = position; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w;
  #include <logdepthbuf_vertex>
  }`;
const plumeFrag = `
  uniform vec3 sunDir; uniform float time, len;
  varying vec3 vP; varying vec3 vW; varying vec3 vN;
  #include <logdepthbuf_pars_fragment>
  float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }
  float noise(vec3 p){ vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
    return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
               mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z); }
  void main(){
    #include <logdepthbuf_fragment>
    float h = clamp((-vP.y - 240.0) / len, 0.0, 1.0);
    vec3 view = normalize(cameraPosition - vW);
    float soft = pow(clamp(abs(dot(normalize(vN), view)), 0.0, 1.0), 2.0);
    float ang = atan(vP.z, vP.x);
    float streaks = 0.5 + 0.5 * noise(vec3(ang * 6.0, h * 3.0 - time * 0.03, 0.0));
    float n = noise(vP * 0.015 + vec3(0.0, time * 0.04, 0.0));
    float d = soft * pow(clamp(1.0 - h, 0.0, 1.0), 2.2) * (0.3 + 0.7 * streaks) * (0.5 + n);
    float fwd = 0.3 + 2.8 * pow(max(dot(-view, sunDir), 0.0), 4.0);
    gl_FragColor = vec4(vec3(0.75, 0.85, 1.0) * d * fwd * 0.09, 1.0);
  }`;

function makeSunTexture() {
  const s = 256, c = document.createElement('canvas'); c.width = c.height = s;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.04, 'rgba(255,250,235,1)');
  grd.addColorStop(0.12, 'rgba(255,225,170,0.35)');
  grd.addColorStop(0.35, 'rgba(255,190,120,0.08)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, s, s);
  // faint anamorphic streak
  const st = g.createLinearGradient(0, 0, s, 0);
  st.addColorStop(0, 'rgba(160,190,255,0)'); st.addColorStop(0.5, 'rgba(200,220,255,0.55)'); st.addColorStop(1, 'rgba(160,190,255,0)');
  g.fillStyle = st; g.fillRect(0, s / 2 - 1.5, s, 3);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** The far layer: sky, Saturn, rings, moons, sun. Units: km. Camera sits at origin; bodies are offset. */
export class SkyLayer {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, 1, 1, 2e8);
    this.origin = new THREE.Vector3(); // camera position in system space (km, double precision in JS)
    this.sunDir = sunDir.clone();

    const sky = assets.tex('assets/sky/milkyway.jpg');
    sky.mapping = THREE.EquirectangularReflectionMapping;
    sky.colorSpace = THREE.SRGBColorSpace;
    this.scene.background = sky;
    this.scene.backgroundIntensity = 0.55;

    this.sun = new THREE.DirectionalLight(0xfff4e6, 3.0);
    this.sun.position.copy(sunDir);
    this.scene.add(this.sun);
    this.scene.add(new THREE.AmbientLight(0x1a1c22, 0.25));

    const ringTex = assets.tex('assets/planets/rings.png');
    ringTex.colorSpace = THREE.SRGBColorSpace;
    ringTex.wrapS = ringTex.wrapT = THREE.ClampToEdgeWrapping;
    ringTex.anisotropy = 8;
    const satTex = assets.tex('assets/planets/saturn.jpg');
    satTex.colorSpace = THREE.SRGBColorSpace; satTex.anisotropy = 8;

    // Saturn
    this.saturn = new THREE.Group();
    const sGeo = new THREE.SphereGeometry(1, 192, 128);
    const sMat = new THREE.ShaderMaterial({
      vertexShader: saturnVert, fragmentShader: saturnFrag,
      uniforms: { map: { value: satTex }, ringTex: { value: ringTex }, sunDir: { value: sunDir }, rIn: { value: SATURN.ringInner }, rOut: { value: SATURN.ringOuter }, radius: { value: SATURN.radius } },
    });
    const sMesh = new THREE.Mesh(sGeo, sMat);
    sMesh.scale.set(SATURN.radius, SATURN.polar, SATURN.radius);
    this.saturn.add(sMesh);
    const atmo = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 64), new THREE.ShaderMaterial({
      vertexShader: atmoVert, fragmentShader: atmoFrag, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      uniforms: { sunDir: { value: sunDir }, color: { value: new THREE.Color(0.95, 0.8, 0.55) }, power: { value: 4.0 }, strength: { value: 0.45 } },
    }));
    atmo.scale.set(SATURN.radius * 1.012, SATURN.polar * 1.012, SATURN.radius * 1.012);
    this.saturn.add(atmo);
    const rGeo = new THREE.RingGeometry(SATURN.ringInner, SATURN.ringOuter, 512, 4);
    rGeo.rotateX(-Math.PI / 2);
    const rMat = new THREE.ShaderMaterial({
      vertexShader: ringVert, fragmentShader: ringFrag, transparent: true, side: THREE.DoubleSide, depthWrite: false,
      uniforms: { ringTex: { value: ringTex }, sunDir: { value: sunDir }, rIn: { value: SATURN.ringInner }, rOut: { value: SATURN.ringOuter }, radius: { value: SATURN.radius }, polar: { value: SATURN.polar } },
    });
    this.rings = new THREE.Mesh(rGeo, rMat);
    this.rings.renderOrder = 2;
    this.saturn.add(this.rings);
    this.scene.add(this.saturn);

    // Moons
    this.moons = {};
    for (const [id, b] of Object.entries(BODIES)) {
      const map = assets.tex(`assets/planets/${b.tex}.jpg`);
      map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 8;
      const bump = assets.tex(`assets/planets/${b.tex}_h.jpg`);
      const mat = new THREE.MeshStandardMaterial({ map, bumpMap: bump, bumpScale: 2.5, roughness: 1, metalness: 0 });
      const m = new THREE.Mesh(new THREE.SphereGeometry(b.radius, 160, 100), mat);
      m.userData.pos = new THREE.Vector3(...b.pos);
      this.scene.add(m);
      this.moons[id] = m;
      if (b.atmosphere) {
        const a = new THREE.Mesh(new THREE.SphereGeometry(b.radius * 1.06, 96, 64), new THREE.ShaderMaterial({
          vertexShader: atmoVert, fragmentShader: atmoFrag, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.FrontSide,
          uniforms: { sunDir: { value: sunDir }, color: { value: new THREE.Color(...b.atmosphere) }, power: { value: 2.2 }, strength: { value: 1.3 } },
        }));
        m.add(a);
      }
    }

    // Sun glare sprite (very far away along sunDir)
    this.sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeSunTexture(), blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true, color: new THREE.Color(6, 5.6, 5) }));
    this.sunSprite.scale.setScalar(3.2e6);
    this.scene.add(this.sunSprite);
    // Enceladus geysers (south pole plumes)
    const enc = this.moons.enceladus;
    if (enc) {
      this.plumeMat = new THREE.ShaderMaterial({ vertexShader: plumeVert, fragmentShader: plumeFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        uniforms: { sunDir: { value: sunDir }, time: { value: 0 }, len: { value: 900 } } });
      const geo = new THREE.CylinderGeometry(40, 520, 900, 48, 24, true);
      geo.translate(0, -450 - 240, 0);
      const plume = new THREE.Mesh(geo, this.plumeMat);
      plume.renderOrder = 3;
      enc.add(plume);
      this.plume = plume;
    }
  }

  /** Update positions relative to the camera's system position (km). */
  setOrigin(x, y, z) {
    this.origin.set(x, y, z);
    this.saturn.position.set(-x, -y, -z);
    for (const m of Object.values(this.moons)) m.position.set(m.userData.pos.x - x, m.userData.pos.y - y, m.userData.pos.z - z);
    this.sunSprite.position.copy(sunDir).multiplyScalar(6e7);
  }

  syncCamera(nearCam) {
    this.camera.quaternion.copy(nearCam.quaternion);
    this.camera.fov = nearCam.fov;
    this.camera.aspect = nearCam.aspect;
    this.camera.updateProjectionMatrix();
  }

  update(dt) {
    if (this.plumeMat) this.plumeMat.uniforms.time.value += dt;
  }
}
