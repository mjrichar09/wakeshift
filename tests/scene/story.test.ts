import { describe, expect, it } from "vitest";
import { simulate, simulateGhost } from "../../src/physics/simulate";
import { presetParams } from "../../src/ui/presets";
import { autoBallScale, caption, directionWords, landmarks } from "../../src/ui/story";

describe("direction words", () => {
  it("names +x as 1B / passer's right", () => {
    expect(directionWords(1, 0, "baseball")).toBe("toward 1B");
    expect(directionWords(-1, 0.1, "baseball")).toBe("toward 3B");
    expect(directionWords(0.1, -1, "baseball")).toBe("down");
    expect(directionWords(0.8, 1, "baseball")).toBe("up and toward 1B");
    expect(directionWords(1, 0, "volleyball")).toBe("to the passer's right");
  });
});

describe("caption", () => {
  const p = presetParams("baseball", "quarter");
  const rec = simulate(p);
  const ghost = simulateGhost(p);

  it("narrates release, the side force and arrival", () => {
    expect(caption(rec, ghost, 0, "imperial").tag).toBe("Release");
    expect(caption(rec, ghost, rec.n - 1, "imperial").text).toMatch(/toward (1B|3B)/);
    const mid = caption(rec, ghost, 150, "imperial");
    expect(["Side force", "Balanced"]).toContain(mid.tag);
  });

  it("matches the push direction in the record", () => {
    for (let i = 20; i < rec.n - 1; i += 37) {
      const c = caption(rec, ghost, i, "imperial");
      if (c.tag !== "Side force") continue;
      const fx = rec.fSeam[3 * i];
      if (Math.abs(fx) > 0.6 * Math.abs(rec.fSeam[3 * i + 1])) expect(c.text).toContain(fx > 0 ? "1B" : "3B");
    }
  });

  it("calls a fast serve supercritical", () => {
    const fp = presetParams("volleyball", "fast");
    const fr = simulate(fp);
    expect(caption(fr, simulateGhost(fp), 30, "metric").tag).toBe("Supercritical");
  });
});

describe("landmarks", () => {
  it("marks a peak and, for 1/2 turn, a flip of the push", () => {
    const rec = simulate(presetParams("baseball", "half"));
    const lm = landmarks(rec);
    expect(lm.filter((l) => l.kind === "peak")).toHaveLength(1);
    expect(lm.some((l) => l.kind === "flip")).toBe(true);
    for (let k = 1; k < lm.length; k++) expect(lm[k].t).toBeGreaterThanOrEqual(lm[k - 1].t);
  });

  it("marks the fast serve dropping into the drag crisis", () => {
    const rec = simulate(presetParams("volleyball", "fast"));
    expect(landmarks(rec).some((l) => l.kind === "crisis")).toBe(true);
  });
});

describe("auto ball scale", () => {
  it("enlarges a far ball and leaves a near one alone", () => {
    expect(autoBallScale(0.037, 16, 26, 800)).toBeGreaterThan(1.5);
    expect(autoBallScale(0.037, 0.8, 40, 800)).toBe(1);
    expect(autoBallScale(0.037, 1e4, 26, 800)).toBe(10);
  });
});
