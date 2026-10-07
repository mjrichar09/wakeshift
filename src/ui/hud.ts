// Live readout at the playhead (four key numbers, the rest behind "more"), the broadcast
// lower-third caption, and the orientation gizmo showing where +x (1B side / passer's
// right) and the flight point on screen for the current camera.

import * as THREE from "three";
import type { FlightRecord } from "../physics/simulate";
import { lateralLabel } from "../physics/frames";
import type { UnitSystem } from "./units";
import { fmtSpeed, smallUnit, toSmall } from "./units";

export function regime(wRe: number): { key: "sub" | "crit" | "super"; label: string } {
  if (wRe < 0.2) return { key: "sub", label: "Subcritical · seams can trip one side" };
  if (wRe < 0.8) return { key: "crit", label: "In the drag crisis" };
  return { key: "super", label: "Supercritical · little float" };
}

export class Hud {
  private keys: Record<string, HTMLElement> = {};
  private more = false;
  private moreEl: HTMLElement;
  private regimeEl: HTMLElement;

  constructor(el: HTMLElement) {
    el.innerHTML = `
      <div class="hud__main">
        <div class="hud__stat hud__stat--hero"><span class="hud__k">Break</span><span class="hud__v" data-k="breakH"></span><span class="hud__s" data-k="breakV"></span></div>
        <div class="hud__stat"><span class="hud__k">Side force C<sub>S</sub></span><span class="hud__v" data-k="cs"></span></div>
        <div class="hud__stat"><span class="hud__k">Turns</span><span class="hud__v" data-k="rot"></span></div>
      </div>
      <p class="hud__regime" data-k="regime"></p>
      <dl class="hud__more" hidden>
        <dt>time</dt><dd data-k="t"></dd><dt>speed</dt><dd data-k="speed"></dd>
        <dt>Re</dt><dd data-k="re"></dd><dt>C<sub>d</sub></dt><dd data-k="cd"></dd>
        <dt>S = rω/v</dt><dd data-k="S"></dd><dt>seam angle</dt><dd data-k="seam"></dd>
      </dl>
      <button type="button" class="hud__toggle" aria-expanded="false">More numbers</button>`;
    el.querySelectorAll<HTMLElement>("[data-k]").forEach((e) => (this.keys[e.dataset.k!] = e));
    this.moreEl = el.querySelector(".hud__more")!;
    this.regimeEl = el.querySelector(".hud__regime")!;
    const btn = el.querySelector<HTMLButtonElement>(".hud__toggle")!;
    btn.addEventListener("click", () => {
      this.more = !this.more;
      this.moreEl.hidden = !this.more;
      btn.textContent = this.more ? "Fewer numbers" : "More numbers";
      btn.setAttribute("aria-expanded", String(this.more));
    });
  }

  render(rec: FlightRecord, ghost: FlightRecord, i: number, t: number, units: UnitSystem, slowed: boolean) {
    const g = Math.min(i, ghost.n - 1);
    const dx = rec.r[3 * i] - ghost.r[3 * g];
    const dy = rec.r[3 * i + 1] - ghost.r[3 * g + 1];
    const su = smallUnit(units);
    const k = this.keys;
    k.breakH.textContent = lateralLabel(toSmall(dx, units), rec.params.sport, 1, ` ${su}`);
    k.breakV.textContent = `${Math.abs(toSmall(dy, units)).toFixed(1)} ${su} ${dy >= 0 ? "higher" : "lower"}`;
    k.cs.textContent = rec.cs[i].toFixed(3);
    k.rot.textContent = rec.rotations[i].toFixed(2);
    const reg = regime(rec.wRe[i]);
    this.regimeEl.textContent = reg.label;
    this.regimeEl.className = `hud__regime regime--${reg.key}`;
    if (!this.more) return;
    const sp = Math.hypot(rec.v[3 * i], rec.v[3 * i + 1], rec.v[3 * i + 2]);
    k.t.textContent = `${(t * 1000).toFixed(0)} ms${slowed ? " (slowed)" : ""}`;
    k.speed.textContent = fmtSpeed(sp, units);
    k.re.textContent = `${(rec.re[i] / 1000).toFixed(0)}k`;
    k.cd.textContent = rec.cd[i].toFixed(3);
    k.S.textContent = rec.spinParam[i].toFixed(4);
    k.seam.textContent = `${(((rec.seamAngle[i] % 360) + 360) % 360).toFixed(0)}°`;
  }
}

/** Draw the screen directions of world +x, +z and +y for this camera. */
const gizmoLast = new WeakMap<HTMLCanvasElement, string>();

export function drawGizmo(cv: HTMLCanvasElement, camera: THREE.Camera, labels: { x: string; z: string }, accent: string) {
  const q = camera.quaternion;
  const key = `${q.x.toFixed(4)},${q.y.toFixed(4)},${q.z.toFixed(4)},${q.w.toFixed(4)},${labels.x},${accent}`;
  if (gizmoLast.get(cv) === key) return;
  gizmoLast.set(cv, key);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = cv.clientWidth;
  const H = cv.clientHeight;
  if (W === 0) return;
  if (cv.width !== W * dpr) {
    cv.width = W * dpr;
    cv.height = H * dpr;
  }
  const ctx = cv.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const inv = camera.quaternion.clone().invert();
  const c = { x: W / 2, y: H / 2 };
  const L = W * 0.3;
  ctx.fillStyle = "rgba(12,17,20,0.55)";
  ctx.beginPath();
  ctx.arc(c.x, c.y, W * 0.48, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 1;
  ctx.stroke();
  const axes: [THREE.Vector3, string, string, number][] = [
    [new THREE.Vector3(0, 1, 0), "up", "#c9d2d6", 1.5],
    [new THREE.Vector3(0, 0, 1), labels.z, "#9fd0ff", 2],
    [new THREE.Vector3(1, 0, 0), labels.x, accent, 2.5],
  ];
  ctx.font = `600 ${Math.round(W * 0.12)}px 'Barlow Condensed', sans-serif`;
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
    const lx = c.x + v.x * (L + W * 0.11);
    const ly = c.y - v.y * (L + W * 0.11);
    ctx.fillText(label, Math.min(W - 12, Math.max(12, lx)), Math.min(H - 8, Math.max(8, ly)));
  }
  ctx.globalAlpha = 1;
}
