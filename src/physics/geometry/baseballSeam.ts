// The baseball seam as a closed curve on the unit sphere (body frame):
//   x = a cos t + b cos 3t,  y = a sin t − b sin 3t,  z = c sin 2t,  a + b = 1, c = 2√(ab)
// which satisfies x² + y² + z² = 1 exactly. Body z is the seam's 4-fold rotoreflection
// axis; the planes x = y and x = −y are mirror planes and z is a 2-fold axis, so a flow
// along ±z sees a mirror-symmetric pattern (zero lateral force).
// The renderer draws the stitches from this same function, so the picture matches the physics.

import type { V3 } from "../vec";

/** Lobe parameter: larger b pinches the two halves into a deeper dumbbell. */
export const SEAM_B = 0.28;

export function seamPoint(t: number, b = SEAM_B): V3 {
  const a = 1 - b;
  const c = 2 * Math.sqrt(a * b);
  return [a * Math.cos(t) + b * Math.cos(3 * t), a * Math.sin(t) - b * Math.sin(3 * t), c * Math.sin(2 * t)];
}

/** n points evenly spaced in the parameter around the closed seam. */
export function baseballSeam(n = 400, b = SEAM_B): V3[] {
  return Array.from({ length: n }, (_, i) => seamPoint((2 * Math.PI * i) / n, b));
}
