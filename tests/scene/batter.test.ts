import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { swingingBatter, sweetSpot } from "../../src/scene/batter";
import { FIELD } from "../../src/physics/constants";

// The batter stands in the 3B-side box (x < 0) facing the plate.
const at = new THREE.Vector3(-(FIELD.plateWidth / 2 + FIELD.boxGap + FIELD.boxWidth / 2), 0, FIELD.plateDepth / 2);

describe("swinging batter", () => {
  it("cocks the bat behind him toward the catcher, then sweeps the barrel over the plate", () => {
    const b = swingingBatter(at);
    const start = sweetSpot(b, 0);
    expect(start.x).toBeLessThan(at.x + 0.1); // still on his side of the plate
    expect(start.z).toBeGreaterThan(at.z); // back toward the catcher
    expect(start.y).toBeGreaterThan(1.5); // up over the shoulder
    const contact = sweetSpot(b, 0.55);
    expect(Math.abs(contact.x)).toBeLessThan(0.35); // over the plate
    expect(contact.y).toBeGreaterThan(0.4);
    expect(contact.y).toBeLessThan(1.2); // through the zone
    const follow = sweetSpot(b, 1);
    expect(follow.z).toBeLessThan(contact.z + 0.2); // wrapped toward the pitcher's side
  });
});
