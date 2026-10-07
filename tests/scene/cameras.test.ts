// Screen-space left/right for every camera, checked by projecting world points.
// Convention: +x = catcher's/passer's right = 1B side.
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { BASEBALL_VIEWS, VOLLEYBALL_VIEWS, chasePose } from "../../src/scene/cameras";
import type { Pose, ViewDef } from "../../src/scene/cameras";
import { toThreeQuat } from "../../src/scene/ball";
import { qAxisAngle, qMul, qRotate, norm } from "../../src/physics/vec";
import type { V3 } from "../../src/physics/vec";

function cam(p: Pose) {
  const c = new THREE.PerspectiveCamera(p.fov, 1.6, 0.01, 500);
  c.position.copy(p.position);
  c.lookAt(p.target);
  c.updateMatrixWorld();
  return c;
}
const screen = (c: THREE.Camera, x: number, y: number, z: number) => new THREE.Vector3(x, y, z).project(c);
const view = (list: ViewDef[], id: string) => cam(list.find((v) => v.id === id)!.pose!);

describe("baseball cameras", () => {
  it("catcher sees 1B (+x) on the right", () => {
    const c = view(BASEBALL_VIEWS, "catcher");
    expect(screen(c, 1, 1.2, -10).x).toBeGreaterThan(0);
    expect(screen(c, -1, 1.2, -10).x).toBeLessThan(0);
  });

  it("puts the right-handed batter on the 3B side and the lefty on the 1B side", () => {
    expect(BASEBALL_VIEWS.find((v) => v.id === "batterR")!.pose!.position.x).toBeLessThan(0);
    expect(BASEBALL_VIEWS.find((v) => v.id === "batterL")!.pose!.position.x).toBeGreaterThan(0);
    // Both batters look toward the pitcher and keep 1B to the catcher's right.
    for (const id of ["batterR", "batterL"]) {
      const c = view(BASEBALL_VIEWS, id);
      expect(screen(c, 0, 1.5, -16).z).toBeLessThan(1); // in front of the camera
      expect(screen(c, 1.5, 1.2, -10).x).toBeGreaterThan(screen(c, -1.5, 1.2, -10).x);
    }
  });

  it("behind the pitcher, 1B is on the left of the screen", () => {
    const c = view(BASEBALL_VIEWS, "pitcher");
    expect(screen(c, 1, 1, -5).x).toBeLessThan(0);
  });

  it("overhead keeps 1B on the right with the pitcher at the top", () => {
    const c = view(BASEBALL_VIEWS, "overhead");
    expect(screen(c, 2, 0, -8.2).x).toBeGreaterThan(0);
    expect(screen(c, 0, 0, -15).y).toBeGreaterThan(screen(c, 0, 0, -2).y);
  });

  it("side view stands on the 1B side with the pitcher on the right", () => {
    expect(BASEBALL_VIEWS.find((v) => v.id === "side")!.pose!.position.x).toBeGreaterThan(0);
    const c = view(BASEBALL_VIEWS, "side");
    expect(screen(c, 0, 1, -15).x).toBeGreaterThan(screen(c, 0, 1, -2).x);
  });

  it("chase camera trails the ball, so 1B is on the screen's left", () => {
    const p = chasePose(new THREE.Vector3(0, 1.5, -10), new THREE.Vector3(0, 0, 1), 1.2);
    const c = cam(p);
    expect(screen(c, 1, 1.5, -8).x).toBeLessThan(screen(c, -1, 1.5, -8).x);
  });
});

describe("volleyball cameras", () => {
  it("passer sees their right (+x) on the right", () => {
    const c = view(VOLLEYBALL_VIEWS, "passer");
    expect(screen(c, 2, 2, -5).x).toBeGreaterThan(0);
    expect(screen(c, -2, 2, -5).x).toBeLessThan(0);
  });

  it("overhead keeps the passer's right on the right, server at the top", () => {
    const c = view(VOLLEYBALL_VIEWS, "overhead");
    expect(screen(c, 3, 0, 0).x).toBeGreaterThan(0);
    expect(screen(c, 0, 0, -8).y).toBeGreaterThan(screen(c, 0, 0, 8).y);
  });

  it("server's view from behind has the passer's right on the left of the screen", () => {
    const c = view(VOLLEYBALL_VIEWS, "server");
    expect(screen(c, 3, 1, 5).x).toBeLessThan(screen(c, -3, 1, 5).x);
  });
});

describe("ball orientation", () => {
  it("maps the physics quaternion onto three.js unchanged", () => {
    const q = qMul(qAxisAngle([0.3, 1, -0.2], 1.1), qAxisAngle([1, 0, 0], -0.4));
    for (const v of [[1, 0, 0], [0, 1, 0], norm([0.2, -0.5, 0.8])] as V3[]) {
      const a = qRotate(q, v);
      const b = new THREE.Vector3(...v).applyQuaternion(toThreeQuat(q));
      expect(b.x).toBeCloseTo(a[0], 9);
      expect(b.y).toBeCloseTo(a[1], 9);
      expect(b.z).toBeCloseTo(a[2], 9);
    }
  });
});
