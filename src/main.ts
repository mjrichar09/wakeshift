import "./ui/style.css";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { inject } from "@vercel/analytics";

import type { Params, Sport } from "./physics/params";
import { defaultParams, withPatch } from "./physics/params";
import type { FlightRecord } from "./physics/simulate";
import { arrival, geometricTable, releaseQuat, simulate, simulateGhost } from "./physics/simulate";
import { G } from "./physics/constants";
import { deg } from "./physics/vec";
import { plusXName } from "./physics/frames";

import { createWorld } from "./scene/world";
import { CameraRig, chasePose, viewsFor } from "./scene/cameras";
import type { ViewDef } from "./scene/cameras";
import { Playback, SPEEDS, lerp3, nearest, sampleAt } from "./scene/playback";
import { BallRig, defaultOverlays } from "./scene/ballRig";
import type { ArrowKey } from "./scene/overlays/forceArrows";
import { ARROW_COLORS } from "./scene/overlays/forceArrows";
import { Trails, PIN_COLORS } from "./scene/overlays/trail";
import { FlowLab } from "./scene/flowLab";
import { makeSnapshot, snapshotAt } from "./scene/flowState";
import { toThreeQuat, createBallMesh } from "./scene/ball";
import { SeparationRing } from "./scene/overlays/separationRing";

import { buildPanel } from "./ui/panel";
import type { Display, PanelHost } from "./ui/panel";
import { presetParams, presetsFor } from "./ui/presets";
import type { UnitSystem } from "./ui/units";
import { fmtSmall, toSmall, smallUnit } from "./ui/units";
import { Charts } from "./ui/charts";
import { drawGizmo, renderHud } from "./ui/hud";
import { decodeHash, encodeHash, paramsDiff } from "./ui/share";
import { drawSpray, runSpray } from "./ui/spray";
import type { SprayOptions } from "./ui/spray";
import type { SprayResult } from "./workers/spray.worker";
import { ABOUT_HTML, Tour } from "./ui/about";

inject();

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// ---------------------------------------------------------------- state
const shared = decodeHash(location.hash);
let params: Params = shared?.params ?? presetParams("baseball", "quarter");
let presetId = shared?.preset ?? (shared ? "custom" : "quarter");
let units: UnitSystem = params.sport === "baseball" ? "imperial" : "metric";
let rec: FlightRecord;
let ghost: FlightRecord;
let aLatMax = 1;
const overlays = defaultOverlays();
const display: Display = { ballScale: 1, split: false };
const spray: SprayOptions = { n: 50, mode: "orientation", toleranceDeg: 10 };
interface Pin {
  params: Params;
  rec: FlightRecord;
  color: number;
  label: string;
}
let pins: Pin[] = [];
const playback = new Playback();
const narrow = matchMedia("(max-width: 760px)").matches;
if (narrow) {
  // Phones: a reduced overlay set.
  overlays.streamlines = false;
  overlays.pressure = false;
  overlays.smoke = false;
}

// ---------------------------------------------------------------- scene
const canvas = $<HTMLCanvasElement>("scene");
const stage = $("stage");
const world = createWorld(canvas);
const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 400);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.495;
const camRig = new CameraRig(camera, controls);
const flowLab = new FlowLab(canvas);
const mainRig = new BallRig(false);
world.scene.add(mainRig.group, mainRig.arrowGroup);
const trails = new Trails();
world.scene.add(trails.group);
const sprayDots = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: 0xf08a24, size: 6, sizeAttenuation: false }));
sprayDots.frustumCulled = false;
world.scene.add(sprayDots);

let views: ViewDef[] = viewsFor(params.sport);
let view: ViewDef = views[0];

function resize() {
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  world.renderer.setSize(w, h, false);
  const leftW = display.split ? w / 2 : w;
  camera.aspect = leftW / Math.max(h, 1);
  camera.updateProjectionMatrix();
  flowLab.resize(display.split ? w / 2 : w, h);
  trails.setResolution(w, h);
  mainRig.setLineResolution(w, h);
  charts.setCompact(w < 900 || innerHeight < 860);
  flowLab.rig.setLineResolution(w, h);
}
new ResizeObserver(resize).observe(stage);

// Orbit controls share the canvas: enable the one under the pointer.
canvas.addEventListener(
  "pointerdown",
  (e) => {
    const r = canvas.getBoundingClientRect();
    const right = e.clientX - r.left > r.width / 2;
    const flowActive = display.split ? right : view.kind === "flowlab";
    flowLab.controls.enabled = flowActive;
    controls.enabled = !flowActive && !camRig.moving && view.kind !== "chase";
  },
  { capture: true },
);

// ---------------------------------------------------------------- simulation
function rhoText(r: FlightRecord) {
  return `${r.air.rho.toFixed(3)} kg/m³`;
}

const readouts = { rotations: "", rho: "", reCrit: "", blurb: "" };

function presetBlurb() {
  return presetsFor(params.sport).find((p) => p.id === presetId)?.blurb ?? "Custom settings.";
}

function resim() {
  rec = simulate(params);
  ghost = simulateGhost(params);
  aLatMax = Math.max(0.5, ...Array.from(rec.aLat));
  playback.setDuration(rec.t[rec.n - 1]);
  playback.autoSlowThreshold = 0.6 * aLatMax;
  trails.setRecords(rec, ghost, aLatMax);
  trails.setPins(pins.map((p) => ({ rec: p.rec, color: p.color })));
  mainRig.setBall(params);
  flowLab.rig.setBall(params);
  for (const r of [mainRig, flowLab.rig]) r.setTripZone(params.aero.tripMinDeg * deg, params.aero.tripMaxDeg * deg);
  charts.build(rec, ghost, pins, units);
  const n = rec.n - 1;
  readouts.rotations = `${rec.rotations[n].toFixed(2)} in ${(rec.t[n] * 1000).toFixed(0)} ms`;
  readouts.rho = rhoText(rec);
  readouts.reCrit = `${(rec.reCrit / 1000).toFixed(0)}k`;
  readouts.blurb = presetBlurb();
  panel.setBlurb(readouts.blurb);
  $("preset-name").textContent = presetsFor(params.sport).find((p) => p.id === presetId)?.label ?? "Custom";
  $("outcome").textContent = outcomeText();
  renderPreview();
  renderLegend();
  sprayDots.visible = false;
  $("spray").hidden = true;
  history.replaceState(null, "", encodeHash({ params, view: view?.id, preset: presetId }));
}

function outcomeText() {
  const end = arrival(rec);
  const g = arrival(ghost);
  const dx = end[0] - g[0];
  const su = smallUnit(units);
  const side = params.sport === "baseball" ? (dx >= 0 ? "toward 1B" : "toward 3B") : dx >= 0 ? "to passer's right" : "to passer's left";
  const label = { plate: "at the plate", floor: "lands", net: "into the net", long: "long", timeout: "still flying" }[rec.outcome];
  return `${label} · break ${Math.abs(toSmall(dx, units)).toFixed(1)} ${su} ${side}`;
}

let resimQueued = false;
function queueResim() {
  if (resimQueued) return;
  resimQueued = true;
  requestAnimationFrame(() => {
    resimQueued = false;
    resim();
  });
}

// ---------------------------------------------------------------- panel
const host: PanelHost = {
  params,
  units,
  overlays,
  display,
  spray,
  presetId,
  readouts,
  changed(kind) {
    if (kind === "params") {
      presetId = "custom";
      queueResim();
    } else if (kind === "display") {
      resize();
      updateSplitLabels();
    } else renderLegend();
  },
  preset(id) {
    loadParams(presetParams(params.sport, id), id);
  },
  setUnits(u) {
    units = u;
    rebuildPanel();
    resim();
  },
  pin: pinRun,
  clearPins() {
    pins = [];
    resim();
  },
  runSpray: doSpray,
  share() {
    const url = location.href;
    navigator.clipboard?.writeText(url).then(
      () => flash("Link copied"),
      () => flash(url),
    );
  },
  fillEmpirical() {
    params.aero.empiricalTable = geometricTable(params);
    queueResim();
  },
  resetParams() {
    loadParams(defaultParams(params.sport), "custom");
  },
};
let panel = buildPanel($("panel"), host);

function rebuildPanel() {
  host.params = params;
  host.units = units;
  host.presetId = presetId;
  panel.pane.dispose();
  panel = buildPanel($("panel"), host);
}

function loadParams(p: Params, id: string) {
  const sportChanged = p.sport !== params.sport;
  params = p;
  presetId = id;
  if (sportChanged) {
    units = p.sport === "baseball" ? "imperial" : "metric";
    pins = [];
  }
  rebuildPanel();
  if (sportChanged) setupSport();
  resim();
  playback.replay();
}

function flash(msg: string) {
  const el = $("outcome");
  const prev = el.textContent;
  el.textContent = msg;
  setTimeout(() => (el.textContent = prev), 1600);
}

// ---------------------------------------------------------------- orientation preview
const preview = (() => {
  const r = new THREE.WebGLRenderer({ canvas: panel.preview, antialias: true, alpha: true });
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445055, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 1.5);
  key.position.set(1, 2, 3);
  scene.add(key);
  // From the plate (+z) looking back at the ball (−z): the face the air meets, +x on the right.
  const cam = new THREE.PerspectiveCamera(30, 1.6, 0.1, 20);
  cam.position.set(0, 0, 4.4);
  cam.lookAt(0, 0, 0);
  const holder = new THREE.Group();
  const ring = new SeparationRing();
  scene.add(holder, ring.group);
  return { r, scene, cam, holder, ring, key: "" };
})();

function renderPreview() {
  const cv = panel.preview;
  if (preview.r.domElement !== cv) {
    // The panel was rebuilt: re-attach to the new canvas.
    preview.r.dispose();
    preview.r = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true });
  }
  const w = cv.clientWidth || 280;
  const h = cv.clientHeight || 175;
  preview.r.setPixelRatio(Math.min(devicePixelRatio, 2));
  preview.r.setSize(w, h, false);
  preview.cam.aspect = w / h;
  preview.cam.updateProjectionMatrix();
  const key = params.sport === "baseball" ? "bb" : `vb${params.ball.panelDesign}`;
  if (key !== preview.key) {
    preview.holder.clear();
    preview.holder.add(createBallMesh(params));
    preview.key = key;
  }
  preview.holder.quaternion.copy(toThreeQuat(releaseQuat(params)));
  preview.ring.setTripZone(params.aero.tripMinDeg * deg, params.aero.tripMaxDeg * deg);
  preview.ring.setResolution(w, h);
  preview.ring.update(snapshotAt(rec, 0), true, true);
  preview.r.render(preview.scene, preview.cam);
}

// ---------------------------------------------------------------- charts, pins, legend
const charts = new Charts($("charts"), (t) => {
  playback.scrub(t);
  playback.playing = false;
});

function describeDiff(p: Params): string {
  const base = presetId !== "custom" ? presetParams(params.sport, presetId) : defaultParams(params.sport);
  const d = paramsDiff(withPatch(p, {}));
  const b = paramsDiff(base);
  const flat = (o: object, pre = ""): [string, unknown][] =>
    Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" && !Array.isArray(v) ? flat(v, `${pre}${k}.`) : [[`${pre}${k}`, v]]));
  const bm = new Map(flat(b));
  const out = flat(d)
    .filter(([k, v]) => JSON.stringify(bm.get(k)) !== JSON.stringify(v) && k !== "aero.empiricalTable")
    .map(([k, v]) => `${k.split(".").pop()} ${typeof v === "number" ? +v.toFixed(2) : v}`);
  return out.slice(0, 3).join(", ") || (presetsFor(p.sport).find((x) => x.id === presetId)?.label ?? "baseline");
}

function pinRun() {
  if (pins.length >= 5) pins.shift();
  const used = new Set(pins.map((p) => p.color));
  const color = PIN_COLORS.find((c) => !used.has(c)) ?? PIN_COLORS[0];
  pins.push({ params: structuredClone(params), rec, color, label: describeDiff(params) });
  trails.setPins(pins.map((p) => ({ rec: p.rec, color: p.color })));
  charts.build(rec, ghost, pins, units);
  renderLegend();
}

function renderLegend() {
  const hex = (c: number) => `#${c.toString(16).padStart(6, "0")}`;
  const pinsEl = $("pins");
  pinsEl.innerHTML = pins.length
    ? pins.map((p, i) => `<span><i style="display:inline-block;width:10px;height:3px;background:${hex(p.color)};vertical-align:middle"></i> ${p.label}<button data-unpin="${i}" aria-label="Remove pinned run">×</button></span>`).join(" · ")
    : "none (press P)";
  pinsEl.querySelectorAll<HTMLButtonElement>("[data-unpin]").forEach((b) =>
    b.addEventListener("click", () => {
      pins.splice(+b.dataset.unpin!, 1);
      trails.setPins(pins.map((p) => ({ rec: p.rec, color: p.color })));
      charts.build(rec, ghost, pins, units);
      renderLegend();
    }),
  );
  const leg = $("legend");
  const shown = (Object.keys(ARROW_COLORS) as ArrowKey[]).filter((k) => overlays.arrows[k]);
  const arrowNames: Record<ArrowKey, string> = { velocity: "velocity", gravity: "gravity", drag: "drag", magnus: "Magnus", seam: "seam force", wake: "wake noise", aero: "net aero" };
  leg.innerHTML =
    shown.map((k) => `<span><i style="background:${hex(ARROW_COLORS[k])}"></i>${arrowNames[k]}</span>`).join("") +
    (overlays.ghost ? `<span><i style="background:repeating-linear-gradient(90deg,#fff 0 5px,transparent 5px 8px)"></i>ghost: same release, no seam force</span>` : "") +
    (overlays.trail ? `<span><i style="background:linear-gradient(90deg,#54739e,#f08a24,#ffeea0)"></i>trail: |side accel.| low → high</span>` : "") +
    (overlays.ring ? `<span><i style="background:${css("--sep-lam")}"></i>laminar <i style="background:${css("--sep-turb")};margin-left:6px"></i>tripped <i style="background:${css("--sep-pin")};margin-left:6px"></i>pinned</span>` : "") +
    pins.map((p) => `<span><i style="background:${hex(p.color)}"></i>${p.label}</span>`).join("");
  leg.hidden = narrow || leg.innerHTML === "";
}

// ---------------------------------------------------------------- spray
async function doSpray() {
  const fig = $("spray");
  fig.hidden = false;
  $("legend").hidden = true;
  $("spray-note").textContent = `Running ${spray.n} flights…`;
  try {
    const { results, ms } = await runSpray(params, spray);
    const main = toResult(rec);
    const gh = toResult(ghost);
    const s = drawSpray(
      $<HTMLCanvasElement>("spray-canvas"),
      params,
      results,
      main,
      gh,
      { ink: css("--ink"), muted: css("--ink-2"), line: css("--line"), dot: css("--f-seam"), ghost: css("--ink-2"), zone: css("--ink-2") },
      (m) => fmtSmall(m, units),
    );
    const what = spray.mode === "noise" ? "wake-noise seeds" : `orientation ±${spray.toleranceDeg}°`;
    $("spray-title").textContent = `Spray · ${results.length} runs`;
    $("spray-note").textContent = `${what} · spread ${s.sx} × ${s.sy} (1σ) · ${ms.toFixed(0)} ms · ring = ghost, dot = this run`;
    const pos: number[] = [];
    for (const r of results) pos.push(r.x, params.sport === "baseball" ? r.y : 0.02, params.sport === "baseball" ? r.z : r.z);
    sprayDots.geometry.dispose();
    sprayDots.geometry = new THREE.BufferGeometry();
    sprayDots.geometry.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    sprayDots.visible = true;
  } catch (e) {
    $("spray-note").textContent = `Spray failed: ${String(e)}`;
  }
}
const toResult = (r: FlightRecord): SprayResult => {
  const a = arrival(r);
  return { x: a[0], y: a[1], z: a[2], outcome: r.outcome };
};
$("spray-close").addEventListener("click", () => {
  $("spray").hidden = true;
  sprayDots.visible = false;
  renderLegend();
});

// ---------------------------------------------------------------- views
function buildViewNav() {
  const nav = $("views");
  nav.innerHTML = views.map((v, i) => `<button type="button" data-view="${v.id}" aria-keyshortcuts="${i + 1}"><kbd>${i + 1}</kbd>${v.label}</button>`).join("");
  nav.querySelectorAll<HTMLButtonElement>("button").forEach((b) => b.addEventListener("click", () => setView(b.dataset.view!)));
}

function currentBall() {
  const s = sampleAt(rec, playback.t);
  const r = lerp3(rec.r, s.i, s.f);
  const v = lerp3(rec.v, s.i, s.f);
  return { r: new THREE.Vector3(...r), dir: new THREE.Vector3(...v).normalize() };
}

const fade = $("fade");
function withFade(fn: () => void) {
  fade.classList.add("is-on");
  setTimeout(() => {
    fn();
    fade.classList.remove("is-on");
  }, 230);
}

function setView(id: string) {
  const next = views.find((v) => v.id === id) ?? views[0];
  const wasFlow = view?.kind === "flowlab";
  const apply = () => {
    view = next;
    for (const b of $("views").querySelectorAll<HTMLButtonElement>("button")) b.setAttribute("aria-current", String(b.dataset.view === id));
    world.figures.visible = overlays.figures && !next.pov;
    flowLab.controls.enabled = next.kind === "flowlab";
    if (next.kind === "flowlab") {
      camRig.stopFollowing();
      controls.enabled = false;
    } else if (next.kind === "chase") {
      const D = 14 * rec.ball.diameter;
      camRig.chase(() => {
        const b = currentBall();
        return chasePose(b.r, b.dir, D);
      });
    } else if (next.pose) camRig.flyTo(next.pose, wasFlow ? 0.01 : 1.1);
    updateSplitLabels();
    history.replaceState(null, "", encodeHash({ params, view: view.id, preset: presetId }));
  };
  if (next.kind === "flowlab" && !wasFlow && !display.split) withFade(apply);
  else if (wasFlow && next.kind !== "flowlab" && !display.split) withFade(apply);
  else apply();
}

function updateSplitLabels() {
  $("split-left").hidden = !display.split;
  $("split-right").hidden = !display.split;
  if (display.split) $("split-left").textContent = view.kind === "flowlab" ? views[0].label : view.label;
  $("schematic").hidden = !(view.kind === "flowlab" || display.split);
}

function setupSport() {
  world.setSport(params.sport, params.court.netHeight);
  views = viewsFor(params.sport);
  buildViewNav();
  flowLab.setDirectionLabels(params.sport === "baseball" ? "1B side" : "passer's right", params.sport === "baseball" ? "upstream: toward plate" : "upstream: toward passer");
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-sport]")) b.setAttribute("aria-checked", String(b.dataset.sport === params.sport));
  view = views[0];
  camRig.jumpTo(view.pose!);
  setView(view.id);
}

for (const b of document.querySelectorAll<HTMLButtonElement>("[data-sport]"))
  b.addEventListener("click", () => {
    const s = b.dataset.sport as Sport;
    if (s === params.sport) return;
    const first = presetsFor(s)[s === "baseball" ? 1 : 0].id;
    loadParams(presetParams(s, first), first);
  });

// ---------------------------------------------------------------- playback UI
const speedSeg = $("pb-speeds");
speedSeg.innerHTML = SPEEDS.map((s) => `<button type="button" role="radio" data-speed="${s}" aria-checked="false">${s}×</button>`).join("");
function syncSpeed() {
  for (const b of speedSeg.querySelectorAll<HTMLButtonElement>("button")) b.setAttribute("aria-checked", String(+b.dataset.speed! === playback.speed));
  $<HTMLInputElement>("pb-free").value = String(Math.log10(playback.speed));
}
speedSeg.querySelectorAll<HTMLButtonElement>("button").forEach((b) =>
  b.addEventListener("click", () => {
    playback.speed = +b.dataset.speed!;
    syncSpeed();
  }),
);
$<HTMLInputElement>("pb-free").addEventListener("input", (e) => {
  playback.speed = +(10 ** +(e.target as HTMLInputElement).value).toFixed(3);
  for (const b of speedSeg.querySelectorAll<HTMLButtonElement>("button")) b.setAttribute("aria-checked", String(+b.dataset.speed! === playback.speed));
});
$("pb-play").addEventListener("click", () => playback.toggle());
$("pb-back").addEventListener("click", () => playback.step(-1));
$("pb-fwd").addEventListener("click", () => playback.step(1));
$("pb-replay").addEventListener("click", () => playback.replay());
$<HTMLInputElement>("pb-loop").addEventListener("change", (e) => (playback.loop = (e.target as HTMLInputElement).checked));
$<HTMLInputElement>("pb-auto").addEventListener("change", (e) => (playback.autoSlow = (e.target as HTMLInputElement).checked));
const scrub = $<HTMLInputElement>("pb-scrub");
scrub.addEventListener("input", () => {
  playback.scrub((+scrub.value / 1000) * playback.duration);
  playback.playing = false;
});
$("drawer-toggle").addEventListener("click", (e) => {
  const d = $("drawer");
  d.classList.toggle("is-collapsed");
  (e.target as HTMLElement).textContent = d.classList.contains("is-collapsed") ? "Charts ▸" : "Charts ▾";
  (e.target as HTMLElement).setAttribute("aria-expanded", String(!d.classList.contains("is-collapsed")));
});

window.addEventListener("keydown", (e: KeyboardEvent) => {
  const t = e.target as HTMLElement;
  if (t.closest("input, textarea, select, [contenteditable]") && !(t as HTMLInputElement).type?.match(/range|checkbox/)) return;
  if (e.key === " ") {
    e.preventDefault();
    playback.toggle();
  } else if (e.key === "ArrowLeft") {
    e.preventDefault();
    playback.step(-1);
  } else if (e.key === "ArrowRight") {
    e.preventDefault();
    playback.step(1);
  } else if (e.key === "p" || e.key === "P") pinRun();
  else if (/^[1-9]$/.test(e.key) && views[+e.key - 1]) setView(views[+e.key - 1].id);
});

// ---------------------------------------------------------------- about & tour
$("about-body").innerHTML = ABOUT_HTML;
$("about-open").addEventListener("click", () => $<HTMLDialogElement>("about").showModal());
function peakSeamTime() {
  let best = 0;
  let bi = 0;
  for (let i = 0; i < rec.n; i++) {
    const m = Math.hypot(rec.fSeam[3 * i], rec.fSeam[3 * i + 1], rec.fSeam[3 * i + 2]);
    if (m > best) {
      best = m;
      bi = i;
    }
  }
  return rec.t[bi];
}
const tour = new Tour([
  {
    title: "A quarter turn on the way in",
    body: "This knuckleball turns only <b>¼ of a rotation</b> before it reaches the plate. Watch from the catcher's spot at 0.1× speed. The orange-to-yellow trail shows where the sideways push is strongest; the dashed white line is the same pitch with the seam force switched off.",
    enter: () => {
      if (params.sport !== "baseball" || presetId !== "quarter") loadParams(presetParams("baseball", "quarter"), "quarter");
      display.split = false;
      resize();
      playback.speed = 0.1;
      syncSpeed();
      playback.replay();
      setView("catcher");
    },
  },
  {
    title: "Ride with the ball",
    body: "The flow lab holds the ball still and streams the air past it. The ring on the ball is where the boundary layer <b>separates</b>: <b style='color:var(--sep-lam)'>blue</b> = laminar (early, ≈82°), <b style='color:var(--sep-turb)'>orange</b> = tripped by a seam (late, ≈115°), <b style='color:var(--sep-pin)'>magenta</b> = pinned at a seam. The faint band is the trip zone.",
    enter: () => {
      overlays.ring = true;
      overlays.tripBand = true;
      overlays.streamlines = true;
      overlays.wake = true;
      panel.refresh();
      playback.playing = false;
      playback.scrub(0.05);
      setView("flowlab");
    },
  },
  {
    title: "The orange arrow",
    body: "Where the seam trips one side, that side separates later. The wake shifts to the <b>other</b> side, and the ball is pushed toward the late side: the big <b style='color:var(--f-seam)'>orange arrow</b>. This is the moment of strongest push in this flight.",
    enter: () => {
      playback.playing = false;
      playback.scrub(peakSeamTime());
    },
  },
  {
    title: "Watch it swing",
    body: "Play at 0.05×. As the ball turns, seams slide into and out of the trip zone, ring segments change color and the arrow swings. A quarter turn is enough to change the push's direction mid-flight, which is the knuckleball's dance.",
    enter: () => {
      playback.speed = 0.05;
      syncSpeed();
      playback.replay();
    },
  },
  {
    title: "Measure the break, then compare",
    body: "Back at the catcher's view, the gap between the trail and the dashed ghost is the break the seams caused (also in the HUD and the last chart). Press <b>P</b> to pin this run, then choose the <b>1/2 turn</b> or <b>Too much spin</b> preset to see the dance shrink as the spin averages it out.",
    enter: () => {
      $("drawer").classList.remove("is-collapsed");
      playback.speed = 0.25;
      syncSpeed();
      playback.replay();
      setView("catcher");
    },
  },
]);
$("tour-open").addEventListener("click", () => tour.start());

// ---------------------------------------------------------------- frame loop
const clock = new THREE.Clock();
const snap = makeSnapshot(36);
let snapI = -1;
let snapshot = snap;
const qa = new THREE.Quaternion();
const qb = new THREE.Quaternion();
let chartTick = 0;

function forceVecs(i: number, f: number): Record<ArrowKey, THREE.Vector3> {
  const v = (a: Float64Array) => new THREE.Vector3(...lerp3(a, i, f));
  return { velocity: v(rec.v), gravity: v(rec.fGrav), drag: v(rec.fDrag), magnus: v(rec.fMagnus), seam: v(rec.fSeam), wake: v(rec.fWake), aero: v(rec.fAero) };
}

let frameMs = 0;
let lastSplit = display.split;
function frame() {
  const f0 = performance.now();
  if (display.split !== lastSplit) {
    lastSplit = display.split;
    resize();
    updateSplitLabels();
  }
  const dt = Math.min(clock.getDelta(), 0.1);
  playback.update(dt, (t) => rec.aLat[nearest(sampleAt(rec, t))]);
  const s = sampleAt(rec, playback.t);
  const iN = nearest(s);
  const R = rec.ball.diameter / 2;

  // Ball pose.
  const pos = new THREE.Vector3(...lerp3(rec.r, s.i, s.f));
  toThreeQuat(rec.q, qa, 4 * s.i);
  toThreeQuat(rec.q, qb, 4 * (s.i + 1));
  const q = new THREE.Quaternion().slerpQuaternions(qa, qb, s.f);
  const flowChanged = iN !== snapI;
  if (flowChanged) {
    snapshot = snapshotAt(rec, iN, snapshot);
    snapI = iN;
  }

  // Visual flow speed and shedding: slowed real shedding, kept watchable.
  const flowSpeed = 3;
  const shedReal = (rec.params.aero.strouhal * snapshot.speed) / rec.ball.diameter;
  const shedHz = THREE.MathUtils.clamp(shedReal * (playback.playing ? playback.speed : 0.02), 0.4, 2.5);

  // Field rig: real size × display scale; lightweight overlays (no streamlines or smoke).
  const scale = R * display.ballScale;
  mainRig.group.position.copy(pos);
  mainRig.group.scale.setScalar(scale);
  mainRig.spin.quaternion.copy(q);
  mainRig.update(snapshot, { ...overlays, streamlines: false, smoke: false }, dt, flowSpeed, shedHz, flowChanged);
  mainRig.wake.setFocal(stage.clientHeight / (2 * Math.tan((camera.fov * deg) / 2)));
  const vecs = forceVecs(s.i, s.f);
  mainRig.arrows.visible = overlays.arrows;
  mainRig.arrows.update(pos, vecs, rec.ball.mass * G, 0.5, overlays.arrowScale, scale);

  // Flow lab rig: unit radius at the origin.
  const showFlow = view.kind === "flowlab" || display.split;
  if (showFlow) {
    flowLab.rig.spin.quaternion.copy(q);
    flowLab.rig.update(snapshot, overlays, dt, flowSpeed, shedHz, flowChanged);
    flowLab.rig.wake.setFocal(stage.clientHeight / (2 * Math.tan((flowLab.camera.fov * deg) / 2)));
    // The ball is held still in the flow lab, so its velocity arrow is left out there.
    flowLab.rig.arrows.visible = { ...overlays.arrows, velocity: false };
    flowLab.rig.arrows.update(new THREE.Vector3(), vecs, rec.ball.mass * G, 3, overlays.arrowScale, 1);
    flowLab.controls.update();
  }

  trails.setProgress(iN);
  trails.setVisibility(overlays.trail, overlays.ghost);
  if (world.strikeZone) world.strikeZone.visible = overlays.strikeZone;
  world.figures.visible = overlays.figures && !view.pov;

  camRig.update(dt);
  if (!camRig.moving && controls.enabled) controls.update();

  // HUD, gizmo, scrubber, charts.
  renderHud($("hud"), rec, ghost, iN, playback.t, units, playback.slowedNow);
  const gizmoCam = view.kind === "flowlab" && !display.split ? flowLab.camera : camera;
  drawGizmo($<HTMLCanvasElement>("gizmo"), gizmoCam, { x: params.sport === "baseball" ? "1B" : "R", z: "flight" }, css("--ink"), css("--f-seam") || "#f08a24");
  scrub.value = String(Math.round((playback.t / Math.max(playback.duration, 1e-6)) * 1000));
  $("pb-time").textContent = `${(playback.t * 1000).toFixed(0)} ms`;
  $("pb-play").textContent = playback.playing ? "❚❚" : "▶";
  if ((chartTick = (chartTick + 1) % 2) === 0) charts.setPlayhead(playback.t);

  // Render.
  const r = world.renderer;
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  r.setScissorTest(false);
  r.setViewport(0, 0, w, h);
  r.clear();
  if (display.split) {
    r.setScissorTest(true);
    r.setViewport(0, 0, w / 2, h);
    r.setScissor(0, 0, w / 2, h);
    r.render(world.scene, camera);
    r.setViewport(w / 2, 0, w / 2, h);
    r.setScissor(w / 2, 0, w / 2, h);
    r.render(flowLab.scene, flowLab.camera);
    r.setScissorTest(false);
  } else if (view.kind === "flowlab") r.render(flowLab.scene, flowLab.camera);
  else r.render(world.scene, camera);
  frameMs = frameMs * 0.95 + (performance.now() - f0) * 0.05;
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- start
// The ring and arrows use the main overlay flags; the arrows' own visibility map is shared.
mainRig.arrows.visible = overlays.arrows;
setupSport();
resim();
syncSpeed();
resize();
if (shared?.view && views.some((v) => v.id === shared.view)) setView(shared.view);
if (!shared) setTimeout(() => !tour.open && $("tour-open").animate([{ opacity: 0.3 }, { opacity: 1 }], { duration: 900, iterations: 3 }), 1500);
requestAnimationFrame(frame);

// Debug / test hooks.
Object.assign(window as unknown as Record<string, unknown>, {
  lab: {
    get rec() {
      return rec;
    },
    get ghost() {
      return ghost;
    },
    get params() {
      return params;
    },
    playback,
    setView,
    loadPreset: (sport: Sport, id: string) => loadParams(presetParams(sport, id), id),
    get view() {
      return view.id;
    },
    camera,
    flowCamera: flowLab.camera,
    doSpray,
    get frameMs() {
      return frameMs;
    },
    overlays,
    display,
    tour,
    scenes: { field: world.scene, flow: flowLab.scene },
    plusX: () => plusXName(params.sport),
  },
});
