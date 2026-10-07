// The control panel: cards with Basic / Advanced tabs, built from the kit. Unit-bearing
// values convert through the display units; params stay SI. Rebuilt on sport/unit switch.

import type { Params } from "../physics/params";
import { defaultEmpiricalTable } from "../physics/params";
import type { ArrowKey } from "../scene/overlays/forceArrows";
import { ARROW_LABELS } from "../scene/overlays/forceArrows";
import type { Control } from "./kit";
import { button, card, dial, note, readout, seg, slider, toggle } from "./kit";
import type { UnitSystem } from "./units";
import { fromLen, fromSmall, fromSpeed, fromTemp, lenUnit, smallUnit, speedUnit, tempUnit, toLen, toSmall, toSpeed, toTemp } from "./units";
import type { SprayOptions } from "./spray";

export type Theme = "auto" | "light" | "dark";
export type Quality = "auto" | "high" | "low";

export interface Display {
  /** Enlarge the ball in far views so it stays visible (true size up close). */
  autoEnlarge: boolean;
  /** Extra manual multiplier on top. */
  ballScale: number;
  split: boolean;
  pip: boolean;
  theme: Theme;
  quality: Quality;
  arrowScale: number;
  arrows: Record<ArrowKey, boolean>;
}

export interface CardsHost {
  params: Params;
  units: UnitSystem;
  display: Display;
  spray: SprayOptions;
  readouts: { rotations: string; rho: string; reCrit: string };
  changed(kind: "params" | "display"): void;
  setUnits(u: UnitSystem): void;
  setTheme(t: Theme): void;
  setQuality(q: Quality): void;
  pin(): void;
  clearPins(): void;
  runSpray(): void;
  share(): void;
  fillEmpirical(): void;
  resetParams(): void;
}

const r1 = (x: number) => Math.round(x * 10) / 10;

export function buildCards(container: HTMLElement, host: CardsHost) {
  container.innerHTML = "";
  const p = host.params;
  const u = host.units;
  const bb = p.sport === "baseball";
  const changed = () => host.changed("params");
  const side = bb ? "1B" : "R";
  const otherSide = bb ? "3B" : "L";
  const sl = (o: Parameters<typeof slider>[0]) => {
    const c = slider({ ...o, set: (v) => (o.set(v), changed()) });
    return c;
  };

  // ---- Release
  const release = card({
    title: "Release",
    chip: () => `${toSpeed(p.release.speed, u).toFixed(1)} ${speedUnit(u)}`,
    basic: [
      sl({ label: "Speed", unit: speedUnit(u), min: r1(toSpeed(8, u)), max: r1(toSpeed(bb ? 45 : 32, u)), step: 0.1, get: () => toSpeed(p.release.speed, u), set: (v) => (p.release.speed = fromSpeed(v, u)) }),
      sl({ label: "Launch angle (up)", unit: "°", min: -6, max: 30, step: 0.1, get: () => p.release.vAngleDeg, set: (v) => (p.release.vAngleDeg = v) }),
      sl({ label: `Aim (+ toward ${bb ? "1B" : "passer's right"})`, unit: "°", min: -8, max: 8, step: 0.1, get: () => p.release.hAngleDeg, set: (v) => (p.release.hAngleDeg = v) }),
    ],
    advanced: [
      sl({ label: "Release height", unit: lenUnit(u), min: r1(toLen(0.8, u)), max: r1(toLen(3.4, u)), step: 0.01, get: () => toLen(p.release.height, u), set: (v) => (p.release.height = fromLen(v, u)) }),
      sl({
        label: bb ? "Release point (− 3B side, + 1B side)" : "Contact point (− left, + right)",
        unit: smallUnit(u),
        min: r1(toSmall(-1.2, u)),
        max: r1(toSmall(1.2, u)),
        step: 0.1,
        get: () => toSmall(p.release.lateral, u),
        set: (v) => (p.release.lateral = fromSmall(v, u)),
      }),
      ...(bb
        ? [note("A right-handed pitcher releases from the 3B side (negative values).")]
        : [seg({ label: "Net", options: [{ value: 2.43, label: "Men 2.43 m" }, { value: 2.24, label: "Women 2.24 m" }], get: () => p.court.netHeight, set: (v) => ((p.court.netHeight = v), changed()) })]),
    ],
  });

  // ---- Spin
  const spin = card({
    title: "Spin",
    chip: () => host.readouts.rotations,
    basic: [
      sl({ label: "Spin rate", unit: "rev/s", min: 0, max: bb ? 6 : 3, step: 0.01, get: () => p.spin.revPerSec, set: (v) => (p.spin.revPerSec = v), hint: () => `≈ ${host.readouts.rotations} before the ${bb ? "plate" : "floor"}` }),
      dial({
        label: "Spin axis · push seen by the catcher",
        kind: "clock",
        marks: ["up", side, "down", otherSide],
        get: () => p.spin.tiltDeg,
        set: (v) => ((p.spin.tiltDeg = v), changed()),
        format: (d) => (d === 0 ? "0° backspin" : d === 180 ? "180° topspin" : `${Math.round(d)}°`),
      }),
    ],
    advanced: [
      sl({ label: "Gyro (axis along flight)", unit: "°", min: 0, max: 90, step: 1, get: () => p.spin.gyroDeg, set: (v) => (p.spin.gyroDeg = v) }),
      sl({ label: "Spin decay τ (0 = off)", unit: "s", min: 0, max: 5, step: 0.05, get: () => p.spin.decayTau, set: (v) => (p.spin.decayTau = v) }),
    ],
  });

  // ---- Orientation
  const preview = document.createElement("canvas");
  preview.className = "preview";
  preview.id = "orientation-preview";
  preview.title = bb ? "The ball at release, seen from the plate: the face the air meets" : "The ball at contact, seen from the passer";
  const grips = bb
    ? [
        { value: "seamFront" as const, label: "Seam" },
        { value: "lobeFront" as const, label: "Lobe" },
        { value: "symmetric" as const, label: "Symmetric" },
        { value: "maxBreak" as const, label: "Max push" },
      ]
    : [
        { value: "seamFront" as const, label: "Seam" },
        { value: "lobeFront" as const, label: "Panel" },
        { value: "symmetric" as const, label: "Symmetric" },
        { value: "maxBreak" as const, label: "Max push" },
      ];
  const orient = card({
    title: "Orientation",
    basic: [
      seg({ label: bb ? "Facing the plate" : "Facing the passer", options: grips, get: () => p.orientation.grip, set: (v) => ((p.orientation.grip = v), changed()) }),
      preview,
      note(bb ? "Seen from the plate: the face the air meets. Ring = where the air lets go." : "Seen from the passer: the face the air meets."),
    ],
    advanced: [
      sl({ label: "Yaw (about vertical)", unit: "°", min: -180, max: 180, step: 1, get: () => p.orientation.yawDeg, set: (v) => (p.orientation.yawDeg = v) }),
      sl({ label: "Pitch (about 1B–3B axis)", unit: "°", min: -180, max: 180, step: 1, get: () => p.orientation.pitchDeg, set: (v) => (p.orientation.pitchDeg = v) }),
      sl({ label: "Roll (about flight)", unit: "°", min: -180, max: 180, step: 1, get: () => p.orientation.rollDeg, set: (v) => (p.orientation.rollDeg = v) }),
    ],
  });

  // ---- Air
  const air = card({
    title: "Air",
    chip: () => host.readouts.rho,
    basic: [
      sl({ label: "Wind speed", unit: speedUnit(u), min: 0, max: r1(toSpeed(12, u)), step: 0.1, get: () => toSpeed(p.env.windSpeed, u), set: (v) => (p.env.windSpeed = fromSpeed(v, u)) }),
      dial({
        label: "Wind blows toward · seen from above",
        kind: "compass",
        marks: bb ? ["pitcher", "1B", "plate", "3B"] : ["server", "R", "passer", "L"],
        get: () => p.env.windDirDeg,
        set: (v) => ((p.env.windDirDeg = v), changed()),
        format: (d) => {
          const r = Math.round(d) % 360;
          const name = r === 0 ? " tailwind" : r === 180 ? " headwind" : r === 90 ? ` → ${bb ? "1B" : "R"}` : r === 270 ? ` → ${bb ? "3B" : "L"}` : "";
          return `${r}°${name}`;
        },
      }),
    ],
    advanced: [
      sl({ label: "Temperature", unit: tempUnit(u), min: r1(toTemp(-5, u)), max: r1(toTemp(40, u)), step: 0.5, get: () => toTemp(p.env.tempC, u), set: (v) => (p.env.tempC = fromTemp(v, u)) }),
      sl({ label: "Altitude", unit: lenUnit(u), min: 0, max: Math.round(toLen(3000, u)), step: 10, get: () => toLen(p.env.altitudeM, u), set: (v) => (p.env.altitudeM = fromLen(v, u)), digits: 0 }),
      sl({ label: "Humidity", unit: "%", min: 0, max: 100, step: 1, get: () => p.env.humidity * 100, set: (v) => (p.env.humidity = v / 100) }),
      sl({ label: "Gusts (rms)", unit: speedUnit(u), min: 0, max: r1(toSpeed(3, u)), step: 0.05, get: () => toSpeed(p.env.gustIntensity, u), set: (v) => (p.env.gustIntensity = fromSpeed(v, u)) }),
      sl({ label: "Gust time scale", unit: "s", min: 0.1, max: 5, step: 0.05, get: () => p.env.gustTau, set: (v) => (p.env.gustTau = v) }),
      toggle({ label: "Outdoor wind shear", hint: "wind weaker near the ground", get: () => p.env.outdoor, set: (v) => ((p.env.outdoor = v), changed()) }),
      readout("Air density", () => host.readouts.rho),
    ],
  });

  // ---- Ball
  const ball = card({
    title: "Ball",
    basic: [
      sl({ label: bb ? "Seam height" : "Groove depth", unit: "× reg.", min: 0, max: 2, step: 0.01, get: () => p.ball.seamHeight, set: (v) => (p.ball.seamHeight = v) }),
      ...(bb
        ? []
        : [
            seg({
              label: "Panels",
              options: [
                { value: "classic18" as const, label: "18 classic" },
                { value: "cube6" as const, label: "6 cube" },
                { value: "octa8" as const, label: "8 octa" },
              ],
              get: () => p.ball.panelDesign,
              set: (v) => ((p.ball.panelDesign = v), changed()),
            }),
          ]),
    ],
    advanced: [
      sl({ label: "Roughness (moves the drag crisis)", min: 0, max: 1, step: 0.01, get: () => p.ball.roughness, set: (v) => (p.ball.roughness = v) }),
      readout("Critical Reynolds number", () => host.readouts.reCrit),
    ],
  });

  // ---- Model
  const table = document.createElement("textarea");
  table.className = "table-input";
  table.rows = 3;
  table.setAttribute("aria-label", "Empirical C_S table, one value per equal step of seam angle over one turn");
  table.value = p.aero.empiricalTable.join(", ");
  table.addEventListener("change", () => {
    const vals = table.value.split(/[\s,;]+/).map(Number).filter((x) => Number.isFinite(x));
    if (vals.length >= 2) {
      p.aero.empiricalTable = vals;
      changed();
    }
  });
  const tableButtons = document.createElement("div");
  tableButtons.className = "row";
  tableButtons.append(
    button(
      "Fill from geometry",
      () => {
        host.fillEmpirical();
        table.value = p.aero.empiricalTable.join(", ");
      },
      "quiet",
    ),
    button(
      "Reset to sin 2θ",
      () => {
        p.aero.empiricalTable = defaultEmpiricalTable(p.aero.csMax);
        table.value = p.aero.empiricalTable.join(", ");
        changed();
      },
      "quiet",
    ),
  );
  const model = card({
    title: "Experiment with the model",
    basic: [
      seg({
        label: "Side force from",
        options: [
          { value: "geometric" as const, label: "Separation model" },
          { value: "empirical" as const, label: "Empirical curve" },
        ],
        get: () => p.aero.mode,
        set: (v) => ((p.aero.mode = v), changed()),
      }),
      sl({ label: "Peak side-force coefficient C_S,max", min: 0, max: 0.5, step: 0.005, get: () => p.aero.csMax, set: (v) => (p.aero.csMax = v) }),
      toggle({ label: "Unsteady wake noise", hint: "seeded, at the shedding frequency", get: () => p.aero.noise, set: (v) => ((p.aero.noise = v), changed()) }),
      button("Reset everything to defaults", () => host.resetParams(), "quiet"),
    ],
    advanced: [
      sl({ label: "Trip zone starts", unit: "°", min: 10, max: 80, step: 1, get: () => p.aero.tripMinDeg, set: (v) => (p.aero.tripMinDeg = v) }),
      sl({ label: "Trip zone ends", unit: "°", min: 30, max: 100, step: 1, get: () => p.aero.tripMaxDeg, set: (v) => (p.aero.tripMaxDeg = v) }),
      sl({ label: "Laminar separation α", unit: "°", min: 70, max: 100, step: 0.5, get: () => p.aero.alphaLamDeg, set: (v) => (p.aero.alphaLamDeg = v) }),
      sl({ label: "Turbulent separation α", unit: "°", min: 95, max: 140, step: 0.5, get: () => p.aero.alphaTurbDeg, set: (v) => (p.aero.alphaTurbDeg = v) }),
      sl({ label: "Pin band ±", unit: "°", min: 0, max: 15, step: 0.5, get: () => p.aero.pinDeltaDeg, set: (v) => (p.aero.pinDeltaDeg = v) }),
      sl({ label: "Sectors N_φ", min: 12, max: 72, step: 2, get: () => p.aero.nPhi, set: (v) => (p.aero.nPhi = v) }),
      sl({ label: "Magnus slope k_M", min: 0, max: 3, step: 0.05, get: () => p.aero.kMagnus, set: (v) => (p.aero.kMagnus = v) }),
      sl({ label: "C_d ← separation", min: 0, max: 1, step: 0.05, get: () => p.aero.cdModulation, set: (v) => (p.aero.cdModulation = v) }),
      sl({ label: "Noise C_N rms", min: 0, max: 0.2, step: 0.005, get: () => p.aero.noiseIntensity, set: (v) => (p.aero.noiseIntensity = v) }),
      sl({ label: "Seed", min: 1, max: 999, step: 1, get: () => p.aero.seed, set: (v) => (p.aero.seed = v) }),
      note("Empirical C_S table, one value per equal step of seam angle over one turn:"),
      table,
      tableButtons,
    ],
  });

  // ---- Compare & share
  const actions = document.createElement("div");
  actions.className = "row";
  actions.append(button("Pin this run (P)", () => host.pin()), button("Clear pins", () => host.clearPins(), "quiet"));
  const sprayRow = document.createElement("div");
  sprayRow.className = "row";
  sprayRow.append(button("Run spray", () => host.runSpray()), button("Copy share link", () => host.share(), "quiet"));
  const compare = card({
    title: "Compare & share",
    basic: [actions, note("Spray throws many balls with small differences and plots where they arrive."), sprayRow],
    advanced: [
      slider({ label: "Spray runs", min: 10, max: 200, step: 1, get: () => host.spray.n, set: (v) => (host.spray.n = v) }),
      seg({
        label: "Spray varies",
        options: [
          { value: "orientation" as const, label: "Orientation" },
          { value: "noise" as const, label: "Wake noise" },
        ],
        get: () => host.spray.mode,
        set: (v) => (host.spray.mode = v),
      }),
      slider({ label: "Orientation ±", unit: "°", min: 1, max: 45, step: 1, get: () => host.spray.toleranceDeg, set: (v) => (host.spray.toleranceDeg = v) }),
    ],
  });

  // ---- Display
  const d = host.display;
  const dv = () => host.changed("display");
  const display = card({
    title: "Display",
    basic: [
      seg({ label: "Units", options: [{ value: "imperial" as const, label: "mph · ft · in" }, { value: "metric" as const, label: "m/s · m · cm" }], get: () => u, set: (v) => host.setUnits(v) }),
      seg({ label: "Theme", options: [{ value: "auto" as const, label: "Auto" }, { value: "light" as const, label: "Light" }, { value: "dark" as const, label: "Dark" }], get: () => d.theme, set: (v) => host.setTheme(v) }),
      seg({
        label: "Graphics",
        options: [
          { value: "auto" as const, label: "Auto", title: "Drops to Low if the frame rate falls under ~30 fps" },
          { value: "high" as const, label: "High" },
          { value: "low" as const, label: "Low" },
        ],
        get: () => d.quality,
        set: (v) => host.setQuality(v),
      }),
      toggle({ label: "Close-up of the ball (picture-in-picture)", get: () => d.pip, set: (v) => ((d.pip = v), dv()) }),
      toggle({ label: "Split screen with the flow lab", get: () => d.split, set: (v) => ((d.split = v), dv()) }),
      toggle({ label: "Enlarge the ball in far views", hint: "true size up close", get: () => d.autoEnlarge, set: (v) => ((d.autoEnlarge = v), dv()) }),
    ],
    advanced: [
      slider({ label: "Extra ball size", unit: "×", min: 1, max: 6, step: 0.5, get: () => d.ballScale, set: (v) => ((d.ballScale = v), dv()) }),
      slider({ label: "Arrow length", unit: "×", min: 0.2, max: 6, step: 0.1, get: () => d.arrowScale, set: (v) => ((d.arrowScale = v), dv()) }),
      note("Force arrows to draw:"),
      ...(Object.keys(ARROW_LABELS) as ArrowKey[]).map((k) => toggle({ label: ARROW_LABELS[k], get: () => d.arrows[k], set: (v) => ((d.arrows[k] = v), dv()) })),
    ],
  });

  const cards = [release, spin, orient, air, ball, model, compare, display];
  for (const c of cards) container.append(c.el);
  const all: Control[] = cards;
  return {
    preview,
    refresh: () => all.forEach((c) => c.refresh()),
    refreshChips: () => cards.forEach((c) => c.setChip()),
  };
}
