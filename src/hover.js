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

    this._onMove = (e) => {
      const rect = element.getBoundingClientRect();
      this.pointer.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      this._inside = true;
      this._dirty = true;
    };
    this._onLeave = () => {
      this._inside = false;
      this._dirty = true;
    };

    element.addEventListener('pointermove', this._onMove, { passive: true });
    element.addEventListener('pointerdown', this._onMove, { passive: true });
    element.addEventListener('pointerleave', this._onLeave, { passive: true });
  }

  /** Call once per frame. Pass cameraMoved=true if the camera moved this frame. */
  update(cameraMoved = false) {
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
    this.element.removeEventListener('pointerdown', this._onMove);
    this.element.removeEventListener('pointerleave', this._onLeave);
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
