// Arrival markers, broadcast style: where the ball arrives vs where the no-seam ghost
// arrives, joined by a line and labelled with the break. Baseball: on the plate plane
// (z = 0). Volleyball: flat on the floor. Fade in over the last part of the flight.

import * as THREE from "three";
import type { FlightRecord } from "../../physics/simulate";
import { arrival } from "../../physics/simulate";
import { textSprite } from "../world";

export class ArrivalMarkers {
  readonly group = new THREE.Group();
  private mats: THREE.Material[] = [];

  set(rec: FlightRecord, ghost: FlightRecord, label: string) {
    for (const c of [...this.group.children]) {
      this.group.remove(c);
      (c as THREE.Mesh).geometry?.dispose();
    }
    this.mats.forEach((m) => m.dispose());
    this.mats = [];
    const a = new THREE.Vector3(...arrival(rec));
    const g = new THREE.Vector3(...arrival(ghost));
    const floor = rec.params.sport === "volleyball";
    const R = rec.ball.diameter / 2;
    const ringR = Math.max(R * 1.4, floor ? 0.16 : 0.05);
    const mat = (color: number, opacity: number) => {
      const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false, fog: false });
      this.mats.push(m);
      return m;
    };
    const ring = (at: THREE.Vector3, color: number, filled: boolean) => {
      const geo = filled ? new THREE.CircleGeometry(ringR * 0.8, 40) : new THREE.RingGeometry(ringR * 0.85, ringR, 48);
      const m = new THREE.Mesh(geo, mat(color, filled ? 0.9 : 0.85));
      m.position.copy(at);
      if (floor) {
        m.rotation.x = -Math.PI / 2;
        m.position.y = 0.03;
      }
      m.renderOrder = 5;
      return m;
    };
    this.group.add(ring(g, 0xffffff, false), ring(a, 0xf08a24, true));
    // Connector, in the marker plane.
    const pa = a.clone();
    const pg = g.clone();
    if (floor) pa.y = pg.y = 0.03;
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([pg, pa]), new THREE.LineBasicMaterial({ color: 0xf08a24, transparent: true, opacity: 0.9, fog: false }));
    this.mats.push(line.material as THREE.Material);
    this.group.add(line);
    const tag = textSprite(label, floor ? 0.32 : 0.09, "#ffd2a6", "rgba(14,18,22,0.78)");
    tag.position.copy(pa).add(new THREE.Vector3(0, floor ? 0.45 : 0.1, 0));
    this.mats.push(tag.material);
    this.group.add(tag);
  }

  /** 0 hidden … 1 fully shown. */
  setReveal(k: number) {
    this.group.visible = k > 0.01;
    for (const m of this.mats) (m as THREE.MeshBasicMaterial).opacity = Math.min((m.userData.base ??= (m as THREE.MeshBasicMaterial).opacity), k * m.userData.base);
  }
}
