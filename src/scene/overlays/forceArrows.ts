// Solid arrows for each force, anchored at the ball. Length ∝ |F| / (m g) (velocity: |v|/30 m/s),
// times a user scale and a scene unit (meters in the field, radii in the flow lab).

import * as THREE from "three";

export type ArrowKey = "velocity" | "gravity" | "drag" | "magnus" | "seam" | "wake" | "aero";

export const ARROW_COLORS: Record<ArrowKey, number> = {
  velocity: 0xf4f6f6,
  gravity: 0x8a9499,
  drag: 0xd63a3a,
  magnus: 0x8a5cd6,
  seam: 0xf08a24,
  wake: 0xe8c838,
  aero: 0x2fb8c9,
};

export const ARROW_LABELS: Record<ArrowKey, string> = {
  velocity: "Velocity",
  gravity: "Gravity",
  drag: "Drag",
  magnus: "Magnus",
  seam: "Seam/panel side force",
  wake: "Unsteady wake",
  aero: "Net aerodynamic",
};

class Arrow {
  readonly group = new THREE.Group();
  length = 0;
  private shaft: THREE.Mesh;
  private head: THREE.Mesh;
  constructor(color: number, private thickness: number) {
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.4, emissive: color, emissiveIntensity: 0.35 });
    this.shaft = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 10), mat);
    this.head = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 14), mat);
    this.group.add(this.shaft, this.head);
  }
  set(dir: THREE.Vector3, length: number, unit: number) {
    if (length < 1e-6) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    this.length = length;
    const r = this.thickness * unit;
    const headLen = Math.min(length * 0.45, 7 * r);
    const shaftLen = Math.max(length - headLen, 0);
    this.shaft.scale.set(r, shaftLen, r);
    this.shaft.position.set(0, shaftLen / 2, 0);
    this.head.scale.set(r * 2.6, headLen, r * 2.6);
    this.head.position.set(0, shaftLen + headLen / 2, 0);
    this.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  }
}

export class ForceArrows {
  readonly group = new THREE.Group();
  private arrows = new Map<ArrowKey, Arrow>();
  visible: Record<ArrowKey, boolean> = { velocity: false, gravity: false, drag: true, magnus: false, seam: true, wake: false, aero: false };

  constructor() {
    for (const k of Object.keys(ARROW_COLORS) as ArrowKey[]) {
      const a = new Arrow(ARROW_COLORS[k], k === "wake" ? 0.045 : k === "seam" ? 0.11 : 0.075);
      this.arrows.set(k, a);
      this.group.add(a.group);
    }
  }

  /** World-space tips of the visible arrows (for on-screen labels), with |F| in N. */
  tips(vecs: Record<ArrowKey, THREE.Vector3>): { key: ArrowKey; pos: THREE.Vector3; mag: number }[] {
    const out: { key: ArrowKey; pos: THREE.Vector3; mag: number }[] = [];
    for (const [k, a] of this.arrows) {
      if (!a.group.visible) continue;
      const dir = vecs[k].clone().normalize();
      const pos = this.group.position.clone().add(a.group.position).addScaledVector(dir, a.length);
      out.push({ key: k, pos, mag: vecs[k].length() });
    }
    return out;
  }

  /**
   * @param vecs force vectors (N) and the velocity (m/s)
   * @param mg ball weight (N)
   * @param unit length of one "g" arrow before the user scale (scene units)
   * @param radius ball radius in scene units (arrows start at the surface)
   */
  update(origin: THREE.Vector3, vecs: Record<ArrowKey, THREE.Vector3>, mg: number, unit: number, scale: number, radius: number) {
    this.group.position.copy(origin);
    for (const [k, a] of this.arrows) {
      const v = vecs[k];
      const show = this.visible[k];
      if (!show || !v) {
        a.group.visible = false;
        continue;
      }
      const mag = k === "velocity" ? v.length() / 30 : v.length() / mg;
      const len = mag * unit * scale;
      a.set(v, len, radius);
      if (a.group.visible) a.group.position.copy(v.clone().normalize().multiplyScalar(radius));
    }
  }
}
