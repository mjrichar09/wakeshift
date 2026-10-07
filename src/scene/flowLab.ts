// Flow lab: a separate ball-fixed scene in units of the ball radius. The ball sits at the
// origin and the air streams past it; world directions are kept (no rotation), so +x is
// still the catcher's/passer's right. It has its own mini orbit.

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { BallRig } from "./ballRig";
import { textSprite } from "./world";
import { backdropTexture } from "./textures";

/**
 * Default view: a three-quarter view from the upstream, +x quadrant (the catcher's right
 * front), so +x (1B / passer's right) is toward the right of the screen, the separation
 * ring on the near side is visible, and the wake trails away from you.
 */
export const FLOW_CAMERA = { position: new THREE.Vector3(5.8, 3.0, 4.8), target: new THREE.Vector3(0, 0, -0.8), fov: 38 };

export class FlowLab {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(FLOW_CAMERA.fov, 1, 0.05, 200);
  readonly controls: OrbitControls;
  readonly rig = new BallRig(true);
  private labels = new THREE.Group();

  constructor(dom: HTMLElement) {
    // A dusky wind-tunnel backdrop: deep slate fading to near black at the floor.
    this.scene.background = backdropTexture("#22303a", "#07090b");
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(3, 6, 5);
    const rim = new THREE.DirectionalLight(0x9fc7ff, 0.8);
    rim.position.set(-5, 2, -6);
    this.scene.add(key, rim, new THREE.HemisphereLight(0xe6eef2, 0x2a3034, 0.9));
    this.scene.add(this.rig.group, this.rig.arrowGroup, this.labels);


    this.camera.position.copy(FLOW_CAMERA.position);
    this.controls = new OrbitControls(this.camera, dom);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 2.4;
    this.controls.maxDistance = 20;
    this.controls.target.copy(FLOW_CAMERA.target);
    this.controls.enabled = false;
    this.controls.update();
  }

  setDirectionLabels(plusX: string, plusZ: string) {
    for (const c of [...this.labels.children]) this.labels.remove(c);
    const a = textSprite(`+x: ${plusX}`, 0.3, "#ffd9a8");
    a.position.set(3.0, -2.2, -0.6);
    const b = textSprite(plusZ, 0.3, "#cfe6ff");
    b.position.set(-0.4, -2.2, 3.2);
    this.labels.add(a, b);
  }

  resize(w: number, h: number) {
    this.camera.aspect = w / Math.max(h, 1);
    this.camera.updateProjectionMatrix();
  }
}
