// Every simulation input. Physics is SI internally; the UI converts for display.
// Numbers the plan calls "starting defaults" are plain fields here and exposed in the UI.

import { BASEBALL_RELEASE_Z } from "./constants";

export type Sport = "baseball" | "volleyball";
export type PanelDesign = "classic18" | "cube6" | "octa8";
export type AeroMode = "geometric" | "empirical";
export type GripName = "symmetric" | "seamFront" | "lobeFront" | "maxBreak";

export interface Params {
  sport: Sport;
  release: {
    speed: number; // m/s
    /** Up from horizontal, deg. */
    vAngleDeg: number;
    /** Toward +x (catcher's / passer's right; 1B side), deg. */
    hAngleDeg: number;
    height: number; // m
    /** Release x: + = 1B side (catcher's right). A right-handed pitcher releases at x < 0. */
    lateral: number; // m
    /** Release z: negative, back from the plate plane / net. */
    z: number; // m
  };
  spin: {
    revPerSec: number;
    /**
     * Axis tilt as a clock face seen by the catcher/passer: 0° = backspin (Magnus up),
     * 90° = Magnus toward +x (1B side), 180° = topspin, 270° = Magnus toward −x.
     */
    tiltDeg: number;
    /** 0° = axis ⟂ flight; 90° = rifle (gyro) spin about the flight direction. */
    gyroDeg: number;
    /** Spin decay time constant, s; 0 = constant spin. */
    decayTau: number;
  };
  orientation: {
    grip: GripName;
    /** Fine adjust, applied in the world frame after the grip: about y, then x, then z. */
    yawDeg: number;
    pitchDeg: number;
    rollDeg: number;
  };
  ball: {
    /** Seam height (baseball) or groove depth (volleyball), relative to regulation (1). */
    seamHeight: number;
    /** 0 = smooth, 1 = very rough: lowers the critical Reynolds number. */
    roughness: number;
    panelDesign: PanelDesign;
  };
  env: {
    tempC: number;
    altitudeM: number;
    humidity: number; // 0..1
    windSpeed: number; // m/s (at the 10 m reference when outdoor shear is on)
    /** Direction the wind blows TOWARD: 0° = with the flight (+z), 90° = toward +x. */
    windDirDeg: number;
    gustIntensity: number; // m/s, std of each component
    gustTau: number; // s
    outdoor: boolean; // log-profile wind shear
    /** Test hook: force the air density (kg/m³). */
    densityOverride?: number;
  };
  aero: {
    mode: AeroMode;
    csMax: number;
    tripMinDeg: number;
    tripMaxDeg: number;
    alphaLamDeg: number;
    alphaTurbDeg: number;
    pinDeltaDeg: number;
    nPhi: number;
    kMagnus: number;
    /** How strongly the mean separation angle modulates C_d (0 = curve only). */
    cdModulation: number;
    seamForce: boolean;
    magnus: boolean;
    noise: boolean;
    noiseIntensity: number;
    strouhal: number;
    seed: number;
    /** Empirical mode: C_S at equally spaced seam angles over one turn. */
    empiricalTable: number[];
  };
  /** Volleyball only: net height (men 2.43 m, women 2.24 m). */
  court: { netHeight: number };
  sim: {
    dt: number;
    maxTime: number;
    /** Stop at the plate plane (baseball) / the far end of the court (volleyball). */
    stopAtTarget: boolean;
    stopAtFloor: boolean;
    /** Record per-sector separation detail (off for batch runs). */
    recordSectors: boolean;
  };
}

export const defaultEmpiricalTable = (csMax = 0.2, n = 24) =>
  Array.from({ length: n }, (_, i) => +(csMax * Math.sin((4 * Math.PI * i) / n)).toFixed(4));

const sharedAero = (): Params["aero"] => ({
  mode: "geometric",
  csMax: 0.2,
  tripMinDeg: 35,
  tripMaxDeg: 75,
  alphaLamDeg: 82,
  alphaTurbDeg: 115,
  pinDeltaDeg: 6,
  nPhi: 36,
  kMagnus: 1.5,
  cdModulation: 0.5,
  seamForce: true,
  magnus: true,
  noise: false,
  noiseIntensity: 0.05,
  strouhal: 0.2,
  seed: 1,
  empiricalTable: defaultEmpiricalTable(),
});

export function defaultParams(sport: Sport = "baseball"): Params {
  if (sport === "volleyball") {
    return {
      sport,
      release: { speed: 17, vAngleDeg: 14, hAngleDeg: 0, height: 2.6, lateral: 0, z: -10 },
      spin: { revPerSec: 0.15, tiltDeg: 0, gyroDeg: 0, decayTau: 0 },
      orientation: { grip: "seamFront", yawDeg: 20, pitchDeg: 10, rollDeg: 0 },
      ball: { seamHeight: 1, roughness: 0.25, panelDesign: "classic18" },
      env: {
        tempC: 21,
        altitudeM: 100,
        humidity: 0.45,
        windSpeed: 0,
        windDirDeg: 90,
        gustIntensity: 0,
        gustTau: 1.5,
        outdoor: false,
      },
      aero: { ...sharedAero(), csMax: 0.15 },
      court: { netHeight: 2.43 },
      sim: { dt: 0.001, maxTime: 4, stopAtTarget: true, stopAtFloor: true, recordSectors: true },
    };
  }
  return {
    sport,
    release: { speed: 31, vAngleDeg: 1.2, hAngleDeg: 1.0, height: 1.75, lateral: -0.45, z: BASEBALL_RELEASE_Z },
    spin: { revPerSec: 0.45, tiltDeg: 0, gyroDeg: 0, decayTau: 0 },
    orientation: { grip: "lobeFront", yawDeg: 120, pitchDeg: 60, rollDeg: 0 },
    ball: { seamHeight: 1, roughness: 0.5, panelDesign: "classic18" },
    env: {
      tempC: 22,
      altitudeM: 50,
      humidity: 0.5,
      windSpeed: 0,
      windDirDeg: 180,
      gustIntensity: 0,
      gustTau: 1.5,
      outdoor: true,
    },
    aero: sharedAero(),
    court: { netHeight: 2.43 },
    sim: { dt: 0.001, maxTime: 4, stopAtTarget: true, stopAtFloor: true, recordSectors: true },
  };
}

export const cloneParams = (p: Params): Params => structuredClone(p);

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends unknown[] ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K];
};
export type ParamsPatch = DeepPartial<Params>;

/** Deep-merge a patch onto params (arrays replace). Returns a new object. */
export function withPatch(p: Params, patch: ParamsPatch): Params {
  const out = cloneParams(p) as unknown as Record<string, unknown>;
  const merge = (dst: Record<string, unknown>, src: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(src)) {
      if (v && typeof v === "object" && !Array.isArray(v) && dst[k] && typeof dst[k] === "object")
        merge(dst[k] as Record<string, unknown>, v as Record<string, unknown>);
      else if (v !== undefined) dst[k] = Array.isArray(v) ? [...v] : v;
    }
  };
  merge(out, patch as Record<string, unknown>);
  return out as unknown as Params;
}
