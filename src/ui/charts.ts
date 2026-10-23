// One featured uPlot chart in the drawer, with tabs to switch between the four views of
// the flight. Synced to the playhead; hovering shows values; clicking scrubs.
//  side   — side force (horizontal: + toward 1B / passer's right; vertical: + up)
//  seam   — seam angle (rotation about the spin axis)
//  re     — Re and C_d, with the drag-crisis band shaded
//  gap    — displacement from the ghost path (top-down and side-on), plus pinned runs

import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import type { FlightRecord } from "../physics/simulate";
import { crisisBand } from "../physics/aero/dragCurve";
import type { UnitSystem } from "./units";
import { smallUnit, toSmall } from "./units";
import { tip } from "./tip";

const STRIDE = 2;
export type ChartId = "side" | "seam" | "re" | "gap";

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888";
const hex = (c: number) => `#${c.toString(16).padStart(6, "0")}`;

/** One line (or band) in the key: hover or focus it for what it shows and what it means. */
interface LegendItem {
  /** CSS color of the line. */
  color: string;
  dashed?: boolean;
  /** A shaded band rather than a line. */
  band?: boolean;
  label: string;
  title: string;
  body: string;
}

interface Built {
  data: uPlot.AlignedData;
  series: uPlot.Series[];
  axes: uPlot.Axis[];
  scales: uPlot.Scales;
  plugins: uPlot.Plugin[];
  legend: LegendItem[];
  read: (i: number) => string;
}

/** What each tab plots, for the tab tooltips. */
const TAB_TIPS: Record<ChartId, { title: string; body: string }> = {
  side: {
    title: "Side forces",
    body: "The push the air puts on the ball other than drag, over the flight. This is what makes it move off a straight line. Hover a line in the key for what it means.",
  },
  seam: {
    title: "Seam angle",
    body: "How far the ball has turned since release. A knuckleball turns only a fraction of a rotation, so its seams (or panel grooves) sit in a few positions, and each one pushes differently.",
  },
  re: {
    title: "Re & drag",
    body: "The Reynolds number (how fast the air is relative to the ball's size) and the drag coefficient. In the shaded drag-crisis band the boundary layer can go either way, and that is where low-spin balls dance most.",
  },
  gap: {
    title: "Break vs ghost",
    body: "How far the ball has moved away from the ghost: the same throw with the seam (or panel) force switched off. This is the break the seams caused.",
  },
};

export class Charts {
  private plot: uPlot | null = null;
  private playhead = 0;
  private band: [number, number] = [0, 0];
  private active: ChartId = "side";
  private height = 150;
  private last: { rec: FlightRecord; ghost: FlightRecord; pins: { rec: FlightRecord; color: number; label: string }[]; units: UnitSystem } | null = null;
  private body: HTMLElement;
  /** Theme colors, read once per render (reading CSS in draw hooks is slow). */
  private col = { accent: "#f08a24", ink2: "#888", band: "rgba(0,0,0,0.1)" };
  private readoutEl: HTMLElement;
  private keyEl: HTMLElement;

  constructor(
    private host: HTMLElement,
    private onScrub: (t: number) => void,
  ) {
    host.innerHTML = `<div class="chart-tabs" role="tablist">
        <button type="button" role="tab" data-chart="side">Side forces</button>
        <button type="button" role="tab" data-chart="seam">Seam angle</button>
        <button type="button" role="tab" data-chart="re">Re &amp; drag</button>
        <button type="button" role="tab" data-chart="gap">Break vs ghost</button>
        <span class="chart-key" aria-label="What the lines show"></span><span class="chart-readout" aria-live="polite"></span>
      </div><div class="chart-body"></div>`;
    this.body = host.querySelector(".chart-body")!;
    this.readoutEl = host.querySelector(".chart-readout")!;
    this.keyEl = host.querySelector(".chart-key")!;
    host.querySelectorAll<HTMLButtonElement>("[data-chart]").forEach((b) => {
      b.addEventListener("click", () => {
        this.active = b.dataset.chart as ChartId;
        this.render();
      });
      tip(b, TAB_TIPS[b.dataset.chart as ChartId]);
    });
    new ResizeObserver(() => {
      const w = this.body.clientWidth;
      if (this.plot && w > 50) this.plot.setSize({ width: w, height: this.height });
    }).observe(this.body);
  }

  /** Switch to one of the charts (the tour uses it). */
  select(id: ChartId) {
    this.active = id;
    this.render();
  }

  setCompact(compact: boolean) {
    const h = compact ? 110 : 150;
    if (h === this.height) return;
    this.height = h;
    this.render();
  }

  setPlayhead(t: number) {
    this.playhead = t * 1000;
    this.plot?.redraw(false, false);
  }

  build(rec: FlightRecord, ghost: FlightRecord, pins: { rec: FlightRecord; color: number; label: string }[], units: UnitSystem) {
    this.last = { rec, ghost, pins, units };
    this.render();
  }

  /** Re-read theme colors. */
  restyle() {
    this.render();
  }

  private render() {
    if (!this.last) return;
    for (const b of this.host.querySelectorAll<HTMLButtonElement>("[data-chart]")) b.setAttribute("aria-selected", String(b.dataset.chart === this.active));
    this.plot?.destroy();
    this.plot = null;
    this.body.innerHTML = "";
    this.col = { accent: css("--accent"), ink2: css("--ink-2"), band: css("--chart-band") };
    const built = this.make(this.active);
    this.renderKey(built.legend);
    const ink = css("--ink-2");
    const grid = css("--line");
    const width = Math.max(200, this.body.clientWidth);
    const u = new uPlot(
      {
        width,
        height: this.height,
        legend: { show: false },
        cursor: { drag: { x: false, y: false }, points: { size: 6 } },
        scales: { x: { time: false }, ...built.scales },
        series: [{}, ...built.series],
        axes: [
          { stroke: ink, grid: { stroke: grid, width: 1 }, ticks: { stroke: grid, width: 1, size: 3 }, size: 24, font: "10px IBM Plex Mono, monospace", values: (_u, v) => v.map((x) => `${Math.round(x)} ms`) },
          ...built.axes.map((a) => ({ stroke: ink, grid: { stroke: grid, width: 1 }, ticks: { stroke: grid, width: 1, size: 3 }, size: 44, font: "10px IBM Plex Mono, monospace", ...a })),
        ],
        hooks: {
          setCursor: [
            (p) => {
              const i = p.cursor.idx;
              this.readoutEl.textContent = i == null ? "" : built.read(i);
            },
          ],
        },
        plugins: [this.playheadPlugin(), ...built.plugins],
      },
      built.data,
      this.body,
    );
    u.over.addEventListener("click", (e) => this.onScrub(u.posToVal(e.offsetX, "x") / 1000));
    this.plot = u;
  }

  /** The key: a swatch and a short name per line, each with a tooltip. */
  private renderKey(items: LegendItem[]) {
    this.keyEl.replaceChildren();
    for (const it of items) {
      const el = document.createElement("span");
      el.className = "chart-key__item";
      el.tabIndex = 0;
      const sw = document.createElement("i");
      sw.className = it.band ? "chart-key__band" : it.dashed ? "chart-key__line chart-key__line--dashed" : "chart-key__line";
      sw.style.setProperty("--c", it.color);
      el.append(sw, it.label);
      const swatch = it.band ? it.color : it.dashed ? `repeating-linear-gradient(90deg, ${it.color} 0 5px, transparent 5px 8px)` : it.color;
      tip(el, { title: it.title, body: it.body, key: [{ swatch, label: it.label }] });
      this.keyEl.append(el);
    }
  }

  private playheadPlugin(): uPlot.Plugin {
    return {
      hooks: {
        draw: [
          (u) => {
            const x = u.valToPos(this.playhead, "x", true);
            const ctx = u.ctx;
            ctx.save();
            ctx.strokeStyle = this.col.accent;
            ctx.lineWidth = 2 * devicePixelRatio;
            ctx.beginPath();
            ctx.moveTo(x, u.bbox.top);
            ctx.lineTo(x, u.bbox.top + u.bbox.height);
            ctx.stroke();
            ctx.restore();
          },
        ],
      },
    };
  }

  private make(id: ChartId): Built {
    const { rec, ghost, pins, units } = this.last!;
    const n = Math.ceil(rec.n / STRIDE);
    const idx = (k: number) => Math.min(k * STRIDE, rec.n - 1);
    const t = Float64Array.from({ length: n }, (_, k) => rec.t[idx(k)] * 1000);
    const col = (f: (i: number) => number) => Float64Array.from({ length: n }, (_, k) => f(idx(k)));
    const colA = css("--chart-a");
    const colB = css("--chart-b");
    const side = rec.params.sport === "baseball" ? "1B" : "passer's R";
    const su = smallUnit(units);
    const ms = (k: number) => `${t[k].toFixed(0)} ms`;
    const zero: uPlot.Plugin = {
      hooks: {
        drawClear: [
          (u) => {
            const y = u.valToPos(0, "y", true);
            if (y < u.bbox.top || y > u.bbox.top + u.bbox.height) return;
            const ctx = u.ctx;
            ctx.save();
            ctx.strokeStyle = this.col.ink2;
            ctx.globalAlpha = 0.5;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(u.bbox.left, y);
            ctx.lineTo(u.bbox.left + u.bbox.width, y);
            ctx.stroke();
            ctx.restore();
          },
        ],
      },
    };
    if (id === "side") {
      const fx = col((i) => rec.fSeam[3 * i]);
      const fy = col((i) => rec.fSeam[3 * i + 1]);
      // Spin pitches: the Magnus force is what moves them, so plot it too (purple).
      let peakSeam = 0;
      let peakMag = 0;
      for (let i = 0; i < rec.n; i++) {
        peakSeam = Math.max(peakSeam, Math.hypot(rec.fSeam[3 * i], rec.fSeam[3 * i + 1]));
        peakMag = Math.max(peakMag, Math.hypot(rec.fMagnus[3 * i], rec.fMagnus[3 * i + 1]));
      }
      const withMagnus = peakMag > 0.5 * peakSeam && peakMag > 0.05;
      const mx = col((i) => rec.fMagnus[3 * i]);
      const my = col((i) => rec.fMagnus[3 * i + 1]);
      const purple = "#9b6be0";
      return {
        data: withMagnus ? [t, fx, fy, mx, my] : [t, fx, fy],
        series: [
          { stroke: colA, width: 2.5, fill: withMagnus ? undefined : `${colA}22` },
          { stroke: colB, width: 2 },
          ...(withMagnus ? [{ stroke: purple, width: 2.5 }, { stroke: purple, width: 2, dash: [6, 4] }] : []),
        ],
        axes: [{ values: (_u, v) => v.map((x) => `${x.toFixed(2)} N`) }],
        scales: {},
        plugins: [zero],
        legend: [
          {
            color: colA,
            label: "Seam, sideways",
            title: `Seam force, sideways (+ toward ${side})`,
            body: `The sideways push from the seams (or panel grooves) tripping the air on one side. Above zero it pushes toward ${side}, below zero the other way. When it crosses zero the push has flipped sides: the knuckleball's change of direction.`,
          },
          {
            color: colB,
            label: "Seam, vertical",
            title: "Seam force, vertical (+ up)",
            body: "The up/down part of the same seam push. Above zero it holds the ball up; below zero it pulls it down on top of gravity.",
          },
          ...(withMagnus
            ? [
                {
                  color: purple,
                  label: "Magnus, sideways",
                  title: `Magnus force, sideways (+ toward ${side})`,
                  body: "The push from spin: the spinning ball drags air round with it and is pushed toward the side where the surface moves with the air. For an ordinary spin pitch this, not the seams, is what makes it break.",
                },
                {
                  color: purple,
                  dashed: true,
                  label: "Magnus, vertical",
                  title: "Magnus force, vertical (+ up)",
                  body: "The up/down part of the spin push. Backspin lifts (a fastball 'rises'); topspin pushes down (a curveball drops).",
                },
              ]
            : []),
        ],
        read: (k) =>
          `${ms(k)} · seam ${fx[k].toFixed(3)} / ${fy[k].toFixed(3)} N` + (withMagnus ? ` · Magnus ${mx[k].toFixed(2)} / ${my[k].toFixed(2)} N` : ""),
      };
    }
    if (id === "seam") {
      const a = col((i) => rec.seamAngle[i]);
      return {
        data: [t, a],
        series: [{ stroke: colA, width: 2.5 }],
        axes: [{ values: (_u, v) => v.map((x) => `${Math.round(x)}°`) }],
        scales: {},
        plugins: [],
        legend: [
          {
            color: colA,
            label: "Seam angle",
            title: "Seam angle",
            body: "Degrees the ball has turned about its spin axis since release (360° is one full turn). A slow, steady climb is a knuckleball; the steeper it climbs, the more the seam pushes average out and the less it dances.",
          },
        ],
        read: (k) => `${ms(k)} · ${a[k].toFixed(0)}° (${(a[k] / 360).toFixed(2)} turns)`,
      };
    }
    if (id === "re") {
      const [b0, b1] = crisisBand(rec.reCrit);
      this.band = [b0 / 1000, b1 / 1000];
      const re = col((i) => rec.re[i] / 1000);
      const cd = col((i) => rec.cd[i]);
      const band: uPlot.Plugin = {
        hooks: {
          drawClear: [
            (u) => {
              const y0 = u.valToPos(this.band[0], "re", true);
              const y1 = u.valToPos(this.band[1], "re", true);
              const ctx = u.ctx;
              ctx.save();
              ctx.fillStyle = this.col.band;
              const top = Math.max(u.bbox.top, Math.min(y0, y1));
              const bot = Math.min(u.bbox.top + u.bbox.height, Math.max(y0, y1));
              if (bot > top) ctx.fillRect(u.bbox.left, top, u.bbox.width, bot - top);
              ctx.restore();
            },
          ],
        },
      };
      return {
        data: [t, re, cd],
        series: [
          { stroke: colB, width: 2.5, scale: "re" },
          { stroke: colA, width: 2, scale: "cd" },
        ],
        axes: [
          { scale: "re", values: (_u, v) => v.map((x) => `${Math.round(x)}k`) },
          { scale: "cd", side: 1, grid: { show: false }, values: (_u, v) => v.map((x) => x.toFixed(2)) },
        ],
        scales: {
          re: { range: (_u, lo, hi) => [Math.min(lo, this.band[0]) * 0.95, Math.max(hi, this.band[1]) * 1.05] },
          cd: { range: (_u, lo, hi) => [Math.max(0, lo - 0.05), hi + 0.05] },
        },
        plugins: [band],
        legend: [
          {
            color: colB,
            label: "Reynolds number",
            title: "Reynolds number (left axis, thousands)",
            body: "Air speed × ball size ÷ the air's viscosity: how 'fast' the flow is for this ball. It falls as drag slows the ball down. Where it sits decides whether the air over the ball stays smooth (laminar) or turns turbulent.",
          },
          {
            color: colA,
            label: "Drag coefficient",
            title: "Drag coefficient, C_d (right axis)",
            body: "How hard the air pulls back on the ball for its speed. It drops sharply in the drag crisis, where the turbulent air clings longer and the wake gets narrower.",
          },
          {
            color: this.col.band,
            band: true,
            label: "Drag crisis",
            title: "The drag-crisis band",
            body: "The range of Reynolds numbers where the boundary layer can be laminar on one side and turbulent on the other. A seam or groove can tip either side, so this is where low-spin balls get the biggest, least predictable pushes.",
          },
        ],
        read: (k) => `${ms(k)} · Re ${re[k].toFixed(0)}k · C_d ${cd[k].toFixed(3)}`,
      };
    }
    const dx = col((i) => toSmall(rec.r[3 * i] - ghost.r[3 * Math.min(i, ghost.n - 1)], units));
    const dy = col((i) => toSmall(rec.r[3 * i + 1] - ghost.r[3 * Math.min(i, ghost.n - 1) + 1], units));
    const pinSeries = pins.map(({ rec: pr }) =>
      Array.from({ length: n }, (_, k) => {
        const i = k * STRIDE;
        return i >= pr.n ? null : toSmall(pr.r[3 * i] - ghost.r[3 * Math.min(i, ghost.n - 1)], units);
      }),
    );
    return {
      data: [t, dx, dy, ...pinSeries] as uPlot.AlignedData,
      series: [
        { stroke: colA, width: 2.5, fill: `${colA}22` },
        { stroke: colB, width: 2 },
        ...pins.map((p) => ({ stroke: hex(p.color), width: 1.8, dash: [5, 4] })),
      ],
      axes: [{ values: (_u, v) => v.map((x) => `${x.toFixed(1)} ${su}`) }],
      scales: {},
      plugins: [zero],
      legend: [
        {
          color: colA,
          label: "Sideways",
          title: `Sideways break (+ toward ${side})`,
          body: `How far the ball has moved sideways from the ghost (the same throw with no seam force). Its value at the end is the break the seams caused. Above zero is toward ${side}.`,
        },
        {
          color: colB,
          label: "Up/down",
          title: "Vertical break (+ up)",
          body: "How far the ball is above (+) or below (−) the ghost at each moment.",
        },
        ...pins.map((p) => ({
          color: hex(p.color),
          dashed: true,
          label: p.label,
          title: `Pinned run: ${p.label}`,
          body: "The sideways break of a run you pinned (press P), against the current ghost, for comparison.",
        })),
      ],
      read: (k) => `${ms(k)} · sideways ${dx[k].toFixed(1)} ${su} · vertical ${dy[k].toFixed(1)} ${su}`,
    };
  }
}
