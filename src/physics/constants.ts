// Ball specifications and field / court geometry (SI). See frames.ts for the axes.

export const G = 9.80665;

export interface BallSpec {
  name: string;
  mass: number; // kg
  diameter: number; // m
  /** Critical Reynolds number of a perfectly smooth sphere; roughness lowers it. */
  reCritSmooth: number;
  /** Subcritical and supercritical drag coefficients of the drag-crisis curve. */
  cdSub: number;
  cdSuper: number;
}

export const BASEBALL: BallSpec = {
  name: "Baseball",
  mass: 0.145,
  diameter: 0.074,
  reCritSmooth: 3.8e5,
  cdSub: 0.42,
  cdSuper: 0.2,
};

export const VOLLEYBALL: BallSpec = {
  name: "Volleyball",
  mass: 0.27,
  diameter: 0.21,
  reCritSmooth: 3.8e5,
  cdSub: 0.48,
  cdSuper: 0.14,
};

const FT = 0.3048;
const IN = 0.0254;

/**
 * Baseball field. Origin: center of the FRONT edge of home plate (the edge facing the
 * pitcher), on the ground. That edge is the "plate plane" z = 0 where flights end.
 * The plate extends toward +z (toward the catcher) and the pitcher is at −z.
 */
export const FIELD = {
  plateWidth: 17 * IN, // front edge, along x
  plateDepth: 17 * IN, // front edge to back tip, along +z
  plateSideDepth: 8.5 * IN,
  /** Back tip of the plate to the front of the rubber. */
  rubberDistance: 60.5 * FT,
  /** Release ~55 ft from the plate's back tip. */
  releaseFromTip: 55 * FT,
  strikeZoneBottom: 1.5 * FT,
  strikeZoneTop: 3.5 * FT,
  boxWidth: 4 * FT,
  boxLength: 6 * FT,
  boxGap: 6 * IN, // plate edge to the inner line of the batter's box
  baseDistance: 90 * FT,
  moundRadius: 9 * FT,
  moundHeight: 10 * IN,
};

/** z of the release point (negative: toward the pitcher). */
export const BASEBALL_RELEASE_Z = -(FIELD.releaseFromTip - FIELD.plateDepth);
/** z of the front of the pitching rubber. */
export const RUBBER_Z = -(FIELD.rubberDistance - FIELD.plateDepth);

/**
 * Volleyball court. Origin: center of the court under the net. The server is at −z
 * (behind the end line z = −9), the passer at +z. Sidelines at x = ±4.5.
 */
export const COURT = {
  length: 18,
  width: 9,
  attackLine: 3, // from the net
  netHeightMen: 2.43,
  netHeightWomen: 2.24,
  netWidth: 9.5,
  postOffset: 5.5,
  antennaHeight: 0.8, // above the net tape
};
