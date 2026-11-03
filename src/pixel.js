import * as THREE from 'three';

// Pixel-art look for every texture in the scene. Set enabled: false to go back
// to smooth, full-resolution textures.
export const PIXEL = {
  enabled: true,
  scene: 3,           // whole-scene pixelation: each rendered pixel is this many screen pixels (1 = off)
  cover: 32,          // album covers become cover × cover pixels
  wood: [96, 24],     // shelf wood texture size (it repeats along the ledges)
  vinyl: 48,          // record groove maps
  colorLevels: 0,     // >1 limits each color channel to this many steps (try 6–8 for a retro palette); 0 = off
};

/**
 * Shrink an image or canvas to w × h pixels. Halves the size in steps first,
 * because a single big downscale in canvas skips pixels and looks noisy;
 * halving averages them, so small covers keep their colors.
 */
export function pixelCanvas(source, w, h = w, levels = PIXEL.colorLevels) {
  let src = source;
  let sw = source.naturalWidth || source.width;
  let sh = source.naturalHeight || source.height;

  while (sw / 2 >= w && sh / 2 >= h) {
    sw = Math.floor(sw / 2);
    sh = Math.floor(sh / 2);
    const step = document.createElement('canvas');
    step.width = sw; step.height = sh;
    const sg = step.getContext('2d');
    sg.imageSmoothingQuality = 'high';
    sg.drawImage(src, 0, 0, sw, sh);
    src = step;
  }

  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const g = out.getContext('2d', { willReadFrequently: levels > 1 });
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, w, h);

  if (levels > 1) {
    const img = g.getImageData(0, 0, w, h);
    const step = 255 / (levels - 1);
    for (let i = 0; i < img.data.length; i += 4) {
      img.data[i] = Math.round(img.data[i] / step) * step;
      img.data[i + 1] = Math.round(img.data[i + 1] / step) * step;
      img.data[i + 2] = Math.round(img.data[i + 2] / step) * step;
    }
    g.putImageData(img, 0, 0);
  }
  return out;
}

/**
 * Hard-edged pixels at every distance. Mipmaps are still used when a texture
 * is drawn much smaller than its size (so it doesn't shimmer), but each one is
 * sampled without blending, so covers never go soft.
 */
export function crisp(texture) {
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestMipmapNearestFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 1;
  texture.needsUpdate = true;
  return texture;
}
