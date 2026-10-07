// The separation line drawn on the ball at α_sep(φ), colored by state (laminar blue,
// tripped/turbulent orange, pinned at the seam magenta), plus the optional trip-zone band.
// Unit radius: the parent scales it to the ball.

import * as THREE from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import type { FlowSnapshot } from "../flowState";
import { flowPoint, sectorColor } from "../flowState";

export class SeparationRing {
  readonly group = new THREE.Group();
  readonly material = new LineMaterial({ linewidth: 5, vertexColors: true, worldUnits: false, depthTest: true });
  /** Faint second pass through the ball, so the far side of the ring still reads. */
  readonly ghostMaterial = new LineMaterial({ linewidth: 3, vertexColors: true, worldUnits: false, depthTest: false, transparent: true, opacity: 0.28 });
  readonly glowMaterial = new LineMaterial({ linewidth: 16, vertexColors: true, worldUnits: false, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false });
  private line: Line2;
  private behind: Line2;
  private glow: Line2;
  private glowEnabled = true;
  private band: THREE.Mesh;
  private bandRange = [0, 0];

  constructor() {
    this.line = new Line2(new LineGeometry(), this.material);
    this.line.renderOrder = 3;
    this.behind = new Line2(new LineGeometry(), this.ghostMaterial);
    this.behind.renderOrder = 2;
    this.glow = new Line2(new LineGeometry(), this.glowMaterial);
    this.glow.renderOrder = 4;
    this.band = new THREE.Mesh(
      new THREE.SphereGeometry(1.008, 64, 8, 0, Math.PI * 2, 0.6, 0.7),
      new THREE.MeshBasicMaterial({ color: 0xf08a24, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.group.add(this.behind, this.line, this.glow, this.band);
  }

  setResolution(w: number, h: number) {
    this.material.resolution.set(w, h);
    this.ghostMaterial.resolution.set(w, h);
    this.glowMaterial.resolution.set(w, h);
  }

  /** The glow is for close-ups (flow lab, picture-in-picture); in the field it swamps the ball. */
  setGlow(on: boolean) {
    this.glowEnabled = on;
  }

  setTripZone(minRad: number, maxRad: number) {
    if (this.bandRange[0] === minRad && this.bandRange[1] === maxRad) return;
    this.bandRange = [minRad, maxRad];
    this.band.geometry.dispose();
    this.band.geometry = new THREE.SphereGeometry(1.008, 64, 8, 0, Math.PI * 2, minRad, maxRad - minRad);
  }

  update(s: FlowSnapshot, showRing: boolean, showBand: boolean) {
    this.line.visible = showRing;
    this.behind.visible = showRing;
    this.glow.visible = showRing && this.glowEnabled;
    this.band.visible = showBand;
    if (showBand) this.band.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), s.e);
    if (!showRing) return;
    const N = s.n;
    const pos: number[] = [];
    const col: number[] = [];
    const p = new THREE.Vector3();
    const c = new THREE.Color();
    const SUB = 3; // vertices per sector for a smooth line
    for (let j = 0; j <= N * SUB; j++) {
      const x = j / SUB;
      const k = Math.floor(x) % N;
      const f = x - Math.floor(x);
      const a = s.alpha[k] * (1 - f) + s.alpha[(k + 1) % N] * f;
      flowPoint(s, a, (2 * Math.PI * x) / N, 1.025, p);
      pos.push(p.x, p.y, p.z);
      sectorColor(s, f < 0.5 ? k : (k + 1) % N, c);
      col.push(c.r, c.g, c.b);
    }
    const g = new LineGeometry();
    g.setPositions(pos);
    g.setColors(col);
    this.line.geometry.dispose();
    this.line.geometry = g;
    this.behind.geometry = g;
    this.glow.geometry = g;
  }
}
