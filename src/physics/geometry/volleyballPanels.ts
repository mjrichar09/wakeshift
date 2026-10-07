// Volleyball panel boundaries (grooves) on the unit sphere, body frame, built by
// projecting straight lines on a cube / octahedron onto the sphere (so every boundary
// is a great-circle arc). The same module colors the rendered panels.
//
//  classic18: 6 cube faces × 3 parallel strips; strips on neighbouring faces are
//             perpendicular (the familiar indoor ball).
//  cube6:     the 12 cube edges only (6 panels).
//  octa8:     three orthogonal great circles (8 triangular panels).

import type { PanelDesign } from "../params";
import type { V3 } from "../vec";
import { norm } from "../vec";

type Polyline = V3[];

function arc(from: V3, to: V3, step = 0.02): Polyline {
  // Straight segment in R³ projected onto the sphere = a great-circle arc.
  const a = norm(from);
  const b = norm(to);
  const ang = Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
  const n = Math.max(2, Math.ceil(ang / step) + 1);
  const out: Polyline = [];
  for (let i = 0; i < n; i++) {
    const s = i / (n - 1);
    out.push(norm([from[0] + (to[0] - from[0]) * s, from[1] + (to[1] - from[1]) * s, from[2] + (to[2] - from[2]) * s]));
  }
  return out;
}

/** Point with coordinate values placed on permuted axes: axes[i] receives vals[i]. */
function place(axes: [number, number, number], vals: [number, number, number]): V3 {
  const p: V3 = [0, 0, 0];
  for (let i = 0; i < 3; i++) p[axes[i]] = vals[i];
  return p;
}

function cubeEdges(): Polyline[] {
  const out: Polyline[] = [];
  for (let k = 0; k < 3; k++) {
    const i = (k + 1) % 3;
    const j = (k + 2) % 3;
    for (const si of [-1, 1])
      for (const sj of [-1, 1]) out.push(arc(place([i, j, k], [si, sj, -1]), place([i, j, k], [si, sj, 1])));
  }
  return out;
}

/** Face with normal axis i: strips run along axis (i+1)%3 and divide along (i+2)%3. */
function classicStripLines(): Polyline[] {
  const out: Polyline[] = [];
  for (let i = 0; i < 3; i++) {
    const along = (i + 1) % 3;
    const across = (i + 2) % 3;
    for (const s of [-1, 1])
      for (const u of [-1 / 3, 1 / 3])
        out.push(arc(place([i, along, across], [s, -1, u]), place([i, along, across], [s, 1, u])));
  }
  return out;
}

function octaCircles(): Polyline[] {
  const out: Polyline[] = [];
  const axes: V3[] = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
    [-1, 0, 0],
    [0, -1, 0],
    [0, 0, -1],
  ];
  for (let i = 0; i < 6; i++)
    for (let j = i + 1; j < 6; j++) {
      const d = axes[i][0] * axes[j][0] + axes[i][1] * axes[j][1] + axes[i][2] * axes[j][2];
      if (d === 0) out.push(arc(axes[i], axes[j]));
    }
  return out;
}

export function volleyballBoundaries(design: PanelDesign): Polyline[] {
  if (design === "cube6") return cubeEdges();
  if (design === "octa8") return octaCircles();
  return [...cubeEdges(), ...classicStripLines()];
}

/** Panel index for a body-frame unit direction (for coloring); stable per design. */
export function volleyballPanelId(design: PanelDesign, p: V3): number {
  const ax = [Math.abs(p[0]), Math.abs(p[1]), Math.abs(p[2])];
  if (design === "octa8") return (p[0] > 0 ? 1 : 0) + (p[1] > 0 ? 2 : 0) + (p[2] > 0 ? 4 : 0);
  const i = ax[0] >= ax[1] && ax[0] >= ax[2] ? 0 : ax[1] >= ax[2] ? 1 : 2;
  const face = i * 2 + (p[i] > 0 ? 1 : 0);
  if (design === "cube6") return face;
  const u = p[(i + 2) % 3] / ax[i];
  const strip = u < -1 / 3 ? 0 : u > 1 / 3 ? 2 : 1;
  return face * 3 + strip;
}
