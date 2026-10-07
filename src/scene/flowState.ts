// The flow-frame state at the playhead, read from the record: ê, the azimuth basis, the
// per-sector separation angles and states, and the side-force direction. Every flow
// overlay (ring, pressure, streamlines, wake) reads this one snapshot.

import * as THREE from "three";
import type { FlightRecord } from "../physics/simulate";

export interface FlowSnapshot {
  /** Direction of motion through the air (front stagnation point = +ê on the surface). */
  e: THREE.Vector3;
  e1: THREE.Vector3;
  e2: THREE.Vector3;
  n: number;
  alpha: Float32Array;
  trip: Float32Array;
  pin: Float32Array;
  wRe: number;
  meanSep: number;
  /** Unit direction of the seam force (zero vector if none) and its coefficient. */
  seamDir: THREE.Vector3;
  cs: number;
  speed: number;
  re: number;
}

export function makeSnapshot(n: number): FlowSnapshot {
  return {
    e: new THREE.Vector3(0, 0, 1),
    e1: new THREE.Vector3(1, 0, 0),
    e2: new THREE.Vector3(0, 1, 0),
    n,
    alpha: new Float32Array(n).fill(Math.PI / 2),
    trip: new Float32Array(n),
    pin: new Float32Array(n),
    wRe: 0,
    meanSep: Math.PI / 2,
    seamDir: new THREE.Vector3(),
    cs: 0,
    speed: 0,
    re: 0,
  };
}

/** Snapshot at the nearest sample (sectors are not interpolated: they are per-ms already). */
export function snapshotAt(rec: FlightRecord, i: number, out: FlowSnapshot = makeSnapshot(rec.nPhi)): FlowSnapshot {
  const N = rec.nPhi;
  if (out.n !== N) out = makeSnapshot(N);
  out.e.set(rec.e[3 * i], rec.e[3 * i + 1], rec.e[3 * i + 2]);
  out.e1.set(rec.e1[3 * i], rec.e1[3 * i + 1], rec.e1[3 * i + 2]);
  out.e2.crossVectors(out.e, out.e1);
  if (rec.sepAlpha.length) {
    out.alpha.set(rec.sepAlpha.subarray(i * N, i * N + N));
    out.trip.set(rec.sepTrip.subarray(i * N, i * N + N));
    out.pin.set(rec.sepPin.subarray(i * N, i * N + N));
  }
  out.wRe = rec.wRe[i];
  out.meanSep = rec.meanSep[i];
  out.seamDir.set(rec.fSeam[3 * i], rec.fSeam[3 * i + 1], rec.fSeam[3 * i + 2]);
  if (out.seamDir.lengthSq() > 1e-16) out.seamDir.normalize();
  else out.seamDir.set(0, 0, 0);
  out.cs = rec.cs[i];
  const w = [rec.wind[3 * i], rec.wind[3 * i + 1], rec.wind[3 * i + 2]];
  out.speed = Math.hypot(rec.v[3 * i] - w[0], rec.v[3 * i + 1] - w[1], rec.v[3 * i + 2] - w[2]);
  out.re = rec.re[i];
  return out;
}

/** Separation angle at azimuth φ (rad), linearly interpolated between sector centers. */
export function alphaAt(s: FlowSnapshot, phi: number): number {
  const N = s.n;
  let x = (phi / (2 * Math.PI)) * N;
  x = ((x % N) + N) % N;
  const k = Math.floor(x);
  const f = x - k;
  return s.alpha[k] * (1 - f) + s.alpha[(k + 1) % N] * f;
}

/** Turbulent share of a sector, for coloring and base pressure. */
export function sectorWeights(s: FlowSnapshot, k: number) {
  const T = s.trip[k];
  const P = s.pin[k];
  const w = s.wRe;
  const lam = (1 - T) * (1 - P) * (1 - w);
  const pin = (1 - T) * P * (1 - w);
  return { lam, pin, turb: Math.max(0, 1 - lam - pin) };
}

const LAM = new THREE.Color(0x3d7fe0);
const TURB = new THREE.Color(0xf08a24);
const PIN = new THREE.Color(0xd33fb5);

export function sectorColor(s: FlowSnapshot, k: number, out = new THREE.Color()) {
  const { lam, pin, turb } = sectorWeights(s, k);
  out.setRGB(0, 0, 0);
  out.r = LAM.r * lam + TURB.r * turb + PIN.r * pin;
  out.g = LAM.g * lam + TURB.g * turb + PIN.g * pin;
  out.b = LAM.b * lam + TURB.b * turb + PIN.b * pin;
  return out;
}

/** World point on a sphere of radius R at polar angle α from +ê and azimuth φ. */
export function flowPoint(s: FlowSnapshot, alpha: number, phi: number, R: number, out = new THREE.Vector3()) {
  const sa = Math.sin(alpha);
  return out
    .copy(s.e)
    .multiplyScalar(Math.cos(alpha) * R)
    .addScaledVector(s.e1, sa * Math.cos(phi) * R)
    .addScaledVector(s.e2, sa * Math.sin(phi) * R);
}
