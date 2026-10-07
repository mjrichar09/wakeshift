// simulate(params) → FlightRecord. Playback, charts and overlays only ever read the record,
// which is what makes slow motion, scrubbing and frame stepping exact.
//
// Aerodynamic coefficients (C_d, C_S·n̂, C_N) come from the separation model once per 1 ms
// step and are held through the RK4 stages; q, ê, Magnus and the projections ⟂ ê are
// re-evaluated in every stage. Orientation is analytic: ω has a fixed axis, so
// q(t) = R(ω̂, θ(t)) · q0.

import { BASEBALL, COURT, G, VOLLEYBALL } from "./constants";
import type { BallSpec } from "./constants";
import { WindField, airFromParams } from "./environment";
import type { Air } from "./environment";
import { surfaceFeature } from "./geometry";
import { RK4 } from "./integrator";
import type { Params, GripName } from "./params";
import { withPatch } from "./params";
import { OU, Rng } from "./rng";
import { reCritical, supercriticalWeight } from "./aero/dragCurve";
import { calibrate, makeSepResult, sepConfig, separation } from "./aero/separation";
import type { SepConfig } from "./aero/separation";
import { dragCoefficient, empiricalCs, empiricalDirection, liftCoefficient, perpTo } from "./aero/forces";
import type { Quat, V3 } from "./vec";
import { cross, deg, norm, qAxisAngle, qFromTo, qMul } from "./vec";

export type Outcome = "plate" | "floor" | "net" | "long" | "timeout";

export interface FlightRecord {
  params: Params;
  n: number;
  dt: number;
  nPhi: number;
  ball: BallSpec;
  air: Air;
  reCrit: number;
  kS: number;
  spinAxis: V3;
  t: Float64Array;
  r: Float64Array; // 3n
  v: Float64Array; // 3n
  q: Float64Array; // 4n  [w, x, y, z]
  /** Direction of motion through the air (ê) and the azimuth reference e1. */
  e: Float64Array; // 3n
  e1: Float64Array; // 3n
  wind: Float64Array; // 3n
  fGrav: Float64Array;
  fDrag: Float64Array;
  fMagnus: Float64Array;
  fSeam: Float64Array;
  fWake: Float64Array;
  /** Net aerodynamic force (drag + Magnus + seam + wake). */
  fAero: Float64Array;
  re: Float64Array;
  cd: Float64Array;
  /** |C_S| and C_L, C_N magnitudes. */
  cs: Float64Array;
  cl: Float64Array;
  spinParam: Float64Array;
  /** Cumulative rotation about the spin axis, deg (the "seam angle" before wrapping). */
  seamAngle: Float64Array;
  rotations: Float64Array;
  wRe: Float64Array;
  meanSep: Float64Array; // rad
  /** |seam + Magnus + wake| / m: the "lateral" acceleration that colors the trail. */
  aLat: Float64Array;
  /** Per-sector detail (empty when params.sim.recordSectors is false). */
  sepAlpha: Float32Array; // n × nPhi, rad
  sepTrip: Float32Array;
  sepPin: Float32Array;
  outcome: Outcome;
}

export function ballSpec(p: Params): BallSpec {
  return p.sport === "baseball" ? BASEBALL : VOLLEYBALL;
}

/** Spin axis from the clock-face tilt and gyro angle (see Params.spin). */
export function spinAxis(p: Params): V3 {
  const tilt = p.spin.tiltDeg * deg;
  const g = p.spin.gyroDeg * deg;
  const perp: V3 = [-Math.cos(tilt), Math.sin(tilt), 0];
  return norm([perp[0] * Math.cos(g), perp[1] * Math.cos(g), Math.sin(g)]);
}

/** Total rotation angle (rad) after time t, with optional exponential spin decay. */
export function rotationAngle(p: Params, t: number) {
  const w0 = 2 * Math.PI * p.spin.revPerSec;
  const tau = p.spin.decayTau;
  return tau > 0 ? w0 * tau * (1 - Math.exp(-t / tau)) : w0 * t;
}

export function spinRate(p: Params, t: number) {
  const w0 = 2 * Math.PI * p.spin.revPerSec;
  return p.spin.decayTau > 0 ? w0 * Math.exp(-t / p.spin.decayTau) : w0;
}

const Z: V3 = [0, 0, 1];

/** Grip quaternion: which body direction faces the plate (+z) at release. */
export function gripQuat(p: Params, grip: GripName = p.orientation.grip): Quat {
  switch (grip) {
    case "symmetric":
      return [1, 0, 0, 0];
    case "seamFront":
      return qFromTo([1, 0, 0], Z);
    case "lobeFront":
      return qFromTo(norm([1, 1, 0]), Z);
    case "maxBreak": {
      // The calibrated peak orientation, rolled so the side force points to +x.
      const f = surfaceFeature(p);
      const cfg = { ...sepConfig(p), efficacy: 1 };
      const cal = calibrate(f.id, f.points, cfg);
      const q1 = qFromTo(cal.bestDir, Z);
      const s = separation(f.points, q1, Z, 0, cfg);
      const beta = Math.atan2(s.raw[1], s.raw[0]);
      return qMul(qAxisAngle(Z, -beta), q1);
    }
  }
}

/** Release orientation: grip, then fine adjust in the world frame (yaw y, pitch x, roll z). */
export function releaseQuat(p: Params): Quat {
  const o = p.orientation;
  const yaw = qAxisAngle([0, 1, 0], o.yawDeg * deg);
  const pitch = qAxisAngle([1, 0, 0], o.pitchDeg * deg);
  const roll = qAxisAngle([0, 0, 1], o.rollDeg * deg);
  return qMul(roll, qMul(pitch, qMul(yaw, gripQuat(p))));
}

export function orientationAt(p: Params, q0: Quat, axis: V3, t: number): Quat {
  return qMul(qAxisAngle(axis, rotationAngle(p, t)), q0);
}

export function releaseVelocity(p: Params): V3 {
  const r = p.release;
  const va = r.vAngleDeg * deg;
  const ha = r.hAngleDeg * deg;
  return [r.speed * Math.cos(va) * Math.sin(ha), r.speed * Math.sin(va), r.speed * Math.cos(va) * Math.cos(ha)];
}

/** Lateral coefficient scale for the current settings (k_S). */
export function seamScale(p: Params, cfg: SepConfig = sepConfig(p)) {
  const f = surfaceFeature(p);
  return p.aero.csMax / calibrate(f.id, f.points, cfg).peakRaw;
}

interface Scratch {
  grav: V3;
  drag: V3;
  magnus: V3;
  seam: V3;
  wake: V3;
  cl: number;
  S: number;
}

export function simulate(p: Params): FlightRecord {
  const ball = ballSpec(p);
  const m = ball.mass;
  const d = ball.diameter;
  const rad = d / 2;
  const A = (Math.PI * d * d) / 4;
  const air = airFromParams(p.env);
  const rng = new Rng(p.aero.seed);
  const wind = new WindField(p.env, rng);
  const wakeOU = new OU(rng, 2, p.aero.noise ? p.aero.noiseIntensity : 0);
  const feature = surfaceFeature(p);
  const cfg = sepConfig(p);
  const reCrit = reCritical(ball, p.ball.roughness, p.ball.seamHeight);
  const kS = seamScale(p, cfg);
  const axis = spinAxis(p);
  const q0 = releaseQuat(p);
  const N = cfg.nPhi;
  const dt = p.sim.dt;
  const maxN = Math.ceil(p.sim.maxTime / dt) + 2;
  const recSec = p.sim.recordSectors;

  const arr3 = () => new Float64Array(3 * maxN);
  const arr = () => new Float64Array(maxN);
  const rec: FlightRecord = {
    params: p,
    n: 0,
    dt,
    nPhi: N,
    ball,
    air,
    reCrit,
    kS,
    spinAxis: axis,
    t: arr(),
    r: arr3(),
    v: arr3(),
    q: new Float64Array(4 * maxN),
    e: arr3(),
    e1: arr3(),
    wind: arr3(),
    fGrav: arr3(),
    fDrag: arr3(),
    fMagnus: arr3(),
    fSeam: arr3(),
    fWake: arr3(),
    fAero: arr3(),
    re: arr(),
    cd: arr(),
    cs: arr(),
    cl: arr(),
    spinParam: arr(),
    seamAngle: arr(),
    rotations: arr(),
    wRe: arr(),
    meanSep: arr(),
    aLat: arr(),
    sepAlpha: new Float32Array(recSec ? N * maxN : 0),
    sepTrip: new Float32Array(recSec ? N * maxN : 0),
    sepPin: new Float32Array(recSec ? N * maxN : 0),
    outcome: "timeout",
  };

  // Per-step coefficients, held through the RK4 stages.
  let cd = 0;
  let csVec: V3 = [0, 0, 0];
  let cnVec: V3 = [0, 0, 0];
  const sc: Scratch = { grav: [0, -m * G, 0], drag: [0, 0, 0], magnus: [0, 0, 0], seam: [0, 0, 0], wake: [0, 0, 0], cl: 0, S: 0 };

  const deriv = (t: number, s: Float64Array, out: Float64Array) => {
    const r: V3 = [s[0], s[1], s[2]];
    const w = wind.at(r);
    const vr: V3 = [s[3] - w[0], s[4] - w[1], s[5] - w[2]];
    const sp = Math.hypot(vr[0], vr[1], vr[2]);
    let ax = 0;
    let ay = -G;
    let az = 0;
    if (sp > 1e-9 && air.rho > 0) {
      const e: V3 = [vr[0] / sp, vr[1] / sp, vr[2] / sp];
      const qA = 0.5 * air.rho * sp * sp * A;
      sc.drag = [-qA * cd * e[0], -qA * cd * e[1], -qA * cd * e[2]];
      const S = (rad * spinRate(p, t)) / sp;
      const cl = p.aero.magnus ? liftCoefficient(p.aero.kMagnus, S) : 0;
      const mag = cross(axis, e);
      sc.magnus = [qA * cl * mag[0], qA * cl * mag[1], qA * cl * mag[2]];
      const cs = perpTo(csVec, e);
      sc.seam = [qA * cs[0], qA * cs[1], qA * cs[2]];
      const cn = perpTo(cnVec, e);
      sc.wake = [qA * cn[0], qA * cn[1], qA * cn[2]];
      sc.cl = cl;
      sc.S = S;
      ax += (sc.drag[0] + sc.magnus[0] + sc.seam[0] + sc.wake[0]) / m;
      ay += (sc.drag[1] + sc.magnus[1] + sc.seam[1] + sc.wake[1]) / m;
      az += (sc.drag[2] + sc.magnus[2] + sc.seam[2] + sc.wake[2]) / m;
    } else {
      sc.drag = [0, 0, 0];
      sc.magnus = [0, 0, 0];
      sc.seam = [0, 0, 0];
      sc.wake = [0, 0, 0];
      sc.cl = 0;
      sc.S = 0;
    }
    out[0] = s[3];
    out[1] = s[4];
    out[2] = s[5];
    out[3] = ax;
    out[4] = ay;
    out[5] = az;
  };
  const rk = new RK4(deriv);

  const v0 = releaseVelocity(p);
  const state = new Float64Array([p.release.lateral, p.release.height, p.release.z, v0[0], v0[1], v0[2]]);
  const sepRes = makeSepResult(N);

  const writeSample = (i: number, t: number, s: Float64Array, q: Quat, e: V3, e1: V3, w: V3, re: number, wRe: number, csMag: number) => {
    rec.t[i] = t;
    for (let k = 0; k < 3; k++) {
      rec.r[3 * i + k] = s[k];
      rec.v[3 * i + k] = s[3 + k];
      rec.e[3 * i + k] = e[k];
      rec.e1[3 * i + k] = e1[k];
      rec.wind[3 * i + k] = w[k];
      rec.fGrav[3 * i + k] = sc.grav[k];
      rec.fDrag[3 * i + k] = sc.drag[k];
      rec.fMagnus[3 * i + k] = sc.magnus[k];
      rec.fSeam[3 * i + k] = sc.seam[k];
      rec.fWake[3 * i + k] = sc.wake[k];
      rec.fAero[3 * i + k] = sc.drag[k] + sc.magnus[k] + sc.seam[k] + sc.wake[k];
    }
    for (let k = 0; k < 4; k++) rec.q[4 * i + k] = q[k];
    rec.re[i] = re;
    rec.cd[i] = cd;
    rec.cs[i] = csMag;
    rec.cl[i] = sc.cl;
    rec.spinParam[i] = sc.S;
    const th = rotationAngle(p, t);
    rec.seamAngle[i] = th / deg;
    rec.rotations[i] = th / (2 * Math.PI);
    rec.wRe[i] = wRe;
    rec.meanSep[i] = sepRes.mean;
    const lx = sc.seam[0] + sc.magnus[0] + sc.wake[0];
    const ly = sc.seam[1] + sc.magnus[1] + sc.wake[1];
    const lz = sc.seam[2] + sc.magnus[2] + sc.wake[2];
    rec.aLat[i] = Math.hypot(lx, ly, lz) / m;
    if (recSec)
      for (let k = 0; k < N; k++) {
        rec.sepAlpha[i * N + k] = sepRes.alpha[k];
        rec.sepTrip[i * N + k] = sepRes.trip[k];
        rec.sepPin[i * N + k] = sepRes.pin[k];
      }
  };

  const half = COURT.length / 2;
  let i = 0;
  const prev = new Float64Array(6);
  for (; i < maxN - 1; i++) {
    const t = i * dt;
    // --- per-step coefficients at the start of the step ---
    const q = orientationAt(p, q0, axis, t);
    const w = wind.at([state[0], state[1], state[2]]);
    const vr: V3 = [state[3] - w[0], state[4] - w[1], state[5] - w[2]];
    const sp = Math.hypot(vr[0], vr[1], vr[2]);
    const e: V3 = sp > 1e-9 ? [vr[0] / sp, vr[1] / sp, vr[2] / sp] : [0, 0, 1];
    const re = air.mu > 0 ? (air.rho * sp * d) / air.mu : 0;
    const wRe = supercriticalWeight(re, reCrit);
    separation(feature.points, q, e, wRe, cfg, sepRes);
    cd = dragCoefficient(re, ball, reCrit, sepRes, cfg, p);
    if (!p.aero.seamForce) csVec = [0, 0, 0];
    else if (p.aero.mode === "geometric") csVec = [kS * sepRes.raw[0], kS * sepRes.raw[1], kS * sepRes.raw[2]];
    else {
      const cs = empiricalCs(p.aero.empiricalTable, rotationAngle(p, t)) * Math.min(1, cfg.efficacy) * (1 - wRe);
      const n = empiricalDirection(axis, e, sepRes.e1);
      csVec = [cs * n[0], cs * n[1], cs * n[2]];
    }
    const csMag = Math.hypot(csVec[0], csVec[1], csVec[2]);
    if (p.aero.noise) {
      const f = (p.aero.strouhal * Math.max(sp, 0.1)) / d;
      const n = wakeOU.step(dt, 1 / (2 * Math.PI * f));
      cnVec = [n[0] * sepRes.e1[0] + n[1] * sepRes.e2[0], n[0] * sepRes.e1[1] + n[1] * sepRes.e2[1], n[0] * sepRes.e1[2] + n[1] * sepRes.e2[2]];
    }
    // Forces at the start of the step fill the sample (deriv writes into sc).
    deriv(t, state, new Float64Array(6));
    writeSample(i, t, state, q, e, sepRes.e1, w, re, wRe, csMag);

    // --- advance ---
    prev.set(state);
    rk.step(t, state, dt);
    wind.step(dt);

    // --- termination, with linear interpolation to the crossing ---
    let frac = -1;
    let outcome: Outcome | null = null;
    if (p.sport === "baseball" && p.sim.stopAtTarget && prev[2] < 0 && state[2] >= 0) {
      frac = (0 - prev[2]) / (state[2] - prev[2]);
      outcome = "plate";
    }
    if (p.sport === "volleyball" && prev[2] < 0 && state[2] >= 0) {
      const f = (0 - prev[2]) / (state[2] - prev[2]);
      const y = prev[1] + f * (state[1] - prev[1]);
      const x = prev[0] + f * (state[0] - prev[0]);
      if (y < p.court.netHeight + rad && Math.abs(x) < COURT.netWidth / 2) {
        frac = f;
        outcome = "net";
      }
    }
    if (p.sport === "volleyball" && p.sim.stopAtTarget && !outcome && state[2] >= half + 4) {
      frac = (half + 4 - prev[2]) / (state[2] - prev[2]);
      outcome = "long";
    }
    if (p.sim.stopAtFloor && state[1] <= rad && prev[1] > rad) {
      const f = (prev[1] - rad) / (prev[1] - state[1]);
      if (frac < 0 || f < frac) {
        frac = f;
        outcome = "floor";
      }
    }
    if (outcome) {
      for (let k = 0; k < 6; k++) state[k] = prev[k] + frac * (state[k] - prev[k]);
      const tEnd = t + frac * dt;
      const qEnd = orientationAt(p, q0, axis, tEnd);
      deriv(tEnd, state, new Float64Array(6));
      writeSample(i + 1, tEnd, state, qEnd, e, sepRes.e1, wind.at([state[0], state[1], state[2]]), re, wRe, csMag);
      rec.n = i + 2;
      rec.outcome = outcome;
      return trim(rec);
    }
  }
  rec.n = i;
  return trim(rec);
}

/** Shrink the preallocated arrays to n samples. */
function trim(rec: FlightRecord): FlightRecord {
  const n = rec.n;
  const N = rec.nPhi;
  const out = { ...rec } as FlightRecord;
  const keys1 = ["t", "re", "cd", "cs", "cl", "spinParam", "seamAngle", "rotations", "wRe", "meanSep", "aLat"] as const;
  const keys3 = ["r", "v", "e", "e1", "wind", "fGrav", "fDrag", "fMagnus", "fSeam", "fWake", "fAero"] as const;
  for (const k of keys1) out[k] = rec[k].slice(0, n);
  for (const k of keys3) out[k] = rec[k].slice(0, 3 * n);
  out.q = rec.q.slice(0, 4 * n);
  if (rec.sepAlpha.length) {
    out.sepAlpha = rec.sepAlpha.slice(0, N * n);
    out.sepTrip = rec.sepTrip.slice(0, N * n);
    out.sepPin = rec.sepPin.slice(0, N * n);
  }
  return out;
}

/** The same release with the seam force off: the "ghost" reference path. */
export function simulateGhost(p: Params): FlightRecord {
  return simulate(withPatch(p, { aero: { seamForce: false }, sim: { recordSectors: false } }));
}

/** Vector at sample i of a 3n array. */
export const at3 = (a: Float64Array, i: number): V3 => [a[3 * i], a[3 * i + 1], a[3 * i + 2]];
export const quatAt = (rec: FlightRecord, i: number): Quat => [rec.q[4 * i], rec.q[4 * i + 1], rec.q[4 * i + 2], rec.q[4 * i + 3]];

/** Arrival point: last sample position. */
export function arrival(rec: FlightRecord): V3 {
  return at3(rec.r, rec.n - 1);
}

/**
 * Sample the geometric model into an empirical table: C_S projected on ω̂ × ê at release
 * over one turn of the ball about its spin axis (subcritical, regulation seam).
 */
export function geometricTable(p: Params, n = 24): number[] {
  const f = surfaceFeature(p);
  const cfg = sepConfig(p);
  const kS = seamScale(p, cfg);
  const axis = spinAxis(p);
  const q0 = releaseQuat(p);
  const e = norm(releaseVelocity(p));
  const res = makeSepResult(cfg.nPhi);
  const out: number[] = [];
  for (let k = 0; k < n; k++) {
    const q = qMul(qAxisAngle(axis, (2 * Math.PI * k) / n), q0);
    separation(f.points, q, e, 0, cfg, res);
    const dir = empiricalDirection(axis, e, res.e1);
    out.push(+(kS * (res.raw[0] * dir[0] + res.raw[1] * dir[1] + res.raw[2] * dir[2])).toFixed(4));
  }
  return out;
}
