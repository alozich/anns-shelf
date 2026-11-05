import * as THREE from 'three';

/**
 * Pointer hover via Raycaster, built to stay cheap:
 * - pointermove only records the position; the ray is cast at most once per
 *   frame, inside the render loop, and only when the pointer or camera moved.
 * - It tests a flat list of low-poly hit boxes (12 triangles each), not the
 *   whole scene, and doesn't recurse into children.
 * - The result array is reused, so hovering creates no garbage for the GC.
 */
export class HoverController {
  constructor(camera, element, targets) {
    this.camera = camera;
    this.element = element;
    this.targets = targets;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.hit = null;           // closest THREE.Intersection, or null
    this._hits = [];
    this._dirty = false;
    this._inside = false;
    // Touch screens have no hover: a tap selects something and it stays
    // selected until the next tap (on something else, the same thing, or the wall).
    this.touchMode = false;
    this.onTap = null;          // called with the new hit (or null) after each tap
    this._downType = 'mouse';

    this._setPointer = (e) => {
      const rect = element.getBoundingClientRect();
      this.pointer.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
    };
    this._onMove = (e) => {
      if (e.pointerType === 'touch') return; // fingers don't hover; taps are handled below
      this.touchMode = false;
      this._setPointer(e);
      this._inside = true;
      this._dirty = true;
    };
    this._onDown = (e) => {
      this._downType = e.pointerType;
      this._onMove(e);
    };
    this._onLeave = (e) => {
      if (e.pointerType === 'touch') return; // lifting a finger isn't "leaving"
      this._inside = false;
      this._dirty = true;
    };
    // A tap (a click from a finger) selects whatever is under it. Tapping the
    // selected thing again, or empty wall, clears the selection.
    this._onClick = (e) => {
      if (this._downType !== 'touch') return;
      this.touchMode = true;
      this._setPointer(e);
      this._dirty = false;
      this.raycaster.setFromCamera(this.pointer, this.camera);
      this._hits.length = 0;
      this.raycaster.intersectObjects(this.targets, false, this._hits);
      const next = this._hits[0] ?? null;
      this.hit = next && this.hit && next.object === this.hit.object ? null : next;
      this.onTap?.(this.hit);
    };

    element.addEventListener('pointermove', this._onMove, { passive: true });
    element.addEventListener('pointerdown', this._onDown, { passive: true });
    element.addEventListener('pointerleave', this._onLeave, { passive: true });
    element.addEventListener('click', this._onClick);
  }

  /** Call once per frame. Pass cameraMoved=true if the camera moved this frame. */
  update(cameraMoved = false) {
    if (this.touchMode) return this.hit; // selection only changes on taps
    if (!this._dirty && !cameraMoved) return this.hit;
    this._dirty = false;

    if (!this._inside) {
      this.hit = null;
      return null;
    }

    this.raycaster.setFromCamera(this.pointer, this.camera);
    this._hits.length = 0;
    this.raycaster.intersectObjects(this.targets, false, this._hits);
    this.hit = this._hits[0] ?? null;
    return this.hit;
  }

  dispose() {
    this.element.removeEventListener('pointermove', this._onMove);
    this.element.removeEventListener('pointerdown', this._onDown);
    this.element.removeEventListener('pointerleave', this._onLeave);
    this.element.removeEventListener('click', this._onClick);
  }
}

/**
 * For Draco/glTF models: an invisible box around the object to raycast against,
 * instead of testing every triangle of a dense mesh.
 */
export function createHitProxy(object) {
  object.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const proxy = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z));
  box.getCenter(proxy.position);
  proxy.visible = false;
  return proxy;
}
