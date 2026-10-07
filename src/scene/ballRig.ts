// The ball plus everything drawn around it, in one ball-centered group scaled to the
// ball radius (×display size). The field scene and the flow lab each own one rig, so the
// two views always show the same state.

import * as THREE from "three";
import type { Params } from "../physics/params";
import { createBallMesh } from "./ball";
import type { FlowSnapshot } from "./flowState";
import { ForceArrows } from "./overlays/forceArrows";
import type { ArrowKey } from "./overlays/forceArrows";
import { SeparationRing } from "./overlays/separationRing";
import { SurfacePressure } from "./overlays/surfacePressure";
import { Streamlines, Smoke } from "./overlays/streamlines";
import { Wake } from "./overlays/wake";

export interface OverlayFlags {
  arrows: Record<ArrowKey, boolean>;
  arrowScale: number;
  ring: boolean;
  tripBand: boolean;
  pressure: boolean;
  streamlines: boolean;
  wake: boolean;
  smoke: boolean;
  trail: boolean;
  ghost: boolean;
  strikeZone: boolean;
  figures: boolean;
  flowAnimation: boolean;
}

export const defaultOverlays = (): OverlayFlags => ({
  arrows: { velocity: false, gravity: false, drag: true, magnus: false, seam: true, wake: false, aero: false },
  arrowScale: 1,
  ring: true,
  tripBand: false,
  pressure: false,
  streamlines: true,
  wake: true,
  smoke: false,
  trail: true,
  ghost: true,
  strikeZone: true,
  figures: true,
  flowAnimation: true,
});

export class BallRig {
  /** Positioned at the ball, not rotated, scaled to radius × display size. */
  readonly group = new THREE.Group();
  /** Rotated by the record's quaternion. */
  readonly spin = new THREE.Group();
  readonly ring = new SeparationRing();
  readonly pressure = new SurfacePressure();
  readonly wake: Wake;
  readonly arrows = new ForceArrows();
  readonly streamlines: Streamlines | null;
  readonly smoke: Smoke | null;
  private ballMesh: THREE.Group | null = null;
  private ballKey = "";
  private shedPhase = 0;
  private streamTick = 0;
  private staticKey = "";

  constructor(full: boolean) {
    this.wake = new Wake(full ? 700 : 260, full ? 0.11 : 0.14);
    this.ring.setGlow(full);
    this.streamlines = full ? new Streamlines() : null;
    this.smoke = full ? new Smoke() : null;
    this.group.add(this.spin, this.ring.group, this.pressure.mesh, this.wake.points);
    if (this.streamlines) this.group.add(this.streamlines.line);
    if (this.smoke) this.group.add(this.smoke.points);
  }

  /** The arrows live outside the scaled group: add them to the scene separately. */
  get arrowGroup() {
    return this.arrows.group;
  }

  setBall(p: Params) {
    const key = p.sport === "baseball" ? "baseball" : `vb:${p.ball.panelDesign}`;
    if (key === this.ballKey) return;
    this.ballKey = key;
    if (this.ballMesh) {
      this.spin.remove(this.ballMesh);
      this.ballMesh.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
      });
    }
    this.ballMesh = createBallMesh(p);
    this.spin.add(this.ballMesh);
  }

  setTripZone(minRad: number, maxRad: number) {
    this.ring.setTripZone(minRad, maxRad);
    this.staticKey = "";
  }

  setLineResolution(w: number, h: number) {
    this.ring.setResolution(w, h);
    this.streamlines?.material.resolution.set(w, h);
  }

  /**
   * @param flowSpeed visual flow speed (radii/s); shedHz visual shedding frequency
   * @param flowChanged the snapshot moved to a new sample (rebuild streamlines)
   */
  update(s: FlowSnapshot, f: OverlayFlags, dt: number, flowSpeed: number, shedHz: number, flowChanged: boolean) {
    // Ring and pressure depend only on the sample: rebuild them when it (or a toggle) changes.
    const key = `${f.ring}|${f.tripBand}|${f.pressure}`;
    if (flowChanged || key !== this.staticKey) {
      this.staticKey = key;
      this.ring.update(s, f.ring, f.tripBand);
      this.pressure.mesh.visible = f.pressure;
      if (f.pressure) this.pressure.update(s);
    }
    this.wake.points.visible = f.wake;
    const animDt = f.flowAnimation ? dt : 0;
    if (f.wake) this.wake.update(s, animDt, flowSpeed, shedHz);
    this.shedPhase += 2 * Math.PI * shedHz * animDt;
    if (this.streamlines) {
      this.streamlines.line.visible = f.streamlines;
      if (f.streamlines) {
        if (flowChanged || (f.flowAnimation && ++this.streamTick % 3 === 0)) this.streamlines.update(s, this.shedPhase);
        this.streamlines.animate(animDt, flowSpeed * 0.6);
      }
    }
    if (this.smoke) {
      this.smoke.points.visible = f.smoke;
      if (f.smoke) this.smoke.update(s, animDt, flowSpeed);
    }
  }

  resetSmoke(s: FlowSnapshot) {
    this.smoke?.reset(s);
  }
}
