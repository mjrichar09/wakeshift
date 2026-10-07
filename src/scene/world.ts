// Renderer, lights and the two venues, built to scale in the shared world frame
// (physics/frames.ts): +y up, flight along +z, +x = catcher's/passer's right = 1B side.

import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { COURT, FIELD, RUBBER_Z } from "../physics/constants";
import type { Sport } from "../physics/params";

export interface World {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  venue: THREE.Group;
  strikeZone: THREE.Object3D | null;
  figures: THREE.Group;
  setSport(sport: Sport, netHeight: number): void;
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
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const sun = new THREE.DirectionalLight(0xfff4e6, 2.2);
  sun.position.set(-12, 30, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 26, bottom: -6, near: 1, far: 80 });
  sun.target.position.set(0, 0, -8);
  scene.add(sun, sun.target);
  scene.add(new THREE.HemisphereLight(0xdfe9f5, 0x55603c, 0.7));

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
        scene.background = new THREE.Color(0x9cc3de);
        scene.fog = new THREE.Fog(0x9cc3de, 60, 160);
        world.strikeZone = buildField(venue, figures);
        sun.position.set(-12, 30, 8);
      } else {
        scene.background = new THREE.Color(0x2a2f33);
        scene.fog = new THREE.Fog(0x2a2f33, 40, 90);
        world.strikeZone = null;
        buildCourt(venue, figures, netHeight);
        sun.position.set(-6, 20, 4);
      }
    },
  };
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

/** Flat shape lying on the ground (y = h), from (x, z) points. */
function groundShape(pts: [number, number][], mat: THREE.Material, h = 0.002) {
  // Shape is drawn in (x, −z) so that rotating −90° about x lays it at +z correctly.
  const s = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
  const m = new THREE.Mesh(new THREE.ShapeGeometry(s), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.y = h;
  m.receiveShadow = true;
  return m;
}

function groundDisc(x: number, z: number, r: number, mat: THREE.Material, h = 0.001) {
  const m = new THREE.Mesh(new THREE.CircleGeometry(r, 64), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, h, z);
  m.receiveShadow = true;
  return m;
}

/** Chalk rectangle outline on the ground, from x0..x1 and z0..z1. */
function chalkRect(x0: number, x1: number, z0: number, z1: number, w: number, mat: THREE.Material) {
  const g = new THREE.Group();
  const seg = (ax: number, az: number, bx: number, bz: number) => {
    const len = Math.hypot(bx - ax, bz - az);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(len + w, w), mat);
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = -Math.atan2(bz - az, bx - ax);
    m.position.set((ax + bx) / 2, 0.016, (az + bz) / 2);
    g.add(m);
  };
  seg(x0, z0, x1, z0);
  seg(x1, z0, x1, z1);
  seg(x1, z1, x0, z1);
  seg(x0, z1, x0, z0);
  return g;
}

function chalkLine(ax: number, az: number, bx: number, bz: number, w: number, mat: THREE.Material, h = 0.016) {
  const len = Math.hypot(bx - ax, bz - az);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(len, w), mat);
  m.rotation.x = -Math.PI / 2;
  m.rotation.z = -Math.atan2(bz - az, bx - ax);
  m.position.set((ax + bx) / 2, h, (az + bz) / 2);
  return m;
}

/** Camera-facing text label (for orientation: 1B, 3B, …). */
export function textSprite(text: string, worldHeight: number, color = "#ffffff", bg = "rgba(20,26,30,0.72)") {
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d")!;
  const font = "600 64px 'Barlow Condensed', 'Arial Narrow', sans-serif";
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 40;
  c.width = w;
  c.height = 96;
  ctx.font = font;
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(0, 0, w, 96, 18);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textBaseline = "middle";
  ctx.fillText(text, 20, 50);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: true, transparent: true }));
  s.scale.set((worldHeight * w) / 96, worldHeight, 1);
  return s;
}

/**
 * A simple standing figure. Origin at the feet; it faces +z before rotation (rotation.y
 * turns it). `facing` is the world direction its chest points to.
 */
function figure(color: number, facing: THREE.Vector3, headTurn?: THREE.Vector3) {
  const g = new THREE.Group();
  const mat = std(color, 0.7);
  const skin = std(0xc89f82, 0.6);
  const limb = (r: number, h: number, x: number, y: number, z = 0) => {
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, h, 4, 10), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    return m;
  };
  g.add(limb(0.075, 0.72, -0.12, 0.45), limb(0.075, 0.72, 0.12, 0.45));
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.42, 4, 12), mat);
  torso.position.y = 1.2;
  torso.scale.set(1.15, 1, 0.7);
  torso.castShadow = true;
  g.add(torso, limb(0.06, 0.55, -0.27, 1.13), limb(0.06, 0.55, 0.27, 1.13));
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 20, 14), skin);
  head.position.y = 1.62;
  head.castShadow = true;
  // A cap brim shows which way the head looks.
  const brim = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.015, 0.1), mat);
  brim.position.set(0, 0.06, 0.1);
  head.add(brim);
  g.add(head);
  g.rotation.y = Math.atan2(facing.x, facing.z);
  if (headTurn) {
    const local = headTurn.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -g.rotation.y);
    head.rotation.y = Math.atan2(local.x, local.z);
  }
  return g;
}

/** Baseball field; returns the strike-zone outline. */
function buildField(venue: THREE.Group, figures: THREE.Group): THREE.Object3D {
  const grass = std(0x4f8a3a);
  const dirt = std(0xb3855a);
  const chalk = std(0xf4f4ef, 0.6);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), grass);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  venue.add(ground);

  // Home-plate dirt circle (13 ft radius about the plate center) and the mound.
  const plateCenterZ = FIELD.plateDepth / 2;
  venue.add(groundDisc(0, plateCenterZ, 13 * 0.3048, dirt, 0.008));
  const moundZ = RUBBER_Z + 18 * 0.0254; // mound center is 18 in in front of the rubber
  const mound = new THREE.Mesh(new THREE.CylinderGeometry(FIELD.moundRadius * 0.35, FIELD.moundRadius, FIELD.moundHeight, 48), dirt);
  mound.position.set(0, FIELD.moundHeight / 2, moundZ);
  mound.receiveShadow = true;
  venue.add(mound);
  const rubber = new THREE.Mesh(new THREE.BoxGeometry(24 * 0.0254, 0.02, 6 * 0.0254), chalk);
  rubber.position.set(0, FIELD.moundHeight + 0.01, RUBBER_Z - 3 * 0.0254);
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
      chalk,
      0.02,
    ),
  );

  // Batter's boxes: the RIGHT-handed batter's box is on the 3B side (x < 0).
  const inner = hw + FIELD.boxGap;
  const outer = inner + FIELD.boxWidth;
  const z0 = plateCenterZ - FIELD.boxLength / 2;
  const z1 = plateCenterZ + FIELD.boxLength / 2;
  venue.add(chalkRect(-outer, -inner, z0, z1, 0.06, chalk), chalkRect(inner, outer, z0, z1, 0.06, chalk));

  // Foul lines from the plate's back tip at 45°: 1B toward +x, 3B toward −x.
  const tip = FIELD.plateDepth;
  const L = 95;
  const s = Math.SQRT1_2;
  venue.add(chalkLine(0, tip, L * s, tip - L * s, 0.08, chalk), chalkLine(0, tip, -L * s, tip - L * s, 0.08, chalk));

  // Bases (90 ft from the back tip along the lines) with labels.
  const B = FIELD.baseDistance;
  const bases: [string, number, number][] = [
    ["1B", B * s, tip - B * s],
    ["", 0, tip - 2 * B * s],
    ["3B", -B * s, tip - B * s],
  ];
  for (const [name, x, z] of bases) {
    venue.add(groundDisc(x, z, 4.5, dirt, 0.008));
    const bag = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.08, 0.38), chalk);
    bag.position.set(x, 0.04, z);
    bag.rotation.y = Math.PI / 4;
    bag.castShadow = true;
    venue.add(bag);
    if (!name) continue; // no 2B label: it would sit right behind the pitch in the catcher's view
    const label = textSprite(name, 1.4);
    label.position.set(x, 1.6, z);
    venue.add(label);
  }
  // Infield arc of dirt (simplified): a ring segment around the mound.
  const ring = new THREE.Mesh(new THREE.RingGeometry(26, 29.5, 64, 1, Math.PI * 0.25, Math.PI * 0.5), dirt);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(0, 0.006, moundZ);
  venue.add(ring);

  // Backstop behind the catcher, and a distant outfield wall for depth.
  const wallMat = std(0x2f4a3a, 0.8);
  const backstop = new THREE.Mesh(new THREE.BoxGeometry(30, 4, 0.4), wallMat);
  backstop.position.set(0, 2, 18);
  venue.add(backstop);
  const fence = new THREE.Mesh(new THREE.CylinderGeometry(120, 120, 3, 96, 1, true, Math.PI * 0.75, Math.PI * 0.5), std(0x24402f, 0.8, { side: THREE.DoubleSide }));
  fence.position.set(0, 1.5, tip);
  venue.add(fence);

  // Strike zone over the plate: front face on the plate plane.
  const zoneGeo = new THREE.BoxGeometry(FIELD.plateWidth, FIELD.strikeZoneTop - FIELD.strikeZoneBottom, FIELD.plateDepth);
  const zone = new THREE.LineSegments(new THREE.EdgesGeometry(zoneGeo), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }));
  zone.position.set(0, (FIELD.strikeZoneTop + FIELD.strikeZoneBottom) / 2, FIELD.plateDepth / 2);
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(FIELD.plateWidth, FIELD.strikeZoneTop - FIELD.strikeZoneBottom),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false }),
  );
  face.position.set(0, zone.position.y, 0);
  const zoneGroup = new THREE.Group();
  zoneGroup.add(zone, face);
  venue.add(zoneGroup);

  // Figures: a right-handed batter in the 3B-side box, chest toward the plate (+x),
  // head turned to the pitcher (−z); a crouched catcher behind the plate is left out so
  // the catcher's camera sees the pitch.
  const batter = figure(0x2b4f86, new THREE.Vector3(1, 0, 0), new THREE.Vector3(0.25, 0, -1));
  batter.position.set(-(inner + FIELD.boxWidth / 2), 0, plateCenterZ);
  batter.name = "batter-rhh";
  figures.add(batter);
  return zoneGroup;
}

function buildCourt(venue: THREE.Group, figures: THREE.Group, netHeight: number) {
  const floor = std(0xa9774c, 0.55);
  const court = std(0xd0844a, 0.6);
  const chalk = std(0xf4f4ef, 0.5);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), floor);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  venue.add(ground);
  const half = COURT.length / 2;
  const hw = COURT.width / 2;
  venue.add(groundShape([[-hw, -half], [hw, -half], [hw, half], [-hw, half]], court, 0.008));
  const w = 0.05;
  venue.add(chalkRect(-hw, hw, -half, half, w, chalk));
  for (const z of [0, -COURT.attackLine, COURT.attackLine]) venue.add(chalkLine(-hw, z, hw, z, w, chalk));

  // Net: a translucent mesh panel 1 m deep, its top tape at netHeight; posts at ±5.5 m.
  const netCanvas = document.createElement("canvas");
  netCanvas.width = 64;
  netCanvas.height = 64;
  const nctx = netCanvas.getContext("2d")!;
  nctx.strokeStyle = "rgba(20,20,20,0.9)";
  nctx.lineWidth = 3;
  nctx.strokeRect(0, 0, 64, 64);
  const netTex = new THREE.CanvasTexture(netCanvas);
  netTex.wrapS = netTex.wrapT = THREE.RepeatWrapping;
  netTex.repeat.set(COURT.netWidth / 0.1, 10);
  const net = new THREE.Mesh(
    new THREE.PlaneGeometry(COURT.netWidth, 1),
    new THREE.MeshBasicMaterial({ map: netTex, transparent: true, side: THREE.DoubleSide, depthWrite: false }),
  );
  net.position.set(0, netHeight - 0.5, 0);
  venue.add(net);
  const tape = new THREE.Mesh(new THREE.BoxGeometry(COURT.netWidth, 0.07, 0.01), chalk);
  tape.position.set(0, netHeight - 0.035, 0);
  venue.add(tape);
  const postMat = std(0x9aa3a8, 0.4, { metalness: 0.6 });
  for (const x of [-COURT.postOffset, COURT.postOffset]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, netHeight + 0.2, 16), postMat);
    post.position.set(x, (netHeight + 0.2) / 2, 0);
    post.castShadow = true;
    venue.add(post);
  }
  for (const x of [-hw, hw]) {
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, COURT.antennaHeight + 1, 8), std(0xd0342c, 0.5));
    ant.position.set(x, netHeight - 1 + (COURT.antennaHeight + 1) / 2, 0);
    venue.add(ant);
  }
  // Gym walls for depth.
  const wall = std(0x3a4247, 0.9);
  for (const [x, z, ry] of [[0, -22, 0], [0, 22, Math.PI], [-16, 0, Math.PI / 2], [16, 0, -Math.PI / 2]] as const) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(44, 12), wall);
    m.position.set(x, 6, z);
    m.rotation.y = ry;
    venue.add(m);
  }
  // Labels sit low and to the side so they never cover the serve's path. No arrows in
  // in-scene text: seen from behind the server an arrow would point the wrong way.
  const lab = (t: string, x: number, y: number, z: number) => {
    const s = textSprite(t, 0.6);
    s.position.set(x, y, z);
    venue.add(s);
  };
  lab("Server", -2.6, 0.5, -half - 1.2);
  lab("Passer's right side", hw + 1.6, 0.5, half - 1.5);

  // The passer faces the server (−z); their right hand is on +x.
  const passer = figure(0x2b6f5a, new THREE.Vector3(0, 0, -1));
  passer.position.set(0, 0, 7);
  passer.name = "passer";
  figures.add(passer);
}
