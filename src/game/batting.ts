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
    sim: { recordSectors: false },
    ...(knuckle ? { orientation: { yawDeg: j(180), pitchDeg: j(180), rollDeg: j(180) } } : {}),
  };
  return { params: withPatch(base, patch), name, knuckle };
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

export type Verdict = "barrel" | "solid" | "foul" | "miss" | "chase" | "goodTake" | "calledStrike";

export interface Outcome {
  verdict: Verdict;
  title: string;
  points: number;
  /** Distance from the guess to the ball, m (swings only). */
  miss?: number;
  strike: boolean;
}

const IN = 0.0254;

/**
 * Score a pitch. `guess` is null when the batter did not swing. Contact needs the guess
 * within 1.5 in (barrel), 3 in (solid) or 5 in (foul tip) of where the ball crossed.
 */
export function score(actual: { x: number; y: number }, guess: { x: number; y: number } | null, difficulty: Difficulty): Outcome {
  const strike = isStrike(actual.x, actual.y);
  const m = DIFFICULTY[difficulty].mult;
  if (!guess) {
    return strike
      ? { verdict: "calledStrike", title: "Called strike", points: 0, strike }
      : { verdict: "goodTake", title: "Good eye: ball", points: Math.round(30 * m), strike };
  }
  const d = Math.hypot(guess.x - actual.x, guess.y - actual.y);
  if (d <= 1.5 * IN) return { verdict: "barrel", title: "Barrelled it!", points: Math.round(100 * m), miss: d, strike };
  if (d <= 3 * IN) return { verdict: "solid", title: "Solid contact", points: Math.round(60 * m), miss: d, strike };
  if (d <= 5 * IN) return { verdict: "foul", title: "Foul tip", points: Math.round(20 * m), miss: d, strike };
  if (!strike) return { verdict: "chase", title: "Chased a ball", points: 0, miss: d, strike };
  return { verdict: "miss", title: "Swing and a miss", points: 0, miss: d, strike };
}

/** Hits keep a streak going; a take of a ball does not break it. */
export const extendsStreak = (v: Verdict) => v === "barrel" || v === "solid";
export const breaksStreak = (v: Verdict) => v === "miss" || v === "chase" || v === "calledStrike" || v === "foul";
