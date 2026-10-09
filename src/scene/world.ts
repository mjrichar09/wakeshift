// Renderer, lights and the two venues, built to scale in the shared world frame
// (physics/frames.ts): +y up, flight along +z, +x = catcher's/passer's right = 1B side.
// "Lab look with broadcast touches": calm materials, a ballpark with stands, light towers
// and a broadcast-style strike zone; a gym with painted court, bleachers and light panels.

import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { COURT, FIELD, RUBBER_Z } from "../physics/constants";
import type { Sport } from "../physics/params";
import { catcher, passer } from "./figures";
import { swingingBatter } from "./batter";
import { BATTER_AT } from "../game/batting";
import { dirtTexture, grassTexture, netTexture, paintTexture, skyDome, woodTexture } from "./textures";

export interface World {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  venue: THREE.Group;
  strikeZone: THREE.Object3D | null;
  figures: THREE.Group;
  setSport(sport: Sport, netHeight: number): void;
  /** "low" drops shadows, image-based lighting and the pixel ratio, for slow GPUs. */
  setQuality(q: "high" | "low"): void;
}

export function createWorld(canvas: HTMLCanvasElement): World {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.autoClear = false;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envMap;
  scene.environmentIntensity = 0.55;

  const sun = new THREE.DirectionalLight(0xfff1df, 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 26, bottom: -8, near: 1, far: 90 });
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.02;
  sun.target.position.set(0, 0, -8);
  const hemi = new THREE.HemisphereLight(0xdfe9f5, 0x4f5a3a, 0.75);
  scene.add(sun, sun.target, hemi);

  const venue = new THREE.Group();
  const figures = new THREE.Group();
  scene.add(venue, figures);

  const world: World = {
    renderer,
    scene,
    venue,
    strikeZone: null,
    figures,
    setSport(sport, netHeight) {
      disposeChildren(venue);
      disposeChildren(figures);
      if (sport === "baseball") {
        scene.background = new THREE.Color(0x9fc6e6);
        scene.fog = new THREE.Fog(0xc9dcea, 90, 260);
        venue.add(skyDome(0x4f8fd0, 0xd6e6f2, 0x6a7d5a));
        sun.position.set(-14, 32, 10);
        sun.intensity = 2.6;
        hemi.color.set(0xdfe9f5);
        hemi.groundColor.set(0x4f5a3a);
        world.strikeZone = buildField(venue, figures);
      } else {
        scene.background = new THREE.Color(0x30383e);
        scene.fog = null;
        sun.position.set(-4, 22, 3);
        sun.intensity = 1.6;
        hemi.color.set(0xf2f4f6);
        hemi.groundColor.set(0x6b5440);
        world.strikeZone = null;
        buildCourt(venue, figures, netHeight);
      }
      applyShadows();
      // The venue never moves: compute its matrices once and skip it every frame.
      venue.matrixWorldAutoUpdate = true;
      venue.updateMatrixWorld(true);
      venue.matrixWorldAutoUpdate = false;
    },
    setQuality(q) {
      quality = q;
      renderer.setPixelRatio(q === "high" ? Math.min(window.devicePixelRatio, 2) : 1);
      scene.environment = q === "high" ? envMap : null;
      hemi.intensity = q === "high" ? 0.75 : 1.5;
      applyShadows();
    },
  };
  let quality: "high" | "low" = "high";
  function applyShadows() {
    const on = quality === "high";
    renderer.shadowMap.enabled = on;
    sun.castShadow = on;
    scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(m)) m.forEach((x) => (x.needsUpdate = true));
      else if (m) m.needsUpdate = true;
    });
  }
  return world;
}

function disposeChildren(g: THREE.Object3D) {
  for (const c of [...g.children]) {
    g.remove(c);
    c.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
  }
}

const std = (color: number, roughness = 0.9, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, ...extra });

/** Flat shape lying on the ground at height h, from (x, z) points. */
function groundShape(pts: [number, number][], mat: THREE.Material, h: number) {
  // The shape is drawn in (x, −z): rotating −90° about x then puts it at +z correctly.
  const s = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
  const m = new THREE.Mesh(new THREE.ShapeGeometry(s, 48), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.y = h;
  m.receiveShadow = true;
  return m;
}

function groundDisc(x: number, z: number, r: number, mat: THREE.Material, h: number) {
  const m = new THREE.Mesh(new THREE.CircleGeometry(r, 72), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, h, z);
  m.receiveShadow = true;
  return m;
}

function chalkLine(ax: number, az: number, bx: number, bz: number, w: number, mat: THREE.Material, h = 0.018) {
  const len = Math.hypot(bx - ax, bz - az);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(len, w), mat);
  m.rotation.x = -Math.PI / 2;
  m.rotation.z = -Math.atan2(bz - az, bx - ax);
  m.position.set((ax + bx) / 2, h, (az + bz) / 2);
  m.receiveShadow = true;
  return m;
}

function chalkRect(x0: number, x1: number, z0: number, z1: number, w: number, mat: THREE.Material, h = 0.018) {
  const g = new THREE.Group();
  g.add(
    chalkLine(x0 - w / 2, z0, x1 + w / 2, z0, w, mat, h),
    chalkLine(x1, z0, x1, z1, w, mat, h),
    chalkLine(x1 + w / 2, z1, x0 - w / 2, z1, w, mat, h),
    chalkLine(x0, z1, x0, z0, w, mat, h),
  );
  return g;
}

/** Camera-facing text label. Labels carry no arrows: from some cameras an arrow would lie. */
export function textSprite(text: string, worldHeight: number, color = "#ffffff", bg = "rgba(16,22,26,0.72)") {
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d")!;
  const font = "600 64px 'Barlow Condensed', 'Arial Narrow', sans-serif";
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 44;
  c.width = w;
  c.height = 96;
  ctx.font = font;
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(0, 0, w, 96, 20);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textBaseline = "middle";
  ctx.fillText(text, 22, 50);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: true, transparent: true, fog: false }));
  s.scale.set((worldHeight * w) / 96, worldHeight, 1);
  return s;
}

/** Seating bowl: stepped tiers on an arc, with a speckled "crowd" texture. */
function stands(radius: number, from: number, to: number, center: THREE.Vector3, tiers = 9, rise = 1.1, depth = 1.6) {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#3b4752";
  ctx.fillRect(0, 0, 256, 64);
  const tones = ["#c7ccd1", "#2f5c8f", "#9e3a3a", "#e3d6b8", "#56606a", "#d9a441", "#7a8a96"];
  let seed = 17;
  const r = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 1400; i++) {
    ctx.fillStyle = tones[Math.floor(r() * tones.length)];
    ctx.globalAlpha = 0.55 + r() * 0.4;
    ctx.fillRect(r() * 256, r() * 64, 2, 3);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(24, 1);
  const crowd = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, side: THREE.DoubleSide });
  const concrete = std(0x5a6168, 0.95, { side: THREE.DoubleSide });
  const g = new THREE.Group();
  for (let i = 0; i < tiers; i++) {
    const r0 = radius + i * depth;
    const step = new THREE.Mesh(new THREE.RingGeometry(r0, r0 + depth, 120, 1, from, to - from), concrete);
    step.rotation.x = -Math.PI / 2;
    step.position.set(center.x, (i + 1) * rise, center.z);
    // Riser faces: a cylinder segment; CylinderGeometry measures theta from +z toward +x,
    // RingGeometry (after the −90° tilt) from +x toward −z, so convert.
    const face = new THREE.Mesh(new THREE.CylinderGeometry(r0, r0, rise, 120, 1, true, Math.PI / 2 + from, to - from), crowd);
    face.position.set(center.x, (i + 0.5) * rise, center.z);
    g.add(step, face);
  }
  return g;
}

function lightTower(x: number, z: number, h: number, faceTo: THREE.Vector3) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, h, 10), std(0x8c949a, 0.5, { metalness: 0.5 }));
  pole.position.y = h / 2;
  const bank = new THREE.Mesh(new THREE.BoxGeometry(7, 4, 0.6), std(0x2b3136, 0.6));
  bank.position.y = h + 1.5;
  const lamps = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 3.4), new THREE.MeshBasicMaterial({ color: 0xfff6dc, fog: false }));
  lamps.position.set(0, h + 1.5, 0.31);
  g.add(pole, bank, lamps);
  g.position.set(x, 0, z);
  g.lookAt(faceTo.x, 0, faceTo.z);
  return g;
}

/** Baseball field; returns the strike-zone group. */
function buildField(venue: THREE.Group, figures: THREE.Group): THREE.Object3D {
  const grass = new THREE.MeshStandardMaterial({ map: grassTexture([36, 36]), roughness: 0.95 });
  const dirt = new THREE.MeshStandardMaterial({ map: dirtTexture([10, 10]), roughness: 1 });
  const chalk = std(0xf6f5ef, 0.55);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(420, 420), grass);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  venue.add(ground);

  const tip = FIELD.plateDepth; // back tip of the plate
  const s = Math.SQRT1_2;
  const B = FIELD.baseDistance;
  const plateCenterZ = FIELD.plateDepth / 2;
  const moundZ = RUBBER_Z + 18 * 0.0254; // mound center is 18 in in front of the rubber

  // Infield skin: the dirt arc beyond the bases, then base paths and the home circle.
  const skin = new THREE.Mesh(new THREE.RingGeometry(23.5, 29.2, 96, 1, Math.PI * 0.25, Math.PI * 0.5), dirt);
  skin.rotation.x = -Math.PI / 2;
  skin.position.set(0, 0.006, moundZ);
  skin.receiveShadow = true;
  venue.add(skin);
  const bases: [number, number][] = [
    [0, tip],
    [B * s, tip - B * s],
    [0, tip - 2 * B * s],
    [-B * s, tip - B * s],
  ];
  for (let k = 0; k < 4; k++) {
    const [ax, az] = bases[k];
    const [bx, bz] = bases[(k + 1) % 4];
    venue.add(chalkLine(ax, az, bx, bz, 1.8, dirt, 0.007));
  }
  venue.add(groundDisc(0, plateCenterZ, 13 * 0.3048, dirt, 0.009));
  for (const [x, z] of bases.slice(1)) venue.add(groundDisc(x, z, 3.2, dirt, 0.008));

  // Mound: a low dome of dirt with the rubber on top.
  const prof: THREE.Vector2[] = [];
  for (let i = 0; i <= 16; i++) {
    const r = (FIELD.moundRadius * i) / 16;
    prof.push(new THREE.Vector2(r, FIELD.moundHeight * Math.cos(((i / 16) * Math.PI) / 2) ** 1.4));
  }
  prof.reverse();
  const mound = new THREE.Mesh(new THREE.LatheGeometry(prof, 64), dirt);
  mound.position.set(0, 0.006, moundZ);
  mound.receiveShadow = true;
  venue.add(mound);
  const rubber = new THREE.Mesh(new THREE.BoxGeometry(24 * 0.0254, 0.03, 6 * 0.0254), chalk);
  rubber.position.set(0, FIELD.moundHeight * 0.97, RUBBER_Z - 3 * 0.0254);
  venue.add(rubber);

  // Home plate: front edge on z = 0 (the plate plane), point toward the catcher (+z).
  const hw = FIELD.plateWidth / 2;
  venue.add(
    groundShape(
      [
        [-hw, 0],
        [hw, 0],
        [hw, FIELD.plateSideDepth],
        [0, FIELD.plateDepth],
        [-hw, FIELD.plateSideDepth],
      ],
      std(0xffffff, 0.4),
      0.025,
    ),
  );

  // Batter's boxes: the RIGHT-handed batter's box is on the 3B side (x < 0).
  const inner = hw + FIELD.boxGap;
  const outer = inner + FIELD.boxWidth;
  const z0 = plateCenterZ - FIELD.boxLength / 2;
  const z1 = plateCenterZ + FIELD.boxLength / 2;
  venue.add(chalkRect(-outer, -inner, z0, z1, 0.07, chalk), chalkRect(inner, outer, z0, z1, 0.07, chalk));
  // Foul lines from the plate's back tip: 1B toward +x, 3B toward −x.
  const L = 98;
  venue.add(chalkLine(0, tip, L * s, tip - L * s, 0.09, chalk), chalkLine(0, tip, -L * s, tip - L * s, 0.09, chalk));

  // Bases with labels (no 2B label: it would sit behind the pitch in the catcher's view).
  for (const [name, [x, z]] of [["1B", bases[1]], ["", bases[2]], ["3B", bases[3]]] as [string, [number, number]][]) {
    const bag = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.09, 0.38), chalk);
    bag.position.set(x, 0.045, z);
    bag.rotation.y = Math.PI / 4;
    bag.castShadow = true;
    venue.add(bag);
    if (!name) continue;
    const label = textSprite(name, 1.1);
    label.position.set(x, 1.4, z);
    venue.add(label);
  }

  // Outfield wall with a yellow top line, foul poles, the batter's eye, stands and lights.
  const wallR = 110;
  const home = new THREE.Vector3(0, 0, tip);
  // CylinderGeometry theta runs from +z toward +x; the outfield (−z) is theta = π.
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(wallR, wallR, 3, 160, 1, true, Math.PI * 0.75, Math.PI * 0.5), std(0x1f4a35, 0.85, { side: THREE.DoubleSide }));
  wall.position.set(0, 1.5, tip);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(wallR, wallR, 0.18, 160, 1, true, Math.PI * 0.75, Math.PI * 0.5), std(0xf2c230, 0.5, { side: THREE.DoubleSide }));
  cap.position.set(0, 3.05, tip);
  venue.add(wall, cap);
  for (const sx of [-1, 1]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 22, 8), std(0xf2c230, 0.5));
    pole.position.set(sx * wallR * s, 11, tip - wallR * s);
    venue.add(pole);
  }
  const eye = new THREE.Mesh(new THREE.BoxGeometry(26, 9, 2), std(0x18241e, 0.95));
  eye.position.set(0, 4.5, tip - wallR - 1.5);
  venue.add(eye);
  // Bleachers in left and right field, and a grandstand wrapping behind home plate.
  // RingGeometry angles (after the tilt) run from +x toward −z: the outfield is ~π/2.
  venue.add(stands(wallR + 3, Math.PI * 0.27, Math.PI * 0.44, home, 10, 1.2, 1.8), stands(wallR + 3, Math.PI * 0.56, Math.PI * 0.73, home, 10, 1.2, 1.8));
  venue.add(stands(24, Math.PI * 1.1, Math.PI * 1.9, home, 14, 1.0, 1.4));
  const backstop = new THREE.Mesh(new THREE.BoxGeometry(34, 3.2, 0.4), std(0x1c2b24, 0.85));
  backstop.position.set(0, 1.6, 19);
  venue.add(backstop);
  for (const [x, z] of [
    [-62, -70],
    [62, -70],
    [-48, 22],
    [48, 22],
  ])
    venue.add(lightTower(x, z, 34, new THREE.Vector3(0, 0, -20)));

  // Broadcast-style strike zone: soft face, bright edges, a faint 3×3 grid.
  const zh = FIELD.strikeZoneTop - FIELD.strikeZoneBottom;
  const zoneGroup = new THREE.Group();
  zoneGroup.position.set(0, (FIELD.strikeZoneTop + FIELD.strikeZoneBottom) / 2, 0);
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(FIELD.plateWidth, zh),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.09, side: THREE.DoubleSide, depthWrite: false, fog: false }),
  );
  const x0 = -hw;
  const x1 = hw;
  const y0 = -zh / 2;
  const y1 = zh / 2;
  const edges = [x0, y0, 0, x1, y0, 0, x1, y0, 0, x1, y1, 0, x1, y1, 0, x0, y1, 0, x0, y1, 0, x0, y0, 0];
  const grid: number[] = [];
  for (const f of [1 / 3, 2 / 3]) {
    grid.push(x0 + (x1 - x0) * f, y0, 0, x0 + (x1 - x0) * f, y1, 0);
    grid.push(x0, y0 + (y1 - y0) * f, 0, x1, y0 + (y1 - y0) * f, 0);
  }
  const lineGeo = (a: number[]) => new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(a, 3));
  zoneGroup.add(
    face,
    new THREE.LineSegments(lineGeo(edges), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, fog: false })),
    new THREE.LineSegments(lineGeo(grid), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25, fog: false })),
  );
  venue.add(zoneGroup);

  // Figures: a right-handed batter in the 3B-side box; a catcher crouched behind the plate.
  figures.add(swingingBatter(new THREE.Vector3(BATTER_AT.x, BATTER_AT.y, BATTER_AT.z)));
  figures.add(catcher(new THREE.Vector3(0, 0, FIELD.plateDepth + 0.75)));
  return zoneGroup;
}

function buildCourt(venue: THREE.Group, figures: THREE.Group, netHeight: number) {
  const half = COURT.length / 2;
  const hw = COURT.width / 2;
  const wood = new THREE.MeshStandardMaterial({ map: woodTexture([10, 10]), roughness: 0.42 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(44, 60), wood);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  venue.add(floor);
  // Blue free zone around an orange court, satin paint, white lines.
  const free = new THREE.MeshStandardMaterial({ map: paintTexture("#2f6fb0", [4, 4]), roughness: 0.38 });
  const court = new THREE.MeshStandardMaterial({ map: paintTexture("#d9793c", [4, 4], 13), roughness: 0.38 });
  venue.add(groundShape([[-hw - 4, -half - 7], [hw + 4, -half - 7], [hw + 4, half + 7], [-hw - 4, half + 7]], free, 0.006));
  venue.add(groundShape([[-hw, -half], [hw, -half], [hw, half], [-hw, half]], court, 0.011));
  const chalk = std(0xf7f7f2, 0.4);
  venue.add(chalkRect(-hw, hw, -half, half, 0.05, chalk, 0.016));
  for (const z of [0, -COURT.attackLine, COURT.attackLine]) venue.add(chalkLine(-hw, z, hw, z, 0.05, chalk, 0.016));

  // Net: mesh panel 1 m deep, white top band and bottom tape, cable, padded posts,
  // red-and-white antennas over the sidelines.
  const net = new THREE.Mesh(
    new THREE.PlaneGeometry(COURT.netWidth, 1),
    new THREE.MeshBasicMaterial({ map: netTexture([COURT.netWidth / 0.1, 10]), transparent: true, side: THREE.DoubleSide, depthWrite: false }),
  );
  net.position.set(0, netHeight - 0.5, 0);
  const band = new THREE.Mesh(new THREE.BoxGeometry(COURT.netWidth, 0.07, 0.012), chalk);
  band.position.set(0, netHeight - 0.035, 0);
  const tape = new THREE.Mesh(new THREE.BoxGeometry(COURT.netWidth, 0.05, 0.01), chalk);
  tape.position.set(0, netHeight - 1, 0);
  const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 2 * COURT.postOffset, 6), std(0x222222, 0.4));
  cable.rotation.z = Math.PI / 2;
  cable.position.set(0, netHeight - 0.01, 0);
  venue.add(net, band, tape, cable);
  const post = std(0xb9c0c5, 0.35, { metalness: 0.6 });
  const pad = std(0x2f6fb0, 0.7);
  for (const x of [-COURT.postOffset, COURT.postOffset]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, netHeight + 0.15, 16), post);
    p.position.set(x, (netHeight + 0.15) / 2, 0);
    p.castShadow = true;
    const padM = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 1.8, 20), pad);
    padM.position.set(x, 0.9, 0);
    venue.add(p, padM);
  }
  const stripe = document.createElement("canvas");
  stripe.width = 4;
  stripe.height = 16;
  const sctx = stripe.getContext("2d")!;
  for (let i = 0; i < 16; i += 2) {
    sctx.fillStyle = i % 4 ? "#ffffff" : "#d0342c";
    sctx.fillRect(0, i, 4, 2);
  }
  const stripeTex = new THREE.CanvasTexture(stripe);
  stripeTex.colorSpace = THREE.SRGBColorSpace;
  for (const x of [-hw, hw]) {
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 1.8, 8), new THREE.MeshBasicMaterial({ map: stripeTex }));
    ant.position.set(x, netHeight - 1 + 0.9, 0);
    venue.add(ant);
  }

  // Hall: walls with a darker wainscot, a ceiling of light panels, bleachers on both sides.
  const wall = std(0xc9cfd3, 0.9);
  const wains = std(0x46525b, 0.8);
  for (const [x, z, ry, w] of [
    [0, -26, 0, 44],
    [0, 26, Math.PI, 44],
    [-20, 0, Math.PI / 2, 52],
    [20, 0, -Math.PI / 2, 52],
  ] as const) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, 13), wall);
    m.position.set(x, 6.5, z);
    m.rotation.y = ry;
    const d = new THREE.Mesh(new THREE.PlaneGeometry(w, 2.2), wains);
    d.position.set(x, 1.1, z);
    d.rotation.y = ry;
    d.position.addScaledVector(new THREE.Vector3(Math.sin(ry), 0, Math.cos(ry)), 0.02);
    venue.add(m, d);
  }
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(40, 52), std(0x5d666d, 0.9));
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = 12.8;
  venue.add(ceiling);
  const lamp = new THREE.MeshBasicMaterial({ color: 0xfffaf0 });
  for (let i = -2; i <= 2; i++)
    for (const x of [-6, 0, 6]) {
      const l = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.2), lamp);
      l.rotation.x = Math.PI / 2;
      l.position.set(x, 12.7, i * 8);
      venue.add(l);
    }
  const seat = std(0x2c3a46, 0.8);
  const seat2 = std(0x3a4a57, 0.8);
  for (const sx of [-1, 1])
    for (let k = 0; k < 6; k++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.45 * (k + 1), 22), k % 2 ? seat : seat2);
      b.position.set(sx * (hw + 6.2 + k * 0.8), (0.45 * (k + 1)) / 2, 0);
      b.receiveShadow = true;
      venue.add(b);
    }

  // Labels sit low and to the side so they never cover the serve's path.
  const lab = (t: string, x: number, y: number, z: number) => {
    const s = textSprite(t, 0.55);
    s.position.set(x, y, z);
    venue.add(s);
  };
  lab("Server", -2.6, 0.5, -half - 1.2);
  lab("Passer's right side", hw + 1.7, 0.5, half - 1.5);

  // The passer faces the server (−z); their right hand is on +x.
  figures.add(passer(new THREE.Vector3(0, 0, 7)));
}
