// The dials must agree with the world frame: +x (1B / passer's right) is on the RIGHT of
// both faces; the clock is the catcher's view, the compass is the overhead view with the
// pitcher at the top (screen y points down).
import { describe, expect, it } from "vitest";
import { dialAngle, dialVector } from "../../src/ui/kit";
import { meanWind } from "../../src/physics/environment";
import { defaultParams, withPatch } from "../../src/physics/params";
import { simulate } from "../../src/physics/simulate";

describe("spin-tilt clock", () => {
  it("puts 0° at the top and 90° (Magnus toward 1B) on the right", () => {
    const [x0, y0] = dialVector("clock", 0);
    expect(x0).toBeCloseTo(0, 9);
    expect(y0).toBeCloseTo(-1, 9);
    const [x9, y9] = dialVector("clock", 90);
    expect(x9).toBeCloseTo(1, 9);
    expect(y9).toBeCloseTo(0, 9);
  });

  it("matches the Magnus force the physics produces", () => {
    for (const tilt of [0, 45, 90, 200, 300]) {
      const p = withPatch(defaultParams("baseball"), { spin: { revPerSec: 25, tiltDeg: tilt }, aero: { seamForce: false }, release: { hAngleDeg: 0, vAngleDeg: 0 } });
      const rec = simulate(p);
      const fx = rec.fMagnus[3];
      const fy = rec.fMagnus[4];
      const [sx, sy] = dialVector("clock", tilt);
      // Catcher's view: screen right = +x, screen down = −y.
      const n = Math.hypot(fx, fy);
      expect(sx).toBeCloseTo(fx / n, 2);
      expect(sy).toBeCloseTo(-fy / n, 2);
    }
  });

  it("inverts", () => {
    for (const d of [0, 30, 90, 179, 270, 359]) expect(dialAngle("clock", ...dialVector("clock", d))).toBeCloseTo(d, 6);
  });
});

describe("wind compass", () => {
  it("draws where the wind blows, pitcher at the top, 1B on the right", () => {
    const env = defaultParams("baseball").env;
    for (const d of [0, 90, 180, 270, 37]) {
      const w = meanWind({ ...env, windSpeed: 1, windDirDeg: d });
      const [sx, sy] = dialVector("compass", d);
      // Overhead with the pitcher (−z) at the top: screen right = +x, screen down = +z.
      expect(sx).toBeCloseTo(w[0], 9);
      expect(sy).toBeCloseTo(w[2], 9);
    }
    expect(dialAngle("compass", 1, 0)).toBeCloseTo(90, 9);
    expect(dialAngle("compass", 0, 1)).toBeCloseTo(0, 9);
  });
});
