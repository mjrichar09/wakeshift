// Wake particles shed from the separation ring (unit radius; the parent scales it). The
// wake axis bends opposite to the side force, its width follows the separation angle,
// and it wobbles at a (slowed) Strouhal shedding frequency. Schematic.

import * as THREE from "three";
import type { FlowSnapshot } from "../flowState";
import { alphaAt, flowPoint } from "../flowState";
import { wakeAxis } from "./streamlines";

interface P {
  x: THREE.Vector3;
  v: THREE.Vector3;
  age: number;
  life: number;
}

export class Wake {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private alpha: Float32Array;
  private ps: P[] = [];
  private phase = 0;

  constructor(private count = 600, size = 0.08) {
    this.pos = new Float32Array(count * 3);
    this.alpha = new Float32Array(count);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute("alpha", new THREE.BufferAttribute(this.alpha, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { size: { value: size }, focal: { value: 800 }, color: { value: new THREE.Color(0xdfe7ea) } },
      // size is in ball radii; modelMatrix[0][0] is the group's (uniform) scale.
      vertexShader: `attribute float alpha; varying float vA; uniform float size; uniform float focal;
        void main() { vA = alpha; vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = max(1.5, size * modelMatrix[0][0] * focal / -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying float vA; uniform vec3 color;
        void main() { vec2 d = gl_PointCoord - 0.5; float r = dot(d, d); if (r > 0.25) discard;
          gl_FragColor = vec4(color, vA * (1.0 - r * 4.0) * 0.55); }`,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    for (let i = 0; i < count; i++) this.ps.push({ x: new THREE.Vector3(0, 0, -100), v: new THREE.Vector3(), age: 1e9, life: 1 });
  }

  /** Pixels per world unit at distance 1: viewport height / (2 tan(fov/2)). */
  setFocal(px: number) {
    (this.points.material as THREE.ShaderMaterial).uniforms.focal.value = px;
  }

  /**
   * @param speed visual flow speed in radii per second
   * @param shedHz visual shedding frequency
   */
  update(s: FlowSnapshot, dt: number, speed: number, shedHz: number) {
    this.phase += 2 * Math.PI * shedHz * dt;
    const axis = wakeAxis(s);
    const shed = s.seamDir.lengthSq() > 0 ? s.seamDir : s.e1;
    const spawnRate = this.count / 1.6;
    let toSpawn = Math.min(this.count, Math.round(spawnRate * dt) + (Math.random() < (spawnRate * dt) % 1 ? 1 : 0));
    const tmp = new THREE.Vector3();
    for (let i = 0; i < this.count; i++) {
      const p = this.ps[i];
      if (p.age >= p.life) {
        if (toSpawn <= 0) {
          this.alpha[i] = 0;
          continue;
        }
        toSpawn--;
        const phi = Math.random() * Math.PI * 2;
        const a = alphaAt(s, phi);
        flowPoint(s, a + 0.04, phi, 1.03, p.x);
        // Leave tangentially: d/dα of the surface point, then drift downstream.
        flowPoint(s, a + 0.3, phi, 1.03, tmp).sub(p.x).normalize();
        p.v.copy(tmp).multiplyScalar(0.7).addScaledVector(axis, 0.3);
        p.age = 0;
        p.life = 1.1 + Math.random() * 0.9;
      }
      p.age += dt;
      const down = -p.x.dot(s.e);
      // Relax toward the wake axis speed; recirculate close behind the ball.
      p.v.lerp(tmp.copy(axis).multiplyScalar(down < 1.2 ? 0.25 : 0.6), 0.04);
      p.v.x += (Math.random() - 0.5) * 0.08;
      p.v.y += (Math.random() - 0.5) * 0.08;
      p.v.z += (Math.random() - 0.5) * 0.08;
      p.x.addScaledVector(p.v, dt * speed);
      p.x.addScaledVector(shed, 0.012 * Math.sin(this.phase - 2.4 * down) * Math.min(1, down));
      if (p.x.length() < 1.02) p.x.setLength(1.03);
      this.pos[3 * i] = p.x.x;
      this.pos[3 * i + 1] = p.x.y;
      this.pos[3 * i + 2] = p.x.z;
      this.alpha[i] = Math.max(0, 1 - p.age / p.life);
    }
    this.points.geometry.getAttribute("position").needsUpdate = true;
    this.points.geometry.getAttribute("alpha").needsUpdate = true;
  }
}
