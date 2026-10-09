// A right-handed batter with a proper swing. Local frame: faces +z (the plate), LEFT side +x
// (toward the pitcher). Placed in the 3B-side box facing +x world, his front shoulder points
// at the pitcher.
//
// pose(load, swing):
//   load  0→1 while the pitch is in the air: hands go back, the front foot lifts and strides.
//   swing 0→1 after the click: hips fire, then shoulders, the hands bring the bat through the
//         slot with the barrel lagging, contact at 0.55 (barrel over the plate, slight upward
//         path), extension, and a two-handed follow-through over the front shoulder.
// Arms and legs are two-bone IK chains, so elbows and knees bend instead of stretching.

import * as THREE from "three";
import { BAT_LEN, SWEET, batAtContact, toLocal } from "../game/batting";

type P = [number, number, number];
const v = (p: P) => new THREE.Vector3(...p);
const Y = new THREE.Vector3(0, 1, 0);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (x: number) => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};

function material(color: number, roughness = 0.7, extra: THREE.MeshStandardMaterialParameters = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness, ...extra });
}

/** Capsule between two points, re-posed every frame. */
class Limb {
  readonly mesh: THREE.Mesh;
  constructor(
    private r: number,
    mat: THREE.Material,
    taper = 1,
  ) {
    const g = new THREE.CapsuleGeometry(r, 1, 6, 14);
    if (taper !== 1) {
      // Narrow the far end (y > 0) for forearms and shins.
      const p = g.getAttribute("position");
      for (let i = 0; i < p.count; i++) {
        const k = 1 + (taper - 1) * clamp01((p.getY(i) + 0.5) / 1);
        p.setX(i, p.getX(i) * k);
        p.setZ(i, p.getZ(i) * k);
      }
      g.computeVertexNormals();
    }
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.castShadow = true;
  }
  set(a: THREE.Vector3, b: THREE.Vector3) {
    const d = b.clone().sub(a);
    const L = Math.max(d.length() - this.r * 0.6, 0.01);
    this.mesh.scale.set(1, L, 1);
    this.mesh.position.copy(a).add(b).multiplyScalar(0.5);
    this.mesh.quaternion.setFromUnitVectors(Y, d.normalize());
  }
}

/** Two-bone IK: the middle joint for a chain root→target with segment lengths and a pole. */
export function solveIK(root: THREE.Vector3, target: THREE.Vector3, l1: number, l2: number, pole: THREE.Vector3) {
  const toT = target.clone().sub(root);
  const d = THREE.MathUtils.clamp(toT.length(), Math.abs(l1 - l2) + 1e-4, l1 + l2 - 1e-4);
  const dir = toT.normalize();
  const cosA = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  const bend = pole.clone().addScaledVector(dir, -pole.dot(dir));
  if (bend.lengthSq() < 1e-8) bend.set(0, -1, 0).addScaledVector(dir, dir.y);
  bend.normalize();
  const mid = root.clone().addScaledVector(dir, l1 * cosA).addScaledVector(bend, l1 * sinA);
  const end = root.clone().addScaledVector(dir, d);
  return { mid, end };
}

// ------------------------------------------------------------------ the swing, keyed

/** Bat grip (the knob, in the bottom hand) and bat direction (knob → barrel). */
interface Key {
  s: number;
  grip: P;
  bat: P;
}

const STANCE: Key = { s: 0, grip: [-0.16, 1.36, 0.17], bat: [-0.25, 0.86, -0.3] };
const LOADED: Key = { s: 0, grip: [-0.25, 1.4, 0.12], bat: [-0.48, 0.74, -0.35] };
const SWING: Key[] = [
  LOADED,
  { s: 0.25, grip: [-0.13, 1.16, 0.27], bat: [-0.86, 0.38, 0.2] }, // into the slot, barrel lagging
  { s: 0.42, grip: [0.01, 1.0, 0.35], bat: [-0.58, 0.02, 0.8] },
  { s: 0.55, grip: [0.12, 0.95, 0.33], bat: [0.15, -0.16, 0.97] }, // contact, out over the plate
  { s: 0.7, grip: [0.3, 1.04, 0.29], bat: [0.86, 0.12, 0.48] }, // extension toward the pitcher
  { s: 0.85, grip: [0.29, 1.3, 0.06], bat: [0.55, 0.6, -0.58] },
  { s: 1, grip: [0.16, 1.46, -0.08], bat: [-0.32, 0.45, -0.84] }, // wrapped over the front shoulder
];

/** Hips and shoulders turn (deg, + turns the chest from the plate toward the pitcher). */
const HIPS: [number, number][] = [
  [0, -10],
  [0.25, 25],
  [0.45, 60],
  [0.55, 75],
  [0.7, 90],
  [1, 96],
];
const SHOULDERS: [number, number][] = [
  [0, -22],
  [0.25, 0],
  [0.45, 45],
  [0.55, 70],
  [0.7, 100],
  [0.85, 120],
  [1, 132],
];

function track(keys: [number, number][], s: number) {
  let k = 0;
  while (k < keys.length - 2 && s > keys[k + 1][0]) k++;
  const [s0, a] = keys[k];
  const [s1, b] = keys[k + 1];
  return a + (b - a) * smooth((s - s0) / (s1 - s0));
}

/** A keyed swing with its spline curves (one per swing target). */
class SwingPath {
  private grip: THREE.CatmullRomCurve3;
  private bat: THREE.CatmullRomCurve3;
  constructor(private keys: Key[]) {
    this.grip = new THREE.CatmullRomCurve3(keys.map((k) => v(k.grip)), false, "centripetal");
    this.bat = new THREE.CatmullRomCurve3(keys.map((k) => v(k.bat).normalize()), false, "centripetal");
  }
  /** Grip and bat direction for progress s (non-uniform key spacing; exact at the keys). */
  at(s: number) {
    const K = this.keys;
    let k = 0;
    while (k < K.length - 2 && s > K[k + 1].s) k++;
    const f = clamp01((s - K[k].s) / (K[k + 1].s - K[k].s));
    const u = (k + f) / (K.length - 1);
    return { grip: this.grip.getPoint(u), bat: this.bat.getPoint(u).normalize() };
  }
}

const DEFAULT_PATH = new SwingPath(SWING);

/**
 * The swing re-aimed at a click on the plate plane: the contact key puts the sweet spot on
 * the click (see batAtContact), and the keys either side are blended toward it so the path
 * stays smooth.
 */
export function pathTo(click: { x: number; y: number }): SwingPath {
  const b = batAtContact(click);
  const knob = toLocal(b.knob);
  const end = toLocal(b.end);
  const dir = v([end.x - knob.x, end.y - knob.y, end.z - knob.z]).normalize();
  const contact: Key = { s: 0.55, grip: [knob.x, knob.y, knob.z], bat: [dir.x, dir.y, dir.z] };
  const slot = SWING[1];
  const before: Key = {
    s: 0.42,
    grip: v(slot.grip).lerp(v(contact.grip), 0.62).toArray() as P,
    bat: v(slot.bat).normalize().lerp(dir, 0.5).normalize().toArray() as P,
  };
  const extDir = dir.clone().applyAxisAngle(Y, THREE.MathUtils.degToRad(55)).add(new THREE.Vector3(0, 0.15, 0)).normalize();
  const extension: Key = { s: 0.7, grip: v(contact.grip).add(new THREE.Vector3(0.18, 0.09, -0.04)).toArray() as P, bat: extDir.toArray() as P };
  return new SwingPath([SWING[0], SWING[1], before, contact, extension, SWING[5], SWING[6]]);
}

// ------------------------------------------------------------------ the figure

const UPPER_ARM = 0.29;
const FOREARM = 0.28;
const THIGH = 0.45;
const SHIN = 0.45;

export interface SwingingBatter extends THREE.Group {
  userData: {
    pose: (load: number, swing: number, time?: number) => void;
    swing: (s: number) => void;
    /** Aim the swing at a click on the plate plane (world), or back to the default. */
    setTarget: (click: { x: number; y: number } | null) => void;
  };
}

function batGeometry() {
  // Knob, thin handle, long taper, barrel, rounded end: revolved about +y (knob at 0).
  const r = (y: number, x: number) => new THREE.Vector2(x, y * BAT_LEN);
  // About a third fuller than a regulation bat, to sit right with the stylized figure.
  const prof = [r(0, 0), r(0, 0.028), r(0.02, 0.028), r(0.035, 0.017), r(0.3, 0.0175), r(0.55, 0.032), r(0.72, 0.044), r(0.965, 0.044), r(0.99, 0.037), r(1, 0)];
  const g = new THREE.LatheGeometry(prof, 24);
  g.computeVertexNormals();
  return g;
}

function torsoGeometry() {
  // Waist → chest → shoulders, revolved and then flattened front-to-back by the mesh scale.
  const prof = [
    new THREE.Vector2(0.0, -0.02),
    new THREE.Vector2(0.135, 0.0),
    new THREE.Vector2(0.14, 0.12),
    new THREE.Vector2(0.168, 0.28),
    new THREE.Vector2(0.18, 0.38),
    new THREE.Vector2(0.15, 0.46),
    new THREE.Vector2(0.06, 0.5),
    new THREE.Vector2(0.0, 0.5),
  ];
  return new THREE.LatheGeometry(prof, 28);
}

export function swingingBatter(at: THREE.Vector3): SwingingBatter {
  const g = new THREE.Group() as SwingingBatter;
  const jersey = material(0x24467a, 0.62);
  const sleeve = material(0x1a2c4e, 0.7);
  const pants = material(0xe7e3d9, 0.8);
  const navy = material(0x1a2c4e, 0.75);
  const skin = material(0xc79a7c, 0.55);
  const cleat = material(0x15181a, 0.45);
  const glove = material(0xe9ecee, 0.5);
  const helmetMat = material(0x14284a, 0.22, { metalness: 0.15 });
  const ash = material(0xd6b685, 0.38);

  // Torso (turns with the shoulders) and pelvis (turns with the hips).
  const torso = new THREE.Mesh(torsoGeometry(), jersey);
  torso.scale.set(1, 1, 0.7);
  torso.castShadow = true;
  const pelvis = new THREE.Mesh(new THREE.CapsuleGeometry(0.115, 0.16, 6, 14), pants);
  pelvis.rotation.z = Math.PI / 2;
  pelvis.scale.set(1, 1, 0.85);
  pelvis.castShadow = true;
  const pelvisG = new THREE.Group();
  pelvisG.add(pelvis);
  const belt = new THREE.Mesh(new THREE.TorusGeometry(0.135, 0.018, 8, 28), navy);
  belt.rotation.x = Math.PI / 2;
  belt.scale.set(1, 0.72, 1);
  belt.position.y = 0.07;
  pelvisG.add(belt);
  // Number patch on the back so the turn reads from the catcher's view.
  const patch = new THREE.Mesh(new THREE.CircleGeometry(0.06, 20), material(0xf2f2ee, 0.6));
  patch.position.set(0, 0.33, -0.128);
  patch.rotation.y = Math.PI;
  torso.add(patch);
  const neck = new Limb(0.052, skin);
  const head = new THREE.Group();
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.1, 24, 18), skin);
  skull.scale.set(0.92, 1.05, 1);
  skull.castShadow = true;
  // Helmet: shell, brim to the front, ear flap on the side facing the pitcher (+x).
  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.118, 28, 16, 0, Math.PI * 2, 0, Math.PI * 0.56), helmetMat);
  shell.position.y = 0.015;
  shell.castShadow = true;
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.012, 24, 1, false, -Math.PI / 2, Math.PI), helmetMat);
  brim.position.set(0, 0.012, 0.09);
  brim.rotation.x = 0.12;
  const flap = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 10, -0.5, 1.1, Math.PI * 0.4, Math.PI * 0.32), helmetMat);
  flap.rotation.y = Math.PI / 2;
  flap.position.y = 0.0;
  head.add(skull, shell, brim, flap);
  g.add(torso, pelvisG, neck.mesh, head);

  // Legs: thigh and calf in pants, stockings, cleats.
  const legs = [0, 1].map(() => ({
    thigh: new Limb(0.078, pants, 0.82),
    calf: new Limb(0.062, pants, 0.78),
    sock: new Limb(0.048, navy, 0.85),
    foot: new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.16, 4, 10), cleat),
  }));
  for (const l of legs) {
    l.foot.rotation.x = Math.PI / 2;
    l.foot.castShadow = true;
    const footG = new THREE.Group();
    footG.add(l.foot);
    l.foot.position.z = 0.05;
    (l as unknown as { footG: THREE.Group }).footG = footG;
    g.add(l.thigh.mesh, l.calf.mesh, l.sock.mesh, footG);
  }
  // Arms: undershirt sleeves, gloved hands.
  const arms = [0, 1].map(() => ({
    upper: new Limb(0.052, sleeve, 0.88),
    fore: new Limb(0.044, sleeve, 0.8),
    hand: new THREE.Mesh(new THREE.SphereGeometry(0.045, 14, 10), glove),
  }));
  for (const a of arms) {
    a.hand.scale.set(1, 0.85, 1.2);
    a.hand.castShadow = true;
    g.add(a.upper.mesh, a.fore.mesh, a.hand);
  }
  const bat = new THREE.Mesh(batGeometry(), ash);
  bat.castShadow = true;
  bat.name = "bat";
  g.add(bat);

  // Barrel trail: a fading ribbon between the sweet spot and the barrel end.
  const TRAIL = 9;
  const trailPos = new Float32Array(TRAIL * 2 * 3);
  const trailCol = new Float32Array(TRAIL * 2 * 3);
  const trailGeo = new THREE.BufferGeometry();
  trailGeo.setAttribute("position", new THREE.BufferAttribute(trailPos, 3));
  trailGeo.setAttribute("color", new THREE.BufferAttribute(trailCol, 3));
  const idx: number[] = [];
  for (let i = 0; i < TRAIL - 1; i++) {
    const a = 2 * i;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  trailGeo.setIndex(idx);
  const trail = new THREE.Mesh(
    trailGeo,
    new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }),
  );
  trail.frustumCulled = false;
  g.add(trail);
  const samples: { a: THREE.Vector3; b: THREE.Vector3 }[] = [];

  let path = DEFAULT_PATH;

  const placeFoot = (footG: THREE.Group, ankle: THREE.Vector3, yaw: number, heel: number) => {
    footG.position.set(ankle.x, 0.045 + heel * 0.06, ankle.z);
    footG.rotation.set(-heel, yaw, 0, "YXZ");
  };

  const pose = (loadIn: number, swingIn: number, time = 0) => {
    const load = clamp01(loadIn);
    const s = clamp01(swingIn);
    const swinging = s > 0;

    // Pelvis: weight back during the leg lift, then forward into the stride and the swing.
    const lift = Math.sin(Math.PI * clamp01(load / 0.75)); // front knee up, then down
    const shift = -0.05 * lift + 0.07 * smooth((load - 0.5) / 0.5) + 0.05 * smooth(s / 0.55);
    const pelvisPos = new THREE.Vector3(-0.03 + shift, 0.9 - 0.035 * smooth(load) + 0.02 * smooth((s - 0.6) / 0.4), -0.02);
    const hipYaw = THREE.MathUtils.degToRad(swinging ? track(HIPS, s) : -10 * smooth(load));
    const shYaw = THREE.MathUtils.degToRad(swinging ? track(SHOULDERS, s) : -22 * smooth(load));
    // Stance idle: a small waggle of the bat before the load.
    const waggle = load < 0.05 && !swinging ? Math.sin(time * 2.2) * 0.05 : 0;

    pelvisG.position.copy(pelvisPos);
    pelvisG.rotation.set(0, hipYaw, 0);

    // Spine: lean toward the plate, a little back over the rear leg at contact.
    const lean = 0.14 - 0.08 * smooth((s - 0.4) / 0.3);
    const chestBase = pelvisPos.clone().add(new THREE.Vector3(0, 0.06, 0));
    torso.position.copy(chestBase);
    torso.rotation.set(lean, (hipYaw + 2 * shYaw) / 3, 0.18 * smooth((s - 0.3) / 0.3) * (1 - smooth((s - 0.75) / 0.25)), "YXZ");
    torso.updateMatrixWorld();
    // Bat: stance → loaded → keyed swing.
    let grip: THREE.Vector3;
    let dir: THREE.Vector3;
    if (!swinging) {
      const k = smooth(load);
      grip = v(STANCE.grip).lerp(v(LOADED.grip), k);
      dir = v(STANCE.bat).normalize().lerp(v(LOADED.bat).normalize(), k).applyAxisAngle(new THREE.Vector3(1, 0, 0), waggle).normalize();
    } else {
      const at = path.at(s);
      grip = at.grip;
      dir = at.bat;
    }
    // The knob sits at the grip, so the sweet spot is exactly SWEET × BAT_LEN along the bat.
    bat.position.copy(grip);
    bat.quaternion.setFromUnitVectors(Y, dir);

    // Reaching for a low or away target: bend at the waist toward the hands and sink at the
    // knees, so the arms can stay on the bat and the body stays in one piece.
    const shoulderOffset = new THREE.Vector3(0, 0.43, Math.sin(lean) * 0.172);
    const bendQ = new THREE.Quaternion();
    {
      const base = chestBase.clone().add(shoulderOffset);
      const need = grip.distanceTo(base) - 0.5;
      if (swinging && need > 0) {
        const k = Math.min(need, 0.32) * Math.sin(Math.PI * clamp01((s - 0.15) / 0.75));
        const toward = grip.clone().sub(base).normalize().multiplyScalar(k);
        // Sink: lower hips and chest together by part of the downward reach.
        const sink = new THREE.Vector3(0, Math.min(0, toward.y) * 0.6, 0);
        pelvisPos.add(sink);
        chestBase.add(sink);
        pelvisG.position.copy(pelvisPos);
        torso.position.copy(chestBase);
        // Bend: tilt the torso about its base so the shoulders move toward the hands.
        const flat = new THREE.Vector3(toward.x, 0, toward.z);
        const lenH = flat.length();
        if (lenH > 1e-4) {
          const axis = new THREE.Vector3().crossVectors(Y, flat).normalize();
          bendQ.setFromAxisAngle(axis, Math.asin(Math.min(lenH / 0.43, 0.85)));
          torso.quaternion.premultiply(bendQ);
        }
      }
    }
    // Shoulder line rotates with the shoulders; the rear shoulder dips through contact.
    const shoulderC = chestBase.clone().add(shoulderOffset.clone().applyQuaternion(bendQ));
    const across = new THREE.Vector3(1, 0, 0).applyAxisAngle(Y, shYaw).applyQuaternion(bendQ);
    const dip = 0.07 * Math.sin(Math.PI * clamp01((s - 0.2) / 0.6));
    const shL = shoulderC.clone().addScaledVector(across, 0.18).add(new THREE.Vector3(0, dip * 0.6, 0));
    const shR = shoulderC.clone().addScaledVector(across, -0.18).add(new THREE.Vector3(0, -dip, 0));

    // Neck and head: eyes on the pitcher until contact, then the head turns with the body.
    const neckTop = shoulderC.clone().add(new THREE.Vector3(0.015, 0.11, 0.01));
    neck.set(shoulderC.clone().add(new THREE.Vector3(0, 0.02, 0)), neckTop);
    head.position.copy(neckTop).add(new THREE.Vector3(0.01, 0.1, 0.01));
    const look = s < 0.55 ? Math.PI / 2 - 0.12 : Math.PI / 2 - 0.12 + (shYaw - 1.2) * 0.35;
    head.rotation.set(0.08, look, 0, "YXZ");

    // Hands on the handle: bottom (left) hand at the knob, top (right) hand just above it.
    const handL = grip.clone().addScaledVector(dir, 0.035);
    const handR = grip.clone().addScaledVector(dir, 0.115);
    const poles = [new THREE.Vector3(0.2, -1, 0.35), new THREE.Vector3(-0.5, -1, -0.15)];
    [
      [shL, handL],
      [shR, handR],
    ].forEach(([sh, hand], i) => {
      const ik = solveIK(sh, hand, UPPER_ARM, FOREARM, poles[i]);
      arms[i].upper.set(sh, ik.mid);
      arms[i].fore.set(ik.mid, ik.end);
      arms[i].hand.position.copy(hand);
      arms[i].hand.quaternion.setFromUnitVectors(Y, dir);
    });

    // Legs: front foot lifts and strides toward the pitcher; back foot pivots on the swing.
    const hipAcross = new THREE.Vector3(1, 0, 0).applyAxisAngle(Y, hipYaw);
    const hipL = pelvisPos.clone().addScaledVector(hipAcross, 0.105).add(new THREE.Vector3(0, -0.04, 0));
    const hipR = pelvisPos.clone().addScaledVector(hipAcross, -0.105).add(new THREE.Vector3(0, -0.04, 0));
    const stride = smooth((load - 0.35) / 0.65);
    const frontAnkle = new THREE.Vector3(0.3 + 0.2 * stride, 0.085 + 0.09 * lift * (1 - stride), 0.02 + 0.03 * stride);
    const pivot = smooth((s - 0.3) / 0.5);
    const backAnkle = new THREE.Vector3(-0.36 + 0.03 * pivot, 0.085 + 0.05 * pivot, 0.0);
    const frontKneePole = new THREE.Vector3(0.25, 0.1, 1);
    const backKneePole = new THREE.Vector3(0.6 * pivot - 0.2, 0, 1);
    [
      [hipL, frontAnkle, frontKneePole, 0.35 * smooth(s / 0.6), 0],
      [hipR, backAnkle, backKneePole, 1.1 * pivot, 0.55 * pivot],
    ].forEach(([hip, ankle, pole, yaw, heel], i) => {
      const ik = solveIK(hip as THREE.Vector3, ankle as THREE.Vector3, THIGH, SHIN, pole as THREE.Vector3);
      const l = legs[i];
      l.thigh.set(hip as THREE.Vector3, ik.mid);
      const sockTop = ik.mid.clone().lerp(ik.end, 0.55);
      l.calf.set(ik.mid, sockTop);
      l.sock.set(sockTop, ik.end);
      placeFoot((l as unknown as { footG: THREE.Group }).footG, ik.end, yaw as number, heel as number);
    });

    // Barrel trail while the bat is moving fast.
    if (swinging && s > 0.18 && s < 0.95) {
      samples.unshift({ a: grip.clone().addScaledVector(dir, BAT_LEN * 0.68), b: grip.clone().addScaledVector(dir, BAT_LEN * 1.01) });
      if (samples.length > TRAIL) samples.pop();
    } else if (samples.length) samples.pop();
    for (let i = 0; i < TRAIL; i++) {
      const smp = samples[Math.min(i, samples.length - 1)];
      // Quadratic fade from the bat backward; the barrel edge brighter than the inner edge.
      const k0 = samples.length ? Math.max(0, 1 - i / Math.max(samples.length - 1, 1)) : 0;
      const fade = k0 * k0 * 0.32;
      for (const [j, p] of [smp?.a, smp?.b].entries()) {
        const k = 3 * (2 * i + j);
        trailPos[k] = p?.x ?? 0;
        trailPos[k + 1] = p?.y ?? 0;
        trailPos[k + 2] = p?.z ?? 0;
        const c = fade * (j ? 1 : 0.15);
        trailCol[k] = c;
        trailCol[k + 1] = c * 0.95;
        trailCol[k + 2] = c * 0.85;
      }
    }
    trailGeo.getAttribute("position").needsUpdate = true;
    trailGeo.getAttribute("color").needsUpdate = true;
    trail.visible = samples.length > 1;
  };

  pose(0, 0);
  g.userData.pose = pose;
  g.userData.swing = (s: number) => pose(1, s);
  g.userData.setTarget = (click) => (path = click ? pathTo(click) : DEFAULT_PATH);
  g.position.copy(at);
  g.rotation.y = Math.atan2(1, 0); // face +x world: the plate
  g.name = "batter";
  return g;
}

/** World position of the bat's sweet spot at load 1 and swing progress s (for tests). */
export function sweetSpot(batter: SwingingBatter, s: number, load = 1): THREE.Vector3 {
  batter.userData.pose(load, s);
  batter.updateMatrixWorld(true);
  const bat = batter.getObjectByName("bat")!;
  return new THREE.Vector3(0, BAT_LEN * SWEET, 0).applyMatrix4(bat.matrixWorld);
}
