// Named starting points. Each is a patch on the sport's defaults (pure data; tests use it).

import type { ParamsPatch, Params, Sport } from "../physics/params";
import { defaultParams, withPatch } from "../physics/params";

export interface Preset {
  id: string;
  label: string;
  /** Strip grouping: the low-spin family, conditions, then ordinary spin pitches/serves. */
  group: string;
  blurb: string;
  patch: ParamsPatch;
}

export const BASEBALL_PRESETS: Preset[] = [
  { id: "zero", group: "Knuckleball", label: "Zero spin", blurb: "No rotation: the seam stays put and the ball drifts one way.", patch: { spin: { revPerSec: 0 } } },
  {
    id: "quarter", group: "Knuckleball",
    label: "1/4 turn",
    blurb: "A quarter turn on the way in: the seams sweep through the trip zone and the side force swings.",
    patch: { spin: { revPerSec: 0.45 } },
  },
  { id: "half", group: "Knuckleball", label: "1/2 turn", blurb: "Half a turn: the side force reverses during the flight.", patch: { spin: { revPerSec: 0.9 } } },
  { id: "one", group: "Knuckleball", label: "1 turn", blurb: "One full turn: the pushes start to average out.", patch: { spin: { revPerSec: 1.8 } } },
  {
    id: "tooMuch", group: "Knuckleball",
    label: "Too much spin (2+ turns)",
    blurb: "Several turns: the seam force averages away and the pitch flattens out.",
    patch: { spin: { revPerSec: 4.2 } },
  },
  {
    id: "denver", group: "Conditions",
    label: "High altitude (Denver)",
    blurb: "Thin air at 1609 m: less dynamic pressure, so every aerodynamic push shrinks.",
    patch: { spin: { revPerSec: 0.45 }, env: { altitudeM: 1609, tempC: 26, humidity: 0.3 } },
  },
  {
    id: "humidNight", group: "Conditions",
    label: "Humid night game",
    blurb: "Warm, saturated air is slightly less dense than dry air.",
    patch: { spin: { revPerSec: 0.45 }, env: { tempC: 26, humidity: 0.95, altitudeM: 20 } },
  },
  {
    id: "headwind", group: "Conditions",
    label: "Headwind",
    blurb: "A 6 m/s wind blowing in from the plate: more airspeed, more push, a shorter knuckle.",
    patch: { spin: { revPerSec: 0.45 }, env: { windSpeed: 6, windDirDeg: 180, outdoor: true } },
  },
  // Ordinary spin pitches (right-handed pitcher). Spin rates are typical big-league values;
  // release angles were solved with the simulator so each arrives in the zone.
  {
    id: "fourSeam",
    group: "Other pitches",
    label: "Four-seam fastball",
    blurb: "94 mph with heavy backspin: Magnus lift holds it up, so it seems to rise. With 16 turns on the way in, the seams average out.",
    patch: { release: { speed: 42.02, vAngleDeg: -2.62, hAngleDeg: 1.01 }, spin: { revPerSec: 39.2, tiltDeg: 15, gyroDeg: 5 }, orientation: { grip: "symmetric", yawDeg: 0, pitchDeg: 0 } },
  },
  {
    id: "sinker",
    group: "Other pitches",
    label: "Sinker",
    blurb: "Spin axis tilted toward the arm side: less lift and run toward 3B (into a right-handed batter).",
    patch: { release: { speed: 41.13, vAngleDeg: -2.15, hAngleDeg: 3.03 }, spin: { revPerSec: 35.8, tiltDeg: 300, gyroDeg: 10 }, orientation: { grip: "seamFront", yawDeg: 0, pitchDeg: 0 } },
  },
  {
    id: "cutter",
    group: "Other pitches",
    label: "Cutter",
    blurb: "A fastball with the axis turned toward the glove side: a small late cut toward 1B.",
    patch: { release: { speed: 39.79, vAngleDeg: -1.49, hAngleDeg: 0.2 }, spin: { revPerSec: 40.8, tiltDeg: 55, gyroDeg: 35 }, orientation: { grip: "symmetric", yawDeg: 0, pitchDeg: 0 } },
  },
  {
    id: "slider",
    group: "Other pitches",
    label: "Slider",
    blurb: "Lots of gyro (bullet) spin, which makes no Magnus force; the rest pushes it toward 1B. It drops more than a fastball.",
    patch: { release: { speed: 38.0, vAngleDeg: -0.65, hAngleDeg: 0.83 }, spin: { revPerSec: 40.8, tiltDeg: 100, gyroDeg: 60 }, orientation: { grip: "symmetric", yawDeg: 0, pitchDeg: 0 } },
  },
  {
    id: "curveball",
    group: "Other pitches",
    label: "Curveball",
    blurb: "Topspin: Magnus pushes it down on top of gravity, a big looping drop toward the 1B side.",
    patch: { release: { speed: 35.32, vAngleDeg: 2.23, hAngleDeg: 0.88 }, spin: { revPerSec: 43.3, tiltDeg: 160, gyroDeg: 15 }, orientation: { grip: "symmetric", yawDeg: 0, pitchDeg: 0 } },
  },
  {
    id: "changeup",
    group: "Other pitches",
    label: "Changeup",
    blurb: "Slower, with less spin tilted to the arm side: it fades toward 3B and drops.",
    patch: { release: { speed: 38.0, vAngleDeg: -1.57, hAngleDeg: 2.88 }, spin: { revPerSec: 29.2, tiltDeg: 295, gyroDeg: 15 }, orientation: { grip: "seamFront", yawDeg: 0, pitchDeg: 0 } },
  },
  {
    id: "splitter",
    group: "Other pitches",
    label: "Splitter",
    blurb: "Low spin for a hard pitch: little lift, so it tumbles down late. About 9 turns: the seams still nudge it a little.",
    patch: { release: { speed: 38.45, vAngleDeg: -2.22, hAngleDeg: 2.27 }, spin: { revPerSec: 20, tiltDeg: 330, gyroDeg: 20 }, orientation: { grip: "seamFront", yawDeg: 0, pitchDeg: 0 } },
  },
];

export const VOLLEYBALL_PRESETS: Preset[] = [
  { id: "still", group: "Float serves", label: "Indoor still air", blurb: "A standing float serve in a closed gym.", patch: {} },
  {
    id: "hvac", group: "Conditions",
    label: "HVAC draft",
    blurb: "A slow draft from the vents toward the passer's right, with gentle gusts.",
    patch: { env: { windSpeed: 0.8, windDirDeg: 90, gustIntensity: 0.3, gustTau: 2 } },
  },
  {
    id: "beach", group: "Conditions",
    label: "Beach crosswind",
    blurb: "Outdoors with a 5 m/s crosswind toward the passer's right and real gusts.",
    patch: { env: { windSpeed: 5, windDirDeg: 90, gustIntensity: 1, gustTau: 1.2, outdoor: true, tempC: 29, humidity: 0.7, altitudeM: 0 } },
  },
  {
    id: "fast", group: "Float serves",
    label: "Fast serve (supercritical)",
    blurb: "A hard jump float starts above the drag crisis: every panel is turbulent, so it only floats late, once drag has slowed it into the crisis band.",
    patch: { release: { speed: 23, vAngleDeg: 3.5, height: 3.0 } },
  },
  {
    id: "slow", group: "Float serves",
    label: "Slow serve",
    blurb: "Well below the drag crisis: panel edges trip one side or the other and the ball dances.",
    patch: { release: { speed: 15, vAngleDeg: 18 } },
  },
  // Spin serves, for contrast with the floats. Launch angles solved to land in the court.
  {
    id: "jumpTopspin",
    group: "Other serves",
    label: "Jump topspin serve",
    blurb: "Hit hard from high with topspin: Magnus pushes it down so it dives in. Spin swamps the panels.",
    patch: { release: { speed: 24, vAngleDeg: 7.83, height: 3.15 }, spin: { revPerSec: 6, tiltDeg: 180 }, orientation: { grip: "symmetric" } },
  },
  {
    id: "standingTopspin",
    group: "Other serves",
    label: "Standing topspin",
    blurb: "A slower topspin serve with a high arc that drops steeply behind the net.",
    patch: { release: { speed: 18, vAngleDeg: 20.44, height: 2.55 }, spin: { revPerSec: 4, tiltDeg: 180 }, orientation: { grip: "symmetric" } },
  },
  {
    id: "sidespin",
    group: "Other serves",
    label: "Sidespin serve",
    blurb: "Spin about a near-vertical axis curves it toward the passer's right; aimed left to stay in.",
    patch: { release: { speed: 19, vAngleDeg: 9.15, hAngleDeg: -4, height: 2.6 }, spin: { revPerSec: 3, tiltDeg: 90 }, orientation: { grip: "symmetric" } },
  },
  {
    id: "skyBall",
    group: "Other serves",
    label: "Sky ball (beach)",
    blurb: "Served almost straight up outdoors: three seconds in the air for the wind and gusts to carry it.",
    patch: {
      release: { speed: 19, vAngleDeg: 67.98, height: 1.6 },
      spin: { revPerSec: 0.3 },
      env: { outdoor: true, windSpeed: 2, windDirDeg: 90, gustIntensity: 0.6 },
      sim: { maxTime: 6 },
    },
  },
];

export const presetsFor = (sport: Sport) => (sport === "baseball" ? BASEBALL_PRESETS : VOLLEYBALL_PRESETS);

export function presetParams(sport: Sport, id: string): Params {
  const pr = presetsFor(sport).find((x) => x.id === id);
  if (!pr) throw new Error(`unknown preset ${sport}/${id}`);
  return withPatch(defaultParams(sport), pr.patch);
}
