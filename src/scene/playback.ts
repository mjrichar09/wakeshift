// Playback reads the precomputed FlightRecord at a playhead time, so slow motion,
// scrubbing and frame stepping are exact. One "frame" step = 1 ms of sim time.

import type { FlightRecord } from "../physics/simulate";

export const SPEEDS = [1, 0.5, 0.25, 0.1, 0.05, 0.02];
export const FRAME_STEP = 0.001;

export class Playback {
  t = 0;
  duration = 0;
  playing = true;
  speed = 0.25;
  loop = true;
  autoSlow = false;
  /** Lateral acceleration (m/s²) above which auto-slow kicks in. */
  autoSlowThreshold = 3;
  autoSlowFactor = 0.25;
  /** Wall-clock pause at the end before looping. */
  private endHold = 0;
  slowedNow = false;

  setDuration(d: number) {
    this.duration = d;
    this.t = Math.min(this.t, d);
  }

  update(dtWall: number, aLat: (t: number) => number) {
    if (!this.playing) return;
    if (this.t >= this.duration) {
      if (!this.loop) {
        this.playing = false;
        return;
      }
      this.endHold += dtWall;
      if (this.endHold < 0.9) return;
      this.endHold = 0;
      this.t = 0;
      return;
    }
    this.slowedNow = this.autoSlow && aLat(this.t) > this.autoSlowThreshold;
    const k = this.slowedNow ? this.autoSlowFactor : 1;
    this.t = Math.min(this.duration, this.t + Math.min(dtWall, 0.1) * this.speed * k);
  }

  toggle() {
    if (!this.playing && this.t >= this.duration) this.t = 0;
    this.playing = !this.playing;
  }

  step(dir: number) {
    this.playing = false;
    this.t = Math.max(0, Math.min(this.duration, Math.round((this.t + dir * FRAME_STEP) / FRAME_STEP) * FRAME_STEP));
  }

  scrub(t: number) {
    this.t = Math.max(0, Math.min(this.duration, t));
    this.endHold = 0;
  }

  replay() {
    this.t = 0;
    this.endHold = 0;
    this.playing = true;
  }
}

/** Sample index and blend fraction for time t. */
export function sampleAt(rec: FlightRecord, t: number): { i: number; f: number } {
  if (rec.n < 2) return { i: 0, f: 0 };
  let i = Math.min(Math.max(Math.floor(t / rec.dt), 0), rec.n - 2);
  while (i < rec.n - 2 && t > rec.t[i + 1]) i++;
  const span = rec.t[i + 1] - rec.t[i];
  return { i, f: span > 0 ? Math.max(0, Math.min(1, (t - rec.t[i]) / span)) : 0 };
}

/** Linear blend of a 3-vector array at (i, f). */
export function lerp3(a: Float64Array, i: number, f: number): [number, number, number] {
  const j = 3 * i;
  return [a[j] + (a[j + 3] - a[j]) * f, a[j + 1] + (a[j + 4] - a[j + 1]) * f, a[j + 2] + (a[j + 5] - a[j + 2]) * f];
}

export function lerp1(a: Float64Array, i: number, f: number) {
  return a[i] + (a[i + 1] - a[i]) * f;
}

/** Nearest sample index. */
export const nearest = (s: { i: number; f: number }) => (s.f < 0.5 ? s.i : s.i + 1);
