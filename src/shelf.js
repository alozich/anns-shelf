import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createSleeveMaterial, createWoodMaterial } from './materials.js';
import { ALBUMS } from './albums.js';

// Fallback palettes for albums that don't set their own colors.
const PALETTES = [
  ['#e8d5b0', '#d9532b', '#2b3a55'], ['#101820', '#f2aa4c', '#e8e8e8'],
  ['#2e6f73', '#f4e3c3', '#e07a5f'], ['#f1e4d3', '#1d3557', '#e63946'],
  ['#3d2c2e', '#c9ada7', '#f2e9e4'], ['#0b132b', '#5bc0be', '#ffd166'],
  ['#bc6c25', '#fefae0', '#283618'], ['#ff70a6', '#1b1b3a', '#70d6ff'],
  ['#dad7cd', '#344e41', '#a3b18a'], ['#90e0ef', '#03045e', '#f72585'],
  ['#e9c46a', '#264653', '#f4a261'], ['#2b2d42', '#8d99ae', '#ef233c'],
];

function normalizeAlbum(album, i) {
  return {
    finish: 'gloss',
    colors: PALETTES[i % PALETTES.length],
    ...album,
    seed: i * 97 + 13,
  };
}

export const SLEEVE_SIZE = 1;       // 1 unit ≈ 31 cm (a 12" LP sleeve)
const SLEEVE_DEPTH = 0.02;
const LEAN = -0.1;                  // radians, sleeves lean back against the wall

/**
 * Builds the shelf frame (merged into one draw call) and the sleeves.
 * Each sleeve sits in a "slot" with an invisible, static hit box. Hover tests
 * hit the static box, not the moving sleeve, so a sleeve sliding out from
 * under the cursor can't flicker between hovered and not hovered.
 */
export function buildShelf({ albums = ALBUMS, maxCols = 8, gap = 0.14, rowHeight = 1.55, maxAnisotropy = 8 } = {}) {
  const list = albums.map(normalizeAlbum);
  // Spread albums evenly across the fewest rows, so the last row isn't a lone straggler.
  const rows = Math.max(1, Math.ceil(list.length / maxCols));
  const cols = Math.max(1, Math.ceil(list.length / rows));
  const group = new THREE.Group();
  const innerWidth = cols * SLEEVE_SIZE + (cols - 1) * gap;
  const width = innerWidth + 0.5;
  const height = rows * rowHeight + 0.15;

  // Frame: ledges, front lips and side panels merged into one mesh.
  const parts = [];
  const box = (w, h, d, x, y, z) => {
    const geo = new THREE.BoxGeometry(w, h, d);
    geo.translate(x, y, z);
    parts.push(geo);
  };
  for (let r = 0; r <= rows; r++) {
    const y = r * rowHeight;
    box(width, 0.06, 0.5, 0, y - 0.03, -0.1);           // ledge
    if (r < rows) box(width, 0.035, 0.03, 0, y + 0.0175, 0.135); // lip that stops sleeves sliding off
  }
  box(0.06, height, 0.5, -width / 2 + 0.03, height / 2 - 0.06, -0.1);
  box(0.06, height, 0.5, width / 2 - 0.03, height / 2 - 0.06, -0.1);

  const frame = new THREE.Mesh(mergeGeometries(parts), createWoodMaterial({ maxAnisotropy }));
  frame.castShadow = frame.receiveShadow = true;
  parts.forEach((g) => g.dispose());
  group.add(frame);

  // Sleeves
  const sleeveGeo = new THREE.BoxGeometry(SLEEVE_SIZE, SLEEVE_SIZE, SLEEVE_DEPTH);
  const proxyGeo = new THREE.BoxGeometry(SLEEVE_SIZE, SLEEVE_SIZE, 0.15);
  const items = [];
  const proxies = [];

  list.forEach((album, i) => {
    const c = i % cols;
    const r = rows - 1 - Math.floor(i / cols); // row 0 is the bottom ledge; fill from the top

    // Pivot at the sleeve's bottom edge so the lean rotates around where it rests.
    const pivot = new THREE.Group();
    pivot.position.set(-innerWidth / 2 + SLEEVE_SIZE / 2 + c * (SLEEVE_SIZE + gap), r * rowHeight + 0.005, 0.07);
    pivot.rotation.x = LEAN;

    const sleeve = new THREE.Mesh(sleeveGeo, createSleeveMaterial(album, { maxAnisotropy }));
    sleeve.position.y = SLEEVE_SIZE / 2;
    sleeve.castShadow = sleeve.receiveShadow = true;

    const proxy = new THREE.Mesh(proxyGeo);
    proxy.position.copy(sleeve.position);
    proxy.visible = false; // never drawn, still raycastable

    pivot.add(sleeve, proxy);
    group.add(pivot);

    const item = { album, pivot, sleeve, hover: 0, tiltX: 0, tiltY: 0 };
    proxy.userData.item = item;
    items.push(item);
    proxies.push(proxy);
  });

  return { group, items, proxies, size: new THREE.Vector2(width, height) };
}

/** Pose a sleeve for hover amount h (0..1) plus a small cursor-follow tilt. */
export function poseSleeve(item) {
  const { sleeve, hover: h, tiltX, tiltY } = item;
  sleeve.position.set(0, SLEEVE_SIZE / 2 + h * 0.06, h * 0.32);
  sleeve.rotation.set(-LEAN * h + tiltX, tiltY, 0);
  sleeve.scale.setScalar(1 + h * 0.04);
}
