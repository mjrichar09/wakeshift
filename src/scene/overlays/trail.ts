// Flight path (colored by |lateral acceleration| so the break shows where it happens), the
// ghost path with the seam force off, and up to five pinned comparison runs.

import * as THREE from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import type { FlightRecord } from "../../physics/simulate";

/** Dark-to-hot ramp for |a_lat|: steel blue → orange → yellow-white. */
export function heat(t: number, out = new THREE.Color()) {
  const k = Math.max(0, Math.min(1, t));
  const stops = [
    [0.33, 0.45, 0.62],
    [0.94, 0.54, 0.14],
    [1.0, 0.93, 0.62],
  ];
  const s = k < 0.6 ? 0 : 1;
  const f = s === 0 ? k / 0.6 : (k - 0.6) / 0.4;
  const a = stops[s];
  const b = stops[s + 1];
  return out.setRGB(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, THREE.SRGBColorSpace);
}

export const PIN_COLORS = [0x4fb3ff, 0xb38cff, 0x5fd38a, 0xff7aa8, 0xd8d8d8];

const STRIDE = 4; // samples per vertex (1 vertex every 4 ms)

export class Trails {
  readonly group = new THREE.Group();
  private main: Line2 | null = null;
  private ghost: Line2 | null = null;
  private pins: Line2[] = [];
  private materials: LineMaterial[] = [];
  private mainCount = 0;
  ghostVisible = true;
  trailVisible = true;

  private positions(rec: FlightRecord) {
    const pts: number[] = [];
    for (let i = 0; i < rec.n; i += STRIDE) pts.push(rec.r[3 * i], rec.r[3 * i + 1], rec.r[3 * i + 2]);
    const j = rec.n - 1;
    if ((rec.n - 1) % STRIDE !== 0) pts.push(rec.r[3 * j], rec.r[3 * j + 1], rec.r[3 * j + 2]);
    return pts;
  }

  private mat(opts: ConstructorParameters<typeof LineMaterial>[0]) {
    const m = new LineMaterial({ worldUnits: false, ...opts });
    this.materials.push(m);
    return m;
  }

  setRecords(rec: FlightRecord, ghost: FlightRecord, aLatScale: number) {
    this.clearLine(this.main);
    this.clearLine(this.ghost);
    const pts = this.positions(rec);
    const colors: number[] = [];
    const c = new THREE.Color();
    for (let i = 0; i < rec.n; i += STRIDE) {
      heat(rec.aLat[i] / aLatScale, c);
      colors.push(c.r, c.g, c.b);
    }
    if ((rec.n - 1) % STRIDE !== 0) colors.push(c.r, c.g, c.b);
    const g = new LineGeometry();
    g.setPositions(pts);
    g.setColors(colors);
    this.main = new Line2(g, this.mat({ linewidth: 3.5, vertexColors: true }));
    this.main.computeLineDistances();
    this.mainCount = pts.length / 3;
    this.group.add(this.main);

    const gg = new LineGeometry();
    gg.setPositions(this.positions(ghost));
    this.ghost = new Line2(gg, this.mat({ linewidth: 2, color: 0xffffff, transparent: true, opacity: 0.6, dashed: true, dashSize: 0.18, gapSize: 0.12 }));
    this.ghost.computeLineDistances();
    this.ghost.visible = this.ghostVisible;
    this.group.add(this.ghost);
    this.main.visible = this.trailVisible;
  }

  setPins(recs: { rec: FlightRecord; color: number }[]) {
    for (const p of this.pins) this.clearLine(p);
    this.pins = recs.map(({ rec, color }) => {
      const g = new LineGeometry();
      g.setPositions(this.positions(rec));
      const l = new Line2(g, this.mat({ linewidth: 2.2, color, transparent: true, opacity: 0.75 }));
      this.group.add(l);
      return l;
    });
  }

  /** Draw the main trail up to the playhead (fraction of samples). */
  setProgress(sampleIndex: number) {
    if (!this.main) return;
    const verts = Math.min(this.mainCount, Math.floor(sampleIndex / STRIDE) + 1);
    // LineGeometry is instanced: one instance per segment.
    this.main.geometry.instanceCount = Math.max(0, verts - 1);
  }

  setVisibility(trail: boolean, ghost: boolean) {
    this.trailVisible = trail;
    this.ghostVisible = ghost;
    if (this.main) this.main.visible = trail;
    if (this.ghost) this.ghost.visible = ghost;
  }

  setResolution(w: number, h: number) {
    for (const m of this.materials) m.resolution.set(w, h);
  }

  private clearLine(l: Line2 | null) {
    if (!l) return;
    this.group.remove(l);
    l.geometry.dispose();
    const m = l.material as LineMaterial;
    m.dispose();
    this.materials = this.materials.filter((x) => x !== m);
  }
}
