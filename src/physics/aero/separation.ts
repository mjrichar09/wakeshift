// Per-azimuth boundary-layer separation: the mechanism that makes seam orientation matter.
//
// Flow frame: ê is the direction of the ball's motion through the air, so the front
// stagnation point is the surface point +ê. α is the polar angle from that point and φ
// the azimuth around ê, measured from e1 toward e2 (basisAround(ê)). The circumference is
// split into N sectors centered at φ_k = 2πk/N.
//
// For each sector, a seam (or groove) inside the trip zone trips the boundary layer
// (separation moves back to α_turb); a seam right at the laminar separation line pins
// separation at the seam's own α; otherwise it separates laminar at α_lam. Smooth edges
// and a triangular azimuthal kernel keep everything continuous. Past the critical Re every
// sector blends toward α_turb and the asymmetry collapses.
//
// Later separation on one side shifts the wake to the other, so the lateral force points
// toward the side that separates LATER:  C_S·n̂ = k_S · (1/N) Σ (α_k − ᾱ) u_k.

import type { Params } from "../params";
import type { Quat, V3 } from "../vec";
import { basisAround, deg, qFromTo, qRotate } from "../vec";

export interface SepConfig {
  tripMin: number; // rad
  tripMax: number;
  alphaLam: number;
  alphaTurb: number;
  pinDelta: number;
  nPhi: number;
  /** Edge width of the trip/pin windows, rad. */
  edge: number;
  /** Trip/pin efficacy from seam height (1 = regulation). */
  efficacy: number;
}

export function sepConfig(p: Params): SepConfig {
  const a = p.aero;
  return {
    tripMin: a.tripMinDeg * deg,
    tripMax: a.tripMaxDeg * deg,
    alphaLam: a.alphaLamDeg * deg,
    alphaTurb: a.alphaTurbDeg * deg,
    pinDelta: a.pinDeltaDeg * deg,
    nPhi: Math.max(8, Math.round(a.nPhi / 2) * 2),
    edge: 2.5 * deg,
    efficacy: p.ball.seamHeight,
  };
}

export interface SepResult {
  /** Separation angle per sector, rad. */
  alpha: Float64Array;
  /** Trip strength (0..1) and pin strength (0..1) per sector, after efficacy. */
  trip: Float64Array;
  pin: Float64Array;
  /** Mean separation angle, rad. */
  mean: number;
  /** (1/N) Σ (α_k − ᾱ) u_k in world coordinates (rad); multiply by k_S for C_S·n̂. */
  raw: V3;
  e1: V3;
  e2: V3;
  wRe: number;
}

export function makeSepResult(n: number): SepResult {
  return {
    alpha: new Float64Array(n),
    trip: new Float64Array(n),
    pin: new Float64Array(n),
    mean: 0,
    raw: [0, 0, 0],
    e1: [1, 0, 0],
    e2: [0, 1, 0],
    wRe: 0,
  };
}

const KERNEL_HALF_WIDTH = 1.25; // sectors

/** Smooth 0→1 step centered on x = 0, width ≈ 4 (C¹ smoothstep; cheaper than a logistic). */
export function edgeStep(x: number) {
  const u = 0.5 + x / 4;
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  return u * u * (3 - 2 * u);
}

/**
 * Evaluate separation for body-frame feature points rotated by q, flow direction e (unit,
 * direction of motion relative to the air) and supercritical weight wRe.
 */
export function separation(
  points: Float64Array,
  q: Quat,
  e: V3,
  wRe: number,
  cfg: SepConfig,
  out: SepResult = makeSepResult(cfg.nPhi),
): SepResult {
  const N = cfg.nPhi;
  if (out.alpha.length !== N) out = makeSepResult(N);
  const { alpha, trip, pin } = out;
  const pinSumW = new Float64Array(N);
  const pinSumA = new Float64Array(N);
  trip.fill(0);
  pin.fill(0);
  const [e1, e2] = basisAround(e);
  out.e1 = e1;
  out.e2 = e2;

  const lo = cfg.tripMin - 2 * cfg.edge;
  const hi = Math.max(cfg.tripMax, cfg.alphaLam + cfg.pinDelta) + 2 * cfg.edge;
  const cosLo = Math.cos(lo);
  const cosHi = Math.cos(hi);
  // Work in the body frame: rotate the flow basis once instead of every feature point.
  const qi: Quat = [q[0], -q[1], -q[2], -q[3]];
  const eb = qRotate(qi, e);
  const e1b = qRotate(qi, e1);
  const e2b = qRotate(qi, e2);
  const sectorWidth = (2 * Math.PI) / N;
  const pinLo = cfg.alphaLam - cfg.pinDelta;
  const pinHi = cfg.alphaLam + cfg.pinDelta;

  for (let i = 0; i < points.length; i += 3) {
    const px = points[i];
    const py = points[i + 1];
    const pz = points[i + 2];
    const c = px * eb[0] + py * eb[1] + pz * eb[2];
    if (c > cosLo || c < cosHi) continue;
    const a = Math.acos(c);
    const tStr = edgeStep((a - cfg.tripMin) / cfg.edge) * edgeStep((cfg.tripMax - a) / cfg.edge);
    const pStr = edgeStep((a - pinLo) / cfg.edge) * edgeStep((pinHi - a) / cfg.edge);
    if (tStr < 1e-4 && pStr < 1e-4) continue;
    let phi = Math.atan2(px * e2b[0] + py * e2b[1] + pz * e2b[2], px * e1b[0] + py * e1b[1] + pz * e1b[2]);
    if (phi < 0) phi += 2 * Math.PI;
    const s = phi / sectorWidth;
    const k0 = Math.floor(s - KERNEL_HALF_WIDTH);
    const k1 = Math.ceil(s + KERNEL_HALF_WIDTH);
    for (let k = k0; k <= k1; k++) {
      const K = 1 - Math.abs(s - k) / KERNEL_HALF_WIDTH;
      if (K <= 0) continue;
      const kk = ((k % N) + N) % N;
      const tk = tStr * K;
      if (tk > trip[kk]) trip[kk] = tk;
      const pk = pStr * K;
      if (pk > pin[kk]) pin[kk] = pk;
      pinSumW[kk] += pk;
      pinSumA[kk] += pk * a;
    }
  }

  let sum = 0;
  for (let k = 0; k < N; k++) {
    const T = Math.min(1, cfg.efficacy * trip[k]);
    const P = Math.min(1, cfg.efficacy * pin[k]);
    trip[k] = T;
    pin[k] = P;
    const aPin = pinSumW[k] > 1e-9 ? pinSumA[k] / pinSumW[k] : cfg.alphaLam;
    let a = cfg.alphaLam + T * (cfg.alphaTurb - cfg.alphaLam) + (1 - T) * P * (aPin - cfg.alphaLam);
    a += wRe * (cfg.alphaTurb - a);
    alpha[k] = a;
    sum += a;
  }
  const mean = sum / N;
  let rx = 0;
  let ry = 0;
  let rz = 0;
  for (let k = 0; k < N; k++) {
    const d = alpha[k] - mean;
    const cphi = Math.cos(k * sectorWidth);
    const sphi = Math.sin(k * sectorWidth);
    rx += d * (cphi * e1[0] + sphi * e2[0]);
    ry += d * (cphi * e1[1] + sphi * e2[1]);
    rz += d * (cphi * e1[2] + sphi * e2[2]);
  }
  out.mean = mean;
  out.raw = [rx / N, ry / N, rz / N];
  out.wRe = wRe;
  return out;
}

/** Fibonacci-sphere directions. */
export function fibonacciSphere(n: number): V3[] {
  const out: V3[] = [];
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(1 - y * y);
    out.push([Math.cos(ga * i) * r, y, Math.sin(ga * i) * r]);
  }
  return out;
}

export interface Calibration {
  /** Peak |raw| over all orientations at subcritical Re and regulation seam height. */
  peakRaw: number;
  /** Body direction that, pointed along the flight, gives the peak. */
  bestDir: V3;
}

const calCache = new Map<string, Calibration>();

/**
 * Sweep a static ball through all orientations (flow along +z) and find the peak raw
 * lateral vector, so k_S = C_S,max / peakRaw puts the peak |C_S| at the target.
 */
export function calibrate(featureId: string, points: Float64Array, cfg: SepConfig): Calibration {
  const key = `${featureId}|${cfg.tripMin}|${cfg.tripMax}|${cfg.alphaLam}|${cfg.alphaTurb}|${cfg.pinDelta}|${cfg.nPhi}`;
  const hit = calCache.get(key);
  if (hit) return hit;
  const c1 = { ...cfg, efficacy: 1 };
  const z: V3 = [0, 0, 1];
  let peakRaw = 1e-9;
  let bestDir: V3 = [0, 0, 1];
  const res = makeSepResult(cfg.nPhi);
  for (const d of fibonacciSphere(700)) {
    separation(points, qFromTo(d, z), z, 0, c1, res);
    const m = Math.hypot(res.raw[0], res.raw[1], res.raw[2]);
    if (m > peakRaw) {
      peakRaw = m;
      bestDir = d;
    }
  }
  const cal = { peakRaw, bestDir };
  calCache.set(key, cal);
  return cal;
}
