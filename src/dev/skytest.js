import * as THREE from 'three';
import { Renderer } from '../core/renderer.js';
import { SkyLayer } from '../space/skyLayer.js';
import { zoneAnchor, BODIES } from '../space/universe.js';

const r = new Renderer(document.getElementById('c'));
const sky = new SkyLayer();
const near = { scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(70, 1, 0.1, 1e5) };
r.setLayers(sky, near);
const params = new URLSearchParams(location.search);
const zone = params.get('zone') || 'rhea';
const a = params.get('pos') ? params.get('pos').split(',').map(Number) : zoneAnchor(zone);
sky.setOrigin(...a);
let yaw = +(params.get('yaw') || 0), pitch = +(params.get('pitch') || 0);
const look = params.get('look');
if (look) {
  const t = look === 'saturn' ? [0, 0, 0] : BODIES[look].pos;
  const d = new THREE.Vector3(t[0] - a[0], t[1] - a[1], t[2] - a[2]).normalize();
  near.camera.lookAt(d);
} 
near.camera.fov = +(params.get('fov') || 70); near.camera.updateProjectionMatrix();
let drag = false;
addEventListener('mousedown', () => drag = true); addEventListener('mouseup', () => drag = false);
addEventListener('mousemove', e => { if (!drag) return; near.camera.rotateY(-e.movementX * 0.003); near.camera.rotateX(-e.movementY * 0.003); });
let last = performance.now();
function loop(t) {
  const dt = (t - last) / 1000; last = t;
  sky.syncCamera(near.camera); sky.update(dt);
  r.render(dt);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
window.__sky = sky; window.__cam = near.camera; window.__r = r; window.__near = near;

// --- ship test
import { ShipModel } from '../space/shipModel.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
const shipId = params.get('ship');
if (shipId) {
  const sun = new THREE.DirectionalLight(0xfff1e0, 3.2); sun.position.copy(sky.sunDir); near.scene.add(sun);
  near.scene.add(new THREE.HemisphereLight(0x8a7a60, 0x0a0c10, 0.35));
  // environment: capture far layer into a cubemap
  const cubeRT = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType });
  const cubeCam = new THREE.CubeCamera(1, 2e8, cubeRT);
  sky.scene.add(cubeCam); cubeCam.update(r.gl, sky.scene);
  const pm = new THREE.PMREMGenerator(r.gl);
  near.scene.environment = pm.fromCubemap(cubeRT.texture).texture;
  near.scene.environmentIntensity = 1.0;
  ShipModel.load(shipId, { paint: params.get('paint') }).then(s => {
    near.scene.add(s.root);
    s.root.position.set(0, -1.5, -20).applyQuaternion(near.camera.quaternion);
    s.root.quaternion.copy(near.camera.quaternion); s.root.rotateY(+(params.get('rot') || 2.4)); s.root.rotateX(0.25);
    window.__ship = s;
    const tick = () => { s.update(0.016, 0.7); requestAnimationFrame(tick); }; tick();
  });
}
