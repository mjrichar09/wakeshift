// Flow overlays: the wake bends opposite the side force, streamlines leave the surface at
// the separation ring, and the flow lab's default camera keeps +x on the right.
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { simulate } from "../../src/physics/simulate";
import { presetParams } from "../../src/ui/presets";
import { snapshotAt, flowPoint } from "../../src/scene/flowState";
import { potentialVelocity, traceStreamline, wakeAxis } from "../../src/scene/overlays/streamlines";
import { surfaceCp } from "../../src/scene/overlays/surfacePressure";
import { FLOW_CAMERA } from "../../src/scene/flowLab";

const rec = simulate(presetParams("baseball", "quarter"));
let peak = 0;
for (let i = 0; i < rec.n; i++) if (rec.cs[i] > rec.cs[peak]) peak = i;
const s = snapshotAt(rec, peak);

describe("wake and streamlines", () => {
  it("deflects the wake opposite to the side force", () => {
    const axis = wakeAxis(s);
    expect(axis.dot(s.seamDir)).toBeLessThan(-0.05);
    expect(axis.dot(s.e)).toBeLessThan(-0.8); // still mostly downstream
  });

  it("has zero velocity at the front stagnation point and 1.5 U at the equator", () => {
    const d = s.e.clone().negate();
    expect(potentialVelocity(s.e.clone().multiplyScalar(1.0000001), d).length()).toBeLessThan(1e-5);
    expect(potentialVelocity(s.e1.clone(), d).length()).toBeCloseTo(1.5, 6);
  });

  it("leaves the surface at the local separation angle", () => {
    for (const k of [0, 9, 18, 27]) {
      const phi = (2 * Math.PI * k) / s.n;
      const dir = new THREE.Vector3().copy(s.e1).multiplyScalar(Math.cos(phi)).addScaledVector(s.e2, Math.sin(phi));
      const seed = s.e.clone().multiplyScalar(4).addScaledVector(dir, 0.1);
      const tr = traceStreamline(s, seed, 0);
      expect(tr.sepAt).toBeGreaterThan(0);
      const p = tr.pts[tr.sepAt];
      const a = Math.acos(p.clone().normalize().dot(s.e));
      expect(p.length()).toBeLessThan(1.3);
      expect(Math.abs(a - s.alpha[k])).toBeLessThan(0.12);
      // Just past separation the line keeps going downstream.
      expect(tr.pts[tr.pts.length - 1].dot(s.e)).toBeLessThan(-3);
    }
  });

  it("puts the ring point at polar angle α from the front", () => {
    const p = flowPoint(s, Math.PI / 2, 0, 1);
    expect(p.dot(s.e)).toBeCloseTo(0, 9);
    expect(p.dot(s.e1)).toBeCloseTo(1, 9);
  });

  it("uses potential-flow pressure ahead of separation", () => {
    expect(surfaceCp(0, 1.4, 0)).toBeCloseTo(1, 9);
    expect(surfaceCp(Math.PI / 2, 2.0, 0)).toBeCloseTo(-1.25, 2);
    expect(surfaceCp(2.6, 1.43, 0)).toBeCloseTo(-0.45, 3);
  });
});

describe("flow lab camera", () => {
  it("keeps +x (1B / passer's right) on the right of the screen", () => {
    const c = new THREE.PerspectiveCamera(FLOW_CAMERA.fov, 1.6, 0.05, 200);
    c.position.copy(FLOW_CAMERA.position);
    c.lookAt(FLOW_CAMERA.target);
    c.updateMatrixWorld();
    expect(new THREE.Vector3(1.5, 0, 0).project(c).x).toBeGreaterThan(new THREE.Vector3(-1.5, 0, 0).project(c).x);
  });
});
