import { describe, expect, it } from "vitest";
import { decodeHash, encodeHash, paramsDiff } from "../../src/ui/share";
import { defaultParams, withPatch } from "../../src/physics/params";
import { presetParams } from "../../src/ui/presets";

describe("URL-hash sharing", () => {
  it("round-trips params through the hash", () => {
    const p = withPatch(presetParams("baseball", "denver"), { orientation: { yawDeg: 33 }, aero: { empiricalTable: [0.1, -0.1] } });
    const back = decodeHash(encodeHash({ params: p, view: "catcher", preset: "denver" }))!;
    expect(back.params).toEqual(p);
    expect(back.view).toBe("catcher");
    expect(back.preset).toBe("denver");
  });

  it("stores only what differs from the defaults", () => {
    expect(paramsDiff(defaultParams("volleyball"))).toEqual({});
    expect(paramsDiff(withPatch(defaultParams("volleyball"), { release: { speed: 20 } }))).toEqual({ release: { speed: 20 } });
  });

  it("rejects junk", () => {
    expect(decodeHash("#c=%%%")).toBeNull();
    expect(decodeHash("#nothing")).toBeNull();
  });
});
