// World frame, shared by the physics and the Three.js scene (no axis swaps anywhere):
//
//   +y  up.
//   +z  the direction of flight: from the pitcher toward home plate, or from the server
//       toward the passer.
//   +x  the receiver's RIGHT as they face the incoming ball (catcher or passer).
//       In baseball that is the FIRST-BASE side; −x is the third-base side.
//
// The frame is right-handed (x × y = z), which is the Three.js convention, so a camera
// behind home plate looking toward the pitcher (along −z) sees +x on the right of the
// screen. A pitcher looking toward home (along +z) sees +x on their LEFT. Tests in
// tests/physics/frames.test.ts and tests/scene/cameras.test.ts pin this down.
//
// Use the helpers below for any user-facing left/right wording instead of writing
// "left"/"right" by hand.

import type { Sport } from "./params";

/** Unambiguous label for a lateral (x) offset, e.g. a break or a release point. */
export function lateralLabel(x: number, sport: Sport, digits = 1, unit = ""): string {
  const mag = `${Math.abs(x).toFixed(digits)}${unit}`;
  if (Math.abs(x) < 0.5 * 10 ** -digits) return `${mag} (centered)`;
  if (sport === "baseball") return x > 0 ? `${mag} toward 1B` : `${mag} toward 3B`;
  return x > 0 ? `${mag} to passer's right` : `${mag} to passer's left`;
}

/** Name of the +x side for the sport, for axis captions. */
export function plusXName(sport: Sport): string {
  return sport === "baseball" ? "1B side (catcher's right)" : "passer's right";
}
