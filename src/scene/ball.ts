// Ball meshes drawn from the same geometry modules the physics uses, so the seam you see is
// the seam the separation model sees. Body frame = physics body frame; the record's
// quaternion [w, x, y, z] maps straight onto the mesh (see toThreeQuat).

import * as THREE from "three";
import type { Params, PanelDesign } from "../physics/params";
import { seamPoint } from "../physics/geometry/baseballSeam";
import { volleyballBoundaries, volleyballPanelId } from "../physics/geometry/volleyballPanels";
import type { Quat } from "../physics/vec";

/** Physics quaternion [w, x, y, z] → THREE.Quaternion (x, y, z, w). */
export function toThreeQuat(q: Quat | Float64Array, out = new THREE.Quaternion(), offset = 0): THREE.Quaternion {
  return out.set(q[offset + 1], q[offset + 2], q[offset + 3], q[offset]);
}

/** A unit-radius ball; scale the group by the physical radius (× display size). */
export function createBallMesh(p: Pick<Params, "sport" | "ball">): THREE.Group {
  return p.sport === "baseball" ? baseball() : volleyball(p.ball.panelDesign);
}

function leatherTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#f2ede2";
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) {
    const v = 225 + Math.random() * 25;
    ctx.fillStyle = `rgba(${v},${v - 6},${v - 18},0.35)`;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function baseball(): THREE.Group {
  const g = new THREE.Group();
  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(1, 64, 48),
    new THREE.MeshStandardMaterial({ map: leatherTexture(), roughness: 0.62, color: 0xffffff }),
  );
  sphere.castShadow = true;
  g.add(sphere);

  // The seam groove: a thin cream tube right on the curve.
  const n = 600;
  const pts = Array.from({ length: n }, (_, i) => new THREE.Vector3(...seamPoint((2 * Math.PI * i) / n)));
  const curve = new THREE.CatmullRomCurve3(pts, true);
  const groove = new THREE.Mesh(new THREE.TubeGeometry(curve, 600, 0.018, 6, true), new THREE.MeshStandardMaterial({ color: 0xd9d1c0, roughness: 0.8 }));
  g.add(groove);

  // 108 double stitches in red, a V across the seam at each station.
  const stations = 108;
  const stitch = new THREE.CapsuleGeometry(0.012, 0.075, 2, 6);
  const mesh = new THREE.InstancedMesh(stitch, new THREE.MeshStandardMaterial({ color: 0xc8322d, roughness: 0.55 }), stations * 2);
  const m = new THREE.Matrix4();
  const up = new THREE.Vector3(0, 1, 0);
  const lengths = curve.getLengths(4000);
  const total = lengths[lengths.length - 1];
  for (let i = 0; i < stations; i++) {
    const u = curve.getUtoTmapping(0, (i / stations) * total);
    const p = curve.getPoint(u);
    const t = curve.getTangent(u).normalize();
    const nrm = p.clone().normalize();
    const b = new THREE.Vector3().crossVectors(nrm, t).normalize();
    for (const side of [-1, 1]) {
      // Each stitch leans from the seam outward and slightly forward along it: a V.
      const dir = b.clone().multiplyScalar(side).addScaledVector(t, 0.55).normalize();
      const center = p.clone().addScaledVector(b, side * 0.045).normalize().multiplyScalar(1.012);
      const q = new THREE.Quaternion().setFromUnitVectors(up, dir);
      m.compose(center, q, new THREE.Vector3(1, 1, 1));
      mesh.setMatrixAt(i * 2 + (side > 0 ? 1 : 0), m);
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  g.add(mesh);
  return g;
}

const PANEL_COLORS: Record<PanelDesign, number[]> = {
  classic18: [0xf6f4ee, 0x2f5fb8, 0xf2c335],
  cube6: [0xf6f4ee, 0x2f5fb8, 0xf2c335],
  octa8: [0xf6f4ee, 0x2f5fb8],
};

function volleyball(design: PanelDesign): THREE.Group {
  const g = new THREE.Group();
  const geo = new THREE.SphereGeometry(1, 96, 72);
  const pos = geo.getAttribute("position");
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const pal = PANEL_COLORS[design];
  for (let i = 0; i < pos.count; i++) {
    const id = volleyballPanelId(design, [pos.getX(i), pos.getY(i), pos.getZ(i)]);
    let k: number;
    if (design === "classic18") {
      // Middle strip of each face white; outer strips blue on x/z faces, yellow on y faces.
      const face = Math.floor(id / 3);
      const strip = id % 3;
      k = strip === 1 ? 0 : Math.floor(face / 2) === 1 ? 2 : 1;
    } else if (design === "cube6") k = Math.floor(id / 2);
    else k = [0, 1, 1, 0, 1, 0, 0, 1][id];
    c.setHex(pal[k % pal.length]).convertSRGBToLinear();
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const sphere = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5 }));
  sphere.castShadow = true;
  g.add(sphere);
  const grooveMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.7 });
  for (const line of volleyballBoundaries(design)) {
    const curve = new THREE.CatmullRomCurve3(line.map((p) => new THREE.Vector3(...p).multiplyScalar(1.001)));
    g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(8, line.length), 0.008, 5, false), grooveMat));
  }
  return g;
}
