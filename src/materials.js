import * as THREE from 'three';
import { PIXEL, pixelCanvas, crisp } from './pixel.js';

// Small seeded RNG so procedural textures look the same on every load.
export function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dataTexture(data, size, { repeat = 1 } = {}) {
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return PIXEL.enabled ? crisp(tex) : tex;
}

/* ------------------------------------------------------------------ */
/* Paper grain normal map: shared by every sleeve                     */
/* ------------------------------------------------------------------ */

function makePaperNormalMap() {
  // Pixel mode: one bump per cover pixel, lined up with the cover's pixel grid.
  const size = PIXEL.enabled ? PIXEL.cover : 256;
  const repeat = PIXEL.enabled ? 1 : 3;
  const rnd = mulberry32(7);
  const h = new Float32Array(size * size).map(() => rnd());

  // Blur along x more than y, so the grain reads as paper fibres (skipped in pixel mode).
  const blurred = PIXEL.enabled ? h : new Float32Array(size * size);
  for (let y = 0; y < size && !PIXEL.enabled; y++) {
    for (let x = 0; x < size; x++) {
      let sum = 0;
      for (let k = -2; k <= 2; k++) sum += h[y * size + ((x + k + size) % size)];
      sum += h[((y + 1) % size) * size + x] + h[((y - 1 + size) % size) * size + x];
      blurred[y * size + x] = sum / 7;
    }
  }

  const data = new Uint8Array(size * size * 4);
  const strength = PIXEL.enabled ? 0.3 : 2.5;
  const at = (x, y) => blurred[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      data[i] = (-dx / len * 0.5 + 0.5) * 255;
      data[i + 1] = (-dy / len * 0.5 + 0.5) * 255;
      data[i + 2] = (1 / len * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }
  return dataTexture(data, size, { repeat });
}

let paperNormal;
const getPaperNormal = () => (paperNormal ??= makePaperNormalMap());

/* ------------------------------------------------------------------ */
/* Album covers                                                       */
/* ------------------------------------------------------------------ */

// Draw one line of text, shrinking the font until it fits the cover's width.
function fitText(g, text, weight, fontSize, y, size) {
  const maxWidth = size * 0.88;
  let px = fontSize;
  do {
    g.font = `${weight} ${px}px system-ui, sans-serif`;
    if (g.measureText(text).width <= maxWidth) break;
    px *= 0.92;
  } while (px > size * 0.025);
  g.fillText(text, size * 0.06, y, maxWidth);
}

function drawCover(album, size) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  const rnd = mulberry32(album.seed);
  const [bg, fg, accent] = album.colors;

  g.fillStyle = bg;
  g.fillRect(0, 0, size, size);

  switch (album.seed % 4) {
    case 0: { // rising sun rings
      const cx = size * (0.3 + rnd() * 0.4), cy = size * (0.35 + rnd() * 0.2);
      for (let r = size * 0.55; r > 10; r -= size * 0.06) {
        g.fillStyle = (Math.round(r / (size * 0.06)) % 2) ? fg : accent;
        g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
      }
      break;
    }
    case 1: { // diagonal stripes
      g.save();
      g.translate(size / 2, size / 2);
      g.rotate(-Math.PI / 4 + rnd() * 0.4);
      const w = size * (0.05 + rnd() * 0.05);
      for (let x = -size; x < size; x += w * 2) {
        g.fillStyle = (x / (w * 2)) % 3 === 0 ? accent : fg;
        g.fillRect(x, -size, w, size * 2);
      }
      g.restore();
      break;
    }
    case 2: { // dot grid
      const n = 6 + Math.floor(rnd() * 5), step = size / n;
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          g.fillStyle = rnd() > 0.85 ? accent : fg;
          g.beginPath();
          g.arc((x + 0.5) * step, (y + 0.5) * step, step * (0.15 + rnd() * 0.25), 0, Math.PI * 2);
          g.fill();
        }
      }
      break;
    }
    default: { // offset blocks
      for (let i = 0; i < 5; i++) {
        g.fillStyle = i % 2 ? fg : accent;
        g.globalAlpha = 0.85;
        g.fillRect(rnd() * size * 0.6, rnd() * size * 0.6, size * (0.2 + rnd() * 0.4), size * (0.2 + rnd() * 0.4));
      }
      g.globalAlpha = 1;
    }
  }

  // Title band
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.fillRect(0, size * 0.8, size, size * 0.2);
  g.fillStyle = '#f6efe4';
  fitText(g, album.title, 700, size * 0.07, size * 0.89, size);
  fitText(g, album.artist, 400, size * 0.045, size * 0.955, size);
  return canvas;
}

/**
 * Sleeve: a grainy paper base under a smooth clearcoat layer. Because the
 * normal map only affects the base layer, the coat stays glossy while the
 * grain shows through underneath, which is how laminated card looks.
 * "satin" sleeves get a rougher, thinner coat.
 */
function coverTexture(source, maxAnisotropy) {
  const tex = new THREE.CanvasTexture(PIXEL.enabled ? pixelCanvas(source, PIXEL.cover) : source);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return PIXEL.enabled ? crisp(tex) : tex;
}

export function createSleeveMaterial(album, { maxAnisotropy = 8, size = 512 } = {}) {
  const map = coverTexture(drawCover(album, size), maxAnisotropy);

  const gloss = album.finish !== 'satin';
  const material = new THREE.MeshPhysicalMaterial({
    map,
    roughness: 0.65,
    metalness: 0,
    normalMap: getPaperNormal(),
    normalScale: new THREE.Vector2(0.4, 0.4),
    clearcoat: gloss ? 1.0 : 0.45,
    clearcoatRoughness: gloss ? 0.18 : 0.35,
  });

  // Show the generated cover straight away, then swap in the real image when it
  // arrives. Both are plain textures, so the swap doesn't recompile the shader.
  if (album.cover) {
    const url = /^(https?:)?\/\//.test(album.cover) || album.cover.startsWith('/')
      ? album.cover
      : `${import.meta.env.BASE_URL}${album.cover}`;
    imageLoader.loadAsync(url)
      .then((image) => {
        material.map = coverTexture(image, maxAnisotropy);
        map.dispose();
      })
      .catch(() => console.warn(`Cover not found for "${album.title}": ${url} (using a generated cover)`));
  }
  return material;
}

const imageLoader = new THREE.ImageLoader();

/* ------------------------------------------------------------------ */
/* Vinyl disc: anisotropic grooves under a clearcoat                  */
/* ------------------------------------------------------------------ */

const LABEL_RATIO = 0.34; // label radius / disc radius (a 12" LP has a ~4" label)

function makeVinylMaps(size = PIXEL.enabled ? PIXEL.vinyl : 512) {
  const rough = new Uint8Array(size * size * 4);
  const aniso = new Uint8Array(size * size * 4);
  const trackGaps = [0.45, 0.56, 0.68, 0.79, 0.88];
  const gapWidth = Math.max(0.006, 1.2 / size); // at least ~1 pixel wide so gaps survive low resolutions
  const ringFreq = Math.min(420, size * 0.8);   // fine rings, but never finer than the pixel grid

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const dx = (x + 0.5) / size - 0.5, dy = (y + 0.5) / size - 0.5;
      const r = Math.hypot(dx, dy) * 2; // 0 at centre, 1 at the rim
      const inGrooves = r > LABEL_RATIO + 0.02 && r < 0.96;
      const nearGap = trackGaps.some((g) => Math.abs(r - g) < gapWidth);

      // Roughness (green channel): smooth gaps between tracks, fine ring variation in grooves.
      let rv = 0.3;
      if (inGrooves) rv = nearGap ? 0.12 : 0.42 + 0.08 * Math.sin(r * ringFreq);
      rough[i] = rough[i + 1] = rough[i + 2] = rv * 255;
      rough[i + 3] = 255;

      // Anisotropy: direction is tangent to the circle, strength in blue.
      // This makes the highlight stretch around the disc like real grooves.
      const len = Math.hypot(dx, dy) || 1;
      aniso[i] = (-dy / len * 0.5 + 0.5) * 255;
      aniso[i + 1] = (dx / len * 0.5 + 0.5) * 255;
      aniso[i + 2] = inGrooves && !nearGap ? 255 : 0;
      aniso[i + 3] = 255;
    }
  }
  return { roughnessMap: dataTexture(rough, size), anisotropyMap: dataTexture(aniso, size) };
}

export function createVinylMaterial() {
  const { roughnessMap, anisotropyMap } = makeVinylMaps();
  return new THREE.MeshPhysicalMaterial({
    color: 0x0b0b0c,
    roughness: 1, // scaled by roughnessMap
    roughnessMap,
    metalness: 0,
    anisotropy: 0.85,
    anisotropyMap,
    clearcoat: 0.6,
    clearcoatRoughness: 0.18,
    side: THREE.DoubleSide,
  });
}

export const VINYL_LABEL_RATIO = LABEL_RATIO;

/* ------------------------------------------------------------------ */
/* Lacquered wood for the shelf                                       */
/* ------------------------------------------------------------------ */

export function createWoodMaterial({ maxAnisotropy = 8 } = {}) {
  const w = 1024, h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const g = canvas.getContext('2d');
  const rnd = mulberry32(42);

  g.fillStyle = '#6b4428';
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 260; i++) {
    const y = rnd() * h;
    g.strokeStyle = rnd() > 0.5 ? 'rgba(40,22,10,0.35)' : 'rgba(150,100,60,0.25)';
    g.lineWidth = 0.5 + rnd() * 2.5;
    g.beginPath();
    g.moveTo(0, y);
    for (let x = 0; x <= w; x += 64) g.lineTo(x, y + Math.sin(x * 0.004 + i) * 4 * rnd());
    g.stroke();
  }

  const map = new THREE.CanvasTexture(PIXEL.enabled ? pixelCanvas(canvas, ...PIXEL.wood) : canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = maxAnisotropy;
  if (PIXEL.enabled) {
    map.repeat.set(3, 1); // keeps wood pixels about the same size as cover pixels
    crisp(map);
  }

  return new THREE.MeshPhysicalMaterial({
    map,
    roughness: 0.7,
    clearcoat: 0.5,          // satin lacquer
    clearcoatRoughness: 0.25,
  });
}
