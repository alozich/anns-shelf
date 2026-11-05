import * as THREE from 'three';
import { createWoodMaterial } from './materials.js';
import { PIXEL, pixelCanvas, crisp } from './pixel.js';
import { createHitProxy } from './hover.js';
import { reducedMotion } from './motion.js';

// Personal knick-knacks on floating shelves either side of the record shelf.
// Everything is built from simple low-poly shapes so it matches the pixel look.
// Each hoverable object has a caption (shown in the label) and an optional
// custom hover animation.

const WALL_Z = -0.33;
const SIDE_GAP = 0.5;      // space between the record shelf and the side areas
const SIDE_WIDTH = 2.7;    // width of each side area
// The side layout was designed around a 4-row record shelf. A taller shelf
// raises it so the knick-knacks stay level with the top rows.
const LAYOUT_HEIGHT = 4 * 1.55 + 0.15;

/* ---------------- small helpers ---------------- */

const materials = new Map();
function mat(color, { rough = 0.7, metal = 0, clearcoat = 0, emissive } = {}) {
  const key = [color, rough, metal, clearcoat, emissive].join();
  if (!materials.has(key)) {
    const opts = { color, roughness: rough, metalness: metal, flatShading: true };
    if (emissive) opts.emissive = emissive;
    materials.set(key, clearcoat
      ? new THREE.MeshPhysicalMaterial({ ...opts, clearcoat, clearcoatRoughness: 0.1 })
      : new THREE.MeshStandardMaterial(opts));
  }
  return materials.get(key);
}

function mesh(geometry, material, { pos, rot, scale, shadow = true } = {}) {
  const m = new THREE.Mesh(geometry, material);
  if (pos) m.position.set(...pos);
  if (rot) m.rotation.set(...rot);
  if (scale) m.scale.set(...scale);
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}

const box = (w, h, d, material, opts) => mesh(new THREE.BoxGeometry(w, h, d), material, opts);
const cyl = (rTop, rBottom, h, seg, material, opts) => mesh(new THREE.CylinderGeometry(rTop, rBottom, h, seg), material, opts);
const ball = (r, material, opts) => mesh(new THREE.SphereGeometry(r, 8, 6), material, opts);

/**
 * A texture drawn on a canvas at full size, then shrunk to w × h pixels so it
 * matches the pixel style. Call redraw() after changing what draw() paints.
 */
function canvasTexture(w, h, draw, scale = 8) {
  const big = document.createElement('canvas');
  big.width = w * scale;
  big.height = h * scale;
  const g = big.getContext('2d');
  const tex = new THREE.CanvasTexture(big);
  tex.colorSpace = THREE.SRGBColorSpace;
  const redraw = () => {
    g.clearRect(0, 0, big.width, big.height);
    draw(g, big.width, big.height);
    tex.image = PIXEL.enabled ? pixelCanvas(big, w, h) : big;
    tex.needsUpdate = true;
  };
  redraw();
  if (PIXEL.enabled) crisp(tex);
  return { tex, redraw };
}

function star(g, cx, cy, outer, inner, points) {
  g.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? inner : outer;
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  g.closePath();
  g.fill();
}

/* ---------------- the objects ---------------- */

function chicagoFlag() {
  const { tex } = canvasTexture(48, 32, (g, w, h) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#41b6e6';
    g.fillRect(0, h / 6, w, h / 6);
    g.fillRect(0, (4 * h) / 6, w, h / 6);
    g.fillStyle = '#e4002b';
    for (let i = 0; i < 4; i++) star(g, w * (0.2 + i * 0.2), h / 2, h * 0.13, h * 0.055, 6);
  });
  const group = new THREE.Group();
  group.add(box(1.62, 1.12, 0.05, mat('#2a1d14')));
  group.add(mesh(new THREE.PlaneGeometry(1.5, 1.0), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }), { pos: [0, 0, 0.026] }));
  return group;
}

function bookStack() {
  // Old leather-bound classics: leather covers that overhang yellowed pages,
  // spines with raised bands, gold rules and a dark title label.
  const group = new THREE.Group();
  const gold = '#c9a227';
  const books = [
    { w: 0.95, h: 0.14, d: 0.6, leather: '#5a1a1a', label: '#1a1210' },
    { w: 0.86, h: 0.11, d: 0.55, leather: '#1f3d2b', label: '#5a1a1a', gilt: true },
    { w: 0.9, h: 0.16, d: 0.58, leather: '#7a4a24', label: '#1c2740' },
    { w: 0.8, h: 0.12, d: 0.52, leather: '#1c2740', label: '#5a1a1a' },
  ];
  const pages = mat('#dccb9c', { rough: 0.9 });          // yellowed with age
  const gilt = mat(gold, { metal: 0.7, rough: 0.35 });   // gold-leaf page edges

  let y = 0;
  books.forEach((b, i) => {
    const book = new THREE.Group();
    const leather = new THREE.MeshPhysicalMaterial({ color: b.leather, roughness: 0.65, clearcoat: 0.25, clearcoatRoughness: 0.5, flatShading: true });

    // Spine artwork, along the spine's length (x) and height (y)
    const { tex } = canvasTexture(48, 6, (g, w, h) => {
      g.fillStyle = b.leather;
      g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(0,0,0,0.18)'; // scuffed, uneven leather
      for (let k = 0; k < 60; k++) g.fillRect(Math.random() * w, Math.random() * h, w * 0.02, h * 0.15);
      const rule = (x) => { g.fillStyle = gold; g.fillRect(x - w * 0.004, 0, w * 0.008, h); };
      // Raised bands: a dark ridge between two gold rules
      for (const x of [0.12, 0.3, 0.7, 0.88]) {
        g.fillStyle = 'rgba(0,0,0,0.35)';
        g.fillRect(w * (x - 0.012), 0, w * 0.024, h);
        rule(w * (x - 0.02));
        rule(w * (x + 0.02));
      }
      rule(w * 0.03);
      rule(w * 0.97);
      // Title label with a gold border and gold "lettering"
      g.fillStyle = b.label;
      g.fillRect(w * 0.38, h * 0.15, w * 0.24, h * 0.7);
      g.strokeStyle = gold;
      g.lineWidth = h * 0.06;
      g.strokeRect(w * 0.38, h * 0.15, w * 0.24, h * 0.7);
      g.fillStyle = gold;
      for (let k = 0; k < 5; k++) g.fillRect(w * (0.41 + k * 0.04), h * 0.42, w * 0.025, h * 0.16);
    });
    const spineFace = new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.6, clearcoat: 0.25, clearcoatRoughness: 0.5 });

    const board = 0.015;
    // Front and back boards overhang the page block a little, like a real hardback
    book.add(box(b.w, board, b.d, leather, { pos: [0, b.h / 2 - board / 2, 0] }));
    book.add(box(b.w, board, b.d, leather, { pos: [0, -b.h / 2 + board / 2, 0] }));
    // Page block, set in from the ends and the fore-edge
    book.add(box(b.w - 0.03, b.h - board * 2, b.d - 0.04, b.gilt ? gilt : pages, { pos: [0, 0, -0.005] }));
    // Spine: leather on every side, artwork on the face toward the room (+z)
    const spine = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, 0.025), [leather, leather, leather, leather, spineFace, leather]);
    spine.position.z = b.d / 2 - 0.0125;
    spine.castShadow = spine.receiveShadow = true;
    book.add(spine);

    book.position.set([-0.03, 0.03, -0.01, 0.04][i], y + b.h / 2, [0, -0.02, 0.01, -0.01][i]);
    book.rotation.y = [-0.06, 0.05, -0.03, 0.08][i];
    group.add(book);
    y += b.h;
  });
  group.userData.height = y;
  return group;
}

function turtle() {
  const group = new THREE.Group();
  const skin = mat('#8fae5a');
  // Domed shell with a lighter rim
  group.add(mesh(new THREE.SphereGeometry(0.17, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), mat('#3f6b35', { rough: 0.5, clearcoat: 0.4 }), { pos: [0, 0.04, 0], scale: [1.15, 0.75, 1] }));
  group.add(cyl(0.2, 0.2, 0.03, 8, mat('#6b8f4a'), { pos: [0, 0.045, 0], scale: [1.15, 1, 1] }));
  // A few darker shell plates
  for (const [x, z] of [[0, 0], [0.08, 0.06], [-0.08, 0.06], [0.08, -0.06], [-0.08, -0.06]]) {
    group.add(box(0.06, 0.02, 0.06, mat('#2f5229'), { pos: [x, 0.155 - Math.hypot(x, z) * 0.35, z], rot: [z * 3, 0, -x * 3], shadow: false }));
  }
  // Head, eyes, legs and tail
  group.add(ball(0.065, skin, { pos: [0.25, 0.08, 0], scale: [1.3, 0.9, 0.9] }));
  group.add(ball(0.012, mat('#111111'), { pos: [0.3, 0.11, 0.04] }));
  group.add(ball(0.012, mat('#111111'), { pos: [0.3, 0.11, -0.04] }));
  for (const [x, z] of [[0.12, 0.14], [0.12, -0.14], [-0.12, 0.14], [-0.12, -0.14]]) {
    group.add(ball(0.045, skin, { pos: [x, 0.025, z], scale: [1.2, 0.6, 1] }));
  }
  group.add(mesh(new THREE.ConeGeometry(0.025, 0.08, 4), skin, { pos: [-0.24, 0.04, 0], rot: [0, 0, Math.PI / 2] }));
  group.rotation.y = -0.9; // facing out toward the room
  group.scale.setScalar(1.7);
  return group;
}

function snakePlant() {
  const group = new THREE.Group();
  group.add(cyl(0.16, 0.12, 0.26, 8, mat('#b5603a'), { pos: [0, 0.13, 0] }));
  group.add(cyl(0.145, 0.145, 0.02, 8, mat('#3b2a1e'), { pos: [0, 0.25, 0] }));
  const greens = [mat('#3f7d3a'), mat('#5a9a48'), mat('#2f6330')];
  const leaves = [[0, 0.75, 0, 0], [0.06, 0.6, 0.25, 0.4], [-0.07, 0.62, -0.28, 1.2], [0.03, 0.5, -0.12, 2.2], [-0.04, 0.55, 0.18, 3.1], [0.0, 0.45, 0.32, 4.4]];
  leaves.forEach(([x, h, tilt, turn], i) => {
    const leaf = mesh(new THREE.ConeGeometry(0.055, h, 4), greens[i % 3], { pos: [x, 0.25 + h / 2, 0], scale: [1, 1, 0.35] });
    leaf.rotation.set(0, turn, tilt * 0.6);
    group.add(leaf);
  });
  return group;
}

function retroComputer() {
  const lines = ['$ whoami', 'cs grad / it', '$ sudo brew coffee', 'ok: black, no sugar'];
  let cursorOn = true;
  const screen = canvasTexture(64, 48, (g, w, h) => {
    g.fillStyle = '#06140a';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#39ff6a';
    g.font = `bold ${h * 0.11}px monospace`;
    lines.forEach((line, i) => g.fillText(line, w * 0.06, h * (0.18 + i * 0.17)));
    g.fillText(cursorOn ? '$ _' : '$', w * 0.06, h * (0.18 + lines.length * 0.17));
  });

  const beige = mat('#d8d0bd');
  const group = new THREE.Group();
  group.add(box(0.86, 0.7, 0.66, beige, { pos: [0, 0.45, -0.04] }));           // monitor
  group.add(box(0.5, 0.1, 0.5, beige, { pos: [0, 0.05, -0.04] }));             // stand
  group.add(box(0.74, 0.56, 0.02, mat('#a39a86'), { pos: [0, 0.47, 0.295] }));  // bezel
  group.add(mesh(new THREE.PlaneGeometry(0.62, 0.46), new THREE.MeshStandardMaterial({
    color: '#000000', emissive: '#ffffff', emissiveMap: screen.tex, emissiveIntensity: 1.4, roughness: 0.3,
  }), { pos: [0, 0.47, 0.307], shadow: false }));
  group.add(box(0.7, 0.04, 0.22, beige, { pos: [0, 0.02, 0.48], rot: [0.08, 0, 0] })); // keyboard
  for (let r = 0; r < 3; r++) {
    group.add(box(0.62, 0.012, 0.045, mat('#b9b09a'), { pos: [0, 0.047 - r * 0.004, 0.42 + r * 0.06], shadow: false }));
  }

  let timer = 0;
  group.userData.update = (dt) => {
    timer += dt;
    if (timer > 0.5) {
      timer = 0;
      cursorOn = !cursorOn;
      screen.redraw();
    }
  };
  return group;
}

function gameController() {
  const body = mat('#2b2b30', { rough: 0.5 });
  const group = new THREE.Group();
  group.add(box(0.36, 0.07, 0.17, body, { pos: [0, 0.05, 0] }));
  group.add(ball(0.1, body, { pos: [-0.17, 0.05, 0.03], scale: [1, 0.55, 1.1] }));
  group.add(ball(0.1, body, { pos: [0.17, 0.05, 0.03], scale: [1, 0.55, 1.1] }));
  const grey = mat('#9a9aa0');
  group.add(box(0.1, 0.02, 0.03, grey, { pos: [-0.15, 0.095, 0.01] }));       // d-pad
  group.add(box(0.03, 0.02, 0.1, grey, { pos: [-0.15, 0.095, 0.01] }));
  [['#e63946', 0.2, 0.01], ['#2a9d8f', 0.15, -0.035], ['#f4a261', 0.15, 0.055], ['#457b9d', 0.1, 0.01]].forEach(([c, x, z]) => {
    group.add(cyl(0.02, 0.02, 0.025, 8, mat(c, { rough: 0.3 }), { pos: [x, 0.095, z] }));
  });
  group.rotation.y = 0.35;
  group.scale.setScalar(1.5);
  return group;
}

function pothos() {
  const group = new THREE.Group();
  // Only the pot and bushy top are hoverable; the vines hang in front of the
  // record shelf's corner and would otherwise block hovering that sleeve.
  const pot = new THREE.Group();
  group.add(pot);
  group.userData.hitTarget = pot;
  pot.add(cyl(0.2, 0.15, 0.3, 8, mat('#e8e2d4'), { pos: [0, 0.15, 0] }));
  pot.add(cyl(0.18, 0.18, 0.02, 8, mat('#3b2a1e'), { pos: [0, 0.29, 0] }));
  const leafMats = [mat('#4f9a3e'), mat('#7cbf4f'), mat('#3a7a30')];
  const leafGeo = new THREE.OctahedronGeometry(0.07, 0);

  // Bushy top
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    pot.add(mesh(leafGeo, leafMats[i % 3], { pos: [Math.cos(a) * 0.14, 0.36 + (i % 3) * 0.05, Math.sin(a) * 0.12], scale: [1.4, 0.5, 1], rot: [0, a, 0.3] }));
  }
  // Two vines trailing over the left edge of the record shelf
  [[-0.5, 1.9, 0.08], [-0.4, 1.3, -0.05]].forEach(([reach, drop, z], v) => {
    const curve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(-0.1, 0.32, z),
      new THREE.Vector3(reach - 0.05, 0.45, z),
      new THREE.Vector3(reach, -drop, z + 0.05),
    );
    const count = Math.round(drop * 8);
    for (let i = 1; i <= count; i++) {
      const p = curve.getPoint(i / count);
      const side = i % 2 ? 1 : -1;
      group.add(mesh(leafGeo, leafMats[(i + v) % 3], { pos: [p.x + side * 0.04, p.y, p.z], scale: [1.1, 0.9, 0.4], rot: [0, 0, side * 0.6] }));
    }
  });
  return group;
}

function guitar() {
  // Built hanging from its wall hanger: the origin is the hook, the guitar hangs down -y.
  const gloss = new THREE.MeshPhysicalMaterial({ color: '#0b0b0d', roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.08 });
  const chrome = mat('#c8c8cc', { metal: 0.9, rough: 0.25 });
  const fretboard = mat('#2a1a12');
  const ribbonMat = mat('#b8f0a8', { rough: 0.6 });

  const group = new THREE.Group();

  // Hanger (fixed to the wall, so it isn't part of the swinging guitar)
  const hanger = new THREE.Group();
  // The guitar group sits at z = -0.2, so the wall is at local z ≈ -0.13.
  hanger.add(box(0.14, 0.2, 0.04, mat('#1a1a1a'), { pos: [0, 0.06, -0.11] }));
  hanger.add(box(0.04, 0.04, 0.18, mat('#1a1a1a'), { pos: [0, 0.02, -0.02] }));
  group.add(hanger);

  const body = new THREE.Group(); // everything that swings
  group.add(body);

  // Headstock with 3 + 3 tuning pegs
  body.add(box(0.28, 0.56, 0.05, gloss, { pos: [0, -0.3, 0] }));
  const pegGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.12, 6);
  const pegs = [];
  for (let i = 0; i < 3; i++) {
    for (const side of [-1, 1]) {
      const peg = mesh(pegGeo, chrome, { pos: [side * 0.19, -0.13 - i * 0.15, 0], rot: [0, 0, Math.PI / 2] });
      body.add(peg);
      body.add(box(0.05, 0.07, 0.02, chrome, { pos: [side * 0.26, -0.13 - i * 0.15, 0] }));
      pegs.push(peg);
    }
  }

  // The light green ribbon tied around the top-left peg
  const ribbon = new THREE.Group();
  ribbon.position.set(-0.2, -0.13, 0);
  ribbon.add(mesh(new THREE.TorusGeometry(0.035, 0.014, 4, 8), ribbonMat, { rot: [0, Math.PI / 2, 0] }));
  const tails = [];
  for (const [x, rz, len] of [[-0.01, -0.12, 1.1], [0.02, -0.03, 0.92]]) {
    const tail = new THREE.Group();
    tail.position.set(x, -0.02, 0.045);
    tail.add(box(0.035, len, 0.006, ribbonMat, { pos: [0, -len / 2, 0] }));
    tail.rotation.z = rz;
    tail.userData.rest = rz;
    ribbon.add(tail);
    tails.push(tail);
  }
  body.add(ribbon);

  // Neck and fretboard
  body.add(box(0.17, 1.4, 0.06, gloss, { pos: [0, -1.28, -0.005] }));
  body.add(box(0.16, 1.4, 0.015, fretboard, { pos: [0, -1.28, 0.03] }));
  for (let i = 0; i < 10; i++) {
    const y = -0.62 - 1.3 * (1 - Math.pow(0.88, i + 1)) / (1 - Math.pow(0.88, 10)) * 0.95;
    body.add(box(0.16, 0.008, 0.004, mat('#6f6a64', { metal: 0.5, rough: 0.5 }), { pos: [0, y, 0.038], shadow: false }));
  }
  body.add(box(0.17, 0.025, 0.02, mat('#e8e0c8'), { pos: [0, -0.59, 0.035] })); // nut

  // Body: Les Paul style single cutaway (on the treble side, the viewer's
  // right when it hangs facing out), with a thick, rounded carved-look top.
  const s = new THREE.Shape();
  s.moveTo(0, -0.62);
  s.bezierCurveTo(0.38, -0.62, 0.52, -0.25, 0.42, -0.05);   // lower bout, treble side
  s.bezierCurveTo(0.36, 0.08, 0.42, 0.2, 0.38, 0.34);       // waist
  s.bezierCurveTo(0.35, 0.46, 0.3, 0.52, 0.24, 0.52);       // cutaway horn
  s.bezierCurveTo(0.17, 0.52, 0.12, 0.45, 0.1, 0.36);       // into the cutaway, meeting the neck
  s.lineTo(-0.1, 0.5);                                       // neck joint
  s.bezierCurveTo(-0.22, 0.62, -0.42, 0.58, -0.42, 0.36);   // upper bout, bass side
  s.bezierCurveTo(-0.42, 0.2, -0.36, 0.08, -0.42, -0.05);   // waist
  s.bezierCurveTo(-0.52, -0.25, -0.38, -0.62, 0, -0.62);    // lower bout, bass side
  const bodyGeo = new THREE.ExtrudeGeometry(s, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.035, bevelSize: 0.03, bevelSegments: 2, curveSegments: 6 });
  bodyGeo.translate(0, 0, -0.08);
  const bodyY = -2.4;
  body.add(mesh(bodyGeo, gloss, { pos: [0, bodyY, 0] }));

  // Hardware: two humbuckers, tune-o-matic bridge + stopbar tailpiece,
  // four knobs on the lower treble bout and a pickup selector switch up top.
  const pickup = mat('#2a2a2e', { rough: 0.4 });
  const front = 0.09;
  body.add(box(0.3, 0.12, 0.03, pickup, { pos: [0, bodyY + 0.2, front] }));
  body.add(box(0.3, 0.12, 0.03, pickup, { pos: [0, bodyY - 0.06, front] }));
  body.add(box(0.3, 0.04, 0.03, chrome, { pos: [0, bodyY - 0.22, front] }));
  body.add(box(0.3, 0.05, 0.035, chrome, { pos: [0, bodyY - 0.34, front] }));
  for (const [x, y] of [[0.2, -0.3], [0.33, -0.36], [0.18, -0.45], [0.31, -0.51]]) {
    body.add(cyl(0.035, 0.04, 0.045, 8, chrome, { pos: [x, bodyY + y, front], rot: [Math.PI / 2, 0, 0] }));
  }
  body.add(cyl(0.012, 0.012, 0.07, 6, chrome, { pos: [-0.3, bodyY + 0.36, front + 0.02], rot: [Math.PI / 2, 0, 0] }));
  body.add(cyl(0.05, 0.05, 0.01, 8, mat('#1a1a1a'), { pos: [-0.3, bodyY + 0.36, front - 0.01], rot: [Math.PI / 2, 0, 0] }));

  // Strings, from the nut to the tailpiece
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const t = i / 5 - 0.5;
    pts.push(new THREE.Vector3(t * 0.12, -0.6, 0.045), new THREE.Vector3(t * 0.2, bodyY - 0.34, front + 0.02));
  }
  body.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: '#77736d' })));

  // Swing: a damped pendulum, kicked when hovered.
  let angle = 0, velocity = 0, time = 0;
  group.userData.onEnter = () => { if (!reducedMotion()) velocity += 0.5; };
  group.userData.update = (dt) => {
    time += dt;
    velocity += (-9 * angle - 1.6 * velocity) * dt;
    angle += velocity * dt;
    body.rotation.z = angle;
    for (const tail of tails) tail.rotation.z = tail.userData.rest + Math.sin(time * 1.8 + tail.userData.rest * 5) * 0.06 - angle * 1.5;
    return Math.abs(velocity) > 0.002 || Math.abs(angle) > 0.002;
  };
  group.userData.customHover = true; // the swing is its hover animation
  return group;
}

function coffeeMug() {
  const navy = '#0b162a';
  const orange = '#c83803';
  // Bears colors: navy mug, orange stripes and lettering. The text is drawn at
  // u = 0 (split across the texture's seam) so it faces out next to the handle,
  // and again at u = 0.5 for the back.
  const { tex } = canvasTexture(64, 16, (g, w, h) => {
    g.fillStyle = navy;
    g.fillRect(0, 0, w, h);
    g.fillStyle = orange;
    g.fillRect(0, h * 0.1, w, h * 0.1);
    g.fillRect(0, h * 0.8, w, h * 0.1);
    g.fillStyle = '#ffffff';
    g.fillRect(0, h * 0.22, w, h * 0.03);
    g.fillRect(0, h * 0.75, w, h * 0.03);
    g.fillStyle = orange;
    g.font = `900 ${h * 0.36}px sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const x of [0, w / 2, w]) g.fillText('BEARS', x, h * 0.5);
  });
  const group = new THREE.Group();
  const side = new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.4, clearcoat: 0.8, clearcoatRoughness: 0.1, flatShading: true, side: THREE.DoubleSide });
  group.add(mesh(new THREE.CylinderGeometry(0.17, 0.16, 0.34, 12, 1, true), side, { pos: [0, 0.17, 0] }));
  group.add(cyl(0.16, 0.16, 0.02, 12, mat(navy), { pos: [0, 0.01, 0] }));
  group.add(cyl(0.155, 0.155, 0.01, 12, mat('#1a0d07', { rough: 0.15 }), { pos: [0, 0.29, 0], shadow: false })); // black coffee
  group.add(mesh(new THREE.TorusGeometry(0.09, 0.025, 4, 8, Math.PI), mat(navy, { clearcoat: 0.8 }), { pos: [0.17, 0.17, 0], rot: [0, 0, -Math.PI / 2] }));

  // Steam: a few soft puffs drifting up and fading out
  const puffs = [];
  // Soft round puff texture (a plain sprite would be a hard grey square).
  const puffCanvas = document.createElement('canvas');
  puffCanvas.width = puffCanvas.height = 32;
  const pg = puffCanvas.getContext('2d');
  const grad = pg.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  pg.fillStyle = grad;
  pg.fillRect(0, 0, 32, 32);
  const puffTex = new THREE.CanvasTexture(puffCanvas);
  const puffMat = new THREE.SpriteMaterial({ map: puffTex, color: '#ffffff', transparent: true, opacity: 0, depthWrite: false });
  for (let i = 0; i < 4; i++) {
    const puff = new THREE.Sprite(puffMat.clone());
    puff.userData.phase = i / 4;
    group.add(puff);
    puffs.push(puff);
  }
  let t = 0;
  group.userData.update = (dt) => {
    t += dt * 0.35;
    for (const p of puffs) {
      const k = (t + p.userData.phase) % 1;
      p.position.set(Math.sin((k + p.userData.phase) * 6) * 0.04, 0.32 + k * 0.45, 0);
      p.scale.setScalar(0.1 + k * 0.16);
      p.material.opacity = Math.sin(k * Math.PI) * 0.22;
    }
  };
  group.rotation.y = -0.5; // handle toward the viewer's right
  return group;
}

function dvdStack() {
  const shows = [
    { title: 'FATHER TED', bg: '#3c6e47', fg: '#f4efe6' },
    { title: 'THE SOPRANOS', bg: '#111111', fg: '#e8e8e8', accent: '#c1121f' },
    { title: 'A KNIGHT OF THE SEVEN KINGDOMS', bg: '#2b2118', fg: '#d9b44a' },
  ];
  const group = new THREE.Group();
  shows.forEach((show, i) => {
    const { tex } = canvasTexture(40, 4, (g, w, h) => {
      g.fillStyle = show.bg;
      g.fillRect(0, 0, w, h);
      g.fillStyle = show.fg;
      g.font = `bold ${h * 0.7}px sans-serif`;
      g.fillText(show.title, w * 0.05, h * 0.78, w * 0.9);
    });
    const spine = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 });
    const plain = mat(show.bg, { rough: 0.5 });
    // Box faces: +x, -x, +y, -y, +z (front, the spine), -z
    const dvd = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.075, 0.53), [plain, plain, plain, plain, spine, plain]);
    dvd.castShadow = dvd.receiveShadow = true;
    dvd.position.set(i % 2 ? 0.02 : -0.02, 0.0375 + i * 0.075, 0);
    dvd.rotation.y = (i - 1) * 0.05;
    group.add(dvd);
  });
  return group;
}

function carefulNowSign() {
  const { tex } = canvasTexture(24, 14, (g, w, h) => {
    g.fillStyle = '#fbf7ee';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#c1121f';
    g.font = `bold ${h * 0.34}px sans-serif`;
    g.textAlign = 'center';
    g.fillText('CAREFUL', w / 2, h * 0.45);
    g.fillText('NOW', w / 2, h * 0.85);
  });
  const group = new THREE.Group();
  group.add(box(0.03, 0.55, 0.03, mat('#9c6b3f'), { pos: [0, 0.275, 0] }));
  const board = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.26, 0.015), [
    mat('#fbf7ee'), mat('#fbf7ee'), mat('#fbf7ee'), mat('#fbf7ee'),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }), mat('#fbf7ee'),
  ]);
  board.position.set(0, 0.5, 0.02);
  board.castShadow = true;
  group.add(board);
  group.rotation.z = 0.12; // propped at a slight angle
  return group;
}

function croatiaPostcard() {
  const { tex } = canvasTexture(36, 24, (g, w, h) => {
    const sky = g.createLinearGradient(0, 0, 0, h * 0.55);
    sky.addColorStop(0, '#5fb4e8');
    sky.addColorStop(1, '#bfe6f7');
    g.fillStyle = sky;
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#1d6fa5'; // Adriatic
    g.fillRect(0, h * 0.62, w, h * 0.38);
    g.fillStyle = '#2f8fc9';
    g.fillRect(0, h * 0.62, w, h * 0.05);
    // Old town: pale stone houses with terracotta roofs on a hill
    g.fillStyle = '#d8c9a8';
    g.beginPath(); g.moveTo(w * 0.35, h * 0.62); g.lineTo(w * 0.55, h * 0.4); g.lineTo(w, h * 0.45); g.lineTo(w, h * 0.62); g.fill();
    for (let i = 0; i < 7; i++) {
      const x = w * (0.42 + i * 0.08), y = h * (0.47 + (i % 3) * 0.04);
      g.fillStyle = '#efe4cc';
      g.fillRect(x, y, w * 0.07, h * 0.12);
      g.fillStyle = '#c4502d';
      g.beginPath(); g.moveTo(x - w * 0.01, y); g.lineTo(x + w * 0.035, y - h * 0.06); g.lineTo(x + w * 0.08, y); g.fill();
    }
    g.fillStyle = '#efe4cc'; // bell tower
    g.fillRect(w * 0.6, h * 0.26, w * 0.05, h * 0.22);
    g.fillStyle = '#c4502d';
    g.beginPath(); g.moveTo(w * 0.595, h * 0.26); g.lineTo(w * 0.625, h * 0.18); g.lineTo(w * 0.655, h * 0.26); g.fill();
    g.fillStyle = '#ffffff';
    g.font = `bold ${h * 0.1}px sans-serif`;
    g.fillText('Pozdrav iz Hrvatske!', w * 0.05, h * 0.92);
  });
  const group = new THREE.Group();
  group.add(mesh(new THREE.PlaneGeometry(0.9, 0.6), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, side: THREE.DoubleSide }), { pos: [0, 0, 0] }));
  group.add(ball(0.035, mat('#d7141a', { rough: 0.3 }), { pos: [0, 0.25, 0.02] })); // pin
  group.rotation.z = -0.06;
  return group;
}

function irelandPhoto() {
  // The Cliffs of Moher: sheer layered cliffs stepping away along the coast,
  // green grass on top, O'Brien's Tower on the nearest headland, Atlantic below.
  const { tex } = canvasTexture(48, 36, (g, w, h) => {
    const sky = g.createLinearGradient(0, 0, 0, h * 0.45);
    sky.addColorStop(0, '#9fb6c8');
    sky.addColorStop(1, '#dfe6e8');
    g.fillStyle = sky;
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.8)';
    for (const [x, y, r] of [[0.55, 0.12, 0.1], [0.68, 0.1, 0.08], [0.85, 0.16, 0.07]]) {
      g.beginPath(); g.ellipse(w * x, h * y, w * r, h * r * 0.5, 0, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = '#2c5672'; // Atlantic
    g.fillRect(0, h * 0.4, w, h * 0.6);
    g.fillStyle = '#4c7891';
    for (let i = 0; i < 6; i++) g.fillRect(w * (0.5 + i * 0.08), h * (0.55 + (i % 3) * 0.12), w * 0.05, h * 0.015);

    // Headlands from far (small, hazy) to near (big, dark), along the left side.
    const headlands = [
      { x0: 0.0, x1: 0.42, top: 0.4, base: 0.47, face: '#8a8f8c', grass: '#8fae7a' },
      { x0: 0.0, x1: 0.36, top: 0.36, base: 0.56, face: '#6f6a62', grass: '#6f9e4f' },
      { x0: 0.0, x1: 0.28, top: 0.3, base: 0.7, face: '#5a524a', grass: '#5d9140' },
      { x0: 0.0, x1: 0.2, top: 0.22, base: 1.0, face: '#463e37', grass: '#4f8636' },
    ];
    for (const c of headlands) {
      g.fillStyle = c.face;
      g.beginPath();
      g.moveTo(w * c.x0, h * c.top);
      g.lineTo(w * c.x1, h * (c.top + 0.02));
      g.lineTo(w * (c.x1 - 0.02), h * c.base);
      g.lineTo(w * c.x0, h * c.base);
      g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.25)'; // rock layers
      g.lineWidth = h * 0.01;
      for (let y = c.top + 0.06; y < c.base; y += 0.06) {
        g.beginPath(); g.moveTo(w * c.x0, h * y); g.lineTo(w * (c.x1 - 0.01), h * (y + 0.01)); g.stroke();
      }
      g.fillStyle = c.grass;
      g.fillRect(w * c.x0, h * (c.top - 0.03), w * (c.x1 - c.x0), h * 0.04);
      g.fillStyle = 'rgba(255,255,255,0.7)'; // surf at the foot of the cliff
      g.fillRect(w * (c.x1 - 0.04), h * (c.base - 0.015), w * 0.06, h * 0.015);
    }
    // O'Brien's Tower on the nearest clifftop
    g.fillStyle = '#7b736a';
    g.fillRect(w * 0.1, h * 0.12, w * 0.035, h * 0.08);
    g.fillRect(w * 0.095, h * 0.11, w * 0.045, h * 0.02);
  });
  const group = new THREE.Group();
  group.add(box(0.78, 0.62, 0.05, mat('#2a1d14')));                 // frame
  group.add(box(0.68, 0.52, 0.01, mat('#efe8d8'), { pos: [0, 0, 0.026] })); // mat board
  group.add(mesh(new THREE.PlaneGeometry(0.56, 0.42), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }), { pos: [0, 0, 0.032], shadow: false }));
  group.scale.setScalar(1.35);
  return group;
}

function perfumeBottle() {
  // Chanel Chance Eau Fraîche: a rounded glass bottle of pale yellow-green
  // fragrance, a silver cap and a small white label.
  const group = new THREE.Group();
  const liquid = new THREE.MeshPhysicalMaterial({ color: '#d2e04e', roughness: 0.2, transparent: true, opacity: 0.95, flatShading: true });
  const glass = new THREE.MeshPhysicalMaterial({
    color: '#ffffff', roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.03,
    transparent: true, opacity: 0.18, depthWrite: false, flatShading: true,
  });
  const liquidMesh = mesh(new THREE.SphereGeometry(0.11, 10, 8), liquid, { pos: [0, 0.14, 0], scale: [1, 1.05, 0.6] });
  const glassMesh = mesh(new THREE.SphereGeometry(0.13, 10, 8), glass, { pos: [0, 0.145, 0], scale: [1, 1.08, 0.62], shadow: false });
  glassMesh.renderOrder = 1; // draw the glass after the liquid inside it
  group.add(liquidMesh, glassMesh);
  group.add(cyl(0.03, 0.035, 0.04, 8, mat('#d8d8dc', { metal: 0.9, rough: 0.2 }), { pos: [0, 0.29, 0] }));     // collar
  group.add(cyl(0.055, 0.055, 0.12, 10, mat('#e4e4e8', { metal: 0.85, rough: 0.15 }), { pos: [0, 0.37, 0] })); // cap
  group.add(box(0.09, 0.05, 0.005, mat('#f7f5ef'), { pos: [0, 0.15, 0.085], shadow: false }));                 // label
  group.rotation.y = 0.2;
  group.scale.setScalar(1.6);
  return group;
}

function brigidsCross() {
  // St Brigid's Cross: a woven square of rushes in the middle, four arms of
  // bundled straws offset into a pinwheel, each tied near its end.
  const group = new THREE.Group();
  const light = mat('#d8c68c');
  const mid = mat('#c4ad6a');
  const dark = mat('#a88f4c');
  const tie = mat('#6f5a2c');
  const strip = 0.04;   // width of one rush
  const C = 0.2;        // size of the woven centre

  // Woven centre: crossing strips alternate over/under in two shades
  for (let i = 0; i < 5; i++) {
    const o = -C / 2 + strip / 2 + i * strip;
    group.add(box(C, strip * 0.9, 0.02, i % 2 ? light : mid, { pos: [0, o, i % 2 ? 0.02 : 0.005], shadow: false }));
    group.add(box(strip * 0.9, C, 0.02, i % 2 ? dark : light, { pos: [o, 0, i % 2 ? 0.005 : 0.02], shadow: false }));
  }

  // Arms: pointing right, up, left and down, each offset to one side so the
  // four together make the pinwheel around the centre
  for (let a = 0; a < 4; a++) {
    const arm = new THREE.Group();
    arm.rotation.z = (a * Math.PI) / 2;
    const shades = [light, mid, dark];
    for (let k = 0; k < 3; k++) {
      const len = 0.36 + ((k * 7 + a * 3) % 5) * 0.015; // slightly uneven ends
      arm.add(box(len, strip, 0.025, shades[(k + a) % 3], { pos: [C / 2 + len / 2 - 0.02, 0.0 + k * strip, 0.012] }));
    }
    arm.add(box(0.06, strip * 3.6, 0.035, tie, { pos: [C / 2 + 0.25, strip, 0.012] }));
    group.add(arm);
  }
  group.scale.setScalar(1.15);
  return group;
}

function redConvertible() {
  // A 1950s-style red convertible: open top, tail fins, whitewalls, chrome.
  // Built pointing along +x (the front).
  const car = new THREE.Group();
  const red = new THREE.MeshPhysicalMaterial({ color: '#c1121f', roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.06, flatShading: true });
  const chrome = mat('#d6d6da', { metal: 0.9, rough: 0.2 });
  const cream = mat('#efe3c8');

  car.add(mesh(new THREE.BoxGeometry(0.62, 0.09, 0.28), red, { pos: [0, 0.09, 0] }));             // body
  car.add(box(0.26, 0.006, 0.22, mat('#4a0d12'), { pos: [-0.05, 0.136, 0], shadow: false }));   // open cockpit
  car.add(box(0.06, 0.07, 0.22, cream, { pos: [0.02, 0.165, 0] }));                            // front bench
  car.add(box(0.06, 0.07, 0.22, cream, { pos: [-0.13, 0.165, 0] }));                           // rear bench
  car.add(mesh(new THREE.TorusGeometry(0.028, 0.006, 4, 10), mat('#1a1a1a'), { pos: [0.07, 0.17, 0.06], rot: [0, Math.PI / 2, 0.4] })); // steering wheel
  const glass = new THREE.MeshPhysicalMaterial({ color: '#bfe3f2', roughness: 0.05, transparent: true, opacity: 0.45, depthWrite: false });
  car.add(mesh(new THREE.BoxGeometry(0.005, 0.07, 0.25), glass, { pos: [0.11, 0.17, 0], rot: [0, 0, 0.45], shadow: false })); // windshield
  for (const z of [-0.125, 0.125]) {
    car.add(mesh(new THREE.BoxGeometry(0.13, 0.045, 0.02), red, { pos: [-0.25, 0.15, z], rot: [0, 0, -0.25] })); // tail fins
    car.add(box(0.012, 0.03, 0.04, mat('#ff2a2a', { emissive: '#aa0000' }), { pos: [-0.312, 0.115, z * 0.8], shadow: false })); // tail lights
    car.add(box(0.012, 0.035, 0.05, mat('#fff4cc', { emissive: '#665c33' }), { pos: [0.312, 0.105, z * 0.8], shadow: false })); // headlights
  }
  car.add(box(0.025, 0.03, 0.3, chrome, { pos: [0.315, 0.06, 0] }));   // bumpers
  car.add(box(0.025, 0.03, 0.3, chrome, { pos: [-0.315, 0.06, 0] }));
  car.add(box(0.5, 0.008, 0.005, chrome, { pos: [0, 0.1, 0.141], shadow: false })); // side trim
  car.add(box(0.5, 0.008, 0.005, chrome, { pos: [0, 0.1, -0.141], shadow: false }));
  const tire = new THREE.CylinderGeometry(0.055, 0.055, 0.04, 10);
  const wall = new THREE.CylinderGeometry(0.035, 0.035, 0.042, 10);
  for (const x of [-0.19, 0.19]) {
    for (const z of [-0.135, 0.135]) {
      car.add(mesh(tire, mat('#151515'), { pos: [x, 0.055, z], rot: [Math.PI / 2, 0, 0] }));
      car.add(mesh(wall, mat('#f2f2f2'), { pos: [x, 0.055, z], rot: [Math.PI / 2, 0, 0], shadow: false }));
    }
  }
  return car;
}

function driveInDiorama() {
  // A little drive-in: a screen playing a looping pixel movie, a red
  // convertible parked facing it, and a speaker post by the driver's door.
  let t = 0;
  let flicker = 1;
  const screen = canvasTexture(32, 18, (g, w, h) => {
    const scene = Math.floor(t / 4) % 3;
    const u = (t % 4) / 4;
    const rnd = (k) => { const x = Math.sin(k * 12.9898 + Math.floor(t * 10) * 78.233) * 43758.5453; return x - Math.floor(x); };

    if (scene === 0) {
      // Old film countdown leader: sepia, a sweeping wedge, 3-2-1
      g.fillStyle = '#d9c9a3';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#b8a47a';
      g.beginPath(); g.moveTo(w / 2, h / 2); g.arc(w / 2, h / 2, h * 0.7, -Math.PI / 2, -Math.PI / 2 + ((u * 3) % 1) * Math.PI * 2); g.fill();
      g.strokeStyle = '#3b3326'; g.lineWidth = h * 0.04;
      g.beginPath(); g.arc(w / 2, h / 2, h * 0.38, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.moveTo(w / 2, 0); g.lineTo(w / 2, h); g.stroke();
      g.fillStyle = '#2a241b';
      g.font = `bold ${h * 0.5}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(3 - Math.floor(u * 3)), w / 2, h / 2 + h * 0.03);
    } else if (scene === 1) {
      // Sunset over the sea, the sun slowly sinking
      const sky = g.createLinearGradient(0, 0, 0, h * 0.62);
      sky.addColorStop(0, '#2b1055'); sky.addColorStop(1, '#ff7e5f');
      g.fillStyle = sky; g.fillRect(0, 0, w, h);
      g.fillStyle = '#ffd166';
      g.beginPath(); g.arc(w * 0.5, h * (0.38 + u * 0.3), h * 0.16, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#1d3557'; g.fillRect(0, h * 0.62, w, h * 0.38);
      g.fillStyle = 'rgba(255,209,102,0.7)';
      for (let i = 0; i < 4; i++) g.fillRect(w * (0.44 - i * 0.02), h * (0.66 + i * 0.08), w * (0.12 + i * 0.04), h * 0.025);
    } else {
      // Night skyline: twinkling stars, lit windows
      g.fillStyle = '#0b132b'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#ffffff';
      for (let i = 0; i < 14; i++) if (rnd(i) > 0.3) g.fillRect(rnd(i + 50) * w, rnd(i + 90) * h * 0.5, w * 0.02, w * 0.02);
      const towers = [[0.02, 0.45], [0.12, 0.3], [0.22, 0.55], [0.34, 0.2], [0.44, 0.38], [0.56, 0.25], [0.68, 0.5], [0.8, 0.32], [0.9, 0.42]];
      towers.forEach(([x, top], i) => {
        g.fillStyle = '#05070f'; g.fillRect(w * x, h * top, w * 0.1, h);
        g.fillStyle = '#ffd166';
        for (let wy = top + 0.06; wy < 0.95; wy += 0.09) if (rnd(i * 31 + wy * 100) > 0.55) g.fillRect(w * (x + 0.03), h * wy, w * 0.025, h * 0.03);
      });
    }
    // Film grain and the odd scratch
    for (let i = 0; i < 18; i++) {
      g.fillStyle = rnd(i + 200) > 0.5 ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.3)';
      g.fillRect(rnd(i + 300) * w, rnd(i + 400) * h, w * 0.012, w * 0.012);
    }
    if (rnd(999) > 0.8) { g.fillStyle = 'rgba(255,255,255,0.4)'; g.fillRect(rnd(998) * w, 0, w * 0.01, h); }
  });

  const group = new THREE.Group();
  const darkGrey = mat('#2b2b2e');
  // Base: asphalt lot with a strip of grass under the screen
  group.add(box(1.9, 0.06, 0.82, mat('#2f2f33', { rough: 0.95 }), { pos: [0, 0.03, 0] }));
  group.add(box(1.9, 0.012, 0.16, mat('#3f6b35', { rough: 0.95 }), { pos: [0, 0.066, -0.33] }));
  for (const x of [-0.7, 0.35]) group.add(box(0.012, 0.008, 0.4, mat('#d8d0bd'), { pos: [x, 0.064, 0.16], shadow: false })); // parking lines

  // Screen on two posts
  for (const x of [-0.62, 0.62]) group.add(box(0.05, 1.12, 0.05, darkGrey, { pos: [x, 0.62, -0.35] }));
  group.add(box(1.36, 0.8, 0.04, darkGrey, { pos: [0, 0.8, -0.35] }));
  const screenMat = new THREE.MeshStandardMaterial({ color: '#000000', emissive: '#ffffff', emissiveMap: screen.tex, emissiveIntensity: 1.1, roughness: 0.6 });
  group.add(mesh(new THREE.PlaneGeometry(1.26, 0.71), screenMat, { pos: [0, 0.8, -0.328], shadow: false }));

  // The red convertible, front toward the screen, angled so its side and fins show
  const car = redConvertible();
  car.position.set(-0.17, 0.06, 0.13);
  car.rotation.y = Math.PI / 2 + 0.85;
  car.scale.setScalar(1.65);
  group.add(car);

  // Speaker post by the driver's door
  group.add(cyl(0.012, 0.012, 0.36, 6, mat('#8a8a8f', { metal: 0.6, rough: 0.4 }), { pos: [0.42, 0.24, 0.2] }));
  group.add(box(0.09, 0.07, 0.05, mat('#6b6b70', { metal: 0.5, rough: 0.4 }), { pos: [0.42, 0.44, 0.2] }));

  let timer = 0;
  group.userData.update = (dt, hover = 0) => {
    t += dt;
    timer += dt;
    if (timer > 0.1) {
      timer = 0;
      screen.redraw();
      flicker = reducedMotion() ? 1 : 0.88 + Math.random() * 0.12;
    }
    screenMat.emissiveIntensity = (1.1 + hover * 0.7) * flicker; // brighter when hovered
  };
  return group;
}

function dart() {
  // One dart, pointing along -z (tip into the board, flights toward the room).
  const d = new THREE.Group();
  const steel = mat('#b8b8be', { metal: 0.85, rough: 0.3 });
  d.add(mesh(new THREE.ConeGeometry(0.008, 0.05, 6), steel, { pos: [0, 0, 0.025], rot: [-Math.PI / 2, 0, 0], shadow: false }));
  d.add(cyl(0.024, 0.024, 0.11, 8, mat('#8a8a90', { metal: 0.8, rough: 0.35 }), { pos: [0, 0, 0.1], rot: [Math.PI / 2, 0, 0] }));  // barrel
  d.add(cyl(0.01, 0.01, 0.09, 6, mat('#1a1a1a'), { pos: [0, 0, 0.2], rot: [Math.PI / 2, 0, 0] }));                              // shaft
  d.add(box(0.12, 0.006, 0.09, mat('#d7141a', { rough: 0.5 }), { pos: [0, 0, 0.25] }));                                          // flights,
  d.add(box(0.006, 0.12, 0.09, mat('#f4efe6', { rough: 0.5 }), { pos: [0, 0, 0.25] }));                                          // red and white
  return d;
}

function dartboard() {
  // Classic board: 20 black/cream segments (20 at the top), red/green double
  // and treble rings, green outer bull and red bullseye, on a dark backboard.
  const { tex } = canvasTexture(64, 64, (g, w) => {
    const c = w / 2, R = w / 2;
    const ring = (r0, r1, a0, a1, color) => {
      g.fillStyle = color;
      g.beginPath(); g.arc(c, c, R * r1, a0, a1); g.arc(c, c, R * r0, a1, a0, true); g.closePath(); g.fill();
    };
    g.fillStyle = '#121212';
    g.beginPath(); g.arc(c, c, R, 0, Math.PI * 2); g.fill();
    const step = (Math.PI * 2) / 20;
    for (let i = 0; i < 20; i++) {
      const a0 = -Math.PI / 2 - step / 2 + i * step, a1 = a0 + step;
      const darkSeg = i % 2 === 0;
      ring(0.08, 0.78, a0, a1, darkSeg ? '#151515' : '#efe3c4');
      ring(0.72, 0.78, a0, a1, darkSeg ? '#c8102e' : '#1e8f4e'); // double ring
      ring(0.44, 0.5, a0, a1, darkSeg ? '#c8102e' : '#1e8f4e');  // treble ring
      g.fillStyle = '#e8e8e8';                                    // number markers
      g.fillRect(c + Math.cos((a0 + a1) / 2) * R * 0.89 - w * 0.012, c + Math.sin((a0 + a1) / 2) * R * 0.89 - w * 0.012, w * 0.024, w * 0.024);
    }
    ring(0, 0.08, 0, Math.PI * 2, '#1e8f4e');  // outer bull
    ring(0, 0.035, 0, Math.PI * 2, '#c8102e'); // bullseye
  });

  const group = new THREE.Group();
  const FACE = 0.07; // z of the board's face
  group.add(cyl(0.62, 0.62, 0.04, 16, mat('#1f1712'), { pos: [0, 0, -0.02], rot: [Math.PI / 2, 0, 0] }));  // backboard
  group.add(cyl(0.46, 0.46, 0.07, 24, mat('#141414'), { pos: [0, 0, 0.035], rot: [Math.PI / 2, 0, 0] }));  // board
  group.add(mesh(new THREE.CircleGeometry(0.46, 32), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }), { pos: [0, 0, FACE + 0.001], shadow: false }));

  // Three darts already in the board
  for (const [x, y, rx, ry] of [[0.02, 0.21, -0.45, 0.25], [-0.08, -0.04, -0.5, -0.35], [0.17, 0.04, -0.35, 0.45]]) {
    const d = dart();
    d.position.set(x, y, FACE);
    d.rotation.set(rx, ry, 0);
    group.add(d);
  }

  // A fourth dart thrown in from the room on hover, landing at a random spot
  const thrown = dart();
  thrown.position.set(-0.1, 0.12, FACE);
  thrown.visible = false;
  group.add(thrown);
  const from = new THREE.Vector3(), to = new THREE.Vector3();
  let flight = -1; // 0..1 while flying, -1 when resting
  group.userData.onEnter = () => {
    if (flight >= 0) return;
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 0.36;
    to.set(Math.cos(a) * r, Math.sin(a) * r, FACE);
    from.set(to.x + 0.4, to.y - 0.15, FACE + 1.8);
    thrown.rotation.set(-0.4 + Math.random() * 0.15, 0.2 + Math.random() * 0.2, 0);
    thrown.visible = true;
    flight = reducedMotion() ? 1 : 0; // with reduced motion it simply lands
  };
  group.userData.update = (dt) => {
    if (flight < 0) return false;
    flight = Math.min(1, flight + dt / 0.25); // a quarter of a second in the air
    thrown.position.lerpVectors(from, to, flight);
    thrown.position.y += Math.sin(flight * Math.PI) * 0.12; // slight arc
    if (flight >= 1) flight = -1;
    return true;
  };
  group.scale.setScalar(1.35);
  return group;
}

/* ---------------- layout ---------------- */

export function buildKnickKnacks({ shelfSize, maxAnisotropy = 8 }) {
  const group = new THREE.Group();
  const items = [];
  const lift = Math.max(0, shelfSize.y - LAYOUT_HEIGHT);
  const leftX = -(shelfSize.x / 2 + SIDE_GAP + SIDE_WIDTH / 2);
  const rightX = -leftX;

  const wood = createWoodMaterial({ maxAnisotropy });
  wood.map.repeat.set(1, 1);
  const floatingShelf = (x, y, depth = 0.62) => {
    const s = box(SIDE_WIDTH, 0.08, depth, wood, { pos: [x, y - 0.04, WALL_Z + depth / 2] });
    group.add(s);
    return y;
  };

  const add = (object, x, y, z, caption) => {
    object.position.set(x, y, z);
    group.add(object);
    if (caption) items.push({ object, caption, base: object.position.clone(), baseRot: object.rotation.clone(), hover: 0 });
    return object;
  };

  // Left side
  add(chicagoFlag(), leftX, 5.35, WALL_Z + 0.03, { title: 'Chicago', tilt: 0.07, wall: true, sound: 'train' });

  const upperL = floatingShelf(leftX, 3.45);
  const books = bookStack();
  add(books, leftX - 0.55, upperL, -0.05, { title: 'Reading', sub: 'Always halfway through something', sound: 'pages' });
  add(turtle(), leftX - 0.5, upperL + books.userData.height, 0.0, { title: 'Turtle', sound: 'bloop' });
  add(perfumeBottle(), leftX + 0.22, upperL, 0.02, { title: 'Chance Eau Fraîche', sound: 'spritz' });
  add(snakePlant(), leftX + 0.75, upperL, -0.05, { sound: 'rustle' });

  const lowerL = floatingShelf(leftX, 1.5);
  add(retroComputer(), leftX - 0.45, lowerL, -0.1, { title: 'Terminal', sub: 'Hello, world!', sound: 'typing' });
  add(gameController(), leftX + 0.7, lowerL, 0.02, { title: 'Video games', sound: 'coin' });

  // Drive-in diorama on its own shelf, level with the lower record rows
  const diorama = floatingShelf(leftX, -0.6, 0.9);
  add(driveInDiorama(), leftX, diorama, WALL_Z + 0.45, { title: 'Drive-in movie', sound: 'drivein' });

  // On top of the record shelf's left corner (the top ledge is at shelfSize.y - 0.15).
  add(pothos(), -shelfSize.x / 2 + 0.35, shelfSize.y - 0.15 - lift, -0.05, { sound: 'rustle' });

  // Right side
  add(croatiaPostcard(), rightX + 0.55, 6.05, WALL_Z + 0.01, { title: 'Croatia', tilt: 0.06, wall: true, sound: 'croatia' });

  const upperR = floatingShelf(rightX, 4.85);
  add(dvdStack(), rightX - 0.7, upperR, -0.05, { title: 'Comfort TV', sub: 'Father Ted · The Sopranos · A Knight of the Seven Kingdoms', sound: 'clack' });
  add(coffeeMug(), rightX + 0.15, upperR, 0.0, { title: 'Black coffee', sound: 'pour' });
  add(carefulNowSign(), rightX + 0.85, upperR, -0.08, { title: 'Careful now', sub: 'Down with this sort of thing', sound: 'drink' });

  add(brigidsCross(), rightX + 0.85, 3.9, WALL_Z + 0.03, { title: "St Brigid's Cross", tilt: 0.08, wall: true, sound: 'rustle' });
  add(irelandPhoto(), rightX + 0.82, 2.75, WALL_Z + 0.03, { title: 'Ireland', sub: 'Galway and the Aran Islands', tilt: 0.05, wall: true, sound: 'jig' });
  // Dartboard below the guitar, level with the drive-in on the left
  add(dartboard(), rightX + 0.25, -0.3, WALL_Z + 0.03, { title: 'Darts', tilt: 0.04, wall: true, sound: 'darts' });
  add(guitar(), rightX - 0.1, 4.2, -0.2, { title: 'My guitar', sub: 'A Les Paul', sound: 'strum' });

  // Static hit boxes, computed once with everything at rest.
  group.updateMatrixWorld(true);
  const proxies = items.map((item) => {
    const proxy = createHitProxy(item.object.userData.hitTarget ?? item.object);
    proxy.userData.item = item;
    group.add(proxy);
    return proxy;
  });
  // Raise everything (hit boxes included) to line up with the shelf's top rows.
  group.position.y = lift;

  // Hover animation: objects lift and turn a little; some have their own.
  // Returns true while anything that casts a shadow is moving.
  const damp = THREE.MathUtils.damp;
  function update(dt, hovered) {
    let moving = false;
    for (const item of items) {
      const { object } = item;
      const active = item === hovered;
      const custom = object.userData.update?.(dt, item.hover);
      if (custom) moving = true;
      if (object.userData.customHover) continue;

      const target = active ? 1 : 0;
      const before = item.hover;
      item.hover = damp(item.hover, target, 10, dt);
      if (Math.abs(item.hover - before) < 1e-4) continue;
      moving = true;
      const h = item.hover;
      object.position.y = item.base.y + h * 0.06;
      if (item.caption.wall) {
        // Flat on the wall: tilt in the wall's plane and ease slightly off it.
        // Turning sideways would push one edge into the wall.
        object.position.z = item.base.z + h * 0.03;
      } else {
        if (!reducedMotion()) object.rotation.y = item.baseRot.y + h * 0.18;
      }
      object.rotation.z = item.baseRot.z - h * (item.caption.tilt ?? 0);
    }
    return moving;
  }

  function enter(item) {
    item?.object.userData.onEnter?.();
  }

  return {
    group,
    items,
    proxies,
    update,
    enter,
    width: shelfSize.x + 2 * (SIDE_GAP + SIDE_WIDTH) + 0.4,
  };
}
