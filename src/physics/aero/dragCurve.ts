// C_d versus Reynolds number with a drag crisis. Roughness (and taller seams) move the
// crisis to lower Re. The same critical Re drives the separation model's supercritical
// blend, so the drag curve and the seam force collapse together.

import type { BallSpec } from "../constants";

export const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

/** Critical Re: smooth-sphere value lowered by roughness (0..1) and seam height (1 = regulation). */
export function reCritical(ball: BallSpec, roughness: number, seamHeight = 1) {
  return ball.reCritSmooth * Math.pow(10, -0.6 * roughness) * (1 - 0.15 * (seamHeight - 1));
}

/** Relative width of the transition. */
export const CRISIS_WIDTH = 0.1;

/** 0 well below the crisis, 1 well above it: how "supercritical" the boundary layer is. */
export function supercriticalWeight(re: number, reCrit: number) {
  return sigmoid((re - reCrit) / (CRISIS_WIDTH * reCrit));
}

/** Drag crisis: plateau, sharp drop through Re_crit, then a slow supercritical recovery. */
export function dragCurve(re: number, ball: BallSpec, reCrit: number) {
  const w = supercriticalWeight(re, reCrit);
  const recovery = 0.25 * ball.cdSuper * sigmoid((re - 2.5 * reCrit) / (0.6 * reCrit));
  return ball.cdSuper + (ball.cdSub - ball.cdSuper) * (1 - w) + recovery;
}

/** The Re band drawn as "drag crisis" in charts. */
export function crisisBand(reCrit: number): [number, number] {
  return [reCrit * (1 - 2.2 * CRISIS_WIDTH), reCrit * (1 + 2.2 * CRISIS_WIDTH)];
}
