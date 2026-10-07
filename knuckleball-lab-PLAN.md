# Knuckleball & Float Serve Lab — Build Plan

An interactive 3D web app for studying low-spin ball flight: a knuckleball in baseball and a float serve in volleyball. The user adjusts release conditions, ball orientation, spin, and environment. They then watch the flight in slow motion from several camera positions, with force vectors, separation lines, and schematic airflow overlaid. The goal is to show *why* the ball moves.

> **For Claude Code:** Build in the phases listed in §9. Each phase has acceptance criteria, and you should finish one phase before starting the next. The physics core must be pure, deterministic, and unit-tested before any graphics work begins. Where this plan gives a number as a "starting default," treat it as a tunable parameter, not a fact. Expose it in the UI or a config file.

---

## 1. Goals and non-goals

**Goals**
- Show the mechanism: seam or panel position, asymmetric boundary-layer separation, a lateral force, and a wandering path.
- Let the user change one variable and immediately compare against the previous path.
- Include slow motion, scrubbing, and frame-stepping through a precomputed flight.
- Offer multiple camera views, including a "flow lab" view where the camera rides with the ball.
- Show indicators that make the forces visible: force arrows, separation rings, surface pressure, streamlines, the wake, and live charts.
- Support both sports with one shared physics core.

**Non-goals**
- Real CFD. The aerodynamics are **semi-empirical**, and the flow lines are **schematic**. The UI must say so clearly.
- Quantitative prediction of a specific real pitch. Magnitudes are calibrated to look plausible and are tunable.

---

## 2. Tech stack

| Concern | Choice |
|---|---|
| Language/build | TypeScript + Vite |
| 3D | Three.js (vanilla) |
| Controls UI | Tweakpane (quick, nested folders, good for sliders) |
| Charts | uPlot (small, fast, easy to sync with a playhead) |
| Heavy batch sims | Web Worker for "spray" mode (N noisy runs) |
| Tests | Vitest |
| Lint/format | ESLint + Prettier |

Physics uses **SI units internally**. The display layer converts units: mph, ft, and in for baseball; m/s and m for volleyball, with a unit toggle.

---

## 3. Project structure

```
src/
  physics/
    constants.ts        # ball specs, field/court geometry
    environment.ts      # air density, viscosity, wind + gust model
    geometry/
      baseballSeam.ts   # parametric seam curve on unit sphere
      volleyballPanels.ts # panel-boundary curves (selectable designs)
    aero/
      separation.ts     # per-azimuth separation-angle model
      forces.ts         # drag, seam lateral force, Magnus, noise
      dragCurve.ts      # Cd vs Re (with drag crisis), roughness shift
    integrator.ts       # RK4, fixed dt, returns full trajectory record
    rng.ts              # seeded RNG (mulberry32) + OU process
    simulate.ts         # simulate(params) -> FlightRecord
  scene/
    world.ts            # renderer, lights, field/court meshes
    ball.ts             # ball mesh + procedural seam/panel texture
    cameras.ts          # camera rigs + smooth transitions
    overlays/
      forceArrows.ts
      trail.ts          # path, ghost path, comparison paths
      separationRing.ts
      surfacePressure.ts
      streamlines.ts
      wake.ts
    playback.ts         # time scale, scrub, step, loop
  ui/
    panel.ts            # Tweakpane controls
    hud.ts              # live numbers
    charts.ts           # uPlot panels synced to playhead
    presets.ts
  workers/
    spray.worker.ts
  main.ts
tests/
  physics/*.test.ts
```

---

## 4. Physics model

### 4.1 State and integration
- The state is position **r**, velocity **v**, orientation quaternion **q**, and angular velocity **ω**.
- **ω** is constant by default. An optional small spin-decay parameter can be enabled.
- Integrate with fixed-step RK4 (dt = 1 ms) until the ball crosses the plate plane or touches the floor.
- `simulate()` returns a **FlightRecord**: an array of samples containing t, r, v, q, every individual force vector, Re, Cd, the lateral coefficient, the separation angles per azimuth, and the seam angle. **Playback only reads this record.** That is what makes slow motion, scrubbing, and frame-stepping trivial and exact.

### 4.2 Environment (`environment.ts`)
- Air density ρ comes from temperature, pressure, and humidity (moist-air ideal gas). Pressure comes from altitude via the barometric formula.
- Dynamic viscosity μ comes from Sutherland's law.
- Wind is a mean vector (speed and direction) plus an optional gust: a 3D Ornstein–Uhlenbeck process with tunable intensity and time scale.
- Optional wind shear (a log profile with height) applies to outdoor baseball.
- Relative velocity is **v_rel = v − v_wind(r, t)**. All aerodynamic forces use v_rel.
- Note for the "about" panel: temperature gradients over the flight path are negligible. Temperature enters only through ρ and μ.

### 4.3 Ball specs (`constants.ts`)
| | Baseball | Volleyball (indoor) |
|---|---|---|
| Mass | 0.145 kg | 0.27 kg |
| Diameter | 0.074 m | 0.21 m |
| Surface | raised seam (height param) | panel grooves (depth param), selectable panel design |
| Geometry | release ~55 ft from plate tip, strike zone | 18 × 9 m court, net 2.43 m (men) / 2.24 m (women) |

### 4.4 Forces (`forces.ts`)
Let q_dyn = ½ρ|v_rel|², let A = πd²/4, and let **ê** = v_rel/|v_rel|.

1. **Gravity**: m**g**.
2. **Drag**: −q_dyn·A·C_d·**ê**. C_d comes from `dragCurve.ts` (C_d vs Re, with a drag crisis whose critical Re shifts with roughness) and is modulated by the mean separation angle from the separation model. Later average separation gives lower C_d.
3. **Magnus**: q_dyn·A·C_L·(**ω̂** × **ê**), with C_L ≈ k_M·S, where S = rω/|v_rel|. Starting default: k_M ≈ 1.5. The force is small at knuckleball spins, but keep it so high-spin presets behave normally.
4. **Seam/panel lateral force** (the core of the app; see §4.5): q_dyn·A·C_S·**n̂**, where **n̂** ⟂ **ê**.
5. **Unsteady wake force**: q_dyn·A·C_N(t)·**m̂**(t), where C_N is an OU process. Its characteristic frequency is tied to vortex shedding, f ≈ St·|v_rel|/d with St ≈ 0.2. It has a seeded RNG and an on/off toggle with an intensity slider. Off by default, so runs stay deterministic.

### 4.5 Separation model (`separation.ts`) — the key mechanism
This model makes seam orientation matter, and it is physically motivated.

1. Work in the **flow frame**. Measure the polar angle α from the front stagnation point (aligned with −**ê**). Divide the circumference into N_φ azimuthal sectors (starting default 36).
2. Transform the seam or panel-boundary curve into the flow frame using the current **q**.
3. For each sector φ:
   - If a seam or groove lies in the **trip zone**, α ∈ [α_trip_min, α_trip_max] (starting defaults 35°–75°), the boundary layer is **tripped**. Separation moves to α_turb (default ~115°).
   - Else, if a seam lies near the laminar separation line, α ∈ [α_lam − δ, α_lam + δ], separation is **pinned at the seam's α**.
   - Otherwise the boundary layer stays **laminar** and separation occurs at α_lam (default ~82°).
   - Smooth all transitions with sigmoids, not hard switches. This keeps the forces continuous and the integrator happy.
4. **Reynolds-number weighting** w(Re) ∈ [0, 1]. Tripping matters in the subcritical-to-critical range. At supercritical Re, every sector is turbulent anyway, so the asymmetry collapses. Blend each sector's separation toward α_turb as Re rises past the ball's critical Re. Volleyball float serves sit right in this band, and the app should make that visible.
5. **Lateral coefficient**: compute the vector sum of each sector's separation-angle deviation from the mean, projected onto the plane ⟂ **ê**. The force points toward the side with **later** separation.
   C_S·**n̂** = k_S · (1/N_φ) Σ_φ (α_sep(φ) − ᾱ)·**u**(φ)
   Set k_S so the peak |C_S| sweeping a static ball through all orientations lands near a target C_S,max. Starting default ≈ 0.2. Expose it as a calibration slider.
6. Provide an alternative **"empirical curve" mode**: C_S(θ) from a user-editable periodic lookup table vs seam angle, for comparison with the geometric model. A toggle chooses between the two modes.

### 4.6 Derived quantities to record
Record Re, S, C_d, C_S, the seam angle (orientation about the spin axis), the number of rotations completed, and the per-sector separation state. For a **reference path**, also record a run with the seam force disabled, so the user can see the break as the gap between the two paths.

### 4.7 Spin semantics in the UI
Spin rate is entered in rev/s, with a live readout of **"≈ X rotations before reaching the plate/net"**. This number is the intuitive one for knuckleballs (¼–1 rotation is the interesting range). The spin axis is set by two angles. Release orientation is set by grip presets plus fine adjustment with three Euler sliders.

---

## 5. Visualization

### 5.1 Ball rendering
- **Baseball**: white leather material with the seam drawn from the same parametric curve the physics uses: red stitching as tube geometry or a decal. It must match the physics geometry exactly.
- **Volleyball**: panel boundaries from the same geometry module, with selectable panel designs. Use generic colors only, with no brand marks.
- The ball rotates according to the recorded **q**, so the user can see the seams turning.

### 5.2 Force and state indicators (each toggleable, with an arrow-scale slider)
| Indicator | Color (suggested) |
|---|---|
| Velocity | white |
| Gravity | gray |
| Drag | red |
| Magnus | purple |
| Seam/panel lateral | orange (the hero arrow) |
| Unsteady wake | yellow, thin |
| Net aerodynamic | cyan |

- **Separation ring**: a line drawn on the ball surface at α_sep(φ). Color each segment by state: laminar = blue, tripped/turbulent = orange, pinned at seam = magenta. This is the single most explanatory overlay.
- **Trip zone band**: an optional translucent band on the surface showing where a seam would trip the boundary layer.
- **Surface pressure**: an optional vertex-color map. Use potential-flow Cp = 1 − (9/4)sin²α up to the local separation angle, then a constant base pressure.

### 5.3 Airflow (schematic; label it "schematic flow, not CFD")
- **Streamlines**: analytic potential flow around a sphere in the ball frame, seeded on a grid upstream. Streamlines follow potential flow until they reach the local separation line. They then leave tangentially and join the wake.
- **Wake**: a particle system behind the ball whose axis is **deflected opposite to the lateral force**. Add recirculation jitter and shedding oscillation at the Strouhal frequency. Wake width scales with mean separation angle.
- **Particle mode**: optional advected smoke particles, colored by local speed.
- Full detail renders in the **flow lab** camera. Other views get a lightweight version: wake only, plus the arrows.

### 5.4 Trail and comparison
- The trail is a polyline of the path, colored by |lateral acceleration|, which shows *where* the break happens.
- A **ghost path** shows the same release with seam force off (§4.6).
- **Compare mode**: "Pin run" locks the current path as a faded overlay, up to 5 pinned runs, each with a legend entry listing the changed parameters.
- **Spray mode**: N runs (default 50) with noise on, or with randomized orientation within a tolerance. Computed in a Web Worker. Shows a scatter of arrival points at the plate or court, with a strike zone or target box drawn.

### 5.5 HUD
Show time, speed (in display units), Re, C_d, C_S, spin parameter S, rotations completed, seam angle, and current lateral displacement from the ghost path.

### 5.6 Charts (bottom drawer, synced to the playhead)
1. Lateral force (horizontal and vertical components) vs time
2. Seam angle vs time
3. Re and C_d vs time (with the drag-crisis band shaded)
4. Top-down and side-on displacement from the ghost path

Clicking a chart scrubs the playback to that time.

---

## 6. Playback

- Speeds: 1×, 0.5×, 0.25×, 0.1×, 0.05×, 0.02×, plus a free slider.
- Controls: play/pause, timeline scrub, frame step (±1 ms of sim time), loop, and "replay last."
- Keyboard: space = play/pause, ←/→ = step, 1–9 = camera presets, P = pin run.
- Optional auto-slow: playback slows down automatically when |lateral acceleration| exceeds a threshold, to highlight the dance.

---

## 7. Cameras

| Baseball | Volleyball |
|---|---|
| Catcher's view | Passer's view |
| Batter's view (RHH / LHH) | Server's view (behind) |
| Behind pitcher | Side (along the net) |
| Side (1B line) | Overhead |
| Overhead | Ball chase |
| Ball chase (trailing) | Flow lab |
| **Flow lab** (ball-fixed frame, air streams past; ball centered) | Free orbit |
| Free orbit | |

- Use smooth eased transitions between cameras.
- Flow lab has its own mini orbit, so the user can circle the stationary ball while the flow animates.
- **Split screen**: an optional two-up view (for example catcher + flow lab), synced to the same playhead.

---

## 8. Controls panel

- **Sport**: Baseball / Volleyball. This swaps the ball, the scene, the presets, and the unit defaults.
- **Release**: speed, vertical angle, horizontal angle, release height, lateral release point.
- **Spin**: rate (with rotations-to-target readout), axis (2 angles).
- **Orientation**: grip preset + 3 fine-adjust sliders. Show a small 3D preview of the ball as the flow will see it at release.
- **Ball**: seam height or groove depth, roughness (shifts the drag crisis), and panel design (volleyball).
- **Environment**: temperature, altitude, humidity, wind speed and direction, gust intensity and time scale, indoor/outdoor.
- **Aero model**: geometric vs empirical-curve mode, C_S,max calibration, trip-zone angles, α_lam, α_turb, noise on/off and seed.
- **Overlays**: a toggle for every indicator in §5, plus arrow scale.
- **Presets**:
  - Baseball: zero spin, ¼ turn, ½ turn, 1 turn, too much spin (2+ turns), high altitude (Denver), humid night game, headwind.
  - Volleyball: indoor still air, HVAC draft, beach crosswind, fast serve (supercritical, floats less), slow serve.
- **Share**: encode all params in the URL hash so a configuration can be bookmarked.

---

## 9. Build phases and acceptance criteria

### Phase 1: Physics core (no graphics)
- Implement §4 completely, plus a tiny CLI script that dumps a FlightRecord to CSV.
- **Tests (Vitest)**:
  - With ρ = 0, the trajectory matches the analytic projectile solution within tolerance.
  - Drag-only vertical drop approaches the analytic terminal velocity.
  - Mechanical energy is non-increasing with no wind.
  - A symmetric orientation (seam pattern mirror-symmetric about the flow plane) gives C_S ≈ 0.
  - Rotating the ball 180° about **ê** flips the direction of **n̂**.
  - A Re sweep on a static ball reproduces a drag-crisis-shaped C_d curve.
  - The same params and seed produce an identical record; a different seed with noise on produces a different record.
  - A spin rate giving ~½ rotation produces a C_S(t) that changes sign during flight.
- **Accept** when all tests pass and the CSV for the "¼ turn" preset shows a visibly non-monotonic lateral force.

### Phase 2: Scene, ball, playback, cameras
- Field and court scenes, a ball with exact seam geometry rotating per **q**, the full playback system (§6), and all cameras (§7).
- **Accept** when you can play any preset at 0.05× and step frame by frame, and every camera works with smooth transitions.

### Phase 3: Core indicators
- Force arrows, trail with ghost path, separation ring, HUD.
- **Accept** when the separation ring visibly changes color segments as the seam rotates, and the orange arrow swings correspondingly.

### Phase 4: Flow visualization
- Streamlines, wake, surface pressure, flow lab polish, and the "schematic" label.
- **Accept** when the wake visibly deflects opposite the lateral force and streamlines leave the surface at the separation ring.

### Phase 5: Analysis tools
- Charts synced to the playhead, compare and pin, spray mode in a worker, URL-hash sharing.
- **Accept** when spray mode with 50 runs finishes in under ~1 s on a laptop and charts scrub the playback.

### Phase 6: Volleyball
- Panel geometry and designs, court, cameras, presets, and an emphasized Re-band visualization.
- **Accept** when the "fast serve" preset shows reduced float relative to "slow serve," explained by the Re chart.

### Phase 7: Polish
- Responsive layout (usable on a tablet; phone gets a reduced overlay set), performance pass (target 60 fps with all overlays on a mid-range laptop), an "About the model" panel explaining the assumptions, and a short guided tour that walks through the ¼-turn preset.

---

## 10. Model honesty (put this in the About panel)

- Forces come from a simplified separation model calibrated to plausible magnitudes. They are not solved from the Navier–Stokes equations.
- Real knuckleball and float-serve flows are unsteady and partly chaotic. The noise term is a stand-in for that, not a model of it.
- Flow lines are schematic: potential flow upstream and an illustrative wake downstream.
- All tunable constants are exposed so the user can explore sensitivity, which is half the point.

---

## 11. Possible extensions (later)
- Import measured pitch-tracking data (release velocity, spin, and movement) and fit k_S and the trip-zone parameters.
- Sensitivity sweep: a heat map of break magnitude vs (release orientation × spin rate).
- Export a video clip of any playback.
- Additional balls: soccer knuckle shot, cricket swing bowling (the same separation mechanism, applied deliberately).
