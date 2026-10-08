import { describe, expect, it } from "vitest";
import { defaultParams, withPatch } from "../../src/physics/params";
import type { Params } from "../../src/physics/params";
import { at3, simulate, simulateGhost } from "../../src/physics/simulate";
import { G } from "../../src/physics/constants";
import { surfaceFeature } from "../../src/physics/geometry";
import { calibrate, sepConfig, separation } from "../../src/physics/aero/separation";
import { dragCurve, reCritical } from "../../src/physics/aero/dragCurve";
import { BASEBALL, VOLLEYBALL } from "../../src/physics/constants";
import type { V3 } from "../../src/physics/vec";
import { dot, norm, qAxisAngle, qFromTo, qMul } from "../../src/physics/vec";
import { presetParams } from "../../src/ui/presets";

const base = () => defaultParams("baseball");

describe("integrator", () => {
  it("matches the analytic projectile with ρ = 0", () => {
    const p = withPatch(base(), { env: { densityOverride: 0, windSpeed: 0 } });
    const rec = simulate(p);
    const v0 = at3(rec.v, 0);
    const r0 = at3(rec.r, 0);
    for (const i of [100, 300, rec.n - 2]) {
      const t = rec.t[i];
      const r = at3(rec.r, i);
      expect(r[0]).toBeCloseTo(r0[0] + v0[0] * t, 9);
      expect(r[1]).toBeCloseTo(r0[1] + v0[1] * t - 0.5 * G * t * t, 9);
      expect(r[2]).toBeCloseTo(r0[2] + v0[2] * t, 9);
    }
  });

  it("approaches the analytic terminal velocity in a drag-only drop", () => {
    const p = withPatch(base(), {
      release: { speed: 0, vAngleDeg: 0, hAngleDeg: 0, height: 3000, lateral: 0, z: 0 },
      spin: { revPerSec: 0 },
      aero: { seamForce: false, magnus: false },
      env: { windSpeed: 0 },
      sim: { maxTime: 40, stopAtTarget: false, stopAtFloor: true, recordSectors: false },
    });
    const rec = simulate(p);
    const i = rec.n - 1;
    const v = at3(rec.v, i);
    const cd = rec.cd[i];
    const A = (Math.PI * BASEBALL.diameter ** 2) / 4;
    const vt = Math.sqrt((2 * BASEBALL.mass * G) / (rec.air.rho * A * cd));
    expect(Math.abs(v[0])).toBeLessThan(1e-9);
    expect(-v[1]).toBeGreaterThan(0.99 * vt);
    expect(-v[1]).toBeLessThan(1.01 * vt);
  });

  it("never gains mechanical energy without wind", () => {
    for (const p of [base(), presetParams("baseball", "quarter"), presetParams("baseball", "tooMuch"), defaultParams("volleyball")]) {
      const rec = simulate(withPatch(p, { env: { windSpeed: 0, gustIntensity: 0 } }));
      const m = rec.ball.mass;
      let prev = Infinity;
      for (let i = 0; i < rec.n; i++) {
        const v = at3(rec.v, i);
        const E = 0.5 * m * dot(v, v) + m * G * rec.r[3 * i + 1];
        expect(E).toBeLessThanOrEqual(prev + 1e-9);
        prev = E;
      }
    }
  });
});

describe("separation model", () => {
  const p = base();
  const f = surfaceFeature(p);
  const cfg = sepConfig(p);
  const z: V3 = [0, 0, 1];

  it("gives zero lateral force for a mirror-symmetric orientation", () => {
    // Flow along body z: the seam's mirror planes x = ±y both contain the flow.
    const s = separation(f.points, [1, 0, 0, 0], z, 0, cfg);
    const peak = calibrate(f.id, f.points, cfg).peakRaw;
    expect(Math.hypot(...s.raw) / peak).toBeLessThan(0.02);
    // Flow along a direction inside the single mirror plane x = y: no force across that plane.
    const d = norm([1, 1, 0.6]);
    const s2 = separation(f.points, qFromTo(d, z), z, 0, cfg);
    const planeNormalWorld = norm(qRotateV(qFromTo(d, z), [1, -1, 0]));
    expect(Math.abs(dot(s2.raw, planeNormalWorld)) / peak).toBeLessThan(0.03);
    expect(Math.hypot(...s2.raw) / peak).toBeGreaterThan(0.05);
  });

  it("flips n̂ when the ball is rotated 180° about ê", () => {
    for (const d of [norm([1, 0.2, 0.3]), norm([0.3, -0.8, 0.4]), norm([1, 0, 0])]) {
      const q = qFromTo(d, z);
      const a = separation(f.points, q, z, 0, cfg);
      const b = separation(f.points, qMul(qAxisAngle(z, Math.PI), q), z, 0, cfg);
      const ma = Math.hypot(...a.raw);
      expect(ma).toBeGreaterThan(1e-4);
      for (let k = 0; k < 3; k++) expect(b.raw[k]).toBeCloseTo(-a.raw[k], 6);
    }
  });

  it("collapses the asymmetry at supercritical Re", () => {
    const q = qFromTo(norm([1, 0.2, 0.3]), z);
    const lo = Math.hypot(...separation(f.points, q, z, 0, cfg).raw);
    const hi = Math.hypot(...separation(f.points, q, z, 0.98, cfg).raw);
    expect(hi).toBeLessThan(0.05 * lo);
  });

  it("calibrates the peak |C_S| to C_S,max", () => {
    const cal = calibrate(f.id, f.points, cfg);
    expect(cal.peakRaw).toBeGreaterThan(0);
    const s = separation(f.points, qFromTo(cal.bestDir, z), z, 0, cfg);
    expect((p.aero.csMax * Math.hypot(...s.raw)) / cal.peakRaw).toBeCloseTo(p.aero.csMax, 6);
  });
});

describe("drag curve", () => {
  it("has a drag-crisis shape across a Re sweep", () => {
    for (const ball of [BASEBALL, VOLLEYBALL]) {
      const rc = reCritical(ball, 0.4);
      const sweep = Array.from({ length: 60 }, (_, i) => 3e4 * 1.06 ** i);
      const cds = sweep.map((re) => dragCurve(re, ball, rc));
      const sub = dragCurve(0.4 * rc, ball, rc);
      const sup = dragCurve(1.4 * rc, ball, rc);
      expect(sub - sup).toBeGreaterThan(0.15);
      // Steepest drop sits at the critical Re.
      let steep = 0;
      let reSteep = 0;
      for (let i = 1; i < sweep.length; i++) {
        const slope = (cds[i - 1] - cds[i]) / Math.log(sweep[i] / sweep[i - 1]);
        if (slope > steep) {
          steep = slope;
          reSteep = sweep[i];
        }
      }
      expect(reSteep / rc).toBeGreaterThan(0.85);
      expect(reSteep / rc).toBeLessThan(1.15);
      // Roughness moves the crisis to lower Re.
      expect(reCritical(ball, 0.8)).toBeLessThan(reCritical(ball, 0.2));
    }
  });
});

describe("determinism and noise", () => {
  const noisy = (seed: number): Params => withPatch(base(), { aero: { noise: true, seed } });

  it("reproduces a record exactly for the same params and seed", () => {
    const a = simulate(noisy(7));
    const b = simulate(noisy(7));
    expect(a.n).toBe(b.n);
    expect(Array.from(a.r)).toEqual(Array.from(b.r));
    expect(Array.from(a.fWake)).toEqual(Array.from(b.fWake));
  });

  it("changes the record for a different seed when noise is on", () => {
    const a = simulate(noisy(7));
    const b = simulate(noisy(8));
    const i = Math.min(a.n, b.n) - 1;
    expect(Math.abs(a.r[3 * i] - b.r[3 * i]) + Math.abs(a.r[3 * i + 1] - b.r[3 * i + 1])).toBeGreaterThan(1e-5);
  });

  it("ignores the seed when noise and gusts are off", () => {
    const a = simulate(withPatch(base(), { aero: { seed: 1 } }));
    const b = simulate(withPatch(base(), { aero: { seed: 2 } }));
    expect(Array.from(a.r)).toEqual(Array.from(b.r));
  });
});

describe("knuckleball behaviour", () => {
  it("½ rotation makes the lateral force change sign during flight", () => {
    const rec = simulate(presetParams("baseball", "half"));
    expect(rec.rotations[rec.n - 1]).toBeGreaterThan(0.4);
    expect(rec.rotations[rec.n - 1]).toBeLessThan(0.6);
    let pos = false;
    let neg = false;
    for (let i = 0; i < rec.n; i++) {
      const fx = rec.fSeam[3 * i];
      if (fx > 0.02) pos = true;
      if (fx < -0.02) neg = true;
    }
    expect(pos && neg).toBe(true);
  });

  it("¼ rotation gives a non-monotonic lateral force", () => {
    const rec = simulate(presetParams("baseball", "quarter"));
    const fx = Array.from({ length: rec.n }, (_, i) => rec.fSeam[3 * i]);
    let ups = 0;
    let downs = 0;
    for (let i = 10; i < fx.length; i += 10) {
      if (fx[i] > fx[i - 10] + 1e-3) ups++;
      if (fx[i] < fx[i - 10] - 1e-3) downs++;
    }
    expect(ups).toBeGreaterThan(2);
    expect(downs).toBeGreaterThan(2);
  });
});

function qRotateV(q: [number, number, number, number], v: V3): V3 {
  const [w, x, y, zz] = q;
  const tx = 2 * (y * v[2] - zz * v[1]);
  const ty = 2 * (zz * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - zz * ty), v[1] + w * ty + (zz * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}

describe("float serve", () => {
  const maxDev = (id: string) => {
    const p = presetParams("volleyball", id);
    const r = simulate(p);
    const g = simulateGhost(p);
    let m = 0;
    for (let i = 0; i < Math.min(r.n, g.n); i++) m = Math.max(m, Math.hypot(r.r[3 * i] - g.r[3 * i], r.r[3 * i + 1] - g.r[3 * i + 1]));
    return { m, r };
  };

  it("floats less when served fast (supercritical) than slow", () => {
    const fast = maxDev("fast");
    const slow = maxDev("slow");
    expect(fast.m).toBeLessThan(0.75 * slow.m);
    expect(fast.r.wRe[0]).toBeGreaterThan(0.7);
    expect(slow.r.wRe[0]).toBeLessThan(0.3);
  });

  it("lands every volleyball preset in the court", () => {
    for (const id of ["still", "hvac", "beach", "fast", "slow", "jumpTopspin", "standingTopspin", "sidespin", "skyBall"]) {
      const { r } = maxDev(id);
      expect(r.outcome).toBe("floor");
      const z = r.r[3 * (r.n - 1) + 2];
      expect(z).toBeGreaterThan(0);
      expect(z).toBeLessThan(9);
      expect(Math.abs(r.r[3 * (r.n - 1)])).toBeLessThan(4.5);
    }
  });
});

describe("other pitches", () => {
  it("brings every spin pitch to the plate near the strike zone", () => {
    for (const id of ["fourSeam", "sinker", "cutter", "slider", "curveball", "changeup", "splitter"]) {
      const r = simulate(presetParams("baseball", id));
      const end = at3(r.r, r.n - 1);
      expect(r.outcome, id).toBe("plate");
      expect(Math.abs(end[0]), id).toBeLessThan(0.3);
      expect(end[1], id).toBeGreaterThan(0.35);
      expect(end[1], id).toBeLessThan(1.15);
    }
  });

  it("orders the movement the way the pitches are known for", () => {
    // Vertical Magnus: four-seam lifts most, curveball pushes down.
    const lift = (id: string) => {
      const r = simulate(presetParams("baseball", id));
      return r.fMagnus[3 * 50 + 1];
    };
    expect(lift("fourSeam")).toBeGreaterThan(0.4);
    expect(lift("curveball")).toBeLessThan(-0.3);
    // Horizontal: sinker and changeup run toward 3B (arm side of a right-hander), slider and cutter toward 1B.
    const side = (id: string) => simulate(presetParams("baseball", id)).fMagnus[3 * 50];
    expect(side("sinker")).toBeLessThan(0);
    expect(side("changeup")).toBeLessThan(0);
    expect(side("slider")).toBeGreaterThan(0);
    expect(side("cutter")).toBeGreaterThan(0);
  });
});
