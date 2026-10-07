// Camera rigs. Fixed views are poses in the world frame (+x = catcher's/passer's right =
// 1B side); "chase" follows the ball; "flowlab" switches to the ball-fixed flow scene;
// "orbit" frees the camera. The eased CameraRig is adapted from the Bioreactor Lab.

import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Sport } from "../physics/params";

export interface Pose {
  position: THREE.Vector3;
  target: THREE.Vector3;
  fov: number;
}

export type ViewKind = "fixed" | "chase" | "flowlab" | "orbit";

export interface ViewDef {
  id: string;
  label: string;
  kind: ViewKind;
  pose?: Pose;
  /** First-person views hide the figures (the camera is at their eyes). */
  pov?: boolean;
}

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const pose = (p: THREE.Vector3, t: THREE.Vector3, fov: number): Pose => ({ position: p, target: t, fov });

export const BASEBALL_VIEWS: ViewDef[] = [
  { id: "catcher", label: "Catcher", kind: "fixed", pose: pose(v(0, 0.95, 1.25), v(0, 1.15, -16), 26) },
  // Right-handed batter stands in the 3B-side box (x < 0); left-handed on the 1B side.
  { id: "batterR", label: "Batter RHH", kind: "fixed", pov: true, pose: pose(v(-0.95, 1.62, 0.22), v(-0.25, 1.35, -16), 42) },
  { id: "batterL", label: "Batter LHH", kind: "fixed", pov: true, pose: pose(v(0.95, 1.62, 0.22), v(0.25, 1.35, -16), 42) },
  { id: "pitcher", label: "Behind pitcher", kind: "fixed", pose: pose(v(0, 2.3, -21.5), v(0, 0.9, 0), 20) },
  { id: "side", label: "Side (1B line)", kind: "fixed", pose: pose(v(9.5, 1.5, -8.2), v(0, 1.2, -8.2), 55) },
  // Looking down with the pitcher at the top of the screen: +x (1B) stays on the right.
  { id: "overhead", label: "Overhead", kind: "fixed", pose: pose(v(0, 26, -7.4), v(0, 0, -8.2), 42) },
  { id: "chase", label: "Ball chase", kind: "chase" },
  { id: "flowlab", label: "Flow lab", kind: "flowlab" },
  { id: "orbit", label: "Free orbit", kind: "orbit", pose: pose(v(8, 5, 5), v(0, 1, -8), 45) },
];

export const VOLLEYBALL_VIEWS: ViewDef[] = [
  { id: "passer", label: "Passer", kind: "fixed", pov: true, pose: pose(v(0, 1.62, 7.05), v(0, 2.2, -8), 50) },
  { id: "server", label: "Server (behind)", kind: "fixed", pose: pose(v(0, 3.3, -14), v(0, 1.6, 5), 45) },
  { id: "side", label: "Side (net line)", kind: "fixed", pose: pose(v(13.5, 3.2, 0), v(0, 1.6, 0), 58) },
  // Server at the top of the screen: the passer's right (+x) is on the right.
  { id: "overhead", label: "Overhead", kind: "fixed", pose: pose(v(0, 30, 0.6), v(0, 0, 0), 42) },
  { id: "chase", label: "Ball chase", kind: "chase" },
  { id: "flowlab", label: "Flow lab", kind: "flowlab" },
  { id: "orbit", label: "Free orbit", kind: "orbit", pose: pose(v(12, 7, 9), v(0, 1.5, 0), 50) },
];

export const viewsFor = (sport: Sport) => (sport === "baseball" ? BASEBALL_VIEWS : VOLLEYBALL_VIEWS);

/** Behind-and-above chase pose for a ball at r moving along dir; D scales with ball size. */
export function chasePose(r: THREE.Vector3, dir: THREE.Vector3, D: number): Pose {
  const flat = dir.clone().setY(dir.y * 0.3).normalize();
  return {
    position: r.clone().addScaledVector(flat, -D).add(new THREE.Vector3(0.35 * D, 0.32 * D, 0)),
    target: r.clone().addScaledVector(flat, 0.6 * D),
    fov: 40,
  };
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * Eases the camera from wherever it is to a pose, which may move (a chase pose is
 * re-evaluated every frame). Hands control back to orbiting when a static pose is reached.
 */
export class CameraRig {
  private from: Pose | null = null;
  private to: (() => Pose) | null = null;
  private t = 0;
  private duration = 1.1;
  private follow: (() => Pose) | null = null;
  private done: (() => void) | null = null;

  constructor(
    private camera: THREE.PerspectiveCamera,
    private controls: OrbitControls,
  ) {}

  get moving() {
    return this.to !== null;
  }

  /** Static target: orbit controls take over on arrival. */
  flyTo(target: Pose, duration = 1.1, onDone?: () => void) {
    this.start(() => target, duration, onDone);
    this.follow = null;
  }

  /** Moving target: keep following after arrival (controls stay off). */
  chase(get: () => Pose, duration = 1.1) {
    this.start(get, duration);
    this.follow = get;
  }

  jumpTo(p: Pose) {
    this.to = null;
    this.follow = null;
    this.apply(p);
    this.controls.enabled = true;
  }

  private start(get: () => Pose, duration: number, onDone?: () => void) {
    this.from = { position: this.camera.position.clone(), target: this.controls.target.clone(), fov: this.camera.fov };
    this.to = get;
    this.t = 0;
    this.duration = matchMedia("(prefers-reduced-motion: reduce)").matches ? 0.01 : duration;
    this.done = onDone ?? null;
    this.controls.enabled = false;
  }

  private apply(p: Pose) {
    this.camera.position.copy(p.position);
    this.controls.target.copy(p.target);
    this.camera.fov = p.fov;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(p.target);
  }

  update(dt: number) {
    if (this.to && this.from) {
      this.t = Math.min(1, this.t + Math.max(0, dt) / this.duration);
      const k = ease(this.t);
      const goal = this.to();
      this.camera.position.lerpVectors(this.from.position, goal.position, k);
      this.controls.target.lerpVectors(this.from.target, goal.target, k);
      this.camera.fov = THREE.MathUtils.lerp(this.from.fov, goal.fov, k);
      this.camera.updateProjectionMatrix();
      this.camera.lookAt(this.controls.target);
      if (this.t >= 1) {
        this.to = null;
        if (!this.follow) this.controls.enabled = true;
        const cb = this.done;
        this.done = null;
        cb?.();
      }
      return;
    }
    if (this.follow) {
      const goal = this.follow();
      const k = 1 - Math.exp(-dt * 10);
      this.camera.position.lerp(goal.position, k);
      this.controls.target.lerp(goal.target, k);
      this.camera.lookAt(this.controls.target);
    }
  }

  stopFollowing() {
    this.follow = null;
    this.to = null;
    this.controls.enabled = true;
  }
}
