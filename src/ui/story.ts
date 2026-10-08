// Narration and landmarks read from the FlightRecord: a live caption for the playhead, the
// notable moments marked on the timeline, and how much to enlarge the ball in far views.
// Pure functions (tested); directions use the shared frame (+x = 1B / passer's right).

import type { FlightRecord } from "../physics/simulate";
import type { Sport } from "../physics/params";
import type { UnitSystem } from "./units";
import { smallUnit, toSmall } from "./units";

/** Words for a direction in the plane across the flight: "toward 1B", "up and toward 3B", … */
export function directionWords(x: number, y: number, sport: Sport): string {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const m = Math.max(ax, ay);
  if (m < 1e-12) return "nowhere";
  const side = sport === "baseball" ? (x > 0 ? "toward 1B" : "toward 3B") : x > 0 ? "to the passer's right" : "to the passer's left";
  const vert = y > 0 ? "up" : "down";
  if (ax >= 0.4 * m && ay >= 0.4 * m) return `${vert} and ${side}`;
  return ax > ay ? side : vert;
}

export interface Caption {
  tag: string;
  text: string;
}

const f2 = (x: number) => x.toFixed(2);

export function caption(rec: FlightRecord, ghost: FlightRecord, i: number, units: UnitSystem): Caption {
  const sport = rec.params.sport;
  const n = rec.n;
  const csMax = rec.params.aero.csMax;
  const target = sport === "baseball" ? "the plate" : "the floor";
  if (i >= n - 1) {
    const g = Math.min(i, ghost.n - 1);
    const dx = rec.r[3 * i] - ghost.r[3 * g];
    const dy = rec.r[3 * i + 1] - ghost.r[3 * g + 1];
    const su = smallUnit(units);
    const h = `${Math.abs(toSmall(dx, units)).toFixed(1)} ${su} ${directionWords(dx, 0, sport)}`;
    const v = `${Math.abs(toSmall(dy, units)).toFixed(1)} ${su} ${dy >= 0 ? "higher" : "lower"}`;
    return { tag: "Arrival", text: `At ${target}: ${h} and ${v} than the same throw with no seam force (dashed ghost).` };
  }
  if (rec.t[i] < 0.012) {
    const turns = rec.rotations[n - 1];
    return { tag: "Release", text: `The ball will turn only ${f2(turns)} of a rotation before it reaches ${target}. Watch the seams.` };
  }
  const w = rec.wRe[i];
  if (w > 0.8)
    return {
      tag: "Supercritical",
      text: `At Re ${(rec.re[i] / 1000).toFixed(0)}k the whole boundary layer is already turbulent, so the ${sport === "baseball" ? "seams" : "panel edges"} can't favour one side: little side push.`,
    };
  const fx = rec.fSeam[3 * i];
  const fy = rec.fSeam[3 * i + 1];
  const cs = rec.cs[i];
  // Ordinary spin pitches and serves: the Magnus force dominates the seams.
  const mx = rec.fMagnus[3 * i];
  const my = rec.fMagnus[3 * i + 1];
  const mag = Math.hypot(mx, my, rec.fMagnus[3 * i + 2]);
  if (mag > 1.5 * Math.hypot(fx, fy) && rec.cl[i] > 0.05) {
    const rpm = Math.round(rec.params.spin.revPerSec * 60);
    return {
      tag: "Magnus",
      text: `Spinning at ${rpm} rpm, the ball drags the air around with it and the wake is thrown the other way: the Magnus force pushes it ${directionWords(mx, my, sport)} (${mag.toFixed(2)} N). The seams' push averages out over ${f2(rec.rotations[n - 1])} turns.`,
    };
  }
  if (cs < 0.2 * csMax) return { tag: "Balanced", text: `The ${sport === "baseball" ? "seams" : "panel edges"} sit symmetrically right now: almost no side push (C_S ${f2(cs)}).` };
  // Swinging: compare the push direction with 25 ms ago.
  const j = Math.max(0, i - 25);
  const px = rec.fSeam[3 * j];
  const py = rec.fSeam[3 * j + 1];
  const dot = (fx * px + fy * py) / (Math.hypot(fx, fy) * Math.hypot(px, py) || 1);
  const dir = directionWords(fx, fy, sport);
  const feature = sport === "baseball" ? "A seam" : "A panel edge";
  const swing = rec.cs[j] > 0.2 * csMax && dot < Math.cos((25 * Math.PI) / 180) ? " The push is swinging as the ball turns." : "";
  const crisis = w > 0.2 ? " (In the drag crisis: the effect is fading.)" : "";
  return {
    tag: "Side force",
    text: `${feature} trips the boundary layer, so the air clings longer on one side and the ball is pushed ${dir} (C_S ${f2(cs)}).${swing}${crisis}`,
  };
}

export interface Landmark {
  t: number;
  label: string;
  kind: "peak" | "flip" | "crisis";
}

/** Notable moments: the peak side push, each reversal of the horizontal push, drag-crisis crossings. */
export function landmarks(rec: FlightRecord): Landmark[] {
  const out: Landmark[] = [];
  let peak = 0;
  let pi = 0;
  for (let i = 0; i < rec.n; i++) {
    const m = Math.hypot(rec.fSeam[3 * i], rec.fSeam[3 * i + 1], rec.fSeam[3 * i + 2]);
    if (m > peak) {
      peak = m;
      pi = i;
    }
  }
  if (peak > 1e-6) out.push({ t: rec.t[pi], label: "Peak push", kind: "peak" });
  // Reversals of the horizontal push, with hysteresis at 15 % of the peak. Only for
  // low-spin flights: with many turns the push flips every half turn and means little.
  const hy = 0.15 * peak;
  let sign = 0;
  const lowSpin = rec.rotations[rec.n - 1] <= 3;
  for (let i = 0; lowSpin && i < rec.n; i++) {
    const fx = rec.fSeam[3 * i];
    const s = fx > hy ? 1 : fx < -hy ? -1 : 0;
    if (s !== 0 && sign !== 0 && s !== sign) out.push({ t: rec.t[i], label: "Push flips side", kind: "flip" });
    if (s !== 0) sign = s;
  }
  for (let i = 1; i < rec.n; i++) {
    const a = rec.wRe[i - 1];
    const b = rec.wRe[i];
    if (a < 0.5 && b >= 0.5) out.push({ t: rec.t[i], label: "Enters supercritical", kind: "crisis" });
    if (a >= 0.5 && b < 0.5) out.push({ t: rec.t[i], label: "Drops into the drag crisis", kind: "crisis" });
  }
  return out.sort((a, b) => a.t - b.t);
}

/**
 * Enlargement that keeps a ball of radius R at distance D at least minPx pixels in radius
 * (never shrinks it; capped so it never dwarfs the scene).
 */
export function autoBallScale(R: number, D: number, fovDeg: number, viewportH: number, minPx = 7, cap = 10) {
  const px = (R * viewportH) / (2 * Math.max(D, 1e-6) * Math.tan((fovDeg * Math.PI) / 360));
  return Math.min(cap, Math.max(1, minPx / Math.max(px, 1e-9)));
}
