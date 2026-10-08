// Plain-language explanations for the controls and the overlay chips. Control tips are
// matched by label prefix, so sport-specific labels ("Aim (+ toward 1B)") share one entry.

import type { TipContent } from "./tip";
import { SPEED_GRADIENT_CSS } from "../scene/overlays/streamlines";

const CONTROL_TIPS: [string, string][] = [
  // Release
  ["Speed", "How fast the ball leaves the hand. Faster means more air speed past the ball: bigger forces, but less time for them to act, and a higher Reynolds number (see the drag crisis)."],
  ["Launch angle", "Angle above horizontal at release. Negative aims downward."],
  ["Aim", "Sideways aim at release, in degrees. Positive aims toward the catcher's right: the 1B side (or the passer's right)."],
  ["Release height", "Height of the ball when it leaves the hand: about 5.5–6 ft for a pitcher, about 2.6 m for a standing serve and over 3 m for a jump serve."],
  ["Release point", "Sideways position of the hand at release. A right-handed pitcher releases from the 3B side, so this is negative for a righty."],
  ["Contact point", "Sideways position where the server hits the ball, relative to the middle of the court."],
  ["Net", "Net height: 2.43 m for men, 2.24 m for women. A serve that crosses lower hits the net."],
  // Spin
  ["Spin rate", "Rotations per second. A knuckleball turns only about a quarter to one full turn on its way to the plate; a fastball turns about 16 times."],
  ["Spin axis", "Which way the spin pushes the ball (the Magnus force), drawn as a clock face from the catcher's view: 12 o'clock is backspin (lift), 3 o'clock pushes toward 1B, 6 o'clock is topspin (down)."],
  ["Gyro", "Tilts the spin axis toward the direction of flight. Spin about the flight direction (90°, like a rifle bullet) makes no Magnus force: the reason a slider breaks less than its spin rate suggests."],
  ["Spin decay", "How quickly the spin slows down. 0 keeps it constant, which is fine for a half-second pitch."],
  // Orientation
  ["Facing the", "Which part of the ball faces the oncoming air at release. Seams in the trip zone on one side make the air cling longer there and push the ball that way. 'Symmetric' balances them; 'Max push' finds the orientation with the strongest push."],
  ["Yaw", "Turns the ball about the vertical axis before release. Small turns move seams into or out of the trip zone: the knuckleball's most sensitive input."],
  ["Pitch (about", "Turns the ball about the 1B–3B axis (end over end) before release."],
  ["Roll", "Turns the ball about the flight direction before release. It swings the side force around the clock without changing its size."],
  // Air
  ["Wind speed", "Steady wind speed. Outdoors this is the speed 10 m up; it is weaker near the ground when wind shear is on."],
  ["Wind blows toward", "Where the wind blows to, seen from above with the pitcher (or server) at the top. 0° is a tailwind, 180° a headwind, 90° blows toward 1B (the passer's right)."],
  ["Temperature", "Warmer air is thinner, so every aerodynamic force is a little smaller. Temperature only enters through air density and viscosity."],
  ["Altitude", "Air thins with height. In Denver (1609 m) the air is about 17% less dense, so pitches break less and fly farther."],
  ["Humidity", "Water vapour is lighter than dry air, so humid air is slightly less dense, not heavier."],
  ["Gusts", "Random wind fluctuations (rms). They use the seed, so the same settings give the same flight."],
  ["Gust time scale", "How long a gust lasts before it changes, in seconds."],
  ["Outdoor wind shear", "Outdoors the wind is slowed by the ground (a logarithmic profile), so at ball height it is weaker than the 10 m wind speed."],
  ["Air density", "Mass of air per cubic metre, from temperature, altitude and humidity. Every aerodynamic force is proportional to it."],
  // Ball
  ["Seam height", "Taller seams trip the boundary layer more easily (×1 = regulation). With no seams (0) there is nothing to trip, and no knuckle."],
  ["Groove depth", "Deeper panel grooves trip the boundary layer more easily (×1 = regulation)."],
  ["Panels", "The panel layout decides where the grooves are, and so which orientations float most."],
  ["Roughness", "Rougher balls trip their boundary layer at lower speed, which moves the drag crisis to a lower Reynolds number."],
  ["Critical Reynolds", "The Reynolds number where the drag crisis happens. Above it the boundary layer is turbulent all round, drag drops, and seams or grooves stop mattering: no float."],
  // Model
  ["Side force from", "Separation model: the side force is computed from where the seams sit on the ball. Empirical curve: it is read from the table below as the ball turns, for comparison."],
  ["Peak side-force", "Calibrates the model: the strongest side-force coefficient any orientation can produce. Real knuckleballs measure around 0.1–0.3."],
  ["Unsteady wake noise", "Adds a random, flickering side force at the vortex-shedding frequency, as a stand-in for the chaotic wake. It uses the seed."],
  ["Trip zone starts", "Angle from the front of the ball where a seam starts to trip the boundary layer to turbulence."],
  ["Trip zone ends", "Angle from the front beyond which a seam no longer trips the boundary layer (it is too close to where the air lets go)."],
  ["Laminar separation", "Where smooth (laminar) air lets go of the ball, measured from the front: about 82° for a sphere."],
  ["Turbulent separation", "Where tripped (turbulent) air lets go: later, around 115°, because turbulent flow clings to the surface longer."],
  ["Pin band", "A seam within this many degrees of the laminar line pins separation right at the seam."],
  ["Sectors", "How many slices around the ball the separation model uses. More is smoother and slower."],
  ["Magnus slope", "How strongly spin makes lift: C_L ≈ k_M × (spin speed at the surface ÷ air speed)."],
  ["C_d ← separation", "How much tripped seams lower the drag (later separation means a narrower wake and less drag)."],
  ["Noise C_N", "Strength of the random wake force when noise is on."],
  ["Seed", "Random seed for the noise and gusts. The same seed always gives the same flight."],
  // Compare
  ["Spray runs", "How many throws a spray makes."],
  ["Spray varies", "Orientation: each throw starts with the ball turned slightly differently, which shows how unpredictable a knuckleball is. Wake noise: same throw, different random wake."],
  ["Orientation ±", "How far each spray throw's starting orientation may differ, in degrees."],
  // Display
  ["Units", "Display units only; the physics always runs in SI."],
  ["Graphics", "Auto starts on High and drops to Low if playback falls under about 30 frames a second. Low turns off shadows, image lighting and glow."],
  ["Close-up", "A small inset of the ball with its force arrows and their sizes (key C)."],
  ["Split screen", "Shows the chosen camera on the left and the flow lab on the right, in sync."],
  ["Enlarge the ball", "In far views a real-size ball is only a few pixels, so it is drawn larger (and with a glow). The path is never changed."],
  ["Extra ball size", "Draws the ball even larger, on top of the automatic enlargement."],
  ["Arrow length", "Scales the force arrows. Arrow length is proportional to force: 1 × the ball's weight is half a metre in the field."],
];

export function controlTip(label: string): string | undefined {
  return CONTROL_TIPS.find(([k]) => label.startsWith(k))?.[1];
}

/** Overlay chip tips, with a key where the overlay uses colors. */
export const CHIP_TIPS: Record<string, TipContent> = {
  arrows: {
    title: "Forces",
    body: "Arrows on the ball, each proportional to its force. The side force is the knuckleball's whole story; the rest set the stage.",
    key: [
      { swatch: "#f08a24", label: "Side (seam) force: pushes toward the side where air clings longer" },
      { swatch: "#d63a3a", label: "Drag: straight back against the motion" },
      { swatch: "#8a5cd6", label: "Magnus: from spin (tiny for a knuckleball)" },
      { swatch: "#8a9499", label: "Gravity" },
      { swatch: "#e8c838", label: "Wake noise (when on)" },
      { swatch: "#2fb8c9", label: "Net aerodynamic force" },
    ],
  },
  ring: {
    title: "Separation line",
    body: "Where the thin layer of air hugging the ball (the boundary layer) lets go. Air that lets go later on one side shifts the wake to the other side, and pushes the ball toward the late side.",
    key: [
      { swatch: "var(--sep-lam)", label: "Laminar: smooth flow, lets go early (≈82°)" },
      { swatch: "var(--sep-turb)", label: "Tripped by a seam: turbulent, clings longer (≈115°)" },
      { swatch: "var(--sep-pin)", label: "Pinned at a seam right on the laminar line" },
    ],
  },
  tripBand: {
    title: "Trip zone",
    body: "The band, measured from the front of the ball, where a seam or groove trips the boundary layer into turbulence. Watch seams slide into and out of it as the ball turns.",
    key: [{ swatch: "rgba(240,138,36,0.5)", label: "35°–75° from the front (adjustable)" }],
  },
  pressure: {
    title: "Surface pressure",
    body: "Pressure on the ball's surface: high where the air hits the front, low where it speeds over the shoulders, then roughly constant behind the separation line.",
    key: [
      { swatch: "#d8483b", label: "Above ambient (front stagnation point)" },
      { swatch: "#ffffff", label: "Ambient" },
      { swatch: "#3b6fd8", label: "Below ambient (suction)" },
    ],
  },
  streamlines: {
    title: "Airflow (flow lab)",
    body: "Streamlines past the ball held still: textbook potential flow upstream, peeling off at the separation line into the wake. Schematic, not CFD.",
    key: [
      { swatch: SPEED_GRADIENT_CSS, label: "Air speed: stalled → free stream → 1.5× over the shoulders" },
      { swatch: "#f0a25a", label: "Shear layers feeding the wake" },
    ],
  },
  wake: {
    title: "Wake",
    body: "The churning air behind the ball. It is deflected opposite the side force (push the air one way, the ball goes the other), and wider when the air lets go earlier.",
  },
  smoke: {
    title: "Smoke (flow lab)",
    body: "Particles carried by the schematic flow, colored by speed, like smoke in a wind tunnel.",
    key: [{ swatch: SPEED_GRADIENT_CSS, label: "Slow → fast" }],
  },
  trail: {
    title: "Tracer",
    body: "The ball's path, colored by how hard it is being pushed sideways at each point: bright where the break happens.",
    key: [{ swatch: "linear-gradient(90deg,#54739e,#f08a24,#ffeea0)", label: "Weak → strong side push" }],
  },
  ghost: {
    title: "No-seam ghost",
    body: "The same throw with the seam (or groove) force switched off. The gap between the tracer and the ghost is the break the seams caused.",
    key: [{ swatch: "repeating-linear-gradient(90deg,#fff 0 4px,transparent 4px 7px)", label: "Ghost path; the ring at the plate is where it arrives" }],
  },
  strikeZone: {
    title: "Strike zone",
    body: "17 in wide (the plate) and from about the knees (1.5 ft) to the letters (3.5 ft). Its front face is the plate plane where flights end.",
  },
  figures: {
    title: "Players",
    body: "Show or hide the batter (a right-hander, in the 3B-side box), the catcher and the passer. A camera at a player's eyes hides that player.",
  },
};
