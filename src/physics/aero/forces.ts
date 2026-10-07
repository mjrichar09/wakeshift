// Aerodynamic coefficients and forces. With q = ½ρ|v_rel|², A = πd²/4, ê = v_rel/|v_rel|:
//   gravity  m g
//   drag     −q A C_d ê
//   Magnus   q A C_L (ω̂ × ê),  C_L = k_M S (soft-capped), S = rω/|v_rel|
//   seam     q A C_S n̂,  n̂ ⟂ ê   (separation model or empirical table)
//   wake     q A C_N(t) m̂(t)      (OU noise at the shedding frequency; off by default)

import type { BallSpec } from "../constants";
import type { Params } from "../params";
import type { V3 } from "../vec";
import { cross, dot } from "../vec";
import { dragCurve } from "./dragCurve";
import type { SepConfig, SepResult } from "./separation";

/** C_L = k_M·S, saturating smoothly at 0.4 so high-spin presets stay sane. */
export function liftCoefficient(kM: number, S: number) {
  const cap = 0.4;
  return cap * Math.tanh((kM * S) / cap);
}

/** C_d from the drag-crisis curve, lowered when seams trip more of the boundary layer. */
export function dragCoefficient(re: number, ball: BallSpec, reCrit: number, sep: SepResult | null, cfg: SepConfig, p: Params) {
  const base = dragCurve(re, ball, reCrit);
  if (!sep) return base;
  const fTurb = (sep.mean - cfg.alphaLam) / (cfg.alphaTurb - cfg.alphaLam);
  const extra = Math.max(0, fTurb - sep.wRe);
  const cd = base - p.aero.cdModulation * (ball.cdSub - ball.cdSuper) * extra;
  return Math.max(0.6 * ball.cdSuper, cd);
}

/** Periodic linear interpolation of the empirical C_S table at seam angle θ (rad). */
export function empiricalCs(table: number[], theta: number) {
  const n = table.length;
  if (n === 0) return 0;
  const u = (((theta / (2 * Math.PI)) % 1) + 1) % 1;
  const x = u * n;
  const i = Math.floor(x) % n;
  const f = x - Math.floor(x);
  return table[i] * (1 - f) + table[(i + 1) % n] * f;
}

/** Remove the component of a along unit e. */
export function perpTo(a: V3, e: V3): V3 {
  const d = dot(a, e);
  return [a[0] - d * e[0], a[1] - d * e[1], a[2] - d * e[2]];
}

/** Direction of the empirical-mode side force: ω̂ × ê (falls back to e1 for pure gyro spin). */
export function empiricalDirection(axis: V3, e: V3, e1: V3): V3 {
  const c = cross(axis, e);
  const l = Math.hypot(c[0], c[1], c[2]);
  return l > 1e-3 ? [c[0] / l, c[1] / l, c[2] / l] : e1;
}
