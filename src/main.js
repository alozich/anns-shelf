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
import { reducedMotion } from './motion.js';

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
// Viewport size, excluding the page scrollbar.
const viewW = () => document.documentElement.clientWidth;
const viewH = () => window.innerHeight;

const renderer = new THREE.WebGLRenderer({ antialias: !PIXELATE_SCENE, powerPreference: 'high-performance' });
const MAX_PIXEL_RATIO = Math.min(window.devicePixelRatio, 2); // >2x costs a lot of fill rate for little gain
let pixelRatio = MAX_PIXEL_RATIO;
renderer.setPixelRatio(pixelRatio);
renderer.setSize(viewW(), viewH());
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

// On small screens everything is drawn smaller, so use finer pixels there
// (down to 1.5) to keep album covers recognizable.
const pixelSize = () => Math.max(1.5, Math.min(PIXEL.scene, viewW() / 330));

function sizePixelTarget() {
  pixelTarget?.setSize(
    Math.max(1, Math.round(viewW() / pixelSize())),
    Math.max(1, Math.round(viewH() / pixelSize())),
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
// Vertical extent of everything on the wall (plant on top to the shelf's base).
const sceneTop = shelf.size.y + 0.85;
const sceneBottom = -0.45;

// Personal knick-knacks on floating shelves either side.
const deco = buildKnickKnacks({ shelfSize: shelf.size, maxAnisotropy });
scene.add(deco.group);
// The camera is framed for a 4-row shelf so covers stay the same size however
// many albums there are; taller shelves scroll.
const VIEW_HEIGHT = 4 * 1.55 + 0.15 + 1.3;
const sceneSize = new THREE.Vector2(deco.width, Math.min(sceneTop - sceneBottom, VIEW_HEIGHT));

const wall = new THREE.Mesh(
  new THREE.PlaneGeometry(40, 20),
  new THREE.MeshStandardMaterial({ color: 0x2a221c, roughness: 0.95 }),
);
wall.position.set(0, 4, -0.36);
wall.receiveShadow = true;
scene.add(wall);

// Warm key light, angled so the clearcoat picks up a highlight across the sleeves.
const key = new THREE.DirectionalLight(0xffe2c4, 2.2);
key.position.set(4, center.y + 3.6, 6); // stays above the shelf's middle however tall it gets
key.target.position.copy(center);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.02;
const shadowHalf = (sceneTop - sceneBottom) / 2 + 1;
Object.assign(key.shadow.camera, { left: -9.5, right: 9.5, top: shadowHalf, bottom: -shadowHalf, near: 1, far: 26 });
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

const camera = new THREE.PerspectiveCamera(35, viewW() / viewH(), 0.1, 60);
const camBase = new THREE.Vector3();

/* ---------------- Scrolling ---------------- */

// The canvas stays fixed; a spacer gives the page real scrollbars, and the
// scroll position slides the camera across the wall. On portrait screens
// (phones) the record shelf fills the width and the side areas scroll in
// from the left and right.
const scrollSpace = document.getElementById('scroll-space');
const SCROLL_MARGIN = 0.4;   // breathing room above the plant and below the shelf
const sceneLeft = -deco.width / 2;
let visibleHeight = 1;       // world units visible top to bottom (at the shelf)
let visibleWidth = 1;
let scrollRange = 0;         // world units of wall below the first screenful
let scrollRangeX = 0;        // world units of wall beyond the screen's width
let pixelsPerUnit = 1;

function fitCamera() {
  const halfV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const portrait = camera.aspect < 1;
  const fitWidth = portrait ? shelf.size.x + 0.6 : sceneSize.x;
  const dist = Math.max(
    portrait ? 0 : (sceneSize.y / 2) / halfV,
    (fitWidth / 2) / (halfV * camera.aspect),
  ) * 1.06;
  camBase.set(center.x, 0, dist);
  visibleHeight = 2 * dist * halfV;
  visibleWidth = visibleHeight * camera.aspect;
  scrollRange = Math.max(0, sceneTop - sceneBottom + SCROLL_MARGIN * 2 - visibleHeight);
  scrollRangeX = Math.max(0, deco.width - visibleWidth);
  pixelsPerUnit = viewH() / visibleHeight;
  scrollSpace.style.height = `${Math.ceil(viewH() + scrollRange * pixelsPerUnit)}px`;
  scrollSpace.style.width = `${Math.floor(viewW() + scrollRangeX * pixelsPerUnit)}px`;
}

// Start horizontally centred on the record shelf.
function centerHorizontally() {
  if (scrollRangeX > 0) window.scrollTo({ left: (scrollRangeX / 2) * pixelsPerUnit, top: window.scrollY });
}

// Where the camera looks across the wall for the current horizontal scroll.
function viewCenterX() {
  if (scrollRangeX <= 0) return center.x;
  const scrolled = Math.min(scrollRangeX, window.scrollX / pixelsPerUnit);
  return sceneLeft + visibleWidth / 2 + scrolled;
}

// Height the camera looks at for the current scroll position.
function viewCenterY() {
  if (scrollRange <= 0) return (sceneTop + sceneBottom) / 2 + 0.2;
  const scrolled = Math.min(scrollRange, window.scrollY / pixelsPerUnit);
  return sceneTop + SCROLL_MARGIN - visibleHeight / 2 - scrolled;
}

fitCamera();
centerHorizontally();
camera.position.set(viewCenterX(), viewCenterY() + 0.3, camBase.z);
camera.lookAt(viewCenterX(), viewCenterY(), 0);
let parallaxX = 0;
let parallaxY = 0;

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
  // Browsers block audio until the first click, so until then, anything that
  // would make a sound nudges the visitor to click.
  const needsClick = audio.enabled && !audio.unlocked;
  // Hidden commas make screen readers pause between the parts of the label.
  const sep = '<span class="sr-only">, </span>';
  const nudge = `${sep}<em>${hover.touchMode ? 'tap' : 'click'} anywhere for sound</em>`;
  if (hovered.album) {
    const { title, artist, track, preview } = hovered.album;
    let extra = '';
    if (needsClick && preview) extra = nudge;
    else if (audio.enabled && track) extra = `${sep}<em>♪ ${escapeHtml(track)}</em>`;
    labelEl.innerHTML = `${escapeHtml(title)}${sep}<small>${escapeHtml(artist)}</small>${extra}`;
  } else {
    const { title, sub, sound } = hovered.caption;
    labelEl.innerHTML = escapeHtml(title) + (sub ? `${sep}<small>${escapeHtml(sub)}</small>` : '')
      + (needsClick && sound ? nudge : '');
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

// Taps on touch screens select things. Set it now (inside the tap) so the
// preview can start right away, which iPhones require.
hover.onTap = (hit) => {
  setHovered(hit ? hit.object.userData.item : null);
  audio.playPending();
};

// "i" button: an about card with credits and how to use the shelf.
// The native <dialog> handles Esc, focus and blocking the scene behind it.
const about = document.getElementById('about');
document.getElementById('info').addEventListener('click', () => about.showModal());
document.getElementById('about-close').addEventListener('click', () => about.close());
about.addEventListener('click', (e) => {
  if (e.target === about) about.close(); // a click on the backdrop, outside the card
});

/* ---------------- Keyboard navigation ---------------- */

// Arrow keys move a selection through everything with a label: the left-side
// knick-knacks (top to bottom), the albums (reading order), then the right side.
// Selecting something is the same as hovering it.
scene.updateMatrixWorld(true);
const navList = (() => {
  const entries = [...shelf.proxies, ...deco.proxies]
    .filter((proxy) => proxy.userData.item.album || proxy.userData.item.caption?.title)
    .map((proxy) => ({ proxy, item: proxy.userData.item, pos: proxy.getWorldPosition(new THREE.Vector3()) }));
  const side = (left) => entries
    .filter((e) => !e.item.album && (e.pos.x < 0) === left)
    .sort((a, b) => b.pos.y - a.pos.y);
  return [...side(true), ...entries.filter((e) => e.item.album), ...side(false)];
})();
const albumCount = shelf.items.length;
const firstAlbum = navList.findIndex((e) => e.item.album);
const shelfCols = navList.filter((e) => e.item.album && Math.abs(e.pos.y - navList[firstAlbum].pos.y) < 0.01).length;
let navIndex = -1;

// Scroll the page so the selected thing is comfortably on screen.
const revealPoint = new THREE.Vector3();
function reveal(entry) {
  entry.proxy.getWorldPosition(revealPoint).project(camera);
  const edge = 0.7; // keep it inside the middle 70% of the screen
  const dx = Math.max(0, revealPoint.x - edge) + Math.min(0, revealPoint.x + edge);
  const dy = Math.max(0, revealPoint.y - edge) + Math.min(0, revealPoint.y + edge);
  if (dx || dy) {
    window.scrollBy({ left: (dx * viewW()) / 2, top: (-dy * viewH()) / 2, behavior: reducedMotion() ? 'auto' : 'smooth' });
  }
}

function selectNav(index) {
  navIndex = Math.max(0, Math.min(navList.length - 1, index));
  const entry = navList[navIndex];
  setHovered(hover.select(entry.proxy).object.userData.item);
  reveal(entry);
}

function clearSelection() {
  hover.select(null);
  setHovered(null);
}

const canvas = renderer.domElement;
canvas.tabIndex = 0;
canvas.setAttribute('role', 'application');
canvas.setAttribute('aria-roledescription', 'record shelf');
canvas.setAttribute('aria-label',
  "Ann's record shelf. Use the arrow keys to browse records and the things on the side shelves, " +
  'Enter to play a sound again, and Escape to put things back.');

canvas.addEventListener('focus', () => {
  // Only for keyboard focus (Tab); a mouse click also focuses the canvas.
  if (!hovered && canvas.matches(':focus-visible')) selectNav(navIndex >= 0 ? navIndex : firstAlbum);
});
canvas.addEventListener('blur', () => {
  if (hover.pinned && !hover.touchMode) clearSelection();
});
canvas.addEventListener('keydown', (e) => {
  const current = navIndex >= 0 ? navIndex : firstAlbum;
  const onAlbum = navList[current]?.item.album;
  const albumPos = current - firstAlbum;
  let next = null;
  switch (e.key) {
    case 'ArrowRight': next = current + 1; break;
    case 'ArrowLeft': next = current - 1; break;
    case 'ArrowDown':
      next = onAlbum && albumPos + shelfCols < albumCount ? current + shelfCols : current + 1;
      break;
    case 'ArrowUp':
      next = onAlbum && albumPos - shelfCols >= 0 ? current - shelfCols : current - 1;
      break;
    case 'Home': next = 0; break;
    case 'End': next = navList.length - 1; break;
    case 'Enter':
    case ' ':
      if (hovered?.caption) {
        deco.enter(hovered);
        if (hovered.caption.sound) audio.sfx(hovered.caption.sound);
      } else if (hovered?.album) {
        audio.playPending();
      } else {
        selectNav(current);
      }
      e.preventDefault();
      return;
    case 'Escape':
      clearSelection();
      e.preventDefault();
      return;
    default:
      return;
  }
  e.preventDefault(); // arrow keys would otherwise scroll the page
  selectNav(next);
});

// Sound is on by default (it starts after the first click anywhere);
// this button mutes and unmutes.
audio.onUnlock = updateLabel;
soundBtn.addEventListener('click', () => {
  if (audio.enabled) audio.disable();
  else audio.enable();
  soundBtn.textContent = audio.enabled ? '♪ Sound on' : '♪ Sound off';
  soundBtn.classList.toggle('on', audio.enabled);
  soundBtn.setAttribute('aria-pressed', String(audio.enabled));
  updateLabel();
});

window.addEventListener('resize', () => {
  camera.aspect = viewW() / viewH();
  camera.updateProjectionMatrix();
  renderer.setSize(viewW(), viewH());
  sizePixelTarget();
  const wasPortrait = scrollRangeX > 0;
  fitCamera();
  if (!wasPortrait) centerHorizontally();
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
  // (Parallax follows a mouse only; on touch screens it would jump to each tap.)
  const still = hover.pinned || reducedMotion();
  const px = still ? 0 : hover.pointer.x;
  const py = still ? 0 : hover.pointer.y;
  const prevX = camera.position.x, prevY = camera.position.y;
  parallaxX = damp(parallaxX, px * 0.4, 3, dt);
  parallaxY = damp(parallaxY, py * 0.25, 3, dt);
  const viewX = viewCenterX();
  const viewY = viewCenterY();
  camera.position.x = viewX + parallaxX;
  camera.position.y = viewY + 0.3 + parallaxY;
  camera.position.z = camBase.z;
  lookTarget.set(viewX, viewY, 0);
  camera.lookAt(lookTarget);
  const camMoved = Math.abs(camera.position.x - prevX) + Math.abs(camera.position.y - prevY) > 1e-5;

  const hit = hover.update(camMoved);
  setHovered(hit ? hit.object.userData.item : null);

  // Sleeves ease in and out. Damping is frame-rate independent.
  let animating = false;
  for (const item of shelf.items) {
    const active = item === hovered;
    let tx = 0, ty = 0;
    if (active && hit.uv && hit.face.normal.z > 0.5 && !reducedMotion()) {
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
