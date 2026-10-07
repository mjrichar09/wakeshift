// Surface pressure map: potential-flow Cp = 1 − (9/4) sin²α ahead of the local separation
// line, then a constant base pressure (lower for laminar separation than for turbulent).
// Vertex colors on a shell just outside the ball, in the flow frame (it does not spin).

import * as THREE from "three";
import type { FlowSnapshot } from "../flowState";
import { alphaAt, sectorWeights } from "../flowState";

const CP_MIN = -1.25;
const CP_MAX = 1;

/** Diverging map: blue (suction) → white (ambient) → red (stagnation). */
export function cpColor(cp: number, out = new THREE.Color()) {
  if (cp < 0) {
    const k = Math.min(1, cp / CP_MIN);
    return out.setRGB(1 - 0.8 * k, 1 - 0.55 * k, 1 - 0.1 * k, THREE.SRGBColorSpace);
  }
  const k = Math.min(1, cp / CP_MAX);
  return out.setRGB(1 - 0.1 * k, 1 - 0.7 * k, 1 - 0.75 * k, THREE.SRGBColorSpace);
}

export function surfaceCp(alpha: number, alphaSep: number, turb: number) {
  const pot = 1 - 2.25 * Math.sin(alpha) ** 2;
  const base = -0.45 + 0.25 * turb;
  const w = THREE.MathUtils.smoothstep(alpha, alphaSep - 0.05, alphaSep + 0.05);
  return pot * (1 - w) + base * w;
}

export class SurfacePressure {
  readonly mesh: THREE.Mesh;
  private geo: THREE.SphereGeometry;
  private colors: Float32Array;

  constructor() {
    this.geo = new THREE.SphereGeometry(1.012, 64, 40);
    this.colors = new Float32Array(this.geo.getAttribute("position").count * 3);
    this.geo.setAttribute("color", new THREE.BufferAttribute(this.colors, 3));
    this.mesh = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.88, depthWrite: false }));
    this.mesh.renderOrder = 1;
  }

  update(s: FlowSnapshot) {
    const pos = this.geo.getAttribute("position");
    const c = new THREE.Color();
    const n = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      n.set(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
      const a = Math.acos(THREE.MathUtils.clamp(n.dot(s.e), -1, 1));
      let phi = Math.atan2(n.dot(s.e2), n.dot(s.e1));
      if (phi < 0) phi += 2 * Math.PI;
      const k = Math.round((phi / (2 * Math.PI)) * s.n) % s.n;
      cpColor(surfaceCp(a, alphaAt(s, phi), sectorWeights(s, k).turb), c);
      this.colors[3 * i] = c.r;
      this.colors[3 * i + 1] = c.g;
      this.colors[3 * i + 2] = c.b;
    }
    (this.geo.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;
  }
}
