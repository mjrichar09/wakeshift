// The surface feature (seam or panel grooves) as body-frame point samples for the
// separation model, plus the polylines the renderer draws. One source for both.

import type { Params } from "../params";
import type { V3 } from "../vec";
import { norm } from "../vec";
import { baseballSeam } from "./baseballSeam";
import { volleyballBoundaries } from "./volleyballPanels";

/** Arc spacing of the feature samples (rad); well under a sector width at the trip zone. */
const SPACING = 0.03;

export interface SurfaceFeature {
  id: string;
  polylines: V3[][];
  /** Flattened body-frame unit vectors [x0,y0,z0,x1,…], roughly evenly spaced. */
  points: Float64Array;
}

const cache = new Map<string, SurfaceFeature>();

export function surfaceFeature(p: Pick<Params, "sport" | "ball">): SurfaceFeature {
  const id = p.sport === "baseball" ? "baseball" : `volleyball:${p.ball.panelDesign}`;
  let f = cache.get(id);
  if (f) return f;
  const seam = baseballSeam(400);
  const polylines = p.sport === "baseball" ? [[...seam, seam[0]]] : volleyballBoundaries(p.ball.panelDesign);
  // Resample every polyline at an even arc-length spacing so the trip/pin maxima see a
  // uniform density whatever the design.
  const pts: number[] = [];
  for (const line of polylines) {
    let carry = 0;
    for (let i = 0; i + 1 < line.length; i++) {
      const a = line[i];
      const b = line[i + 1];
      const seg = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      for (let s = carry; s < seg; s += SPACING) {
        const f = s / seg;
        const q = norm([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]);
        pts.push(q[0], q[1], q[2]);
      }
      carry = (((carry - seg) % SPACING) + SPACING) % SPACING;
    }
  }
  f = { id, polylines, points: new Float64Array(pts) };
  cache.set(id, f);
  return f;
}
