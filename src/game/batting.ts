// Batting game rules (pure, tested): random pitches, where a click lands on the plate
// plane, and how a guess scores. Directions use the shared frame: +x = 1B (catcher's right).

import * as THREE from "three";
import { FIELD } from "../physics/constants";
import type { Params } from "../physics/params";
import { withPatch } from "../physics/params";
import { presetParams } from "../ui/presets";

export type Difficulty = "easy" | "medium" | "hard";

export const DIFFICULTY: Record<Difficulty, { label: string; speed: number; mult: number }> = {
  easy: { label: "Easy · 0.35×", speed: 0.35, mult: 1 },
  medium: { label: "Medium · 0.6×", speed: 0.6, mult: 1.5 },
  hard: { label: "Real time · 1×", speed: 1, mult: 2.5 },
};

export const PITCHES_PER_ROUND = 10;

/** From the click to the bat reaching the plate, in game (sim) time: a real swing's ~0.1 s. */
export const SWING_DELAY = 0.1;
/** Timing windows on |bat arrival − ball arrival| (s, sim time). */
export const TIMING_GOOD = 0.02;
export const TIMING_FOUL = 0.04;
/** Clicks are still taken this long (wall time) after the ball passes the plate: late swings. */
export const LATE_WINDOW_MS = 500;
/** Game pitches fly on past the plate into the catcher's mitt. */
export const MITT_Z = 1.05;

export interface GamePitch {
  params: Params;
  /** Pitch name for the result card, e.g. "Knuckleball (1/4 turn)". */
  name: string;
  knuckle: boolean;
}

const KNUCKLES: [string, string][] = [
  ["zero", "Knuckleball (no spin)"],
  ["quarter", "Knuckleball (1/4 turn)"],
  ["half", "Knuckleball (1/2 turn)"],
  ["one", "Knuckleball (1 turn)"],
];
const SPIN: [string, string][] = [
  ["fourSeam", "Four-seam fastball"],
  ["sinker", "Sinker"],
  ["cutter", "Cutter"],
  ["slider", "Slider"],
  ["curveball", "Curveball"],
  ["changeup", "Changeup"],
  ["splitter", "Splitter"],
];

/**
 * A random pitch: about half knuckleballs with a random seam orientation (their break is
 * unpredictable), the rest spin pitches. Aim jitter spreads locations over and around the
 * zone so some pitches are balls.
 */
export function randomPitch(rand: () => number = Math.random): GamePitch {
  const knuckle = rand() < 0.5;
  const [id, name] = knuckle ? KNUCKLES[Math.floor(rand() * KNUCKLES.length)] : SPIN[Math.floor(rand() * SPIN.length)];
  const base = presetParams("baseball", id);
  const j = (deg: number) => (rand() * 2 - 1) * deg;
  const patch = {
    release: { vAngleDeg: base.release.vAngleDeg + j(0.9), hAngleDeg: base.release.hAngleDeg + j(1.1) },
    sim: { recordSectors: false, targetZ: MITT_Z },
    ...(knuckle ? { orientation: { yawDeg: j(180), pitchDeg: j(180), rollDeg: j(180) } } : {}),
  };
  return { params: withPatch(base, patch), name, knuckle };
}

/** Where and when a flight crosses the plane z = z0 (linear interpolation), or null. */
export function crossing(r: Float64Array, t: Float64Array, n: number, z0 = 0): { t: number; x: number; y: number } | null {
  for (let i = 1; i < n; i++) {
    const za = r[3 * (i - 1) + 2];
    const zb = r[3 * i + 2];
    if (za < z0 && zb >= z0) {
      const f = (z0 - za) / (zb - za);
      return {
        t: t[i - 1] + f * (t[i] - t[i - 1]),
        x: r[3 * (i - 1)] + f * (r[3 * i] - r[3 * (i - 1)]),
        y: r[3 * (i - 1) + 1] + f * (r[3 * i + 1] - r[3 * (i - 1) + 1]),
      };
    }
  }
  return null;
}

/** Where a click (normalized device coords) meets the plate plane z = 0; null if it misses. */
export function plateHit(camera: THREE.Camera, ndcX: number, ndcY: number): { x: number; y: number } | null {
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
  const hit = new THREE.Vector3();
  if (!ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), hit)) return null;
  return { x: hit.x, y: hit.y };
}

/** A strike if any part of the ball passes through the zone at the plate plane. */
export function isStrike(x: number, y: number, radius = 0.037) {
  return Math.abs(x) <= FIELD.plateWidth / 2 + radius && y >= FIELD.strikeZoneBottom - radius && y <= FIELD.strikeZoneTop + radius;
}

export type Verdict = "barrel" | "solid" | "weak" | "foul" | "miss" | "chase" | "goodTake" | "calledStrike" | "early" | "late";

export interface Outcome {
  verdict: Verdict;
  title: string;
  points: number;
  /** Distance from the guess to the ball, m (swings only). */
  miss?: number;
  /** Bat arrival minus ball arrival, s (swings only): negative = early. */
  timing?: number;
  /** Where the ball met the bat (swings only): along it from the sweet spot, and off it. */
  along?: number;
  perp?: number;
  above?: boolean;
  strike: boolean;
}

const IN = 0.0254;

// ------------------------------------------------------------------ the bat at contact

/** Where the batter stands (world): the middle of the 3B-side box, a right-handed batter. */
export const BATTER_AT = {
  x: -(FIELD.plateWidth / 2 + FIELD.boxGap + FIELD.boxWidth / 2),
  y: 0,
  z: FIELD.plateDepth / 2,
};

export const BAT_LEN = 0.84;
/** Sweet spot: about 6 in from the end of the bat, as a fraction from the knob. */
export const SWEET = 0.82;

/** Bat radius at distance u (m) from the knob — the drawn bat's profile. */
export function batRadius(u: number) {
  const f = u / BAT_LEN;
  const pts: [number, number][] = [[0, 0.028], [0.02, 0.028], [0.035, 0.017], [0.3, 0.0175], [0.55, 0.032], [0.72, 0.044], [0.965, 0.044], [0.99, 0.037], [1, 0.02]];
  if (f <= 0) return pts[0][1];
  for (let i = 1; i < pts.length; i++)
    if (f <= pts[i][0]) {
      const [f0, r0] = pts[i - 1];
      const [f1, r1] = pts[i];
      return r0 + ((r1 - r0) * (f - f0)) / (f1 - f0);
    }
  return 0.02;
}

type V3 = { x: number; y: number; z: number };
const sub = (a: V3, b: V3) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const addS = (a: V3, b: V3, k: number) => ({ x: a.x + b.x * k, y: a.y + b.y * k, z: a.z + b.z * k });
const len = (a: V3) => Math.hypot(a.x, a.y, a.z);
const scale = (a: V3, k: number) => ({ x: a.x * k, y: a.y * k, z: a.z * k });

/** World ↔ batter-local (local: +z toward the plate, +x toward the pitcher, +y up). */
export const toLocal = (w: V3): V3 => ({ x: -(w.z - BATTER_AT.z), y: w.y, z: w.x - BATTER_AT.x });
export const toWorld = (l: V3): V3 => ({ x: l.z + BATTER_AT.x, y: l.y, z: BATTER_AT.z - l.x });

export interface BatLine {
  /** World positions of the knob, the sweet spot and the end of the bat at contact. */
  knob: V3;
  sweet: V3;
  end: V3;
  /** False when the click was out of reach: the sweet spot gets as close as the arms allow. */
  reached: boolean;
}

/**
 * Point the hands work around at contact (between the shoulders, allowing for the batter
 * crouching and leaning into low and away pitches) and how far the knob can get from it.
 * Inside pitches are reached by pulling the hands in.
 */
const REACH_CENTER: V3 = { x: 0.05, y: 1.25, z: 0.12 };
const REACH_MAX = 0.72;
const REACH_MIN = 0.08;

/**
 * The bat at the moment of contact for a click on the plate plane: the sweet spot sits on the
 * click and the bat points back to the hands, which ride a little above the ball (so low
 * pitches are hit with the barrel tilted down). Out of reach, the hands go as far as they can
 * and the bat keeps its angle.
 */
export function batAtContact(click: { x: number; y: number }): BatLine {
  const S = toLocal({ x: click.x, y: click.y, z: 0 });
  const handTarget: V3 = { x: 0.12, y: THREE.MathUtils.clamp(click.y + 0.15, 0.72, 1.28), z: 0.33 };
  const toS = sub(S, handTarget);
  const dir = scale(toS, 1 / Math.max(len(toS), 1e-6));
  let knob = addS(S, dir, -SWEET * BAT_LEN);
  const fromC = sub(knob, REACH_CENTER);
  const d = len(fromC);
  let reached = true;
  if (d > REACH_MAX || d < REACH_MIN) {
    knob = addS(REACH_CENTER, fromC, THREE.MathUtils.clamp(d, REACH_MIN, REACH_MAX) / Math.max(d, 1e-6));
    reached = false;
  }
  const sweet = addS(knob, dir, SWEET * BAT_LEN);
  const endP = addS(knob, dir, BAT_LEN);
  return { knob: toWorld(knob), sweet: toWorld(sweet), end: toWorld(endP), reached };
}

export interface AlongBat {
  /** Distance from the knob to the closest point on the bat (m). */
  u: number;
  /** Signed distance from the sweet spot along the bat (m): + toward the end, − toward the hands. */
  along: number;
  /** Distance from the bat's centreline (m), and whether the ball is above it. */
  perp: number;
  above: boolean;
  /** True when the ball touches the bat: within bat radius + ball radius of the centreline. */
  hit: boolean;
}

export const BALL_R = 0.037;

/** Where a ball at the plate plane meets the bat line. */
export function contactAlongBat(ball: { x: number; y: number }, bat: BatLine): AlongBat {
  const B = { x: ball.x, y: ball.y, z: 0 };
  const axis = sub(bat.end, bat.knob);
  const L = len(axis);
  const a = scale(axis, 1 / L);
  const rel = sub(B, bat.knob);
  const uRaw = rel.x * a.x + rel.y * a.y + rel.z * a.z;
  const u = THREE.MathUtils.clamp(uRaw, 0, L);
  const closest = addS(bat.knob, a, u);
  const off = sub(B, closest);
  const perp = len(off);
  const hit = uRaw >= -BALL_R && uRaw <= L + BALL_R && perp <= batRadius(u) + BALL_R;
  return { u, along: u - SWEET * L, perp, above: off.y > 0, hit };
}

/**
 * Score a pitch. `bat` is null when the batter did not swing. Timing first: within 20 ms
 * of the ball is clean, 20–40 ms is at best a foul, more is a whiff (early or late). Then
 * where the ball met the bat: within 1.5 in of the sweet spot (your click) is a barrel,
 * within 4 in along the bat and 2 in off its centreline is solid, anywhere else on the bat
 * is weak contact (jammed, off the end, topped, under it), and missing the bat is a miss.
 * `timing` = bat arrival − ball arrival (s).
 */
export function score(actual: { x: number; y: number }, bat: BatLine | null, difficulty: Difficulty, timing = 0): Outcome {
  const strike = isStrike(actual.x, actual.y);
  const m = DIFFICULTY[difficulty].mult;
  if (!bat) {
    return strike
      ? { verdict: "calledStrike", title: "Called strike", points: 0, strike }
      : { verdict: "goodTake", title: "Good eye: ball", points: Math.round(30 * m), strike };
  }
  const c = contactAlongBat(actual, bat);
  const miss = Math.hypot(bat.sweet.x - actual.x, bat.sweet.y - actual.y);
  const base = { miss, timing, strike, along: c.along, perp: c.perp, above: c.above };
  const at = Math.abs(timing);
  if (at > TIMING_FOUL)
    return timing < 0
      ? { verdict: "early", title: "Way out in front: swing and a miss", points: 0, ...base }
      : { verdict: "late", title: "Late: swing and a miss", points: 0, ...base };
  if (!c.hit)
    return strike ? { verdict: "miss", title: "Swing and a miss", points: 0, ...base } : { verdict: "chase", title: "Chased a ball", points: 0, ...base };
  if (at > TIMING_GOOD) return { verdict: "foul", title: timing < 0 ? "A bit early: foul ball" : "A bit late: foul ball", points: Math.round(20 * m), ...base };
  const alongIn = Math.abs(c.along) / IN;
  const perpIn = c.perp / IN;
  if (miss <= 1.5 * IN && perpIn <= 1.2) return { verdict: "barrel", title: "Barrelled it!", points: Math.round(100 * m), ...base };
  if (alongIn <= 4 && perpIn <= 2) return { verdict: "solid", title: "Solid contact", points: Math.round(60 * m), ...base };
  const kind =
    perpIn > 2
      ? c.above
        ? "Got under it"
        : "Topped it"
      : c.along < 0
        ? "Jammed: off the hands"
        : "Off the end of the bat";
  return { verdict: "weak", title: kind, points: Math.round(30 * m), ...base };
}

/** Hits keep a streak going; a take of a ball does not break it. */
export const extendsStreak = (v: Verdict) => v === "barrel" || v === "solid";
export const breaksStreak = (v: Verdict) => v === "miss" || v === "chase" || v === "calledStrike" || v === "foul" || v === "early" || v === "late" || v === "weak";

// ------------------------------------------------------------------ batted ball

export interface Contact {
  /** Exit speed, m/s. */
  speed: number;
  /** Launch angle above horizontal, deg. */
  launch: number;
  /** Spray angle, deg: + toward right field (1B side, +x), − toward left field (3B side). */
  spray: number;
  /** Backspin, rev/s. */
  spin: number;
}

const MPH = 0.44704;

/**
 * How the ball comes off the bat. Quality sets exit speed; where the ball met the bat sets
 * launch (bat under the ball → higher, over it → lower) and how hard; pitch location and
 * timing set the direction (a right-hander pulls inside pitches and early swings to left
 * field). Jammed balls die toward the opposite field, balls off the end slice that way too.
 */
export function contactFrom(o: Outcome, actual: { x: number; y: number }, rand: () => number = Math.random): Contact | null {
  const r = (a: number, b: number) => a + (b - a) * rand();
  // Inches the bat's centreline passed under the ball (+) or over it (−).
  const under = ((o.perp ?? 0) * (o.above ? 1 : -1)) / 0.0254;
  const pull = actual.x * 95 + (o.timing ?? 0) * 600;
  if (o.verdict === "foul") {
    const side = o.timing !== undefined && Math.abs(o.timing) > TIMING_GOOD ? Math.sign(o.timing) : (o.along ?? 0) >= 0 ? 1 : -1;
    return { speed: r(55, 75) * MPH, launch: r(25, 55), spray: side * r(52, 75), spin: r(25, 40) };
  }
  if (o.verdict === "weak") {
    const along = o.along ?? 0;
    const speed = r(58, 78) * MPH;
    const launch = THREE.MathUtils.clamp(r(10, 22) + under * 12, -20, 75);
    // Jammed and off-the-end contact both push the ball away from the pull side.
    const spray = THREE.MathUtils.clamp(pull + (Math.abs(along) > 0.1 ? 22 : 0) + r(-12, 12), -50, 50);
    return { speed, launch, spray, spin: r(20, 45) };
  }
  if (o.verdict !== "barrel" && o.verdict !== "solid") return null;
  const barrel = o.verdict === "barrel";
  const speed = (barrel ? r(100, 110) : r(86, 98)) * MPH;
  const launch = THREE.MathUtils.clamp((barrel ? r(22, 32) : r(6, 20)) + under * 6, -15, 70);
  const spray = THREE.MathUtils.clamp(pull + r(-10, 10), -42, 42);
  return { speed, launch, spray, spin: r(28, 42) };
}

/** Params for the batted ball: leaves the plate plane toward the outfield (−z) with backspin. */
export function battedParams(pitch: Params, at: { x: number; y: number }, c: Contact): Params {
  return withPatch(pitch, {
    release: { speed: c.speed, vAngleDeg: c.launch, hAngleDeg: 180 - c.spray, height: at.y, lateral: at.x, z: -0.02 },
    // Tilt 180° with flight along −z is backspin (Magnus up for a ball heading to the outfield).
    spin: { revPerSec: c.spin, tiltDeg: 180, gyroDeg: 0, decayTau: 0 },
    // Calibrated to big-league batted-ball distances (≈400 ft at 100 mph and 28°, ≈270 ft
    // at 92 mph and 12°): a less-rough ball keeps hard-hit drag realistic, and a gentler
    // Magnus slope matches measured lift on backspinning fly balls.
    aero: { noise: false, kMagnus: 1.0 },
    ball: { roughness: 0.3 },
    env: { gustIntensity: 0 },
    sim: { maxTime: 8, stopAtTarget: false, stopAtFloor: true, recordSectors: false, dt: 0.002 },
  });
}

export interface FlightCall {
  kind: "homeRun" | "deepFly" | "lineDrive" | "flyBall" | "groundBall" | "popUp" | "foul";
  title: string;
  /** Distance from home plate to where it landed (or would have), ft. */
  feet: number;
  field: string;
}

const FT = 3.280839895;
const WALL = 110; // m from the plate's back tip (as built in the scene)
const WALL_H = 3;

/** Call a batted-ball flight from its record (x, y, z per sample in r). */
export function callFlight(r: Float64Array, n: number, launch: number): FlightCall {
  const tip = FIELD.plateDepth;
  const end = [r[3 * (n - 1)], r[3 * (n - 1) + 1], r[3 * (n - 1) + 2]];
  const dist = Math.hypot(end[0], end[2] - tip);
  const angle = (Math.atan2(end[0], tip - end[2]) * 180) / Math.PI; // + toward 1B / right field
  const field = Math.abs(angle) < 15 ? "center field" : angle > 0 ? "right field" : "left field";
  const feet = Math.round(dist * FT);
  if (Math.abs(angle) > 45 || end[2] > tip) return { kind: "foul", title: "Foul ball", feet, field: angle > 0 ? "the 1B side" : "the 3B side" };
  // Over the wall: height when it reaches the wall's distance.
  for (let i = 1; i < n; i++) {
    const d = Math.hypot(r[3 * i], r[3 * i + 2] - tip);
    if (d >= WALL) {
      if (r[3 * i + 1] > WALL_H) return { kind: "homeRun", title: "Home run!", feet, field };
      break;
    }
  }
  if (launch < 8) return { kind: "groundBall", title: "Ground ball", feet, field };
  if (launch > 50) return { kind: "popUp", title: "Pop-up", feet, field };
  if (dist > 85) return { kind: "deepFly", title: "Deep fly ball", feet, field };
  if (launch < 22) return { kind: "lineDrive", title: "Line drive", feet, field };
  return { kind: "flyBall", title: "Fly ball", feet, field };
}
