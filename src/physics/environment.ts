// Air properties and wind. Temperature enters only through ρ and μ: gradients along a
// 20 m flight are negligible.

import type { Params } from "./params";
import type { V3 } from "./vec";
import { Rng, OU } from "./rng";

/** Barometric formula (ISA troposphere), Pa. */
export function pressureAtAltitude(h: number) {
  return 101325 * Math.pow(1 - 2.25577e-5 * h, 5.25588);
}

/** Saturation vapour pressure over water (Buck), Pa. */
export function saturationVaporPressure(tC: number) {
  return 611.21 * Math.exp((18.678 - tC / 234.5) * (tC / (257.14 + tC)));
}

/** Moist-air density from temperature, altitude and relative humidity (0..1), kg/m³. */
export function airDensity(tC: number, altitudeM: number, humidity: number) {
  const T = tC + 273.15;
  const p = pressureAtAltitude(altitudeM);
  const pv = Math.min(Math.max(humidity, 0), 1) * saturationVaporPressure(tC);
  return (p - pv) / (287.058 * T) + pv / (461.495 * T);
}

/** Sutherland's law, Pa·s. */
export function airViscosity(tC: number) {
  const T = tC + 273.15;
  return (1.716e-5 * Math.pow(T / 273.15, 1.5) * (273.15 + 110.4)) / (T + 110.4);
}

export interface Air {
  rho: number;
  mu: number;
}

export function airFromParams(env: Params["env"]): Air {
  return {
    rho: env.densityOverride ?? airDensity(env.tempC, env.altitudeM, env.humidity),
    mu: airViscosity(env.tempC),
  };
}

/** Mean wind vector (at the 10 m reference when outdoor). Direction = blowing toward. */
export function meanWind(env: Params["env"]): V3 {
  const a = (env.windDirDeg * Math.PI) / 180;
  return [env.windSpeed * Math.sin(a), 0, env.windSpeed * Math.cos(a)];
}

const Z0 = 0.03; // roughness length of a grass field, m
const ZREF = 10;

/** Log-profile shear factor at height y (1 at the 10 m reference). */
export function shearFactor(y: number) {
  return Math.max(0, Math.log(Math.max(y, 0.1) / Z0) / Math.log(ZREF / Z0));
}

/** Mean wind + shear + an OU gust that advances once per integration step. */
export class WindField {
  private mean: V3;
  private gust: OU;
  constructor(
    private env: Params["env"],
    rng: Rng,
  ) {
    this.mean = meanWind(env);
    this.gust = new OU(rng, 3, env.gustIntensity);
  }
  step(dt: number) {
    this.gust.step(dt, this.env.gustTau);
  }
  at(r: V3): V3 {
    const k = this.env.outdoor ? shearFactor(r[1]) : 1;
    const g = this.gust.x;
    return [this.mean[0] * k + g[0], this.mean[1] * k + g[1] * 0.3, this.mean[2] * k + g[2]];
  }
}
