import * as THREE from 'three';
// Pixel font for the label and sound button, bundled from npm (no external font request).
import '@fontsource/pixelify-sans/400.css';
import '@fontsource/pixelify-sans/600.css';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import Stats from 'three/addons/libs/stats.module.js';
import { loadModel, upgradeToClearcoat } from './loaders.js';
import { createVinylMaterial, VINYL_LABEL_RATIO } from './materials.js';
import { HoverController } from './hover.js';
import { buildShelf, poseSleeve, SLEEVE_SIZE } from './shelf.js';
import { PIXEL } from './pixel.js';
import { HoverAudio } from './audio.js';
import { buildKnickKnacks } from './knickknacks.js';

// Draco-compressed models to place in the scene. Put .glb files in public/models/.
// Compress any glTF with: npm run compress -- input.glb public/models/output.glb
const MODELS = [
  // { url: '/models/turntable.glb', position: [0, 4.65, -0.1], scale: 1 },
];

const damp = THREE.MathUtils.damp;

/* ---------------- Renderer ---------------- */

const container = document.getElementById('app');
const labelEl = document.getElementById('label');
const soundBtn = document.getElementById('sound');

const PIXELATE_SCENE = PIXEL.enabled && PIXEL.scene > 1;
// Antialiasing would only smooth the final upscale, so it's off when pixelating.
const renderer = new THREE.WebGLRenderer({ antialias: !PIXELATE_SCENE, powerPreference: 'high-performance' });
const MAX_PIXEL_RATIO = Math.min(window.devicePixelRatio, 2); // >2x costs a lot of fill rate for little gain
let pixelRatio = MAX_PIXEL_RATIO;
renderer.setPixelRatio(pixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false; // re-render shadows only while something moves
renderer.shadowMap.needsUpdate = true;
container.appendChild(renderer.domElement);

const maxAnisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);

/* ---------------- Whole-scene pixelation ---------------- */

// The scene renders into a small offscreen image (1/PIXEL.scene of the window
// size), which is then stretched over the screen with hard pixel edges. Tone
// mapping happens in that final step, so colors match the unpixelated version.
// It's also cheaper: the GPU shades about 1/9 of the pixels at scene: 3.
let pixelTarget = null;
let blitScene = null;
const blitCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

if (PIXELATE_SCENE) {
  pixelTarget = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType, // keeps bright highlights intact until tone mapping
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    generateMipmaps: false,
  });
  blitScene = new THREE.Scene();
  blitScene.add(new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.MeshBasicMaterial({ map: pixelTarget.texture, depthTest: false, depthWrite: false }),
  ));
}

function sizePixelTarget() {
  pixelTarget?.setSize(
    Math.max(1, Math.round(window.innerWidth / PIXEL.scene)),
    Math.max(1, Math.round(window.innerHeight / PIXEL.scene)),
  );
}
sizePixelTarget();

function renderFrame() {
  if (!pixelTarget) {
    renderer.render(scene, camera);
    return;
  }
  renderer.setRenderTarget(pixelTarget);
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  renderer.render(blitScene, blitCamera);
}

/* ---------------- Scene ---------------- */

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x15110e);

// Clearcoat needs something to reflect. A prefiltered room environment gives
// soft studio reflections for the cost of one texture lookup.
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.4;
// The sleeves lean back, so untilted they mirror the room's bright ceiling
// lights and dark covers wash out. Tilting the environment avoids that.
scene.environmentRotation.x = 0.9;
pmrem.dispose();

const shelf = buildShelf({ maxAnisotropy });
scene.add(shelf.group);
const center = new THREE.Vector3(0, shelf.size.y / 2 + 0.2, 0);

// Personal knick-knacks on floating shelves either side.
const deco = buildKnickKnacks({ shelfSize: shelf.size, maxAnisotropy });
scene.add(deco.group);
const sceneSize = new THREE.Vector2(deco.width, shelf.size.y + 1.3); // room for the plant on top

const wall = new THREE.Mesh(
  new THREE.PlaneGeometry(40, 20),
  new THREE.MeshStandardMaterial({ color: 0x2a221c, roughness: 0.95 }),
);
wall.position.set(0, 4, -0.36);
wall.receiveShadow = true;
scene.add(wall);

// Warm key light, angled so the clearcoat picks up a highlight across the sleeves.
const key = new THREE.DirectionalLight(0xffe2c4, 2.2);
key.position.set(4, 7, 6);
key.target.position.copy(center);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.02;
Object.assign(key.shadow.camera, { left: -9.5, right: 9.5, top: 5, bottom: -4.5, near: 1, far: 22 });
scene.add(key, key.target);

/* ---------------- Vinyl (one shared disc) ---------------- */

// A single disc follows whichever sleeve is hovered and slides out of its top edge.
const DISC_RADIUS = 0.48;
const disc = new THREE.Mesh(new THREE.CircleGeometry(DISC_RADIUS, 96), createVinylMaterial());
disc.castShadow = true;
const labelMat = new THREE.MeshPhysicalMaterial({ roughness: 0.5, clearcoat: 0.3 });
const discLabel = new THREE.Mesh(new THREE.CircleGeometry(DISC_RADIUS * VINYL_LABEL_RATIO, 48), labelMat);
discLabel.position.z = 0.001;
disc.add(discLabel);
disc.visible = false;

let discOwner = null;
let discOut = 0; // 0 = hidden inside the sleeve, 1 = halfway out

/* ---------------- Optional Draco models ---------------- */

for (const { url, position = [0, 0, 0], scale = 1 } of MODELS) {
  loadModel(url)
    .then((model) => {
      upgradeToClearcoat(model, { clearcoat: 0.8, clearcoatRoughness: 0.12 });
      model.position.fromArray(position);
      model.scale.setScalar(scale);
      scene.add(model);
      renderer.shadowMap.needsUpdate = true;
    })
    .catch((err) => console.warn(`Could not load ${url}`, err));
}

/* ---------------- Camera ---------------- */

const camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.1, 60);
const camBase = new THREE.Vector3();

function fitCamera() {
  const halfV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const dist = Math.max(
    (sceneSize.y / 2) / halfV,
    (sceneSize.x / 2) / (halfV * camera.aspect),
  ) * 1.06;
  camBase.set(center.x, center.y + 0.3, dist);
}
fitCamera();
camera.position.copy(camBase);
camera.lookAt(center);

/* ---------------- Interaction ---------------- */

const hover = new HoverController(camera, renderer.domElement, [...shelf.proxies, ...deco.proxies]);
const audio = new HoverAudio();
let hovered = null;

const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function updateLabel() {
  // Some knick-knacks (the plants) have a hover sound but no label.
  if (!hovered || (hovered.caption && !hovered.caption.title)) {
    labelEl.classList.remove('visible');
    return;
  }
  if (hovered.album) {
    const { title, artist, track } = hovered.album;
    const playing = audio.enabled && track ? `<em>♪ ${escapeHtml(track)}</em>` : '';
    labelEl.innerHTML = `${escapeHtml(title)}<small>${escapeHtml(artist)}</small>${playing}`;
  } else {
    const { title, sub } = hovered.caption;
    labelEl.innerHTML = escapeHtml(title) + (sub ? `<small>${escapeHtml(sub)}</small>` : '');
  }
  labelEl.classList.add('visible');
}

function setHovered(item) {
  if (item === hovered) return;
  hovered = item;
  renderer.domElement.style.cursor = item ? 'pointer' : '';
  audio.setAlbum(item?.album ?? null);
  if (item?.caption) {
    deco.enter(item);
    if (item.caption.sound) audio.sfx(item.caption.sound);
  }
  updateLabel();
}

// Browsers only allow audio after a click, so sound starts off.
soundBtn.addEventListener('click', async () => {
  if (audio.enabled) audio.disable();
  else await audio.enable();
  soundBtn.textContent = audio.enabled ? '♪ Sound on' : '♪ Sound off';
  soundBtn.classList.toggle('on', audio.enabled);
  updateLabel();
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  sizePixelTarget();
  fitCamera();
});

/* ---------------- Perf monitoring ---------------- */

let stats = null;
if (import.meta.env.DEV) {
  stats = new Stats();
  document.body.appendChild(stats.dom);
  window.__vinyl = { renderer, scene, camera, shelf, audio }; // handy for poking at in DevTools
}

// If frames run slow (weak GPU, 4K screen), drop the render resolution a step.
let perfFrames = 0;
let perfTime = 0;
function adaptResolution(rawDt) {
  if (rawDt > 0.25) { perfFrames = perfTime = 0; return; } // tab was hidden; ignore
  perfFrames++;
  perfTime += rawDt;
  if (perfTime < 2) return;
  const fps = perfFrames / perfTime;
  perfFrames = perfTime = 0;
  if (fps < 50 && pixelRatio > 1) {
    pixelRatio = Math.max(1, pixelRatio - 0.25);
    renderer.setPixelRatio(pixelRatio);
  }
}

/* ---------------- Loop ---------------- */

let last = performance.now();
const lookTarget = new THREE.Vector3();

renderer.setAnimationLoop((now) => {
  const rawDt = (now - last) / 1000;
  const dt = Math.min(rawDt, 1 / 20); // avoid jumps after a stall
  last = now;

  // Subtle parallax: the camera drifts toward the pointer.
  const px = hover.pointer.x, py = hover.pointer.y;
  const prevX = camera.position.x, prevY = camera.position.y;
  camera.position.x = damp(camera.position.x, camBase.x + px * 0.4, 3, dt);
  camera.position.y = damp(camera.position.y, camBase.y + py * 0.25, 3, dt);
  camera.position.z = camBase.z;
  lookTarget.copy(center);
  camera.lookAt(lookTarget);
  const camMoved = Math.abs(camera.position.x - prevX) + Math.abs(camera.position.y - prevY) > 1e-5;

  const hit = hover.update(camMoved);
  setHovered(hit ? hit.object.userData.item : null);

  // Sleeves ease in and out. Damping is frame-rate independent.
  let animating = false;
  for (const item of shelf.items) {
    const active = item === hovered;
    let tx = 0, ty = 0;
    if (active && hit.uv && hit.face.normal.z > 0.5) {
      ty = (hit.uv.x - 0.5) * 0.22;   // turn toward the cursor
      tx = -(hit.uv.y - 0.5) * 0.18;
    } else if (active) {
      tx = item.tiltX; ty = item.tiltY;
    }
    const target = active ? 1 : 0;
    item.hover = damp(item.hover, target, 9, dt);
    item.tiltX = damp(item.tiltX, tx, 7, dt);
    item.tiltY = damp(item.tiltY, ty, 7, dt);

    const moving = Math.abs(item.hover - target) > 1e-3 || Math.abs(item.tiltX - tx) > 1e-4 || Math.abs(item.tiltY - ty) > 1e-4;
    if (!moving) { item.hover = target; item.tiltX = tx; item.tiltY = ty; }
    if (moving || active) { poseSleeve(item); animating ||= moving; }
  }

  // Knick-knacks: hover animations, guitar swing, steam, blinking cursor.
  animating = deco.update(dt, hovered) || animating;

  // Disc: retract into the old sleeve before moving to the new one.
  const hoveredSleeve = hovered?.album ? hovered : null;
  if (discOwner !== hoveredSleeve) {
    discOut = damp(discOut, 0, 14, dt);
    if (discOut < 0.02) {
      discOut = 0;
      discOwner?.sleeve.remove(disc);
      discOwner = hoveredSleeve;
      if (discOwner) {
        discOwner.sleeve.add(disc);
        labelMat.color.set(discOwner.album.colors[1]);
      }
      disc.visible = !!discOwner;
    }
    animating = true;
  } else if (discOwner) {
    const before = discOut;
    discOut = damp(discOut, 1, 6, dt);
    animating ||= Math.abs(discOut - before) > 1e-4;
  }
  if (discOwner) {
    disc.position.set(0, discOut * SLEEVE_SIZE * 0.45, 0);
    disc.rotation.z += dt * discOut * 0.6;
  }

  if (animating) renderer.shadowMap.needsUpdate = true;

  renderFrame();
  stats?.update();
  adaptResolution(rawDt);
});
