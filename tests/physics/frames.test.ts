// Left/right conventions. +x is the catcher's / passer's RIGHT (baseball: the 1B side).
import { describe, expect, it } from "vitest";
import { defaultParams, withPatch } from "../../src/physics/params";
import { at3, releaseVelocity, simulate, simulateGhost, spinAxis } from "../../src/physics/simulate";
import { meanWind } from "../../src/physics/environment";
import { cross } from "../../src/physics/vec";
import { makeSepResult, separation, sepConfig } from "../../src/physics/aero/separation";
import { lateralLabel } from "../../src/physics/frames";
import type { V3 } from "../../src/physics/vec";

const still = () =>
  withPatch(defaultParams("baseball"), {
    spin: { revPerSec: 0 },
    aero: { seamForce: false },
    env: { windSpeed: 0 },
    release: { hAngleDeg: 0, lateral: 0 },
  });

describe("world frame", () => {
  it("is right-handed with y up and flight along +z", () => {
    expect(cross([1, 0, 0], [0, 1, 0])).toEqual([0, 0, 1]);
    const v = releaseVelocity(still());
    expect(v[2]).toBeGreaterThan(0);
  });

  it("aims toward +x (1B side) for a positive horizontal angle", () => {
    const v = releaseVelocity(withPatch(still(), { release: { hAngleDeg: 3 } }));
    expect(v[0]).toBeGreaterThan(0);
  });

  it("blows a 90° wind toward +x and a 0° wind with the flight", () => {
    const env = defaultParams("baseball").env;
    const w90 = meanWind({ ...env, windSpeed: 5, windDirDeg: 90 });
    expect(w90[0]).toBeCloseTo(5, 9);
    expect(Math.abs(w90[2])).toBeLessThan(1e-9);
    const w0 = meanWind({ ...env, windSpeed: 5, windDirDeg: 0 });
    expect(w0[2]).toBeCloseTo(5, 9);
  });

  it("drifts the ball toward +x in a 90° crosswind", () => {
    const rec = simulate(withPatch(still(), { env: { windSpeed: 6, windDirDeg: 90, outdoor: false } }));
    expect(at3(rec.r, rec.n - 1)[0]).toBeGreaterThan(0.05);
  });

  it("lifts with backspin (tilt 0°) and pushes toward +x at tilt 90°", () => {
    const back = simulate(withPatch(still(), { spin: { revPerSec: 30, tiltDeg: 0 } }));
    expect(back.fMagnus[3 * 5 + 1]).toBeGreaterThan(0);
    const side = simulate(withPatch(still(), { spin: { revPerSec: 30, tiltDeg: 90 } }));
    expect(side.fMagnus[3 * 5]).toBeGreaterThan(0);
    expect(Math.abs(side.fMagnus[3 * 5 + 1])).toBeLessThan(0.1 * side.fMagnus[3 * 5]);
    // Backspin axis points to −x: the top of the ball moves back toward the pitcher.
    expect(spinAxis(withPatch(still(), { spin: { tiltDeg: 0 } }))[0]).toBeCloseTo(-1, 9);
  });

  it("puts the side force on the side that separates later", () => {
    // A ring of seam points in the trip zone on the +x side only: that side trips, its
    // separation moves back, so the force points to +x.
    const p = defaultParams("baseball");
    const cfg = sepConfig(p);
    const pts: number[] = [];
    for (let i = 0; i <= 40; i++) {
      const phi = -0.4 + (0.8 * i) / 40; // around +x
      const a = (55 * Math.PI) / 180;
      pts.push(Math.sin(a) * Math.cos(phi), Math.sin(a) * Math.sin(phi), Math.cos(a));
    }
    // Flow along +z with world +x on the ring: basis e1 must be such that +x is a real sector.
    const s = separation(new Float64Array(pts), [1, 0, 0, 0], [0, 0, 1], 0, cfg, makeSepResult(cfg.nPhi));
    expect(s.raw[0]).toBeGreaterThan(0);
    expect(Math.abs(s.raw[1])).toBeLessThan(0.2 * s.raw[0]);
  });

  it("measures the ghost gap toward +x when the seam force points to +x", () => {
    const p = withPatch(defaultParams("baseball"), { orientation: { grip: "maxBreak", yawDeg: 0, pitchDeg: 0, rollDeg: 0 }, spin: { revPerSec: 0 } });
    const rec = simulate(p);
    const ghost = simulateGhost(p);
    expect(rec.fSeam[0]).toBeGreaterThan(0);
    const end = at3(rec.r, rec.n - 1);
    const g: V3 = at3(ghost.r, ghost.n - 1);
    expect(end[0] - g[0]).toBeGreaterThan(0.02);
  });

  it("labels +x as 1B / passer's right", () => {
    expect(lateralLabel(0.12, "baseball", 2, " m")).toContain("1B");
    expect(lateralLabel(-0.12, "baseball", 2, " m")).toContain("3B");
    expect(lateralLabel(0.3, "volleyball", 1, " m")).toContain("right");
    expect(lateralLabel(-0.3, "volleyball", 1, " m")).toContain("left");
  });
});
