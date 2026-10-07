// Batch runs for spray mode. Each job is a full Params; returns the arrival point.
import { arrival, simulate } from "../physics/simulate";
import type { Outcome } from "../physics/simulate";
import type { Params } from "../physics/params";

export interface SprayResult {
  x: number;
  y: number;
  z: number;
  outcome: Outcome;
}

self.onmessage = (e: MessageEvent<{ jobs: Params[] }>) => {
  const out: SprayResult[] = e.data.jobs.map((p) => {
    const rec = simulate(p);
    const a = arrival(rec);
    return { x: a[0], y: a[1], z: a[2], outcome: rec.outcome };
  });
  (self as unknown as Worker).postMessage(out);
};
