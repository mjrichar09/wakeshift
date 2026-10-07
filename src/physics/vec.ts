// Small allocation-light vector and quaternion helpers for the physics core.
// V3 = [x, y, z]; Quat = [w, x, y, z] rotating body coordinates into world coordinates.

export type V3 = [number, number, number];
export type Quat = [number, number, number, number];

export const v3 = (x = 0, y = 0, z = 0): V3 => [x, y, z];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: V3): V3 => {
  const l = len(a);
  return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
};
export const addScaled = (a: V3, b: V3, k: number): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];

/** Two unit vectors completing a right-handed basis (e1, e2, e) around unit vector e. */
export function basisAround(e: V3): [V3, V3] {
  // Reference "up" unless e is nearly vertical; keeps e1 horizontal for level flight.
  const ref: V3 = Math.abs(e[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0];
  const e1 = norm(cross(ref, e)); // horizontal, ⟂ e
  const e2 = cross(e, e1);
  return [e1, e2];
}

export const qIdentity = (): Quat => [1, 0, 0, 0];

export function qAxisAngle(axis: V3, angle: number): Quat {
  const a = norm(axis);
  const s = Math.sin(angle / 2);
  return [Math.cos(angle / 2), a[0] * s, a[1] * s, a[2] * s];
}

export function qMul(a: Quat, b: Quat): Quat {
  return [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
  ];
}

export function qNormalize(q: Quat): Quat {
  const l = Math.hypot(q[0], q[1], q[2], q[3]);
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

export const qConj = (q: Quat): Quat => [q[0], -q[1], -q[2], -q[3]];

/** Rotate v by unit quaternion q. */
export function qRotate(q: Quat, v: V3): V3 {
  const [w, x, y, z] = q;
  // t = 2 * cross(q.xyz, v)
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [
    v[0] + w * tx + (y * tz - z * ty),
    v[1] + w * ty + (z * tx - x * tz),
    v[2] + w * tz + (x * ty - y * tx),
  ];
}

/** Shortest-arc rotation taking unit vector a onto unit vector b. */
export function qFromTo(a: V3, b: V3): Quat {
  const d = dot(a, b);
  if (d < -0.999999) {
    const axis = Math.abs(a[0]) < 0.9 ? cross([1, 0, 0], a) : cross([0, 1, 0], a);
    return qAxisAngle(axis, Math.PI);
  }
  const c = cross(a, b);
  return qNormalize([1 + d, c[0], c[1], c[2]]);
}

export const deg = Math.PI / 180;
