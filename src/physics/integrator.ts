// Fixed-step classical RK4 on a 6-vector state [r, v].

export type State6 = Float64Array; // [rx, ry, rz, vx, vy, vz]
export type Deriv = (t: number, s: State6, out: State6) => void;

export class RK4 {
  private k1 = new Float64Array(6);
  private k2 = new Float64Array(6);
  private k3 = new Float64Array(6);
  private k4 = new Float64Array(6);
  private tmp = new Float64Array(6);

  constructor(private f: Deriv) {}

  /** Advance s in place from t to t + h. Returns k1 (the derivative at the start). */
  step(t: number, s: State6, h: number): State6 {
    const { k1, k2, k3, k4, tmp, f } = this;
    f(t, s, k1);
    for (let i = 0; i < 6; i++) tmp[i] = s[i] + 0.5 * h * k1[i];
    f(t + 0.5 * h, tmp, k2);
    for (let i = 0; i < 6; i++) tmp[i] = s[i] + 0.5 * h * k2[i];
    f(t + 0.5 * h, tmp, k3);
    for (let i = 0; i < 6; i++) tmp[i] = s[i] + h * k3[i];
    f(t + h, tmp, k4);
    for (let i = 0; i < 6; i++) s[i] += (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
    return k1;
  }
}
