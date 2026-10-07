// Schematic airflow in the ball frame (unit radius; the parent scales it). Upstream the air
// follows analytic potential flow past a sphere. A streamline that reaches the local
// separation line leaves the surface tangentially and bends into the wake, whose axis is
// deflected opposite to the side force. Not CFD; labeled as such in the UI.

import * as THREE from "three";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import type { FlowSnapshot } from "../flowState";
import { alphaAt } from "../flowState";

/** Wake gain: wake axis = −ê − K·C_S·n̂ (opposite the side force). */
export const WAKE_GAIN = 3;

export function wakeAxis(s: FlowSnapshot, out = new THREE.Vector3()) {
  return out.copy(s.e).negate().addScaledVector(s.seamDir, -WAKE_GAIN * s.cs).normalize();
}

/**
 * Potential flow past a unit sphere, free stream of unit speed along d (d = −ê, the air
 * moving past the ball): u = d(1 + 1/(2r³)) − (3/(2r⁵))(d·x) x.
 */
export function potentialVelocity(x: THREE.Vector3, d: THREE.Vector3, out = new THREE.Vector3()) {
  const r2 = x.lengthSq();
  const r = Math.sqrt(r2);
  const r3 = r2 * r;
  const dx = d.dot(x);
  return out.copy(d).multiplyScalar(1 + 1 / (2 * r3)).addScaledVector(x, (-3 * dx) / (2 * r3 * r2));
}

/** Polar angle from +ê and azimuth about ê of a point. */
export function flowAngles(s: FlowSnapshot, x: THREE.Vector3) {
  const r = x.length();
  const a = Math.acos(THREE.MathUtils.clamp(x.dot(s.e) / r, -1, 1));
  let phi = Math.atan2(x.dot(s.e2), x.dot(s.e1));
  if (phi < 0) phi += 2 * Math.PI;
  return { r, a, phi };
}

const SLOW = new THREE.Color(0x2e64c9);
const FAST = new THREE.Color(0xe9f6ff);
const WAKE = new THREE.Color(0x9aa6ad);

export function speedColor(sp: number, out = new THREE.Color()) {
  return out.copy(SLOW).lerp(FAST, THREE.MathUtils.clamp(sp / 1.5, 0, 1));
}

interface Traced {
  pts: THREE.Vector3[];
  colors: THREE.Color[];
  /** Index where the line left the surface (−1 if it never separated). */
  sepAt: number;
}

/** Trace one streamline from a seed; shedPhase wobbles the shear layers. */
export function traceStreamline(s: FlowSnapshot, seed: THREE.Vector3, shedPhase: number): Traced {
  const d = s.e.clone().negate();
  const axis = wakeAxis(s);
  const shedDir = s.seamDir.lengthSq() > 0 ? s.seamDir : s.e1;
  const x = seed.clone();
  const u = new THREE.Vector3();
  const pts = [x.clone()];
  const colors = [speedColor(1)];
  let sepAt = -1;
  let dir = new THREE.Vector3();
  const ds = 0.05;
  for (let k = 0; k < 320; k++) {
    if (sepAt < 0) {
      potentialVelocity(x, d, u);
      const sp = u.length();
      const { r, a, phi } = flowAngles(s, x);
      if (r < 1.35 && a > alphaAt(s, phi)) {
        sepAt = pts.length - 1;
        dir = u.clone().normalize();
      } else {
        x.addScaledVector(u, ds / Math.max(sp, 0.2));
        pts.push(x.clone());
        colors.push(speedColor(sp));
      }
    }
    if (sepAt >= 0) {
      // Free shear layer: leave tangentially, bend toward the wake axis, wobble at the
      // shedding frequency with an amplitude that grows downstream.
      dir.lerp(axis, 0.07).normalize();
      const down = -x.dot(s.e);
      const wob = 0.035 * Math.sin(shedPhase - 2.2 * down) * Math.min(1, Math.max(0, down) / 2);
      x.addScaledVector(dir, ds).addScaledVector(shedDir, wob);
      pts.push(x.clone());
      colors.push(WAKE.clone().lerp(FAST, 0.25));
    }
    if (-x.dot(s.e) > 6 || x.lengthSq() > 64) break;
  }
  return { pts, colors, sepAt };
}

export class Streamlines {
  readonly material = new LineMaterial({ linewidth: 1.8, vertexColors: true, dashed: true, dashSize: 0.35, gapSize: 0.18, worldUnits: false, transparent: true, opacity: 0.95 });
  readonly line = new LineSegments2(new LineSegmentsGeometry(), this.material);
  private offsets = [0.1, 0.28, 0.48, 0.7, 0.95, 1.25, 1.65];

  update(s: FlowSnapshot, shedPhase: number) {
    const m = s.seamDir.lengthSq() > 0 ? s.seamDir.clone() : s.e1.clone();
    const m2 = new THREE.Vector3().crossVectors(s.e, m).normalize();
    const pos: number[] = [];
    const col: number[] = [];
    const seed = new THREE.Vector3();
    for (const [plane, weight] of [
      [m, 1],
      [m2, 0.55],
    ] as const) {
      for (const sign of [-1, 1])
        for (const rho of this.offsets) {
          seed.copy(s.e).multiplyScalar(4).addScaledVector(plane, sign * rho);
          const tr = traceStreamline(s, seed, shedPhase + sign * 1.3);
          for (let i = 0; i + 1 < tr.pts.length; i++) {
            const a = tr.pts[i];
            const b = tr.pts[i + 1];
            pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
            const ca = tr.colors[i].clone().multiplyScalar(weight);
            const cb = tr.colors[i + 1].clone().multiplyScalar(weight);
            col.push(ca.r, ca.g, ca.b, cb.r, cb.g, cb.b);
          }
        }
    }
    const g = new LineSegmentsGeometry();
    g.setPositions(pos);
    g.setColors(col);
    this.line.geometry.dispose();
    this.line.geometry = g;
    this.line.computeLineDistances();
  }

  animate(dt: number, speed: number) {
    this.material.dashOffset -= dt * speed;
  }
}

/** Advected smoke particles, colored by local speed (optional "particle mode"). */
export class Smoke {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private col: Float32Array;
  private state: { x: THREE.Vector3; sep: boolean; dir: THREE.Vector3 }[] = [];
  private count: number;

  constructor(count = 700) {
    this.count = count;
    this.pos = new Float32Array(count * 3);
    this.col = new Float32Array(count * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(this.col, 3));
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.05, vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false }));
    this.points.frustumCulled = false;
    for (let i = 0; i < count; i++) this.state.push({ x: new THREE.Vector3(), sep: false, dir: new THREE.Vector3() });
  }

  private respawn(s: FlowSnapshot, p: { x: THREE.Vector3; sep: boolean }, spread = true) {
    const r = 1.9 * Math.sqrt(Math.random());
    const t = Math.random() * Math.PI * 2;
    p.x
      .copy(s.e)
      .multiplyScalar(spread ? 2 + Math.random() * 4 : 4)
      .addScaledVector(s.e1, r * Math.cos(t))
      .addScaledVector(s.e2, r * Math.sin(t));
    p.sep = false;
  }

  reset(s: FlowSnapshot) {
    for (const p of this.state) this.respawn(s, p, true);
  }

  private seeded = false;

  update(s: FlowSnapshot, dt: number, speed: number) {
    // Particles start at the origin, where potential flow is singular: seed them upstream.
    if (!this.seeded) {
      this.reset(s);
      this.seeded = true;
    }
    const d = s.e.clone().negate();
    const axis = wakeAxis(s);
    const u = new THREE.Vector3();
    const c = new THREE.Color();
    for (let i = 0; i < this.count; i++) {
      const p = this.state[i];
      let sp = 1;
      if (!p.sep) {
        potentialVelocity(p.x, d, u);
        sp = u.length();
        const { r, a, phi } = flowAngles(s, p.x);
        if (r < 1.3 && a > alphaAt(s, phi)) {
          p.sep = true;
          p.dir.copy(u).normalize();
        } else p.x.addScaledVector(u, dt * speed);
        if (r < 1.0) p.x.setLength(1.02);
      }
      if (p.sep) {
        p.dir.lerp(axis, 0.05).normalize();
        p.x.addScaledVector(p.dir, dt * speed * 0.6);
        p.x.x += (Math.random() - 0.5) * 0.02;
        p.x.y += (Math.random() - 0.5) * 0.02;
        p.x.z += (Math.random() - 0.5) * 0.02;
        sp = 0.5;
      }
      if (-p.x.dot(s.e) > 6 || !(p.x.lengthSq() < 50)) this.respawn(s, p, false);
      if (p.sep) c.copy(WAKE);
      else speedColor(sp, c);
      this.pos.set([p.x.x, p.x.y, p.x.z], 3 * i);
      this.col.set([c.r, c.g, c.b], 3 * i);
    }
    this.points.geometry.getAttribute("position").needsUpdate = true;
    this.points.geometry.getAttribute("color").needsUpdate = true;
  }
}
