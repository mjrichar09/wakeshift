// On-screen labels for the force arrows ("Side force 0.21 N"), positioned by projecting the
// arrow tips through a camera into a viewport rectangle of the stage.

import * as THREE from "three";
import type { ArrowKey } from "./overlays/forceArrows";
import { ARROW_COLORS } from "./overlays/forceArrows";

const NAMES: Record<ArrowKey, string> = {
  velocity: "Velocity",
  gravity: "Gravity",
  drag: "Drag",
  magnus: "Magnus",
  seam: "Side force",
  wake: "Wake noise",
  aero: "Net aero",
};

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export class ArrowLabels {
  private els = new Map<ArrowKey, HTMLElement>();

  constructor(private host: HTMLElement) {}

  update(tips: { key: ArrowKey; pos: THREE.Vector3; mag: number }[], camera: THREE.Camera, rect: Rect, show = true) {
    const seen = new Set<ArrowKey>();
    if (show)
      for (const t of tips) {
        const p = t.pos.clone().project(camera);
        if (p.z > 1 || Math.abs(p.x) > 1.05 || Math.abs(p.y) > 1.05) continue;
        let el = this.els.get(t.key);
        if (!el) {
          el = document.createElement("span");
          el.className = "arrow-label";
          el.style.setProperty("--c", `#${ARROW_COLORS[t.key].toString(16).padStart(6, "0")}`);
          this.host.appendChild(el);
          this.els.set(t.key, el);
        }
        const unit = t.key === "velocity" ? "m/s" : "N";
        el.textContent = `${NAMES[t.key]} ${t.mag < 0.1 ? t.mag.toFixed(3) : t.mag.toFixed(2)} ${unit}`;
        const sx = ((p.x + 1) / 2) * rect.w;
        const flip = sx > rect.w * 0.55;
        el.classList.toggle("is-left", flip);
        el.style.transform = `translate(${rect.x + sx}px, ${rect.y + ((1 - p.y) / 2) * rect.h}px)${flip ? " translateX(-100%)" : ""}`;
        el.hidden = false;
        seen.add(t.key);
      }
    for (const [k, el] of this.els) if (!seen.has(k)) el.hidden = true;
  }
}
