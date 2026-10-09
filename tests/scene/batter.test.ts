import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { solveIK, swingingBatter, sweetSpot } from "../../src/scene/batter";
import { BATTER_AT } from "../../src/game/batting";

// The batter stands in the 3B-side box (x < 0) facing the plate.
const at = new THREE.Vector3(BATTER_AT.x, BATTER_AT.y, BATTER_AT.z);

describe("two-bone IK", () => {
  it("keeps segment lengths and bends toward the pole", () => {
    const root = new THREE.Vector3(0, 1, 0);
    const target = new THREE.Vector3(0.3, 0.7, 0.2);
    const { mid, end } = solveIK(root, target, 0.29, 0.28, new THREE.Vector3(0, -1, 0));
    expect(mid.distanceTo(root)).toBeCloseTo(0.29, 6);
    expect(mid.distanceTo(end)).toBeCloseTo(0.28, 6);
    expect(end.distanceTo(target)).toBeLessThan(1e-6);
    expect(mid.y).toBeLessThan((root.y + target.y) / 2);
  });
});

describe("swinging batter", () => {
  it("starts with the bat up over his back shoulder toward the catcher", () => {
    const b = swingingBatter(at);
    const p = sweetSpot(b, 0, 0);
    expect(p.z).toBeGreaterThan(at.z); // back toward the catcher (+z world)
    expect(p.y).toBeGreaterThan(1.5);
  });

  it("brings the sweet spot over the plate at zone height at contact", () => {
    const p = sweetSpot(swingingBatter(at), 0.55);
    expect(Math.abs(p.x)).toBeLessThan(0.3); // over the plate
    expect(p.z).toBeGreaterThan(-0.2);
    expect(p.z).toBeLessThan(0.45);
    expect(p.y).toBeGreaterThan(0.5);
    expect(p.y).toBeLessThan(1.1);
  });

  it("finishes wrapped around toward the pitcher's side and up", () => {
    const b = swingingBatter(at);
    const contact = sweetSpot(b, 0.55);
    const end = sweetSpot(b, 1);
    expect(end.y).toBeGreaterThan(contact.y + 0.2);
  });

  it("keeps both feet on the ground through the swing (no sinking)", () => {
    const b = swingingBatter(at);
    for (const s of [0, 0.3, 0.55, 0.8, 1]) {
      b.userData.pose(1, s);
      b.updateMatrixWorld(true);
      let minY = Infinity;
      b.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || m.name === "bat") return;
        const box = new THREE.Box3().setFromObject(m);
        minY = Math.min(minY, box.min.y);
      });
      expect(minY).toBeGreaterThan(-0.03);
      expect(minY).toBeLessThan(0.05);
    }
  });

  it("swings the sweet spot exactly to where you click", () => {
    const b = swingingBatter(at);
    for (const click of [{ x: 0, y: 0.8 }, { x: 0.18, y: 0.55 }, { x: -0.15, y: 1.0 }, { x: 0.05, y: 0.62 }]) {
      b.userData.setTarget(click);
      const p = sweetSpot(b, 0.55);
      expect(p.x).toBeCloseTo(click.x, 3);
      expect(p.y).toBeCloseTo(click.y, 3);
      expect(p.z).toBeCloseTo(0, 3);
    }
  });
});
