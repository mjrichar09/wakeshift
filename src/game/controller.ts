// Batting game: catcher view, a random pitch with no tracer, and one click to say where it
// will cross the plate — before it gets there. Then the path is revealed and scored.

import * as THREE from "three";
import type { Params } from "../physics/params";
import type { FlightRecord } from "../physics/simulate";
import { arrival } from "../physics/simulate";
import { lateralLabel } from "../physics/frames";
import { simulate } from "../physics/simulate";
import { createBallMesh } from "../scene/ball";
import { glowTexture } from "../scene/textures";
import { textSprite } from "../scene/world";
import type { Pose } from "../scene/cameras";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import type { Difficulty, FlightCall, GamePitch, Outcome } from "./batting";
import {
  DIFFICULTY,
  LATE_WINDOW_MS,
  PITCHES_PER_ROUND,
  SWING_DELAY,
  battedParams,
  breaksStreak,
  callFlight,
  contactFrom,
  crossing,
  extendsStreak,
  plateHit,
  randomPitch,
  score,
} from "./batting";

export interface GameApi {
  stage: HTMLElement;
  canvas: HTMLCanvasElement;
  camera: THREE.PerspectiveCamera;
  scene: THREE.Scene;
  enter(): void;
  exit(): void;
  load(p: Params): FlightRecord;
  play(speed: number): void;
  t(): number;
  duration(): number;
  /** Show the flight path (after the pitch). */
  reveal(on: boolean): void;
  ghostOf(p: Params): FlightRecord;
  /** Pose the batter for swing progress 0..1. */
  swing(s: number): void;
  /** Hide the pitched ball (once it has been hit). */
  showPitchBall(on: boolean): void;
  flyCamera(p: Pose, seconds: number): void;
  catcherView(): void;
}

/** Real swing: about 0.16 s from launch to follow-through; contact at 55 % of it. */
const SWING_TIME = 0.16;
const CONTACT_AT = 0.55;

/** The hit ball: its record, a mesh, a growing tracer and a landing marker. */
interface Flight {
  rec: FlightRecord;
  call: FlightCall;
  start: number;
  group: THREE.Group;
  ball: THREE.Object3D;
  line: Line2;
  landed: boolean;
}

type State = "off" | "ready" | "countdown" | "pitching" | "result" | "summary";

const IN = 39.37007874;
const MPH = 2.236936;

export class BattingGame {
  state: State = "off";
  difficulty: Difficulty = "medium";
  private pitch: GamePitch | null = null;
  private rec: FlightRecord | null = null;
  private guess: { x: number; y: number } | null = null;
  private swingT = 0;
  private n = 0;
  private total = 0;
  private streak = 0;
  private best = 0;
  private hits = 0;
  private log: Outcome[] = [];
  private countdownEnd = 0;
  /** Where and when (sim time) the pitch crosses the plate. */
  private plate = { t: 0, x: 0, y: 0 };
  /** Wall time the ball passed the plate, and when the pitch record ran out. */
  private plateWall = 0;
  private endWall = 0;
  private flight: Flight | null = null;
  private cameraMoved = false;
  private markers = new THREE.Group();
  private root: HTMLElement;
  private el: Record<string, HTMLElement> = {};

  constructor(private api: GameApi) {
    api.scene.add(this.markers);
    this.root = document.getElementById("game")!;
    this.root.querySelectorAll<HTMLElement>("[data-g]").forEach((e) => (this.el[e.dataset.g!] = e));
    this.root.querySelectorAll<HTMLButtonElement>("[data-diff]").forEach((b) =>
      b.addEventListener("click", () => {
        this.difficulty = b.dataset.diff as Difficulty;
        this.paintDifficulty();
      }),
    );
    this.el.start.addEventListener("click", () => this.startRound());
    this.el.next.addEventListener("click", () => this.advance());
    this.el.again.addEventListener("click", () => this.startRound());
    this.el.quit.addEventListener("click", () => this.exit());
    this.el.quit2.addEventListener("click", () => this.exit());
    // A swing: the first press on the stage while the pitch is in the air.
    api.canvas.addEventListener(
      "pointerdown",
      (e) => {
        if (this.state !== "pitching" || this.guess) return;
        const t = this.simTime();
        if (t <= 0) return;
        const r = api.canvas.getBoundingClientRect();
        const hit = plateHit(api.camera, ((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
        if (!hit) return;
        this.guess = hit;
        this.swingT = t;
        this.placeGuess(hit);
        this.flash("Swing!");
      },
      { capture: true },
    );
  }

  get active() {
    return this.state !== "off";
  }

  enter() {
    this.api.enter();
    this.state = "ready";
    this.root.hidden = false;
    this.show("intro");
    this.paintDifficulty();
    this.paintScore();
  }

  exit() {
    this.endFlight();
    this.api.swing(0);
    this.api.showPitchBall(true);
    this.state = "off";
    this.root.hidden = true;
    this.clearMarkers();
    this.api.exit();
  }

  /** Keyboard: Space / Enter starts or advances. Returns true when handled. */
  key(e: KeyboardEvent): boolean {
    if (!this.active) return false;
    if (e.key === "Escape") {
      this.exit();
      return true;
    }
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      if (this.state === "ready" || this.state === "summary") this.startRound();
      else if (this.state === "result") this.advance();
      return true;
    }
    return true; // swallow the lab's shortcuts while playing
  }

  private startRound() {
    this.n = 0;
    this.total = 0;
    this.streak = 0;
    this.best = 0;
    this.hits = 0;
    this.log = [];
    this.nextPitch();
  }

  private advance() {
    if (this.n >= PITCHES_PER_ROUND) this.summary();
    else this.nextPitch();
  }

  private nextPitch() {
    this.endFlight();
    this.api.swing(0);
    this.api.showPitchBall(true);
    if (this.cameraMoved) {
      this.api.catcherView();
      this.cameraMoved = false;
    }
    this.n++;
    this.pitch = randomPitch();
    this.rec = this.api.load(this.pitch.params);
    const c = crossing(this.rec.r, this.rec.t, this.rec.n, 0)!;
    this.plate = c;
    this.plateWall = 0;
    this.endWall = 0;
    this.guess = null;
    this.clearMarkers();
    this.api.reveal(false);
    this.state = "countdown";
    this.countdownEnd = performance.now() + 900;
    this.show("none");
    this.flash("Ready…", 900);
    this.paintScore();
  }

  /** Called every frame by the lab. */
  update() {
    if (this.state === "countdown" && performance.now() >= this.countdownEnd) {
      this.state = "pitching";
      this.api.play(DIFFICULTY[this.difficulty].speed);
      this.flash("Click where it will cross the plate", 1400);
    } else if (this.state === "pitching") {
      const now = performance.now();
      if (!this.endWall && this.api.t() >= this.api.duration() - 1e-6) this.endWall = now;
      const st = this.simTime();
      if (!this.plateWall && st >= this.plate.t) this.plateWall = now;
      // A swing is settled once the ball reaches the plate; with no swing, wait out the late
      // window (a late click still counts — as a late swing).
      if (this.guess && st >= this.plate.t) this.finishPitch();
      else if (!this.guess && this.plateWall && now - this.plateWall >= LATE_WINDOW_MS) this.finishPitch();
    }
    this.animateSwing();
    this.animateFlight();
  }

  /** Sim time; once the pitch record runs out it keeps going in the same slow motion. */
  private simTime() {
    if (this.state === "countdown") return 0;
    if (!this.endWall) return this.api.t();
    return this.api.duration() + ((performance.now() - this.endWall) / 1000) * DIFFICULTY[this.difficulty].speed;
  }

  /** The swing launches at the click: the bat reaches the plate SWING_DELAY later. */
  private animateSwing() {
    if (!this.guess || this.state === "off") return;
    const start = this.swingT + SWING_DELAY - CONTACT_AT * SWING_TIME;
    this.api.swing((this.simTime() - start) / SWING_TIME);
  }

  private launch(out: Outcome, a: { x: number; y: number }) {
    if (!this.guess) return;
    const c = contactFrom(out, a, this.guess);
    if (!c) return;
    const rec = simulate(battedParams(this.pitch!.params, a, c));
    const call = callFlight(rec.r, rec.n, c.launch);
    const group = new THREE.Group();
    const ball = createBallMesh(rec.params);
    ball.scale.setScalar(rec.ball.diameter * 2); // enlarged so it reads from the high camera
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xfff0d0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    glow.scale.setScalar(0.9);
    ball.add(glow);
    glow.scale.setScalar(0.9 / (rec.ball.diameter * 2));
    const geo = new LineGeometry();
    geo.setPositions(Array.from(rec.r.subarray(0, 3 * rec.n)));
    geo.instanceCount = 0;
    const lineMat = new LineMaterial({ color: call.kind === "foul" ? 0xd8dde0 : 0xf5a04a, linewidth: 4, worldUnits: false, fog: false });
    const rc = this.api.canvas.getBoundingClientRect();
    lineMat.resolution.set(rc.width, rc.height);
    const line = new Line2(geo, lineMat);
    line.frustumCulled = false;
    group.add(ball, line);
    this.api.scene.add(group);
    this.flight = { rec, call, start: performance.now(), group, ball, line, landed: false };
    this.api.showPitchBall(false);
    // After a beat at the plate, cut to a high home-plate camera framing the landing spot.
    const end = rec.n - 1;
    const land = new THREE.Vector3(rec.r[3 * end], 0, rec.r[3 * end + 2]);
    const mid = land.clone().multiplyScalar(0.55);
    window.setTimeout(() => {
      if (this.flight?.rec !== rec) return;
      this.cameraMoved = true;
      // High above the backstop (in front of the grandstand), looking out over the whole flight.
      const far = Math.max(30, land.length());
      this.api.flyCamera(
        { position: new THREE.Vector3(land.x * 0.08, 10 + far * 0.18, 13), target: new THREE.Vector3(mid.x, 0, mid.z), fov: 52 },
        0.9,
      );
    }, 350);
  }

  private animateFlight() {
    const f = this.flight;
    if (!f) return;
    const t = (performance.now() - f.start) / 1000; // the hit plays at real speed
    const rec = f.rec;
    const i = Math.min(rec.n - 1, Math.floor(t / rec.dt));
    f.ball.position.set(rec.r[3 * i], rec.r[3 * i + 1], rec.r[3 * i + 2]);
    f.line.geometry.instanceCount = Math.max(0, i);
    if (i === rec.n - 1 && !f.landed) {
      f.landed = true;
      const mark = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.3, 40), new THREE.MeshBasicMaterial({ color: 0xf5a04a, side: THREE.DoubleSide, transparent: true, opacity: 0.9, fog: false }));
      mark.rotation.x = -Math.PI / 2;
      mark.position.set(rec.r[3 * i], 0.05, rec.r[3 * i + 2]);
      const tag = textSprite(`${f.call.title} ${f.call.feet} ft`, 3.2, "#ffd2a6");
      tag.position.set(rec.r[3 * i], 4, rec.r[3 * i + 2]);
      f.group.add(mark, tag);
      this.flash(`${f.call.title} ${f.call.feet} ft`, 2200);
    }
  }

  private endFlight() {
    const f = this.flight;
    if (!f) return;
    this.api.scene.remove(f.group);
    f.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mt = m.material as THREE.Material | undefined;
      mt?.dispose();
    });
    this.flight = null;
  }

  private finishPitch() {
    const rec = this.rec!;
    const a = [this.plate.x, this.plate.y];
    const timing = this.guess ? this.swingT + SWING_DELAY - this.plate.t : 0;
    const out = score({ x: a[0], y: a[1] }, this.guess, this.difficulty, timing);
    this.log.push(out);
    this.total += out.points;
    if (extendsStreak(out.verdict)) {
      this.streak++;
      this.hits++;
    } else if (breaksStreak(out.verdict)) this.streak = 0;
    this.best = Math.max(this.best, this.streak);
    this.state = "result";
    this.api.reveal(true);
    this.placeActual(a[0], a[1]);
    this.launch(out, { x: a[0], y: a[1] });
    // Result card.
    const ghost = this.api.ghostOf(this.pitch!.params);
    const gc = crossing(ghost.r, ghost.t, ghost.n, 0);
    const g = gc ? [gc.x, gc.y] : arrival(ghost);
    const speed = Math.hypot(rec.v[0], rec.v[1], rec.v[2]) * MPH;
    const brk = this.pitch!.knuckle ? ` · knuckle broke ${lateralLabel((a[0] - g[0]) * IN, "baseball", 1, " in")}` : "";
    const where = out.strike ? "a strike" : "a ball";
    const ms = Math.round(Math.abs(timing) * 1000);
    const when = ms <= 3 ? "right on time" : `${ms} ms ${timing < 0 ? "early" : "late"}`;
    const swing =
      this.guess && out.miss !== undefined ? `Your bat was ${when}, ${(out.miss * IN).toFixed(1)} in from the ball. (On-time window ±20 ms; ±40 ms for a foul.)` : "You didn't swing.";
    this.el.verdict.textContent = out.title;
    this.el.verdict.className = `game__verdict game__verdict--${out.verdict}`;
    this.el.points.textContent = out.points ? `+${out.points}` : "0";
    this.el.pitch.textContent = `${this.pitch!.name} · ${speed.toFixed(0)} mph · ${where}${brk}`;
    this.el.swing.textContent = swing;
    const hit = this.flight?.call;
    this.el.hit.hidden = !hit;
    if (hit) this.el.hit.textContent = hit.kind === "foul" ? `Foul ball into ${hit.field}.` : `${hit.title} ${hit.feet} ft to ${hit.field}.`;
    this.el.next.textContent = this.n >= PITCHES_PER_ROUND ? "See your score" : "Next pitch";
    this.show("result");
    this.paintScore();
  }

  private summary() {
    this.endFlight();
    if (this.cameraMoved) {
      this.api.catcherView();
      this.cameraMoved = false;
    }
    this.api.showPitchBall(true);
    this.state = "summary";
    const barrels = this.log.filter((o) => o.verdict === "barrel").length;
    const takes = this.log.filter((o) => o.verdict === "goodTake").length;
    const chases = this.log.filter((o) => o.verdict === "chase").length;
    this.el.final.textContent = `${this.total}`;
    const pl = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
    this.el.finalNote.textContent = `${pl(this.hits, "hit", "hits")} (${barrels} barrelled) · ${pl(takes, "good take", "good takes")} · ${pl(chases, "chase", "chases")} · best streak ${this.best} · ${DIFFICULTY[this.difficulty].label}`;
    this.show("summary");
    this.clearMarkers();
  }

  // ------------------------------------------------------------- display

  private show(panel: "intro" | "result" | "summary" | "none") {
    for (const p of ["intro", "result", "summary"]) this.el[p].hidden = p !== panel;
  }

  private flash(text: string, ms = 700) {
    const f = this.el.flash;
    f.textContent = text;
    f.hidden = false;
    f.classList.remove("is-on");
    void f.offsetWidth; // restart the animation
    f.classList.add("is-on");
    clearTimeout((f as unknown as { _t: number })._t);
    (f as unknown as { _t: number })._t = window.setTimeout(() => (f.hidden = true), ms);
  }

  private paintScore() {
    this.el.count.textContent = `Pitch ${Math.max(this.n, 1)} of ${PITCHES_PER_ROUND}`;
    this.el.score.textContent = `${this.total}`;
    this.el.streak.textContent = `${this.streak}`;
  }

  private paintDifficulty() {
    this.root.querySelectorAll<HTMLButtonElement>("[data-diff]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.diff === this.difficulty)));
  }

  private clearMarkers() {
    for (const c of [...this.markers.children]) {
      this.markers.remove(c);
      const m = c as THREE.Mesh;
      m.geometry?.dispose();
      (m.material as THREE.Material)?.dispose();
    }
  }

  private disc(x: number, y: number, color: number, ring: boolean) {
    const geo = ring ? new THREE.RingGeometry(0.03, 0.042, 40) : new THREE.CircleGeometry(0.032, 40);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthTest: false, fog: false }));
    m.position.set(x, y, 0);
    m.renderOrder = 10;
    this.markers.add(m);
  }

  private placeGuess(p: { x: number; y: number }) {
    this.disc(p.x, p.y, 0x4fd1ff, true);
  }

  private placeActual(x: number, y: number) {
    this.disc(x, y, 0xf08a24, false);
    if (this.guess) {
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(this.guess.x, this.guess.y, 0), new THREE.Vector3(x, y, 0)]),
        new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthTest: false, fog: false }),
      );
      line.renderOrder = 10;
      this.markers.add(line);
    }
  }
}
