// Live numbers at the playhead, and the orientation gizmo that shows where +x (1B side /
// passer's right) and the flight direction point on screen for the current camera.

import * as THREE from "three";
import type { FlightRecord } from "../physics/simulate";
import { lateralLabel } from "../physics/frames";
import type { UnitSystem } from "./units";
import { fmtSpeed, smallUnit, toSmall } from "./units";

export function regime(wRe: number): { key: "sub" | "crit" | "super"; label: string } {
  if (wRe < 0.2) return { key: "sub", label: "Subcritical: seams can trip one side" };
  if (wRe < 0.8) return { key: "crit", label: "In the drag crisis" };
  return { key: "super", label: "Supercritical: all turbulent, little float" };
}

export function renderHud(el: HTMLElement, rec: FlightRecord, ghost: FlightRecord, i: number, t: number, units: UnitSystem, slowed: boolean) {
  const g = Math.min(i, ghost.n - 1);
  const sp = Math.hypot(rec.v[3 * i], rec.v[3 * i + 1], rec.v[3 * i + 2]);
  const dx = rec.r[3 * i] - ghost.r[3 * g];
  const dy = rec.r[3 * i + 1] - ghost.r[3 * g + 1];
  const su = smallUnit(units);
  const dxS = toSmall(dx, units);
  const reg = regime(rec.wRe[i]);
  const seam = ((rec.seamAngle[i] % 360) + 360) % 360;
  const rows: [string, string, string?][] = [
    ["t", `${(t * 1000).toFixed(0)} ms${slowed ? " · slowed" : ""}`],
    ["speed", fmtSpeed(sp, units)],
    ["Re", `${(rec.re[i] / 1000).toFixed(0)}k`],
    ["C_d", rec.cd[i].toFixed(3)],
    ["C_S", rec.cs[i].toFixed(3), "hero"],
    ["S = rω/v", rec.spinParam[i].toFixed(4)],
    ["rotations", rec.rotations[i].toFixed(2)],
    ["seam angle", `${seam.toFixed(0)}°`],
    ["break (horiz)", lateralLabel(dxS, rec.params.sport, 1, ` ${su}`), "hero"],
    ["break (vert)", `${toSmall(dy, units) >= 0 ? "+" : "−"}${Math.abs(toSmall(dy, units)).toFixed(1)} ${su} ${dy >= 0 ? "up" : "down"}`],
  ];
  el.innerHTML =
    rows.map(([k, v, c]) => `<dt>${k}</dt><dd${c ? ` class="${c}"` : ""}>${v}</dd>`).join("") +
    `<p class="hud__regime regime--${reg.key}">${reg.label}</p>`;
}

/** Draw the screen directions of world +x, +z and +y for this camera. */
export function drawGizmo(cv: HTMLCanvasElement, camera: THREE.Camera, labels: { x: string; z: string }, ink: string, accent: string) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = cv.clientWidth;
  const H = cv.clientHeight;
  if (cv.width !== W * dpr) {
    cv.width = W * dpr;
    cv.height = H * dpr;
  }
  const ctx = cv.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const inv = camera.quaternion.clone().invert();
  const c = { x: W / 2, y: H / 2 };
  const L = W * 0.32;
  ctx.fillStyle = "rgba(15,20,23,0.45)";
  ctx.beginPath();
  ctx.arc(c.x, c.y, W * 0.47, 0, Math.PI * 2);
  ctx.fill();
  const axes: [THREE.Vector3, string, string, number][] = [
    [new THREE.Vector3(0, 1, 0), "up", "#c9d2d6", 1.5],
    [new THREE.Vector3(0, 0, 1), labels.z, "#9fd0ff", 2],
    [new THREE.Vector3(1, 0, 0), labels.x, accent, 2.5],
  ];
  ctx.font = `600 ${Math.round(W * 0.1)}px 'Barlow Condensed', sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const [d, label, color, w] of axes) {
    const v = d.clone().applyQuaternion(inv);
    const ex = c.x + v.x * L;
    const ey = c.y - v.y * L;
    ctx.strokeStyle = color;
    ctx.globalAlpha = v.z > 0.6 ? 0.45 : 1; // pointing at the viewer: fade
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(c.x, c.y);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.fillStyle = color;
    const lx = c.x + v.x * (L + W * 0.1);
    const ly = c.y - v.y * (L + W * 0.1);
    ctx.fillText(label, Math.min(W - 14, Math.max(14, lx)), Math.min(H - 8, Math.max(8, ly)));
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = ink;
}
