// Four uPlot charts in the bottom drawer, synced to the playhead; clicking one scrubs.
//  1. side force (horizontal: + toward 1B / passer's right; vertical: + up)
//  2. seam angle (rotation about the spin axis)
//  3. Re and C_d, with the drag-crisis band shaded
//  4. displacement from the ghost path (top-down and side-on), plus pinned runs

import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import type { FlightRecord } from "../physics/simulate";
import { crisisBand } from "../physics/aero/dragCurve";
import type { UnitSystem } from "./units";
import { smallUnit, toSmall } from "./units";

const STRIDE = 3;

interface ChartSpec {
  id: string;
  title: string;
  note: string;
}

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888";

export class Charts {
  private plots: uPlot[] = [];
  private playhead = 0;
  private band: [number, number] = [0, 0];
  private figures: HTMLElement[] = [];
  private height = 128;

  /** Shorter charts on small screens so the stage keeps its share. */
  setCompact(compact: boolean) {
    const h = compact ? 92 : 128;
    if (h === this.height) return;
    this.height = h;
    this.resize();
  }

  constructor(
    private host: HTMLElement,
    private onScrub: (t: number) => void,
  ) {
    new ResizeObserver(() => this.resize()).observe(host);
  }

  private resize() {
    for (let i = 0; i < this.plots.length; i++) {
      const w = this.figures[i].clientWidth - 12;
      if (w > 50) this.plots[i].setSize({ width: w, height: this.height });
    }
  }

  setPlayhead(t: number) {
    this.playhead = t * 1000;
    for (const p of this.plots) p.redraw(false, false);
  }

  build(rec: FlightRecord, ghost: FlightRecord, pins: { rec: FlightRecord; color: number }[], units: UnitSystem) {
    for (const p of this.plots) p.destroy();
    this.plots = [];
    this.host.innerHTML = "";
    this.figures = [];
    const side = rec.params.sport === "baseball" ? "1B" : "passer's R";
    const specs: ChartSpec[] = [
      { id: "force", title: "Side force", note: `N · horiz + = ${side}, vert + = up` },
      { id: "seam", title: "Seam angle", note: "deg turned about the spin axis" },
      { id: "re", title: "Re & C_d", note: "shaded: drag-crisis band" },
      { id: "gap", title: "Break vs ghost", note: `${smallUnit(units)} · top-down & side-on` },
    ];
    const n = Math.ceil(rec.n / STRIDE);
    const t = new Float64Array(n);
    const fx = new Float64Array(n);
    const fy = new Float64Array(n);
    const seam = new Float64Array(n);
    const re = new Float64Array(n);
    const cd = new Float64Array(n);
    const dx = new Float64Array(n);
    const dy = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      const i = Math.min(k * STRIDE, rec.n - 1);
      const g = Math.min(i, ghost.n - 1);
      t[k] = rec.t[i] * 1000;
      fx[k] = rec.fSeam[3 * i];
      fy[k] = rec.fSeam[3 * i + 1];
      seam[k] = rec.seamAngle[i];
      re[k] = rec.re[i] / 1000;
      cd[k] = rec.cd[i];
      dx[k] = toSmall(rec.r[3 * i] - ghost.r[3 * g], units);
      dy[k] = toSmall(rec.r[3 * i + 1] - ghost.r[3 * g + 1], units);
    }
    const [b0, b1] = crisisBand(rec.reCrit);
    this.band = [b0 / 1000, b1 / 1000];

    const pinSeries = pins.map(({ rec: pr }) => {
      const arr: (number | null)[] = [];
      for (let k = 0; k < n; k++) {
        const i = k * STRIDE;
        if (i >= pr.n) {
          arr.push(null);
          continue;
        }
        // Pinned runs are drawn relative to the current ghost so all share one reference.
        const g = Math.min(i, ghost.n - 1);
        arr.push(toSmall(pr.r[3 * i] - ghost.r[3 * g], units));
      }
      return arr;
    });

    const colA = css("--chart-a");
    const colB = css("--chart-b");
    const ink = css("--ink-2");
    const grid = css("--line");
    const axis = (scale?: string, side?: number): uPlot.Axis => ({
      scale,
      side,
      stroke: ink,
      grid: { stroke: grid, width: 1 },
      ticks: { stroke: grid, width: 1, size: 3 },
      size: 38,
      font: "10px IBM Plex Mono, monospace",
    });
    const xAxis: uPlot.Axis = { ...axis(), size: 22, values: (_u, v) => v.map((x) => `${Math.round(x)}`) };

    const playheadPlugin = (): uPlot.Plugin => ({
      hooks: {
        draw: [
          (u) => {
            const x = u.valToPos(this.playhead, "x", true);
            const ctx = u.ctx;
            ctx.save();
            ctx.strokeStyle = css("--ink");
            ctx.lineWidth = 1.5 * devicePixelRatio;
            ctx.beginPath();
            ctx.moveTo(x, u.bbox.top);
            ctx.lineTo(x, u.bbox.top + u.bbox.height);
            ctx.stroke();
            ctx.restore();
          },
        ],
      },
    });
    const bandPlugin = (): uPlot.Plugin => ({
      hooks: {
        drawClear: [
          (u) => {
            const y0 = u.valToPos(this.band[0], "re", true);
            const y1 = u.valToPos(this.band[1], "re", true);
            const ctx = u.ctx;
            ctx.save();
            ctx.fillStyle = css("--chart-band");
            const top = Math.max(u.bbox.top, Math.min(y0, y1));
            const bot = Math.min(u.bbox.top + u.bbox.height, Math.max(y0, y1));
            if (bot > top) ctx.fillRect(u.bbox.left, top, u.bbox.width, bot - top);
            ctx.restore();
          },
        ],
      },
    });

    const make = (spec: ChartSpec, data: uPlot.AlignedData, series: uPlot.Series[], axes: uPlot.Axis[], scales: uPlot.Scales, plugins: uPlot.Plugin[] = []) => {
      const fig = document.createElement("figure");
      fig.className = "chart";
      fig.innerHTML = `<figcaption><span>${spec.title}</span><small>${spec.note}</small></figcaption>`;
      this.host.appendChild(fig);
      this.figures.push(fig);
      const width = Math.max(160, fig.clientWidth - 12);
      const u = new uPlot(
        {
          width,
          height: this.height,
          legend: { show: false },
          cursor: { drag: { x: false, y: false }, points: { show: false } },
          scales: { x: { time: false }, ...scales },
          series: [{}, ...series],
          axes: [xAxis, ...axes],
          plugins: [playheadPlugin(), ...plugins],
        },
        data,
        fig,
      );
      u.over.addEventListener("click", (e) => this.onScrub(u.posToVal(e.offsetX, "x") / 1000));
      this.plots.push(u);
    };

    make(
      specs[0],
      [t, fx, fy],
      [
        { stroke: colA, width: 2, label: "horizontal" },
        { stroke: colB, width: 2, label: "vertical" },
      ],
      [axis()],
      {},
    );
    make(specs[1], [t, seam], [{ stroke: colA, width: 2 }], [axis()], {});
    make(
      specs[2],
      [t, re, cd],
      [
        { stroke: colB, width: 2, scale: "re", label: "Re (k)" },
        { stroke: colA, width: 2, scale: "cd", label: "C_d" },
      ],
      [
        { ...axis("re"), values: (_u, v) => v.map((x) => `${Math.round(x)}k`) },
        { ...axis("cd", 1), grid: { show: false } },
      ],
      {
        re: { range: (_u, lo, hi) => [Math.min(lo, this.band[0]) * 0.95, Math.max(hi, this.band[1]) * 1.05] },
        cd: { range: (_u, lo, hi) => [Math.max(0, lo - 0.05), hi + 0.05] },
      },
      [bandPlugin()],
    );
    make(
      specs[3],
      [t, dx, dy, ...pinSeries] as uPlot.AlignedData,
      [
        { stroke: colA, width: 2, label: "top-down (x)" },
        { stroke: colB, width: 2, label: "side-on (y)" },
        ...pins.map((p) => ({ stroke: `#${p.color.toString(16).padStart(6, "0")}`, width: 1.5, dash: [4, 3] })),
      ],
      [axis()],
      {},
    );
  }
}
