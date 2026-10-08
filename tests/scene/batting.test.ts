import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { isStrike, plateHit, randomPitch, score } from "../../src/game/batting";
import { BASEBALL_VIEWS } from "../../src/scene/cameras";
import { arrival, simulate } from "../../src/physics/simulate";
import { mulberry32 } from "../../src/physics/rng";

const IN = 0.0254;

describe("scoring", () => {
  const strike = { x: 0, y: 0.75 };
  const ball = { x: 0.45, y: 0.75 };

  it("grades a swing by how close the guess is", () => {
    expect(score(strike, { x: 0.02, y: 0.75 }, "easy").verdict).toBe("barrel");
    expect(score(strike, { x: 0, y: 0.75 + 2.5 * IN }, "easy").verdict).toBe("solid");
    expect(score(strike, { x: 4 * IN, y: 0.75 }, "easy").verdict).toBe("foul");
    expect(score(strike, { x: 0.3, y: 0.75 }, "easy").verdict).toBe("miss");
    expect(score(ball, { x: 0, y: 0.75 }, "easy").verdict).toBe("chase");
  });

  it("rewards taking a ball and punishes taking a strike", () => {
    expect(score(ball, null, "easy")).toMatchObject({ verdict: "goodTake", points: 30 });
    expect(score(strike, null, "easy")).toMatchObject({ verdict: "calledStrike", points: 0 });
  });

  it("pays more at real-time speed", () => {
    expect(score(strike, strike, "hard").points).toBeGreaterThan(score(strike, strike, "easy").points);
  });

  it("calls the zone with the ball's radius", () => {
    expect(isStrike(0.2159 + 0.03, 1.0)).toBe(true);
    expect(isStrike(0.2159 + 0.05, 1.0)).toBe(false);
    expect(isStrike(0, 0.2)).toBe(false);
  });
});

describe("click to plate", () => {
  it("maps a click to the plate plane with 1B on the right", () => {
    const v = BASEBALL_VIEWS.find((x) => x.id === "catcher")!.pose!;
    const cam = new THREE.PerspectiveCamera(v.fov, 1.6, 0.05, 500);
    cam.position.copy(v.position);
    cam.lookAt(v.target);
    cam.updateMatrixWorld();
    // A point on the plate plane projects to a click that maps straight back to it.
    for (const p of [
      { x: 0.1, y: 0.8 },
      { x: -0.2, y: 0.5 },
    ]) {
      const ndc = new THREE.Vector3(p.x, p.y, 0).project(cam);
      const hit = plateHit(cam, ndc.x, ndc.y)!;
      expect(hit.x).toBeCloseTo(p.x, 6);
      expect(hit.y).toBeCloseTo(p.y, 6);
    }
    expect(plateHit(cam, 0.3, 0)!.x).toBeGreaterThan(plateHit(cam, -0.3, 0)!.x);
  });

  it("keeps the whole strike zone on screen in the catcher view", () => {
    const v = BASEBALL_VIEWS.find((x) => x.id === "catcher")!.pose!;
    for (const aspect of [1.0, 1.6, 2.2]) {
      const cam = new THREE.PerspectiveCamera(v.fov, aspect, 0.05, 500);
      cam.position.copy(v.position);
      cam.lookAt(v.target);
      cam.updateMatrixWorld();
      for (const [x, y] of [[-0.3, 0.3], [0.3, 0.3], [-0.3, 1.2], [0.3, 1.2]]) {
        const p = new THREE.Vector3(x, y, 0).project(cam);
        expect(Math.abs(p.x)).toBeLessThan(0.95);
        expect(Math.abs(p.y)).toBeLessThan(0.95);
      }
      // And the pitcher's release point too.
      const r = new THREE.Vector3(-0.45, 1.75, -16.3).project(cam);
      expect(Math.abs(r.y)).toBeLessThan(0.95);
    }
  });
});

describe("random pitches", () => {
  it("reach the plate, mostly near the zone, with a mix of balls and strikes", () => {
    const rand = mulberry32(42);
    let strikes = 0;
    let knuckles = 0;
    for (let k = 0; k < 40; k++) {
      const p = randomPitch(rand);
      const r = simulate(p.params);
      const a = arrival(r);
      expect(r.outcome).toBe("plate");
      expect(Math.abs(a[0])).toBeLessThan(0.9);
      if (isStrike(a[0], a[1])) strikes++;
      if (p.knuckle) knuckles++;
    }
    expect(strikes).toBeGreaterThan(12);
    expect(strikes).toBeLessThan(38);
    expect(knuckles).toBeGreaterThan(10);
  });
});
