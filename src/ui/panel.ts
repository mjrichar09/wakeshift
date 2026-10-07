// Controls panel (Tweakpane). Unit-bearing values are bound through getter/setter proxies
// so the sliders show mph/ft/in or m/s/m while params stay SI. Rebuilt on sport/unit switch.

import { Pane } from "tweakpane";
import type { FolderApi } from "tweakpane";
import type { Params } from "../physics/params";
import { defaultEmpiricalTable } from "../physics/params";
import type { OverlayFlags } from "../scene/ballRig";
import { ARROW_LABELS } from "../scene/overlays/forceArrows";
import type { ArrowKey } from "../scene/overlays/forceArrows";
import type { UnitSystem } from "./units";
import { fromLen, fromSmall, fromSpeed, fromTemp, lenUnit, smallUnit, speedUnit, tempUnit, toLen, toSmall, toSpeed, toTemp } from "./units";
import { presetsFor } from "./presets";
import type { SprayOptions } from "./spray";

export interface Display {
  ballScale: number;
  split: boolean;
}

export interface PanelHost {
  params: Params;
  units: UnitSystem;
  overlays: OverlayFlags;
  display: Display;
  spray: SprayOptions;
  presetId: string;
  readouts: { rotations: string; rho: string; reCrit: string; blurb: string };
  changed(kind: "params" | "overlays" | "display"): void;
  preset(id: string): void;
  setUnits(u: UnitSystem): void;
  pin(): void;
  clearPins(): void;
  runSpray(): void;
  share(): void;
  fillEmpirical(): void;
  resetParams(): void;
}

const r1 = (x: number) => Math.round(x * 10) / 10;

export function buildPanel(container: HTMLElement, host: PanelHost) {
  container.innerHTML = "";
  const pane = new Pane({ container, title: "Controls" });
  const p = host.params;
  const u = host.units;
  const bb = p.sport === "baseball";
  const changed = () => host.changed("params");

  // --- Presets ---
  const fPre = pane.addFolder({ title: "Presets" });
  const presetObj = { id: host.presetId };
  const opts: Record<string, string> = { "(custom)": "custom" };
  for (const pr of presetsFor(p.sport)) opts[pr.label] = pr.id;
  fPre.addBinding(presetObj, "id", { label: "preset", options: opts }).on("change", (ev) => {
    if (ev.value !== "custom") host.preset(ev.value as string);
  });
  const blurb = note(fPre, host.readouts.blurb);
  fPre.addButton({ title: "Reset to sport defaults" }).on("click", () => host.resetParams());

  // --- Release ---
  const fRel = pane.addFolder({ title: "Release" });
  const rel = {
    get speed() {
      return r1(toSpeed(p.release.speed, u));
    },
    set speed(v: number) {
      p.release.speed = fromSpeed(v, u);
    },
    get height() {
      return Math.round(toLen(p.release.height, u) * 100) / 100;
    },
    set height(v: number) {
      p.release.height = fromLen(v, u);
    },
    get lateral() {
      return r1(toSmall(p.release.lateral, u));
    },
    set lateral(v: number) {
      p.release.lateral = fromSmall(v, u);
    },
  };
  const sMax = bb ? toSpeed(45, u) : toSpeed(32, u);
  fRel.addBinding(rel, "speed", { label: `speed (${speedUnit(u)})`, min: r1(toSpeed(8, u)), max: r1(sMax), step: 0.1 }).on("change", changed);
  fRel.addBinding(p.release, "vAngleDeg", { label: "up angle (°)", min: -6, max: 30, step: 0.1 }).on("change", changed);
  fRel.addBinding(p.release, "hAngleDeg", { label: bb ? "aim → 1B (°)" : "aim → R (°)", min: -8, max: 8, step: 0.1 }).on("change", changed);
  fRel.addBinding(rel, "height", { label: `height (${lenUnit(u)})`, min: Math.round(toLen(0.8, u) * 10) / 10, max: Math.round(toLen(3.4, u) * 10) / 10, step: 0.01 }).on("change", changed);
  fRel.addBinding(rel, "lateral", {
    label: bb ? `x (${smallUnit(u)}) −3B / +1B` : `x (${smallUnit(u)}) −L / +R`,
    min: r1(toSmall(-1.2, u)),
    max: r1(toSmall(1.2, u)),
    step: 0.1,
  }).on("change", changed);
  if (!bb)
    fRel.addBinding(p.court, "netHeight", { label: "net", options: { "men 2.43 m": 2.43, "women 2.24 m": 2.24 } }).on("change", changed);

  // --- Spin ---
  const fSpin = pane.addFolder({ title: "Spin" });
  fSpin.addBinding(p.spin, "revPerSec", { label: "rate (rev/s)", min: 0, max: bb ? 6 : 3, step: 0.01 }).on("change", changed);
  fSpin.addBinding(host.readouts, "rotations", { label: bb ? "≈ turns to plate" : "≈ turns to court", readonly: true, interval: 200 });
  fSpin.addBinding(p.spin, "tiltDeg", { label: "axis tilt (clock°)", min: 0, max: 360, step: 1 }).on("change", changed);
  fSpin.addBinding(p.spin, "gyroDeg", { label: "gyro (°)", min: 0, max: 90, step: 1 }).on("change", changed);
  fSpin.addBinding(p.spin, "decayTau", { label: "decay τ (s, 0=off)", min: 0, max: 5, step: 0.05 }).on("change", changed);
  note(fSpin, "Tilt is a clock face seen by the catcher/passer: 0° backspin (Magnus up), 90° Magnus toward " + (bb ? "1B" : "the passer's right") + ".");

  // --- Orientation ---
  const fOri = pane.addFolder({ title: "Orientation at release" });
  fOri
    .addBinding(p.orientation, "grip", {
      label: "grip",
      options: bb
        ? { "seam facing plate": "seamFront", "lobe facing plate": "lobeFront", "symmetric (no force)": "symmetric", "max break → 1B": "maxBreak" }
        : { "seam facing passer": "seamFront", "panel facing passer": "lobeFront", "symmetric": "symmetric", "max float → R": "maxBreak" },
    })
    .on("change", changed);
  fOri.addBinding(p.orientation, "yawDeg", { label: "yaw (°)", min: -180, max: 180, step: 1 }).on("change", changed);
  fOri.addBinding(p.orientation, "pitchDeg", { label: "pitch (°)", min: -180, max: 180, step: 1 }).on("change", changed);
  fOri.addBinding(p.orientation, "rollDeg", { label: "roll (°)", min: -180, max: 180, step: 1 }).on("change", changed);
  const preview = document.createElement("canvas");
  preview.className = "preview";
  preview.id = "orientation-preview";
  preview.title = bb ? "The ball at release, seen from the plate (the front the air meets)" : "The ball at contact, seen from the passer";
  fOri.element.querySelector(".tp-fldv_c")?.appendChild(preview);

  // --- Ball ---
  const fBall = pane.addFolder({ title: "Ball", expanded: false });
  fBall.addBinding(p.ball, "seamHeight", { label: bb ? "seam height (×)" : "groove depth (×)", min: 0, max: 2, step: 0.01 }).on("change", changed);
  fBall.addBinding(p.ball, "roughness", { label: "roughness", min: 0, max: 1, step: 0.01 }).on("change", changed);
  fBall.addBinding(host.readouts, "reCrit", { label: "critical Re", readonly: true, interval: 300 });
  if (!bb)
    fBall.addBinding(p.ball, "panelDesign", { label: "panels", options: { "18-panel classic": "classic18", "6-panel cube": "cube6", "8-panel octa": "octa8" } }).on("change", changed);

  // --- Environment ---
  const fEnv = pane.addFolder({ title: "Environment", expanded: false });
  const env = {
    get temp() {
      return r1(toTemp(p.env.tempC, u));
    },
    set temp(v: number) {
      p.env.tempC = fromTemp(v, u);
    },
    get alt() {
      return Math.round(toLen(p.env.altitudeM, u));
    },
    set alt(v: number) {
      p.env.altitudeM = fromLen(v, u);
    },
    get wind() {
      return r1(toSpeed(p.env.windSpeed, u));
    },
    set wind(v: number) {
      p.env.windSpeed = fromSpeed(v, u);
    },
    get gust() {
      return r1(toSpeed(p.env.gustIntensity, u));
    },
    set gust(v: number) {
      p.env.gustIntensity = fromSpeed(v, u);
    },
    get humidity() {
      return Math.round(p.env.humidity * 100);
    },
    set humidity(v: number) {
      p.env.humidity = v / 100;
    },
  };
  fEnv.addBinding(env, "temp", { label: `temperature (${tempUnit(u)})`, min: r1(toTemp(-5, u)), max: r1(toTemp(40, u)), step: 0.5 }).on("change", changed);
  fEnv.addBinding(env, "alt", { label: `altitude (${lenUnit(u)})`, min: 0, max: Math.round(toLen(3000, u)), step: 10 }).on("change", changed);
  fEnv.addBinding(env, "humidity", { label: "humidity (%)", min: 0, max: 100, step: 1 }).on("change", changed);
  fEnv.addBinding(host.readouts, "rho", { label: "air density", readonly: true, interval: 300 });
  fEnv.addBinding(env, "wind", { label: `wind (${speedUnit(u)})`, min: 0, max: r1(toSpeed(12, u)), step: 0.1 }).on("change", changed);
  fEnv.addBinding(p.env, "windDirDeg", { label: bb ? "blows toward (°)" : "blows toward (°)", min: 0, max: 360, step: 1 }).on("change", changed);
  note(fEnv, `Wind direction is where it blows TO: 0° with the flight (tailwind), 90° toward ${bb ? "1B" : "the passer's right"}, 180° headwind.`);
  fEnv.addBinding(env, "gust", { label: `gusts (${speedUnit(u)} rms)`, min: 0, max: r1(toSpeed(3, u)), step: 0.05 }).on("change", changed);
  fEnv.addBinding(p.env, "gustTau", { label: "gust time scale (s)", min: 0.1, max: 5, step: 0.05 }).on("change", changed);
  fEnv.addBinding(p.env, "outdoor", { label: "outdoor (wind shear)" }).on("change", changed);

  // --- Aero model ---
  const fAero = pane.addFolder({ title: "Aero model", expanded: false });
  fAero.addBinding(p.aero, "mode", { label: "side force", options: { "geometric (separation)": "geometric", "empirical curve": "empirical" } }).on("change", changed);
  fAero.addBinding(p.aero, "csMax", { label: "C_S,max", min: 0, max: 0.5, step: 0.005 }).on("change", changed);
  fAero.addBinding(p.aero, "tripMinDeg", { label: "trip zone from (°)", min: 10, max: 80, step: 1 }).on("change", changed);
  fAero.addBinding(p.aero, "tripMaxDeg", { label: "trip zone to (°)", min: 30, max: 100, step: 1 }).on("change", changed);
  fAero.addBinding(p.aero, "alphaLamDeg", { label: "α laminar (°)", min: 70, max: 100, step: 0.5 }).on("change", changed);
  fAero.addBinding(p.aero, "alphaTurbDeg", { label: "α turbulent (°)", min: 95, max: 140, step: 0.5 }).on("change", changed);
  fAero.addBinding(p.aero, "pinDeltaDeg", { label: "pin band ± (°)", min: 0, max: 15, step: 0.5 }).on("change", changed);
  fAero.addBinding(p.aero, "nPhi", { label: "sectors N_φ", min: 12, max: 72, step: 2 }).on("change", changed);
  fAero.addBinding(p.aero, "kMagnus", { label: "Magnus k_M", min: 0, max: 3, step: 0.05 }).on("change", changed);
  fAero.addBinding(p.aero, "cdModulation", { label: "C_d ← separation", min: 0, max: 1, step: 0.05 }).on("change", changed);
  fAero.addBinding(p.aero, "noise", { label: "wake noise" }).on("change", changed);
  fAero.addBinding(p.aero, "noiseIntensity", { label: "noise C_N rms", min: 0, max: 0.2, step: 0.005 }).on("change", changed);
  fAero.addBinding(p.aero, "seed", { label: "seed", min: 1, max: 999, step: 1 }).on("change", changed);
  const table = { text: p.aero.empiricalTable.join(", ") };
  fAero
    .addBinding(table, "text", { label: "C_S table (per turn)", multiline: true, rows: 3 } as never)
    .on("change", (ev) => {
      const vals = String(ev.value)
        .split(/[\s,;]+/)
        .map(Number)
        .filter((x) => Number.isFinite(x));
      if (vals.length >= 2) {
        p.aero.empiricalTable = vals;
        changed();
      }
    });
  fAero.addButton({ title: "Table: fill from geometric model" }).on("click", () => {
    host.fillEmpirical();
    table.text = p.aero.empiricalTable.join(", ");
    pane.refresh();
  });
  fAero.addButton({ title: "Table: reset to sin 2θ" }).on("click", () => {
    p.aero.empiricalTable = defaultEmpiricalTable(p.aero.csMax);
    table.text = p.aero.empiricalTable.join(", ");
    pane.refresh();
    changed();
  });

  // --- Overlays & display ---
  const fOv = pane.addFolder({ title: "Overlays", expanded: false });
  const o = host.overlays;
  const ov = () => host.changed("overlays");
  for (const k of Object.keys(ARROW_LABELS) as ArrowKey[]) fOv.addBinding(o.arrows, k, { label: ARROW_LABELS[k] }).on("change", ov);
  fOv.addBinding(o, "arrowScale", { label: "arrow scale", min: 0.2, max: 6, step: 0.1 }).on("change", ov);
  fOv.addBinding(o, "ring", { label: "separation ring" }).on("change", ov);
  fOv.addBinding(o, "tripBand", { label: "trip-zone band" }).on("change", ov);
  fOv.addBinding(o, "pressure", { label: "surface pressure" }).on("change", ov);
  fOv.addBinding(o, "streamlines", { label: "streamlines (flow lab)" }).on("change", ov);
  fOv.addBinding(o, "wake", { label: "wake" }).on("change", ov);
  fOv.addBinding(o, "smoke", { label: "smoke particles (flow lab)" }).on("change", ov);
  fOv.addBinding(o, "flowAnimation", { label: "animate flow" }).on("change", ov);
  fOv.addBinding(o, "trail", { label: "trail" }).on("change", ov);
  fOv.addBinding(o, "ghost", { label: "ghost path (no seam force)" }).on("change", ov);
  if (bb) fOv.addBinding(o, "strikeZone", { label: "strike zone" }).on("change", ov);
  fOv.addBinding(o, "figures", { label: "figures" }).on("change", ov);
  const dv = () => host.changed("display");
  fOv.addBinding(host.display, "ballScale", { label: "ball display size (×)", min: 1, max: 8, step: 0.5 }).on("change", dv);
  fOv.addBinding(host.display, "split", { label: "split screen + flow lab" }).on("change", dv);
  const unitObj = { units: u };
  fOv.addBinding(unitObj, "units", { label: "units", options: { "mph · ft · in": "imperial", "m/s · m · cm": "metric" } }).on("change", (ev) => host.setUnits(ev.value as UnitSystem));

  // --- Compare, spray, share ---
  const fCmp = pane.addFolder({ title: "Compare · spray · share" });
  fCmp.addButton({ title: "Pin this run (P)" }).on("click", () => host.pin());
  fCmp.addButton({ title: "Clear pinned runs" }).on("click", () => host.clearPins());
  fCmp.addBinding(host.spray, "n", { label: "spray runs", min: 10, max: 200, step: 1 });
  fCmp.addBinding(host.spray, "mode", { label: "spray varies", options: { "wake noise (seeds)": "noise", "release orientation": "orientation" } });
  fCmp.addBinding(host.spray, "toleranceDeg", { label: "orientation ± (°)", min: 1, max: 45, step: 1 });
  fCmp.addButton({ title: "Run spray" }).on("click", () => host.runSpray());
  fCmp.addButton({ title: "Copy share link" }).on("click", () => host.share());

  return {
    pane,
    preview,
    refresh: () => pane.refresh(),
    setBlurb(text: string) {
      blurb.textContent = text;
    },
    setPresetLabel(id: string) {
      presetObj.id = id;
      pane.refresh();
    },
  };
}

function note(folder: FolderApi, text: string) {
  const p = document.createElement("p");
  p.className = "panel-note";
  p.textContent = text;
  folder.element.querySelector(".tp-fldv_c")?.appendChild(p);
  return p;
}
