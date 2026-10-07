// Spray mode: N runs with the wake noise on (a new seed each) or with the release
// orientation jittered within a tolerance, spread over a few Web Workers. The inset plots
// where they arrive: the plate plane as the catcher sees it (+x = 1B on the right), or the
// receiving court from above with the server at the top (+x = passer's right on the right).

import type { Params } from "../physics/params";
import { withPatch } from "../physics/params";
import { FIELD, COURT } from "../physics/constants";
import type { SprayResult } from "../workers/spray.worker";
import { mulberry32 } from "../physics/rng";

export type SprayMode = "noise" | "orientation";

export interface SprayOptions {
  n: number;
  mode: SprayMode;
  toleranceDeg: number;
}

export function sprayJobs(p: Params, o: SprayOptions): Params[] {
  const rand = mulberry32(p.aero.seed * 7919 + o.n);
  return Array.from({ length: o.n }, (_, k) => {
    const j = (s = 1) => (rand() * 2 - 1) * o.toleranceDeg * s;
    const patch =
      o.mode === "noise"
        ? { aero: { noise: true, seed: p.aero.seed + 1 + k } }
        : { orientation: { yawDeg: p.orientation.yawDeg + j(), pitchDeg: p.orientation.pitchDeg + j(), rollDeg: p.orientation.rollDeg + j() } };
    return withPatch(p, { ...patch, sim: { recordSectors: false } });
  });
}

export async function runSpray(p: Params, o: SprayOptions): Promise<{ results: SprayResult[]; ms: number }> {
  const jobs = sprayJobs(p, o);
  const workers = Math.max(1, Math.min(navigator.hardwareConcurrency || 4, 6, jobs.length));
  const t0 = performance.now();
  const chunks: Params[][] = Array.from({ length: workers }, () => []);
  jobs.forEach((j, i) => chunks[i % workers].push(j));
  const parts = await Promise.all(
    chunks.map(
      (c) =>
        new Promise<SprayResult[]>((resolve, reject) => {
          const w = new Worker(new URL("../workers/spray.worker.ts", import.meta.url), { type: "module" });
          w.onmessage = (e: MessageEvent<SprayResult[]>) => {
            resolve(e.data);
            w.terminate();
          };
          w.onerror = (e) => {
            reject(e);
            w.terminate();
          };
          w.postMessage({ jobs: c });
        }),
    ),
  );
  return { results: parts.flat(), ms: performance.now() - t0 };
}

export interface SprayDrawColors {
  ink: string;
  muted: string;
  line: string;
  dot: string;
  ghost: string;
  zone: string;
}

/** Draw the arrival scatter. `ghost` is the seam-off arrival; `main` the current run. */
export function drawSpray(
  cv: HTMLCanvasElement,
  p: Params,
  res: SprayResult[],
  main: SprayResult,
  ghost: SprayResult,
  col: SprayDrawColors,
  fmt: (m: number) => string,
) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = cv.clientWidth || 260;
  const H = cv.clientHeight || 260;
  cv.width = W * dpr;
  cv.height = H * dpr;
  const ctx = cv.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.font = "500 10px 'IBM Plex Mono', monospace";
  const pad = 18;

  let X: (x: number) => number;
  let Y: (v: number) => number;
  let pick: (r: SprayResult) => number;
  if (p.sport === "baseball") {
    // Catcher's view of the plate plane: x to the right (1B), height up.
    const span = Math.max(0.5, ...res.map((r) => Math.abs(r.x) + 0.1), Math.abs(main.x) + 0.1);
    const yMin = Math.min(0.2, ...res.map((r) => r.y - 0.1));
    const yMax = Math.max(1.4, ...res.map((r) => r.y + 0.1));
    const s = Math.min((W - 2 * pad) / (2 * span), (H - 2 * pad) / (yMax - yMin));
    X = (x) => W / 2 + x * s;
    Y = (y) => H - pad - (y - yMin) * s;
    pick = (r) => r.y;
    ctx.strokeStyle = col.zone;
    ctx.lineWidth = 1.5;
    const hw = FIELD.plateWidth / 2;
    ctx.strokeRect(X(-hw), Y(FIELD.strikeZoneTop), 2 * hw * s, (FIELD.strikeZoneTop - FIELD.strikeZoneBottom) * s);
    ctx.fillStyle = col.muted;
    ctx.fillText("← 3B", 4, H - 4);
    ctx.textAlign = "right";
    ctx.fillText("1B →", W - 4, H - 4);
    ctx.textAlign = "left";
    ctx.fillText("catcher's view of the plate plane", 4, 11);
  } else {
    // From above, server at the top: x to the right (passer's right), z down the screen.
    const s = Math.min((W - 2 * pad) / (COURT.width + 2), (H - 2 * pad) / (COURT.length / 2 + 2));
    X = (x) => W / 2 + x * s;
    Y = (z) => pad + (z + 1) * s;
    pick = (r) => r.z;
    ctx.strokeStyle = col.zone;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(X(-COURT.width / 2), Y(0), COURT.width * s, (COURT.length / 2) * s);
    ctx.beginPath();
    ctx.moveTo(X(-COURT.width / 2), Y(COURT.attackLine));
    ctx.lineTo(X(COURT.width / 2), Y(COURT.attackLine));
    ctx.stroke();
    ctx.fillStyle = col.muted;
    ctx.fillText("net ↑ server", 4, 11);
    ctx.textAlign = "right";
    ctx.fillText("passer's right →", W - 4, H - 4);
    ctx.textAlign = "left";
  }
  // Ghost arrival (seam force off) as a hollow ring; the current run as a filled dot.
  ctx.strokeStyle = col.ghost;
  ctx.beginPath();
  ctx.arc(X(ghost.x), Y(pick(ghost)), 6, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = col.dot;
  ctx.globalAlpha = 0.7;
  for (const r of res) {
    ctx.beginPath();
    ctx.arc(X(r.x), Y(pick(r)), 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = col.ink;
  ctx.beginPath();
  ctx.arc(X(main.x), Y(pick(main)), 4, 0, Math.PI * 2);
  ctx.fill();
  // Spread summary.
  const mx = res.reduce((a, r) => a + r.x, 0) / res.length;
  const my = res.reduce((a, r) => a + pick(r), 0) / res.length;
  const sx = Math.sqrt(res.reduce((a, r) => a + (r.x - mx) ** 2, 0) / res.length);
  const sy = Math.sqrt(res.reduce((a, r) => a + (pick(r) - my) ** 2, 0) / res.length);
  return { sx: fmt(sx), sy: fmt(sy) };
}
