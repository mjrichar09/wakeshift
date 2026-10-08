// "About the model" (the honesty section of the plan) and the guided tour of the ¼-turn preset.

export const ABOUT_HTML = `
<h2>About the model</h2>
<p>This lab shows <b>why</b> a nearly spinless ball moves: where the seam (or panel groove)
sits, which side of the boundary layer it trips, which side separates later, and the
sideways push that results. It is a teaching model, not a predictor of any real pitch.</p>

<h3>What is simplified</h3>
<ul>
  <li><b>Semi-empirical forces.</b> The side force comes from a simplified separation model
  calibrated to plausible magnitudes (peak C<sub>S</sub> set by the "C_S,max" slider). Nothing here
  solves the Navier–Stokes equations.</li>
  <li><b>Separation model.</b> Around the ball, in ${"N_φ"} sectors: a seam inside the trip zone
  (default 35°–75° from the front) trips that side to turbulent separation at about 115°;
  a seam right at the laminar line (≈82°) pins separation there; otherwise it separates
  laminar at ≈82°. Above the critical Reynolds number every sector is turbulent and the
  asymmetry collapses. The force points toward the side that separates <b>later</b>.</li>
  <li><b>Chaos stand-in.</b> Real knuckleball and float-serve wakes are unsteady and partly
  chaotic. The optional wake-noise term (an Ornstein–Uhlenbeck process at the shedding
  frequency) is a stand-in for that, not a model of it.</li>
  <li><b>Schematic flow.</b> Streamlines follow analytic potential flow upstream until the
  local separation line, then bend into an illustrative wake that is deflected opposite the
  side force. The wake and smoke are drawings of the idea, not computed flow.</li>
  <li><b>Air.</b> Density comes from temperature, altitude (barometric formula) and humidity;
  viscosity from Sutherland's law. Temperature gradients along a 20 m flight are negligible,
  so temperature only enters through ρ and μ.</li>
  <li><b>Integration.</b> RK4 with a fixed 1 ms step. Aerodynamic coefficients are evaluated once
  per step; orientation is analytic (fixed spin axis). Playback only reads the stored record,
  so slow motion and frame steps are exact.</li>
</ul>

<h3>Directions</h3>
<p>+x is always the <b>catcher's (or passer's) right</b>; in baseball that is the
<b>first-base side</b>. A right-handed pitcher releases from the third-base side. The corner
gizmo shows where 1B (or the passer's right) and the flight direction point for whichever
camera you are using; behind the pitcher or in the ball chase, 1B is on the screen's left.</p>

<h3>Explore the sensitivity</h3>
<p>Every tunable constant is exposed (Aero model folder): trip-zone angles, laminar and
turbulent separation angles, the pin band, the number of sectors, C<sub>S,max</sub>, the Magnus
slope and the drag modulation. Changing them and watching what happens is half the point.
The "empirical curve" mode swaps the geometric model for an editable C<sub>S</sub>(seam angle)
table, for comparison.</p>
`;

export interface TourStep {
  title: string;
  body: string;
  enter: () => void;
}

export class Tour {
  private i = 0;
  private el: HTMLElement;
  constructor(private steps: TourStep[]) {
    this.el = document.getElementById("tour")!;
    document.getElementById("tour-next")!.addEventListener("click", () => this.go(this.i + 1));
    document.getElementById("tour-back")!.addEventListener("click", () => this.go(this.i - 1));
    document.getElementById("tour-close")!.addEventListener("click", () => this.close());
  }
  start() {
    this.el.hidden = false;
    this.el.closest(".stage")?.classList.add("is-touring");
    this.go(0);
  }
  close() {
    this.el.hidden = true;
    this.el.closest(".stage")?.classList.remove("is-touring");
  }
  get open() {
    return !this.el.hidden;
  }
  private go(i: number) {
    if (i >= this.steps.length) return this.close();
    this.i = Math.max(0, i);
    const s = this.steps[this.i];
    document.getElementById("tour-step")!.textContent = `Guided tour · ${this.i + 1} of ${this.steps.length}`;
    document.getElementById("tour-title")!.textContent = s.title;
    document.getElementById("tour-body")!.innerHTML = s.body;
    (document.getElementById("tour-back") as HTMLButtonElement).disabled = this.i === 0;
    document.getElementById("tour-next")!.textContent = this.i === this.steps.length - 1 ? "Done" : "Next";
    s.enter();
  }
}
