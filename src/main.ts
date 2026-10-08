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
import { lateralLabel, plusXName } from "./physics/frames";

import { createWorld } from "./scene/world";
import { CameraRig, chasePose, viewsFor } from "./scene/cameras";
import type { ViewDef } from "./scene/cameras";
import { Playback, SPEEDS, lerp3, nearest, sampleAt } from "./scene/playback";
import { BallRig, defaultOverlays } from "./scene/ballRig";
import type { ArrowKey } from "./scene/overlays/forceArrows";
import { Trails, PIN_COLORS } from "./scene/overlays/trail";
import { ArrivalMarkers } from "./scene/overlays/markers";
import { SPEED_GRADIENT_CSS } from "./scene/overlays/streamlines";
import { FlowLab } from "./scene/flowLab";
import { makeSnapshot, snapshotAt } from "./scene/flowState";
import { toThreeQuat, createBallMesh } from "./scene/ball";
import { SeparationRing } from "./scene/overlays/separationRing";
import { ArrowLabels } from "./scene/labels";
import type { Rect } from "./scene/labels";
import { glowTexture } from "./scene/textures";

import { buildCards } from "./ui/cards";
import type { CardsHost, Display, Quality, Theme } from "./ui/cards";
import { presetParams, presetsFor } from "./ui/presets";
import type { UnitSystem } from "./ui/units";
import { fmtSmall, smallUnit, toSmall } from "./ui/units";
import { Charts } from "./ui/charts";
import { Hud, drawGizmo } from "./ui/hud";
import { autoBallScale, caption, landmarks } from "./ui/story";
import { decodeHash, encodeHash, paramsDiff } from "./ui/share";
import { drawSpray, runSpray } from "./ui/spray";
import type { SprayOptions } from "./ui/spray";
import type { SprayResult } from "./workers/spray.worker";
import { ABOUT_HTML, Tour } from "./ui/about";
import { ICONS } from "./ui/icons";
import { tip } from "./ui/tip";
import { BattingGame } from "./game/controller";
import { CHIP_TIPS } from "./ui/tips";

inject();

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* private mode: remembered for this visit only */
    }
  },
};

// Icons into the static markup.
const icon = (id: string, name: keyof typeof ICONS) => ($(id).innerHTML = ICONS[name]);
icon("ic-tour", "tour");
icon("ic-info", "info");
icon("ic-keys", "keyboard");
icon("ic-bat", "bat");
icon("pb-back", "stepBack");
icon("pb-fwd", "stepFwd");
icon("pb-replay", "replay");
icon("pb-more", "more");
icon("pip-close", "close");
icon("spray-close", "close");

// ---------------------------------------------------------------- state
const shared = decodeHash(location.hash);
let params: Params = shared?.params ?? presetParams("baseball", "quarter");
let presetId = shared?.preset ?? (shared ? "custom" : "quarter");
let units: UnitSystem = params.sport === "baseball" ? "imperial" : "metric";
let rec: FlightRecord;
let ghost: FlightRecord;
let aLatMax = 1;
const narrow = matchMedia("(max-width: 760px)").matches;
const overlays = defaultOverlays();
const display: Display = {
  autoEnlarge: true,
  ballScale: 1,
  split: false,
  pip: !narrow,
  theme: (store.get("kl-theme") as Theme) ?? "auto",
  quality: (store.get("kl-quality") as Quality) ?? "auto",
  arrowScale: 1,
  arrows: overlays.arrows,
};
let showArrows = true;
const spray: SprayOptions = { n: 50, mode: "orientation", toleranceDeg: 10 };
interface Pin {
  params: Params;
  rec: FlightRecord;
  color: number;
  label: string;
}
let pins: Pin[] = [];
/** True while the batting game runs: no pinned paths or other give-aways are drawn. */
let gameActive = false;
const playback = new Playback();
if (narrow) {
  // Phones: a reduced overlay set.
  overlays.pressure = false;
  overlays.smoke = false;
}

let accent = "#f08a24";
function applyTheme(t: Theme) {
  display.theme = t;
  if (t === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  store.set("kl-theme", t);
  accent = getComputedStyle(document.documentElement).getPropertyValue("--f-seam").trim() || "#f08a24";
}
applyTheme(display.theme);

// ---------------------------------------------------------------- scene
const canvas = $<HTMLCanvasElement>("scene");
const stage = $("stage");
const world = createWorld(canvas);
const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 1500);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
// Allow looking slightly upward (low cameras look up at the pitch); the camera itself is kept
// above the ground in the frame loop instead.
controls.maxPolarAngle = Math.PI * 0.62;
const camRig = new CameraRig(camera, controls);
const flowLab = new FlowLab(canvas);
const mainRig = new BallRig(false);
world.scene.add(mainRig.group, mainRig.arrowGroup);
const trails = new Trails();
world.scene.add(trails.group);
const markers = new ArrivalMarkers();
world.scene.add(markers.group);
const halo = new THREE.Sprite(
  new THREE.SpriteMaterial({ map: glowTexture(), color: 0xfff1d6, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }),
);
world.scene.add(halo);
const sprayDots = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: 0xf08a24, size: 6, sizeAttenuation: false }));
sprayDots.frustumCulled = false;
world.scene.add(sprayDots);

// Picture-in-picture close-up: the flow lab's ball and arrows from a fixed catcher-side
// three-quarter view (+x on the right), without the streamlines.
const pipCamera = new THREE.PerspectiveCamera(30, 1.3, 0.05, 100);
pipCamera.position.set(2.4, 1.6, 6.4);
pipCamera.lookAt(0, -0.1, 0);
const labelsMain = new ArrowLabels($("labels"));
const labelsPip = new ArrowLabels($("pip-view"));

let views: ViewDef[] = viewsFor(params.sport);
let view: ViewDef = views[0];

let stageW = 1;
let stageH = 1;
let pipRect: (Rect & { glY: number }) | null = null;
function resize() {
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  stageW = w;
  stageH = h;
  requestAnimationFrame(() => (pipRect = $("pip").hidden ? null : rectOf($("pip-view"))));
  world.renderer.setSize(w, h, false);
  const leftW = display.split ? w / 2 : w;
  camera.aspect = leftW / Math.max(h, 1);
  camera.updateProjectionMatrix();
  flowLab.resize(display.split ? w / 2 : w, h);
  trails.setResolution(w, h);
  mainRig.setLineResolution(w, h);
  flowLab.rig.setLineResolution(w, h);
  charts.setCompact(w < 900 || innerHeight < 1000);
}
new ResizeObserver(resize).observe(stage);

// If the browser ever drops the 3D context, say so (three.js restores it when it can).
canvas.addEventListener("webglcontextlost", () => flash("The browser reset the 3D graphics. If the view stays blank, reload the page."));

// Orbit controls share the canvas: enable the one under the pointer.
canvas.addEventListener(
  "pointerdown",
  (e) => {
    const r = canvas.getBoundingClientRect();
    const right = e.clientX - r.left > r.width / 2;
    const flowActive = display.split ? right : view.kind === "flowlab";
    flowLab.controls.enabled = flowActive;
    controls.enabled = !flowActive && !camRig.moving && !game.active;
  },
  { capture: true },
);

// ---------------------------------------------------------------- simulation
const readouts = { rotations: "", rho: "", reCrit: "" };
const previewCanvas = document.createElement("canvas");
previewCanvas.className = "preview";
previewCanvas.id = "orientation-preview";

function resim() {
  rec = simulate(params);
  ghost = simulateGhost(params);
  aLatMax = Math.max(0.5, ...Array.from(rec.aLat));
  playback.setDuration(rec.t[rec.n - 1]);
  playback.autoSlowThreshold = 0.6 * aLatMax;
  trails.setRecords(rec, ghost, aLatMax);
  trails.setPins(gameActive ? [] : pins.map((p) => ({ rec: p.rec, color: p.color })));
  mainRig.setBall(params);
  flowLab.rig.setBall(params);
  for (const r of [mainRig, flowLab.rig]) r.setTripZone(params.aero.tripMinDeg * deg, params.aero.tripMaxDeg * deg);
  charts.build(rec, ghost, pins, units);
  const n = rec.n - 1;
  readouts.rotations = `${rec.rotations[n].toFixed(2)} turns`;
  readouts.rho = `ρ ${rec.air.rho.toFixed(3)} kg/m³`;
  readouts.reCrit = `${(rec.reCrit / 1000).toFixed(0)}k`;
  cards.refresh();
  renderPresets();
  renderMarks();
  const end = arrival(rec);
  const g = arrival(ghost);
  markers.set(rec, ghost, lateralLabel(toSmall(end[0] - g[0], units), params.sport, 1, ` ${smallUnit(units)}`));
  renderPreview();
  renderPins();
  sprayDots.visible = false;
  $("spray").hidden = true;
  snapI = -1;
  captionI = -1;
  history.replaceState(null, "", encodeHash({ params, view: view?.id, preset: presetId }));
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

// ---------------------------------------------------------------- presets strip
function renderPresets() {
  const nav = $("presets");
  const list = presetsFor(params.sport);
  let html = "";
  let group = "";
  for (const p of list) {
    if (p.group !== group) {
      group = p.group;
      html += `<span class="preset-group">${group}</span>`;
    }
    html += `<button type="button" class="preset" data-preset="${p.id}" aria-pressed="${p.id === presetId}">${p.label}</button>`;
  }
  if (presetId === "custom") html += `<span class="preset preset--custom">Custom</span>`;
  nav.innerHTML = html;
  nav.querySelectorAll<HTMLButtonElement>("[data-preset]").forEach((b) => {
    const p = list.find((x) => x.id === b.dataset.preset)!;
    b.addEventListener("click", () => loadParams(presetParams(params.sport, p.id), p.id));
    tip(b, { title: p.label, body: p.blurb });
  });
}

// ---------------------------------------------------------------- cards
const host: CardsHost = {
  params,
  units,
  display,
  spray,
  readouts,
  previewCanvas,
  changed(kind) {
    if (kind === "params") {
      presetId = "custom";
      queueResim();
    } else {
      resize();
      updateViewChrome();
    }
  },
  setUnits(u) {
    units = u;
    rebuildCards();
    resim();
  },
  setTheme(t) {
    applyTheme(t);
    charts.restyle();
  },
  setQuality(q) {
    display.quality = q;
    store.set("kl-quality", q);
    applyQuality(q === "low" ? "low" : "high");
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
      () => flash("Share link copied to the clipboard."),
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
let cards = buildCards($("panel"), host);

function rebuildCards() {
  host.params = params;
  host.units = units;
  cards = buildCards($("panel"), host);
}

function loadParams(p: Params, id: string) {
  const sportChanged = p.sport !== params.sport;
  params = p;
  presetId = id;
  if (sportChanged) {
    units = p.sport === "baseball" ? "imperial" : "metric";
    pins = [];
  }
  rebuildCards();
  if (sportChanged) setupSport();
  resim();
  playback.replay();
  const blurb = presetsFor(params.sport).find((x) => x.id === id)?.blurb;
  if (blurb) flash(blurb, presetsFor(params.sport).find((x) => x.id === id)!.label);
}

let captionHold = 0;
function flash(msg: string, tag = "Note") {
  $("caption-tag").textContent = tag;
  $("caption-text").textContent = msg;
  captionHold = performance.now() + 3200;
}

// ---------------------------------------------------------------- orientation preview
const preview = (() => {
  // One renderer for the life of the page (see CardsHost.previewCanvas).
  const r = new THREE.WebGLRenderer({ canvas: previewCanvas, antialias: true, alpha: true });
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
  const cv = previewCanvas;
  const w = cv.clientWidth || 280;
  const h = cv.clientHeight || 160;
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

// ---------------------------------------------------------------- charts, pins
const charts = new Charts($("charts"), (t) => {
  playback.scrub(t);
  playback.playing = false;
});

function describeDiff(p: Params): string {
  const base = presetId !== "custom" ? presetParams(params.sport, presetId) : defaultParams(params.sport);
  const flat = (o: object, pre = ""): [string, unknown][] =>
    Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" && !Array.isArray(v) ? flat(v, `${pre}${k}.`) : [[`${pre}${k}`, v]]));
  const bm = new Map(flat(paramsDiff(base)));
  const out = flat(paramsDiff(withPatch(p, {})))
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
  renderPins();
  flash(`Pinned "${pins[pins.length - 1].label}". Change something and compare the paths.`);
}

function renderPins() {
  const hex = (c: number) => `#${c.toString(16).padStart(6, "0")}`;
  const el = $("pins");
  el.innerHTML = pins.length
    ? pins
        .map((p, i) => `<span class="pin"><i style="background:${hex(p.color)}"></i>${p.label}<button type="button" data-unpin="${i}" aria-label="Remove pinned run">×</button></span>`)
        .join("")
    : "none yet (press P)";
  el.querySelectorAll<HTMLButtonElement>("[data-unpin]").forEach((b) =>
    b.addEventListener("click", () => {
      pins.splice(+b.dataset.unpin!, 1);
      trails.setPins(pins.map((p) => ({ rec: p.rec, color: p.color })));
      charts.build(rec, ghost, pins, units);
      renderPins();
    }),
  );
}

// ---------------------------------------------------------------- overlay chips
interface Chip {
  key: string;
  label: string;
  swatch: string;
  get: () => boolean;
  set: (v: boolean) => void;
  flowOnly?: boolean;
  sport?: Sport;
}
const chipDefs: Chip[] = [
  { key: "arrows", label: "Forces", swatch: "var(--f-seam)", get: () => showArrows, set: (v) => (showArrows = v) },
  { key: "ring", label: "Separation", swatch: "conic-gradient(var(--sep-lam) 0 33%, var(--sep-turb) 0 66%, var(--sep-pin) 0)", get: () => overlays.ring, set: (v) => (overlays.ring = v) },
  { key: "tripBand", label: "Trip zone", swatch: "rgba(240,138,36,0.5)", get: () => overlays.tripBand, set: (v) => (overlays.tripBand = v) },
  { key: "pressure", label: "Pressure", swatch: "linear-gradient(90deg,#3b6fd8,#fff,#d8483b)", get: () => overlays.pressure, set: (v) => (overlays.pressure = v) },
  { key: "streamlines", label: "Airflow", swatch: SPEED_GRADIENT_CSS, get: () => overlays.streamlines, set: (v) => (overlays.streamlines = v), flowOnly: true },
  { key: "wake", label: "Wake", swatch: "#dfe7ea", get: () => overlays.wake, set: (v) => (overlays.wake = v) },
  { key: "smoke", label: "Smoke", swatch: "radial-gradient(#fff,#8aa)", get: () => overlays.smoke, set: (v) => (overlays.smoke = v), flowOnly: true },
  { key: "trail", label: "Tracer", swatch: "linear-gradient(90deg,#54739e,#f08a24,#ffeea0)", get: () => overlays.trail, set: (v) => (overlays.trail = v) },
  { key: "ghost", label: "Ghost", swatch: "repeating-linear-gradient(90deg,#fff 0 4px,transparent 4px 7px)", get: () => overlays.ghost, set: (v) => (overlays.ghost = v) },
  { key: "strikeZone", label: "Strike zone", swatch: "transparent", get: () => overlays.strikeZone, set: (v) => (overlays.strikeZone = v), sport: "baseball" },
  { key: "figures", label: "Players", swatch: "#2b4f86", get: () => overlays.figures, set: (v) => (overlays.figures = v) },
];
function renderChips() {
  const el = $("chips");
  const flowShown = view.kind === "flowlab" || display.split;
  el.innerHTML = chipDefs
    .filter((c) => !c.sport || c.sport === params.sport)
    .map(
      (c) =>
        `<button type="button" class="chip-btn${c.flowOnly && !flowShown ? " is-dim" : ""}" data-chip="${c.key}" aria-pressed="${c.get()}"${c.flowOnly ? ' title="Shown in the flow lab"' : ""}><i style="background:${c.swatch}"></i>${c.label}</button>`,
    )
    .join("");
  el.querySelectorAll<HTMLButtonElement>("[data-chip]").forEach((b) => {
    b.addEventListener("click", () => {
      const c = chipDefs.find((x) => x.key === b.dataset.chip)!;
      c.set(!c.get());
      b.setAttribute("aria-pressed", String(c.get()));
    });
    const t = CHIP_TIPS[b.dataset.chip!];
    if (t) tip(b, t);
  });
}

// ---------------------------------------------------------------- spray
let renderPaused = false;
async function doSpray() {
  $("spray").hidden = false;
  $("spray-note").textContent = `Throwing ${spray.n} balls…`;
  // Hold the animation while the workers run, so they get the whole CPU.
  renderPaused = true;
  try {
    const { results, ms } = await runSpray(params, spray).finally(() => (renderPaused = false));
    const s = drawSpray(
      $<HTMLCanvasElement>("spray-canvas"),
      params,
      results,
      toResult(rec),
      toResult(ghost),
      { ink: css("--ink"), muted: css("--ink-2"), line: css("--line"), dot: css("--f-seam"), ghost: css("--ink-2"), zone: css("--ink-2") },
      (m) => fmtSmall(m, units),
    );
    const what = spray.mode === "noise" ? "wake-noise seeds" : `orientation ±${spray.toleranceDeg}°`;
    $("spray-title").textContent = `Spray · ${results.length} throws`;
    $("spray-note").textContent = `Varying ${what}: spread ${s.sx} × ${s.sy} (1σ). Ring = no-seam ghost, dark dot = this throw. ${ms.toFixed(0)} ms.`;
    const pos: number[] = [];
    for (const r of results) pos.push(r.x, params.sport === "baseball" ? r.y : 0.03, r.z);
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
});

// ---------------------------------------------------------------- views
function buildViewNav() {
  const nav = $("views");
  nav.innerHTML = views.map((v, i) => `<button type="button" data-view="${v.id}" aria-keyshortcuts="${i + 1}"><kbd>${i + 1}</kbd>${v.label}</button>`).join("");
  nav.querySelectorAll<HTMLButtonElement>("button").forEach((b) => b.addEventListener("click", () => setView(b.dataset.view!)));
}

function currentBall() {
  const s = sampleAt(rec, playback.t);
  return { r: new THREE.Vector3(...lerp3(rec.r, s.i, s.f)), dir: new THREE.Vector3(...lerp3(rec.v, s.i, s.f)).normalize() };
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
    flowLab.controls.enabled = next.kind === "flowlab";
    if (next.kind === "flowlab") {
      camRig.stopFollowing();
      controls.enabled = false;
    } else if (next.kind === "ball") {
      const D = 14 * rec.ball.diameter;
      camRig.followBall(
        () => currentBall().r,
        () => {
          const b = currentBall();
          return chasePose(b.r, b.dir, D);
        },
        wasFlow ? 0.01 : 1.1,
      );
    } else if (next.pose) camRig.flyTo(next.pose, wasFlow ? 0.01 : 1.1);
    updateViewChrome();
    history.replaceState(null, "", encodeHash({ params, view: view.id, preset: presetId }));
  };
  if (!display.split && (next.kind === "flowlab") !== wasFlow) withFade(apply);
  else apply();
}

function updateViewChrome() {
  const flowVisible = view.kind === "flowlab" || display.split;
  $("split-left").hidden = !display.split;
  $("split-right").hidden = !display.split;
  if (display.split) $("split-left").textContent = view.kind === "flowlab" ? views[0].label : view.label;
  $("schematic").hidden = !flowVisible;
  $("flow-legend").hidden = !flowVisible;
  $("pip").hidden = !display.pip || flowVisible;
  // The caption starts right of whatever sits in the bottom-left corner (close-up or legend).
  stage.classList.toggle("has-pip", !$("pip").hidden || !$("flow-legend").hidden);
  requestAnimationFrame(() => (pipRect = $("pip").hidden ? null : rectOf($("pip-view"))));
  renderChips();
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
const QUICK = [1, 0.25, 0.05];
function speedButtons(el: HTMLElement, list: number[]) {
  el.innerHTML = list.map((s) => `<button type="button" role="radio" data-speed="${s}" aria-checked="false">${s}×</button>`).join("");
  el.querySelectorAll<HTMLButtonElement>("button").forEach((b) =>
    b.addEventListener("click", () => {
      playback.speed = +b.dataset.speed!;
      syncSpeed();
    }),
  );
}
speedButtons($("pb-speeds"), QUICK);
speedButtons($("pb-speeds-all"), SPEEDS);
function syncSpeed() {
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-speed]")) b.setAttribute("aria-checked", String(+b.dataset.speed! === playback.speed));
  $<HTMLInputElement>("pb-free").value = String(Math.log10(playback.speed));
  $("pb-free-v").textContent = `${playback.speed}×`;
}
$<HTMLInputElement>("pb-free").addEventListener("input", (e) => {
  playback.speed = +(10 ** +(e.target as HTMLInputElement).value).toFixed(3);
  syncSpeed();
});
const pop = $("pb-popover");
$("pb-more").addEventListener("click", (e) => {
  e.stopPropagation();
  pop.hidden = !pop.hidden;
  $("pb-more").setAttribute("aria-expanded", String(!pop.hidden));
});
document.addEventListener("click", (e) => {
  if (!pop.hidden && !pop.contains(e.target as Node)) {
    pop.hidden = true;
    $("pb-more").setAttribute("aria-expanded", "false");
  }
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
$("pip-close").addEventListener("click", () => {
  display.pip = false;
  updateViewChrome();
  cards.refresh();
});

/** Landmarks on the timeline: click to jump. */
function renderMarks() {
  const el = $("pb-marks");
  const dur = rec.t[rec.n - 1];
  el.innerHTML = landmarks(rec)
    .map(
      (m) =>
        `<button type="button" class="mark mark--${m.kind}" style="left:${(m.t / dur) * 100}%" data-t="${m.t}" title="${m.label} · ${(m.t * 1000).toFixed(0)} ms" aria-label="${m.label} at ${(m.t * 1000).toFixed(0)} ms"></button>`,
    )
    .join("");
  el.querySelectorAll<HTMLButtonElement>(".mark").forEach((b) =>
    b.addEventListener("click", () => {
      playback.scrub(+b.dataset.t!);
      playback.playing = false;
    }),
  );
}

window.addEventListener("keydown", (e: KeyboardEvent) => {
  if (game.key(e)) return;
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
  else if (e.key === "r" || e.key === "R") playback.replay();
  else if (e.key === "c" || e.key === "C") {
    display.pip = !display.pip;
    updateViewChrome();
    cards.refresh();
  } else if (e.key === "?") $<HTMLDialogElement>("keys").showModal();
  else if (/^[1-9]$/.test(e.key) && views[+e.key - 1]) setView(views[+e.key - 1].id);
});

// ---------------------------------------------------------------- about & tour
$("about-body").innerHTML = ABOUT_HTML;
$("about-open").addEventListener("click", () => $<HTMLDialogElement>("about").showModal());
$("keys-open").addEventListener("click", () => $<HTMLDialogElement>("keys").showModal());
const peakSeamTime = () => landmarks(rec).find((l) => l.kind === "peak")?.t ?? 0.1;
const tour = new Tour([
  {
    title: "A quarter turn on the way in",
    body: "This knuckleball turns only <b>1/4 of a rotation</b> before it reaches the plate. The glowing tracer is brightest where the sideways push is strongest; the dashed white line is the same pitch with the seam force switched off. The caption at the bottom narrates what the air is doing.",
    enter: () => {
      if (params.sport !== "baseball" || presetId !== "quarter") loadParams(presetParams("baseball", "quarter"), "quarter");
      display.split = false;
      resize();
      playback.speed = 0.25;
      syncSpeed();
      playback.replay();
      setView("catcher");
    },
  },
  {
    title: "Ride with the ball",
    body: "The flow lab holds the ball still and streams the air past it. The glowing ring is where the boundary layer <b>lets go</b>: <b style='color:var(--sep-lam)'>blue</b> = laminar (early, ≈82°), <b style='color:var(--sep-turb)'>orange</b> = tripped by a seam (late, ≈115°), <b style='color:var(--sep-pin)'>magenta</b> = pinned at a seam. The faint band is the trip zone.",
    enter: () => {
      overlays.ring = true;
      overlays.tripBand = true;
      overlays.streamlines = true;
      overlays.wake = true;
      playback.playing = false;
      playback.scrub(0.05);
      setView("flowlab");
    },
  },
  {
    title: "The orange arrow",
    body: "Where a seam trips one side, the air clings longer there. The wake shifts to the <b>other</b> side, and the ball is pushed toward the late side: the <b style='color:var(--f-seam)'>orange arrow</b>. This is the moment of strongest push in this flight.",
    enter: () => {
      playback.playing = false;
      playback.scrub(peakSeamTime());
    },
  },
  {
    title: "Watch it swing",
    body: "Playing at 0.05×. As the ball turns, seams slide into and out of the trip zone, ring segments change color and the arrow swings. A quarter turn is enough to change the push mid-flight: the knuckleball's dance.",
    enter: () => {
      playback.speed = 0.05;
      syncSpeed();
      playback.replay();
    },
  },
  {
    title: "Measure the break, then compare",
    body: "Back at the catcher's view, the markers at the plate show the break the seams caused (also in the readout and the charts). The close-up in the corner keeps the forces in view. Press <b>P</b> to pin this run, then choose <b>1/2 turn</b> or <b>Too much spin</b> to see the dance shrink as the spin averages it out.",
    enter: () => {
      $("drawer").classList.remove("is-collapsed");
      display.pip = true;
      playback.speed = 0.25;
      syncSpeed();
      playback.replay();
      setView("catcher");
      cards.refresh();
    },
  },
]);
$("tour-open").addEventListener("click", () => tour.start());

// ---------------------------------------------------------------- frame loop
const hud = new Hud($("hud"));
const clock = new THREE.Clock();
let snapI = -1;
let snapshot = makeSnapshot(36);
const qa = new THREE.Quaternion();
const qb = new THREE.Quaternion();
let chartTick = 0;
let frameMs = 0;
let frames = 0;
let lastSplit = display.split;
let captionI = -1;
let hudI = -1;

function forceVecs(i: number, f: number): Record<ArrowKey, THREE.Vector3> {
  const v = (a: Float64Array) => new THREE.Vector3(...lerp3(a, i, f));
  return { velocity: v(rec.v), gravity: v(rec.fGrav), drag: v(rec.fDrag), magnus: v(rec.fMagnus), seam: v(rec.fSeam), wake: v(rec.fWake), aero: v(rec.fAero) };
}

/** Stage-relative rectangle of an element, and the matching GL viewport origin (y up). */
function rectOf(el: HTMLElement): Rect & { glY: number } {
  const s = stage.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return { x: r.left - s.left, y: r.top - s.top, w: r.width, h: r.height, glY: s.height - (r.bottom - s.top) };
}

function frame() {
  frames++;
  if (renderPaused) {
    clock.getDelta();
    requestAnimationFrame(frame);
    return;
  }
  const f0 = performance.now();
  probeFrameRate(f0);
  if (display.split !== lastSplit) {
    lastSplit = display.split;
    resize();
    updateViewChrome();
  }
  const dt = Math.min(clock.getDelta(), 0.1);
  playback.update(dt, (t) => rec.aLat[nearest(sampleAt(rec, t))]);
  const s = sampleAt(rec, playback.t);
  const iN = nearest(s);
  const R = rec.ball.diameter / 2;
  const W = stageW;
  const H = stageH;

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
  const arrowsOn = showArrows ? display.arrows : ({} as Record<ArrowKey, boolean>);

  // Field rig: enlarged in far views so it stays visible, true size in the ball cam.
  const enlarge = display.autoEnlarge && view.kind !== "ball" ? autoBallScale(R, camera.position.distanceTo(pos), camera.fov, H) : 1;
  const scale = R * display.ballScale * enlarge;
  mainRig.group.position.copy(pos);
  mainRig.group.scale.setScalar(scale);
  mainRig.spin.quaternion.copy(q);
  mainRig.update(snapshot, { ...overlays, streamlines: false, smoke: false }, dt, flowSpeed, shedHz, flowChanged);
  mainRig.wake.setFocal(H / (2 * Math.tan((camera.fov * deg) / 2)));
  const vecs = forceVecs(s.i, s.f);
  mainRig.arrows.visible = arrowsOn;
  mainRig.arrows.update(pos, vecs, rec.ball.mass * G, 0.5, display.arrowScale, scale);
  halo.position.copy(pos);
  halo.scale.setScalar(scale * 5);
  halo.visible = enlarge * display.ballScale > 1.6 && view.kind !== "ball";

  // Flow lab rig (also drives the picture-in-picture).
  const flowVisible = view.kind === "flowlab" || display.split;
  const pipVisible = display.pip && !flowVisible;
  if (flowVisible || pipVisible) {
    flowLab.rig.spin.quaternion.copy(q);
    // The close-up never shows streamlines or smoke: skip them unless the flow lab is up.
    flowLab.rig.update(snapshot, flowVisible ? overlays : { ...overlays, streamlines: false, smoke: false }, dt, flowSpeed, shedHz, flowChanged);
    flowLab.rig.wake.setFocal(H / (2 * Math.tan((flowLab.camera.fov * deg) / 2)));
    // The ball is held still in the flow lab, so its velocity arrow is left out there.
    flowLab.rig.arrows.visible = { ...arrowsOn, velocity: false };
    flowLab.rig.arrows.update(new THREE.Vector3(), vecs, rec.ball.mass * G, 3, display.arrowScale, 1);
    if (flowVisible) flowLab.controls.update();
  }

  game.update();
  trails.setProgress(iN);
  trails.setVisibility(overlays.trail, overlays.ghost);
  markers.setReveal(game.active ? 0 : THREE.MathUtils.smoothstep(playback.t / rec.t[rec.n - 1], 0.82, 0.98));
  if (world.strikeZone) world.strikeZone.visible = overlays.strikeZone;
  world.figures.visible = overlays.figures;
  for (const f of world.figures.children) f.visible = !(view.hide ?? []).includes(f.name);

  camRig.update(dt);
  if (!camRig.moving && controls.enabled) controls.update();
  if (camera.position.y < 0.25) camera.position.y = 0.25;

  // Readout, caption, gizmo, timeline, charts.
  if (iN !== hudI) {
    hudI = iN;
    hud.render(rec, ghost, iN, playback.t, units, playback.slowedNow);
  }
  if (iN !== captionI && performance.now() > captionHold) {
    captionI = iN;
    const c = caption(rec, ghost, iN, units);
    $("caption-tag").textContent = c.tag;
    $("caption-text").textContent = c.text;
  }
  const gizmoCam = view.kind === "flowlab" && !display.split ? flowLab.camera : camera;
  drawGizmo(gizmoEl, gizmoCam, { x: params.sport === "baseball" ? "1B" : "R", z: "flight" }, accent);
  const frac = playback.t / Math.max(playback.duration, 1e-6);
  scrub.value = String(Math.round(frac * 1000));
  scrub.style.setProperty("--fill", `${frac * 100}%`);
  const timeText = `${(playback.t * 1000).toFixed(0)} ms`;
  if (pbTime.textContent !== timeText) pbTime.textContent = timeText;
  const playIcon = playback.playing ? "pause" : "play";
  const playBtn = pbPlay;
  if (playBtn.dataset.icon !== playIcon) {
    playBtn.dataset.icon = playIcon;
    playBtn.innerHTML = ICONS[playIcon];
    playBtn.setAttribute("aria-label", playback.playing ? "Pause" : "Play");
  }
  if ((chartTick = (chartTick + 1) % 2) === 0) charts.setPlayhead(playback.t);

  // Render.
  const r = world.renderer;
  r.setScissorTest(false);
  r.setViewport(0, 0, W, H);
  r.clear();
  if (display.split) {
    r.setScissorTest(true);
    r.setViewport(0, 0, W / 2, H);
    r.setScissor(0, 0, W / 2, H);
    r.render(world.scene, camera);
    r.setViewport(W / 2, 0, W / 2, H);
    r.setScissor(W / 2, 0, W / 2, H);
    r.render(flowLab.scene, flowLab.camera);
    r.setScissorTest(false);
    labelsMain.update(flowLab.rig.arrows.tips(vecs), flowLab.camera, { x: W / 2, y: 0, w: W / 2, h: H });
  } else if (view.kind === "flowlab") {
    r.render(flowLab.scene, flowLab.camera);
    labelsMain.update(flowLab.rig.arrows.tips(vecs), flowLab.camera, { x: 0, y: 0, w: W, h: H });
  } else {
    r.render(world.scene, camera);
    labelsMain.update(mainRig.arrows.tips(vecs), camera, { x: 0, y: 0, w: W, h: H }, view.kind === "ball");
  }
  if (pipVisible) {
    const pr = pipRect;
    if (pr && pr.w > 10) {
      pipCamera.aspect = pr.w / pr.h;
      pipCamera.updateProjectionMatrix();
      const hideFlow = [flowLab.rig.streamlines?.line, flowLab.rig.smoke?.points].filter(Boolean) as THREE.Object3D[];
      const was = hideFlow.map((o) => o.visible);
      hideFlow.forEach((o) => (o.visible = false));
      r.setScissorTest(true);
      r.setViewport(pr.x, pr.glY, pr.w, pr.h);
      r.setScissor(pr.x, pr.glY, pr.w, pr.h);
      r.clearDepth();
      r.render(flowLab.scene, pipCamera);
      r.setScissorTest(false);
      hideFlow.forEach((o, k) => (o.visible = was[k]));
      labelsPip.update(flowLab.rig.arrows.tips(vecs), pipCamera, { x: 0, y: 0, w: pr.w, h: pr.h });
    }
  } else labelsPip.update([], pipCamera, { x: 0, y: 0, w: 1, h: 1 }, false);
  frameMs = frameMs * 0.95 + (performance.now() - f0) * 0.05;
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- graphics quality
let applied: "high" | "low" = "high";
function applyQuality(q: "high" | "low") {
  applied = q;
  world.setQuality(q);
  for (const rig of [mainRig, flowLab.rig]) rig.ring.setGlow(q === "high" && rig === flowLab.rig);
  trails.setGlow(q === "high");
  resize();
}
// Auto: watch the real frame interval for a few seconds and drop to Low if it is slow.
const fpsProbe = { n: 0, sum: 0, last: 0, done: false };
function probeFrameRate(now: number) {
  if (fpsProbe.done || display.quality !== "auto" || document.hidden) return;
  if (fpsProbe.last) {
    fpsProbe.sum += Math.min(now - fpsProbe.last, 250);
    fpsProbe.n++;
  }
  fpsProbe.last = now;
  if (fpsProbe.n >= 90) {
    fpsProbe.done = true;
    if (fpsProbe.sum / fpsProbe.n > 34 && applied === "high") {
      applyQuality("low");
      flash("Graphics switched to Low to keep playback smooth (Display card to change).");
    }
  }
}

// ---------------------------------------------------------------- batting game
let saved: { params: Params; presetId: string; overlays: typeof overlays; showArrows: boolean; pip: boolean; split: boolean; loop: boolean; speed: number } | null = null;
const game = new BattingGame({
  stage,
  canvas,
  camera,
  scene: world.scene,
  enter() {
    saved = { params: structuredClone(params), presetId, overlays: structuredClone(overlays), showArrows, pip: display.pip, split: display.split, loop: playback.loop, speed: playback.speed };
    if (params.sport !== "baseball") loadParams(presetParams("baseball", "quarter"), "quarter");
    gameActive = true;
    trails.setPins([]);
    sprayDots.visible = false;
    $("spray").hidden = true;
    tour.close();
    Object.assign(overlays, { trail: false, ghost: false, ring: false, wake: false, tripBand: false, pressure: false, smoke: false, strikeZone: true, figures: true });
    showArrows = false;
    display.pip = false;
    display.split = false;
    $("app").classList.add("is-game");
    setView("catcher");
    playback.playing = false;
    resize();
    updateViewChrome();
  },
  exit() {
    gameActive = false;
    $("app").classList.remove("is-game");
    if (saved) {
      Object.assign(overlays, saved.overlays);
      showArrows = saved.showArrows;
      display.pip = saved.pip;
      display.split = saved.split;
      playback.loop = saved.loop;
      playback.speed = saved.speed;
      syncSpeed();
      loadParams(saved.params, saved.presetId);
    }
    saved = null;
    resize();
    updateViewChrome();
  },
  load(p) {
    params = p;
    presetId = "custom";
    resim();
    playback.playing = false;
    playback.scrub(0);
    return rec;
  },
  play(speed) {
    playback.speed = speed;
    playback.loop = false;
    playback.replay();
  },
  t: () => playback.t,
  duration: () => playback.duration,
  reveal(on) {
    overlays.trail = on;
  },
  ghostOf: (p) => simulateGhost(p),
});
$("game-open").addEventListener("click", () => game.enter());

// ---------------------------------------------------------------- start
const gizmoEl = $<HTMLCanvasElement>("gizmo");
const pbTime = $("pb-time");
const pbPlay = $("pb-play");
$("flow-bar").style.background = SPEED_GRADIENT_CSS;
mainRig.arrows.visible = display.arrows;
setupSport();
if (display.quality === "low") applyQuality("low");
resim();
syncSpeed();
resize();
if (shared?.view && views.some((v) => v.id === shared.view)) setView(shared.view);
// First visit: start the guided tour (it can be skipped).
if (!shared && !store.get("kl-visited")) setTimeout(() => tour.start(), 900);
store.set("kl-visited", "1");
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
    controls,
    flowCamera: flowLab.camera,
    doSpray,
    get frameMs() {
      return frameMs;
    },
    get frames() {
      return frames;
    },
    get paused() {
      return renderPaused;
    },
    /** Screen position (stage px) of the ball in the current main view. */
    ballOnScreen() {
      const b = currentBall().r.clone().project(view.kind === "flowlab" ? flowLab.camera : camera);
      if (view.kind === "flowlab") b.set(0, 0, 0).project(flowLab.camera);
      return { x: ((b.x + 1) / 2) * stageW, y: ((1 - b.y) / 2) * stageH };
    },
    overlays,
    display,
    tour,
    scenes: { field: world.scene, flow: flowLab.scene },
    setShowArrows: (v: boolean) => (showArrows = v),
    setQuality: (q: "high" | "low") => applyQuality(q),
    setPaused: (v: boolean) => (renderPaused = v),
    game,
    plusX: () => plusXName(params.sport),
  },
});
