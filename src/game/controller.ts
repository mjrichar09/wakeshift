// Batting game: catcher view, a random pitch with no tracer, and one click to say where it
// will cross the plate — before it gets there. Then the path is revealed and scored.

import * as THREE from "three";
import type { Params } from "../physics/params";
import type { FlightRecord } from "../physics/simulate";
import { arrival } from "../physics/simulate";
import { lateralLabel } from "../physics/frames";
import type { Difficulty, GamePitch, Outcome } from "./batting";
import { DIFFICULTY, PITCHES_PER_ROUND, breaksStreak, extendsStreak, plateHit, randomPitch, score } from "./batting";

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
        const t = api.t();
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
    this.n++;
    this.pitch = randomPitch();
    this.rec = this.api.load(this.pitch.params);
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
    } else if (this.state === "pitching" && this.api.t() >= this.api.duration() - 1e-6) {
      this.finishPitch();
    }
  }

  private finishPitch() {
    const rec = this.rec!;
    const a = arrival(rec);
    const out = score({ x: a[0], y: a[1] }, this.guess, this.difficulty);
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
    // Result card.
    const ghost = this.api.ghostOf(this.pitch!.params);
    const g = arrival(ghost);
    const speed = Math.hypot(rec.v[0], rec.v[1], rec.v[2]) * MPH;
    const brk = this.pitch!.knuckle ? ` · knuckle broke ${lateralLabel((a[0] - g[0]) * IN, "baseball", 1, " in")}` : "";
    const where = out.strike ? "a strike" : "a ball";
    const swing =
      this.guess && out.miss !== undefined
        ? `Your swing was ${(out.miss * IN).toFixed(1)} in from the ball, ${((this.api.duration() - this.swingT) * 1000).toFixed(0)} ms before it reached the plate.`
        : "You didn't swing.";
    this.el.verdict.textContent = out.title;
    this.el.verdict.className = `game__verdict game__verdict--${out.verdict}`;
    this.el.points.textContent = out.points ? `+${out.points}` : "0";
    this.el.pitch.textContent = `${this.pitch!.name} · ${speed.toFixed(0)} mph · ${where}${brk}`;
    this.el.swing.textContent = swing;
    this.el.next.textContent = this.n >= PITCHES_PER_ROUND ? "See your score" : "Next pitch";
    this.show("result");
    this.paintScore();
  }

  private summary() {
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
