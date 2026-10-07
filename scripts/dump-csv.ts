// Dump a FlightRecord to CSV:  npm run csv -- [sport] [preset] [out.csv]
//   e.g. npm run csv -- baseball quarter out/quarter.csv
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { presetParams } from "../src/ui/presets";
import { simulate, simulateGhost } from "../src/physics/simulate";
import type { Sport } from "../src/physics/params";

const sport = (process.argv[2] ?? "baseball") as Sport;
const preset = process.argv[3] ?? (sport === "baseball" ? "quarter" : "still");
const out = process.argv[4];
const p = presetParams(sport, preset);
const rec = simulate(p);
const ghost = simulateGhost(p);

const cols = [
  "t_s", "x_m", "y_m", "z_m", "vx", "vy", "vz", "re", "cd", "cs", "cl", "spin_param", "seam_angle_deg", "rotations",
  "w_re", "mean_sep_deg", "f_seam_x_N", "f_seam_y_N", "f_seam_z_N", "f_drag_N", "f_magnus_N", "f_wake_N", "dx_ghost_m", "dy_ghost_m",
];
const lines = [cols.join(",")];
const mag = (a: Float64Array, i: number) => Math.hypot(a[3 * i], a[3 * i + 1], a[3 * i + 2]);
for (let i = 0; i < rec.n; i++) {
  const g = Math.min(i, ghost.n - 1);
  lines.push(
    [
      rec.t[i], rec.r[3 * i], rec.r[3 * i + 1], rec.r[3 * i + 2], rec.v[3 * i], rec.v[3 * i + 1], rec.v[3 * i + 2],
      rec.re[i], rec.cd[i], rec.cs[i], rec.cl[i], rec.spinParam[i], rec.seamAngle[i], rec.rotations[i], rec.wRe[i],
      (rec.meanSep[i] * 180) / Math.PI, rec.fSeam[3 * i], rec.fSeam[3 * i + 1], rec.fSeam[3 * i + 2],
      mag(rec.fDrag, i), mag(rec.fMagnus, i), mag(rec.fWake, i), rec.r[3 * i] - ghost.r[3 * g], rec.r[3 * i + 1] - ghost.r[3 * g + 1],
    ].map((v) => +v.toPrecision(6)).join(","),
  );
}
const csv = lines.join("\n") + "\n";
if (out) {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, csv);
  console.log(`${rec.n} samples (${rec.outcome}) → ${out}`);
} else process.stdout.write(csv);
