import { describe, expect, it } from "vitest";
import { airDensity, airViscosity, pressureAtAltitude, shearFactor } from "../../src/physics/environment";
import { surfaceFeature } from "../../src/physics/geometry";
import { volleyballPanelId } from "../../src/physics/geometry/volleyballPanels";
import { defaultParams, withPatch } from "../../src/physics/params";

describe("environment", () => {
  it("gives standard sea-level air", () => {
    expect(airDensity(15, 0, 0)).toBeCloseTo(1.225, 2);
    expect(airViscosity(15)).toBeCloseTo(1.79e-5, 6);
    expect(pressureAtAltitude(0)).toBeCloseTo(101325, 0);
  });

  it("thins the air with altitude, heat and humidity", () => {
    expect(airDensity(20, 1600, 0.3)).toBeLessThan(0.88 * airDensity(20, 0, 0.3));
    expect(airDensity(30, 0, 0)).toBeLessThan(airDensity(10, 0, 0));
    expect(airDensity(30, 0, 1)).toBeLessThan(airDensity(30, 0, 0));
  });

  it("uses a log wind profile that is 1 at 10 m", () => {
    expect(shearFactor(10)).toBeCloseTo(1, 9);
    expect(shearFactor(1.5)).toBeLessThan(0.75);
  });
});

describe("surface features", () => {
  it("puts every feature point on the unit sphere", () => {
    for (const design of ["classic18", "cube6", "octa8"] as const) {
      for (const sport of ["baseball", "volleyball"] as const) {
        const f = surfaceFeature(withPatch(defaultParams(sport), { ball: { panelDesign: design } }));
        expect(f.points.length).toBeGreaterThan(300);
        for (let i = 0; i < f.points.length; i += 3)
          expect(Math.hypot(f.points[i], f.points[i + 1], f.points[i + 2])).toBeCloseTo(1, 9);
      }
    }
  });

  it("numbers the classic volleyball's 18 panels", () => {
    const ids = new Set<number>();
    for (let i = 0; i < 4000; i++) {
      const u = Math.random() * 2 - 1;
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      ids.add(volleyballPanelId("classic18", [r * Math.cos(a), r * Math.sin(a), u]));
    }
    expect(ids.size).toBe(18);
  });
});
