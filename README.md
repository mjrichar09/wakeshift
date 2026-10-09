# Knuckleball Lab

An interactive 3D lab for low-spin ball flight: the baseball **knuckleball** and the
volleyball **float serve**. Set the release, the seam orientation, the spin and the air.
Then watch the flight in slow motion from several cameras, with force arrows, the
separation ring, surface pressure, schematic streamlines and the wake laid over it.
The point is to see *why* the ball moves.

Built from `knuckleball-lab-PLAN.md`. The stage, camera rig, style tokens, Vercel setup and
screenshot harness are adapted from the Bioreactor Lab.

## Using it

- **Presets** load a scenario; its explanation plays in the caption bar. Baseball: the
  knuckleball family, conditions, and ordinary pitches (four-seam, sinker, cutter, slider,
  curveball, changeup, splitter). Volleyball: float serves, conditions, and spin serves (jump
  and standing topspin, sidespin, a beach sky ball). Release angles of the spin pitches and
  serves were solved with the simulator so they arrive in the zone / land in the court.
- **Batting game** (masthead button): catcher view, a random pitch (half knuckleballs with a
  random seam orientation, half spin pitches with location jitter) and no tracer. Click where it
  will cross the plate before it gets there: within 1.5 in barrels it, 3 in is solid contact,
  5 in a foul tip; laying off a ball scores too. Ten pitches a round at 0.35×, 0.6× or real time.
  The click is cast onto the plate plane from the camera, so guesses are measured in real inches.
  The batter swings the bat's sweet spot (about 6 in from the end) to exactly where you click,
  bending and reaching for low and away pitches; out-of-reach clicks get as close as his arms
  allow. Contact is judged along the whole bat: anywhere the ball touches it (bat radius + ball
  radius from its centreline) is contact, with a barrel near your click, solid contact within
  about 4 in along it, and weak contact elsewhere (jammed, off the end, topped, under it).
  The swing launches at the click and the bat reaches the plate 0.1 s (game time) later: within
  ±20 ms of the ball is on time, ±40 ms a foul at best, more is a miss; clicks are taken until
  half a second after the ball passes (late). The batter swings, and contact is simulated as a
  batted ball (exit speed and launch from contact quality, pull/opposite field from timing and
  location; drag and lift calibrated to big-league distances) and followed from a high camera.
- **Hover** any overlay chip, preset or the small "i" next to a setting for an explanation (with a
  color key where it applies).
- **Cameras** (keys 1–9): fixed views you can orbit once they arrive; **Ball cam** follows the
  ball and lets you orbit and zoom around it while it flies; **Flow lab** holds the ball still
  and streams the air past.
- **Close-up** (bottom-left, key `C`): a picture-in-picture of the ball with labelled forces.
- **Chips** on the right of the scene toggle overlays; the **caption** narrates what the air is
  doing at the playhead; dots on the **timeline** mark the peak push, push reversals and
  drag-crisis crossings.
- **Cards** on the right hold every control, with Basic and Advanced tabs. The spin-axis clock is
  drawn as the catcher sees it and the wind compass from above with the pitcher at the top, so
  1B is on the right of both (tested against the physics).
- **Graphics: Auto** drops to a lighter mode (no shadows or image lighting, pixel ratio 1, no
  glow) if the frame rate stays under ~30 fps; force it with High/Low in the Display card.

```bash
npm install
npm run dev                  # http://localhost:5173
npm test                     # physics, frames/left-right, cameras, flow overlays, sharing
npm run build                # static site in dist/
npm run csv -- baseball quarter out/quarter.csv   # dump a FlightRecord (any sport/preset)
node scripts/shots.mjs http://localhost:5173/ shots   # Playwright screenshots + behaviour checks
```

`scripts/shots.mjs` uses Edge on Windows by default. Set `CHROMIUM_PATH` to point it at another
Chromium build.

## Left and right (read this before touching geometry)

The physics frame **is** the Three.js world frame, so no axes are swapped anywhere:

| Axis | Meaning |
|---|---|
| +y | up |
| +z | direction of flight: pitcher → plate, server → passer |
| +x | the **catcher's / passer's right**; in baseball, the **first-base side** |

Consequences, each pinned by a test (`tests/physics/frames.test.ts`, `tests/scene/cameras.test.ts`,
`tests/scene/flow.test.ts`):

- The right-handed batter's box is on the **3B side** (x < 0). A right-handed pitcher releases from x < 0.
- Catcher, passer, overhead, flow-lab and close-up views show +x on the **right** of the screen.
- Behind the pitcher, behind the server and in the ball cam's starting pose, +x is on the
  **left** of the screen.
  The corner gizmo always shows where 1B (or "R") points.
- `hAngleDeg`, `lateral` and the HUD's break use + = 1B / passer's right. Wind direction is where
  the wind blows **to**: 0° = tailwind, 90° = toward +x. Spin tilt is a clock face seen by the
  catcher: 0° backspin (Magnus up), 90° Magnus toward +x.
- User-facing text uses `lateralLabel()` in `src/physics/frames.ts` ("toward 1B / 3B") rather than
  bare "left/right". In-scene text labels carry no arrows, because an arrow would point the wrong way from
  behind the server.
- The record's quaternion is `[w, x, y, z]`. `toThreeQuat()` converts it to Three.js order, and a test
  checks the two rotate vectors identically.

## Model (semi-empirical; see the in-app "About the model")

- `src/physics/`: pure TypeScript, no Three dependency, so the spray worker can use it.
  - It integrates with fixed-step RK4 at dt = 1 ms. Orientation is analytic, `q(t) = R(ω̂, θ(t))·q0`.
  - `simulate(params)` returns a `FlightRecord`; playback, charts and overlays only read it.
- **Separation model** (`aero/separation.ts`): in N_φ azimuthal sectors around ê, a seam can do one of three things.
  - In the trip zone (35°–75°) it trips that sector, so separation moves back to ≈115°.
  - Near the laminar line (≈82°) it pins separation at the seam.
  - Otherwise the sector separates laminar at ≈82°.
  - Smooth edges keep the forces continuous. Above the critical Re every sector blends to turbulent, and the asymmetry collapses.
- **Lateral force**: C_S·n̂ = k_S·(1/N)Σ(α_k − ᾱ)u_k, pointing toward the later-separating side.
  - k_S is calibrated so the peak |C_S| over all static orientations equals C_S,max.
  - An editable empirical C_S(seam angle) table is available as an alternative mode.
- **Other forces**:
  - Drag uses a C_d(Re) drag-crisis curve, shifted by roughness and seam height, and modulated by the mean separation angle.
  - Magnus uses C_L = k_M·S, soft-capped.
  - An optional OU wake-noise term runs at the Strouhal shedding frequency.
- **Air**: ρ comes from temperature, altitude and humidity; μ from Sutherland's law. Wind is a mean plus OU gusts, with optional log-profile shear outdoors.

All magnitudes are tunable starting defaults, exposed in the Aero model folder.

## Acceptance checks (all automated)

| Phase | Check | Where |
|---|---|---|
| 1 | ρ = 0 projectile, terminal velocity, energy non-increasing, symmetric → C_S≈0, 180° about ê flips n̂, drag-crisis sweep, determinism and seeds, ½ turn changes C_S sign, ¼ turn non-monotonic | `tests/physics/core.test.ts`, `npm run csv` |
| 2 | Frame step = 1 ms, 0.05× playback, every camera rendered | `scripts/shots.mjs` |
| 3–4 | Wake deflects opposite the side force; streamlines leave at the separation ring | `tests/scene/flow.test.ts` |
| 5 | 50-run spray ≈ 1 s (multi-worker; rendering pauses while it runs); chart click scrubs; URL hash round-trips | `scripts/shots.mjs`, `tests/scene/share.test.ts` |
| 6 | The fast serve floats less than the slow one (it starts supercritical, w_Re > 0.7) | `tests/physics/core.test.ts` |
| 7 | Phone layout with no horizontal overflow, guided tour (auto-starts on a first visit), About panel | `scripts/shots.mjs` |
| UX | Ball cam keeps its orbit target on the ball and keeps the user's orbit offset; close-up shows labelled forces; dials match the Magnus and wind vectors; captions name the right side | `scripts/shots.mjs`, `tests/scene/dials.test.ts`, `tests/scene/story.test.ts` |

## Deploying

`vercel.json` runs the tests, then `npm run build`, and serves `dist/`.
