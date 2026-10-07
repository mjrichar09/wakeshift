// Display units. Physics stays SI; baseball defaults to mph / ft / in, volleyball to m/s / m.

export type UnitSystem = "imperial" | "metric";

export const MPH = 2.236936;
export const FT = 3.280839895;
export const IN = 39.37007874;

export const speedUnit = (u: UnitSystem) => (u === "imperial" ? "mph" : "m/s");
export const lenUnit = (u: UnitSystem) => (u === "imperial" ? "ft" : "m");
export const smallUnit = (u: UnitSystem) => (u === "imperial" ? "in" : "cm");
export const tempUnit = (u: UnitSystem) => (u === "imperial" ? "°F" : "°C");

export const toSpeed = (ms: number, u: UnitSystem) => (u === "imperial" ? ms * MPH : ms);
export const fromSpeed = (x: number, u: UnitSystem) => (u === "imperial" ? x / MPH : x);
export const toLen = (m: number, u: UnitSystem) => (u === "imperial" ? m * FT : m);
export const fromLen = (x: number, u: UnitSystem) => (u === "imperial" ? x / FT : x);
export const toSmall = (m: number, u: UnitSystem) => (u === "imperial" ? m * IN : m * 100);
export const fromSmall = (x: number, u: UnitSystem) => (u === "imperial" ? x / IN : x / 100);
export const toTemp = (c: number, u: UnitSystem) => (u === "imperial" ? (c * 9) / 5 + 32 : c);
export const fromTemp = (x: number, u: UnitSystem) => (u === "imperial" ? ((x - 32) * 5) / 9 : x);

export const fmtSpeed = (ms: number, u: UnitSystem, d = 1) => `${toSpeed(ms, u).toFixed(d)} ${speedUnit(u)}`;
export const fmtSmall = (m: number, u: UnitSystem, d = 1) => `${toSmall(m, u).toFixed(d)} ${smallUnit(u)}`;
export const fmtLen = (m: number, u: UnitSystem, d = 2) => `${toLen(m, u).toFixed(d)} ${lenUnit(u)}`;
