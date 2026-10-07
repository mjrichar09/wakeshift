// Seeded randomness: mulberry32 uniform, Box–Muller normals, and an exact-discretized
// Ornstein–Uhlenbeck process (stationary std `sigma`, correlation time `tau`).

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  private u: () => number;
  private spare: number | null = null;
  constructor(seed: number) {
    this.u = mulberry32(seed);
  }
  uniform() {
    return this.u();
  }
  normal() {
    if (this.spare !== null) {
      const s = this.spare;
      this.spare = null;
      return s;
    }
    const u1 = Math.max(this.u(), 1e-12);
    const u2 = this.u();
    const r = Math.sqrt(-2 * Math.log(u1));
    this.spare = r * Math.sin(2 * Math.PI * u2);
    return r * Math.cos(2 * Math.PI * u2);
  }
}

/** Vector OU process; each component independent. Starts from a stationary draw. */
export class OU {
  readonly x: number[];
  constructor(
    private rng: Rng,
    dims: number,
    public sigma: number,
  ) {
    this.x = Array.from({ length: dims }, () => (sigma > 0 ? sigma * rng.normal() : 0));
  }
  step(dt: number, tau: number) {
    if (this.sigma <= 0) return this.x;
    const a = Math.exp(-dt / Math.max(tau, 1e-6));
    const b = this.sigma * Math.sqrt(1 - a * a);
    for (let i = 0; i < this.x.length; i++) this.x[i] = this.x[i] * a + b * this.rng.normal();
    return this.x;
  }
}
