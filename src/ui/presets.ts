// Named starting points. Each is a patch on the sport's defaults (pure data; tests use it).

import type { ParamsPatch, Params, Sport } from "../physics/params";
import { defaultParams, withPatch } from "../physics/params";

export interface Preset {
  id: string;
  label: string;
  blurb: string;
  patch: ParamsPatch;
}

export const BASEBALL_PRESETS: Preset[] = [
  { id: "zero", label: "Zero spin", blurb: "No rotation: the seam stays put and the ball drifts one way.", patch: { spin: { revPerSec: 0 } } },
  {
    id: "quarter",
    label: "1/4 turn",
    blurb: "A quarter turn on the way in: the seams sweep through the trip zone and the side force swings.",
    patch: { spin: { revPerSec: 0.45 } },
  },
  { id: "half", label: "1/2 turn", blurb: "Half a turn: the side force reverses during the flight.", patch: { spin: { revPerSec: 0.9 } } },
  { id: "one", label: "1 turn", blurb: "One full turn: the pushes start to average out.", patch: { spin: { revPerSec: 1.8 } } },
  {
    id: "tooMuch",
    label: "Too much spin (2+ turns)",
    blurb: "Several turns: the seam force averages away and the pitch flattens out.",
    patch: { spin: { revPerSec: 4.2 } },
  },
  {
    id: "denver",
    label: "High altitude (Denver)",
    blurb: "Thin air at 1609 m: less dynamic pressure, so every aerodynamic push shrinks.",
    patch: { spin: { revPerSec: 0.45 }, env: { altitudeM: 1609, tempC: 26, humidity: 0.3 } },
  },
  {
    id: "humidNight",
    label: "Humid night game",
    blurb: "Warm, saturated air is slightly less dense than dry air.",
    patch: { spin: { revPerSec: 0.45 }, env: { tempC: 26, humidity: 0.95, altitudeM: 20 } },
  },
  {
    id: "headwind",
    label: "Headwind",
    blurb: "A 6 m/s wind blowing in from the plate: more airspeed, more push, a shorter knuckle.",
    patch: { spin: { revPerSec: 0.45 }, env: { windSpeed: 6, windDirDeg: 180, outdoor: true } },
  },
];

export const VOLLEYBALL_PRESETS: Preset[] = [
  { id: "still", label: "Indoor still air", blurb: "A standing float serve in a closed gym.", patch: {} },
  {
    id: "hvac",
    label: "HVAC draft",
    blurb: "A slow draft from the vents toward the passer's right, with gentle gusts.",
    patch: { env: { windSpeed: 0.8, windDirDeg: 90, gustIntensity: 0.3, gustTau: 2 } },
  },
  {
    id: "beach",
    label: "Beach crosswind",
    blurb: "Outdoors with a 5 m/s crosswind toward the passer's right and real gusts.",
    patch: { env: { windSpeed: 5, windDirDeg: 90, gustIntensity: 1, gustTau: 1.2, outdoor: true, tempC: 29, humidity: 0.7, altitudeM: 0 } },
  },
  {
    id: "fast",
    label: "Fast serve (supercritical)",
    blurb: "A hard jump float starts above the drag crisis: every panel is turbulent, so it only floats late, once drag has slowed it into the crisis band.",
    patch: { release: { speed: 23, vAngleDeg: 3.5, height: 3.0 } },
  },
  {
    id: "slow",
    label: "Slow serve",
    blurb: "Well below the drag crisis: panel edges trip one side or the other and the ball dances.",
    patch: { release: { speed: 15, vAngleDeg: 18 } },
  },
];

export const presetsFor = (sport: Sport) => (sport === "baseball" ? BASEBALL_PRESETS : VOLLEYBALL_PRESETS);

export function presetParams(sport: Sport, id: string): Params {
  const pr = presetsFor(sport).find((x) => x.id === id);
  if (!pr) throw new Error(`unknown preset ${sport}/${id}`);
  return withPatch(defaultParams(sport), pr.patch);
}
