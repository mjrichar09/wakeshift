// A right-handed batter who can swing. Local frame: faces +z (the plate), LEFT side +x
// (toward the pitcher), so after placing him in the 3B-side box facing +x world, his front
// shoulder points at the pitcher. `swing(s)` poses him for swing progress s ∈ [0, 1]:
// 0 = stance (bat cocked over the right shoulder), 0.55 = contact (barrel out over the
// plate), 1 = follow-through (bat wrapped behind the front shoulder).

import * as THREE from "three";

type P = [number, number, number];
const v = (p: P) => new THREE.Vector3(...p);
const mat = (color: number, roughness = 0.75) => new THREE.MeshStandardMaterial({ color, roughness });

/** Capsule between two points that can be re-posed every frame. */
class Limb {
  readonly mesh: THREE.Mesh;
  constructor(
    private r: number,
    material: THREE.Material,
  ) {
    this.mesh = new THREE.Mesh(new THREE.CapsuleGeometry(r, 1, 4, 10), material);
    this.mesh.castShadow = true;
  }
  set(a: THREE.Vector3, b: THREE.Vector3) {
    const d = b.clone().sub(a);
    const L = Math.max(d.length() - this.r, 0.01);
    this.mesh.scale.set(1, L, 1);
    this.mesh.position.copy(a).add(b).multiplyScalar(0.5);
    this.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  }
}

/** Key poses of the swing: upper-body yaw (deg), hands and bat direction (local frame). */
const KEYS: { s: number; yaw: number; hands: P; bat: P }[] = [
  { s: 0, yaw: 0, hands: [-0.18, 1.4, 0.19], bat: [-0.32, 0.6, -0.31] },
  { s: 0.3, yaw: 20, hands: [-0.15, 1.2, 0.3], bat: [-0.6, 0.25, 0.5] },
  { s: 0.55, yaw: 55, hands: [0.1, 1.02, 0.38], bat: [0.35, -0.08, 1] },
  { s: 0.75, yaw: 85, hands: [0.28, 1.15, 0.25], bat: [1, 0.15, 0.05] },
  { s: 1, yaw: 110, hands: [0.3, 1.45, 0.05], bat: [0.1, 0.6, -0.8] },
];

const BAT_LEN = 0.84;

export interface SwingingBatter extends THREE.Group {
  userData: { swing: (s: number) => void };
}

export function swingingBatter(at: THREE.Vector3): SwingingBatter {
  const g = new THREE.Group() as SwingingBatter;
  const jersey = mat(0x24467a);
  const pants = mat(0xe9e6dd);
  const skin = mat(0xc79a7c, 0.6);
  const shoe = mat(0x1d2124, 0.5);
  const hat = mat(0x14284a, 0.5);

  // Legs and feet stay planted.
  const legs: [P, P, P][] = [
    [[0.12, 0.9, -0.02], [0.3, 0.5, 0.1], [0.38, 0.08, 0]],
    [[-0.12, 0.9, -0.02], [-0.28, 0.5, 0.1], [-0.36, 0.08, 0]],
  ];
  for (const [hip, knee, ankle] of legs) {
    const a = new Limb(0.075, pants);
    a.set(v(hip), v(knee));
    const b = new Limb(0.062, pants);
    b.set(v(knee), v(ankle));
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.24), shoe);
    foot.position.set(ankle[0], 0.04, ankle[2] + 0.05);
    foot.castShadow = true;
    g.add(a.mesh, b.mesh, foot);
  }
  const hips = new Limb(0.1, pants);
  hips.set(v([0.12, 0.9, -0.02]), v([-0.12, 0.9, -0.02]));
  g.add(hips.mesh);

  // Upper body turns about the spine.
  const upper = new THREE.Group();
  const torso = new Limb(0.16, jersey);
  torso.set(v([0, 0.9, -0.02]), v([0.01, 1.3, 0.07]));
  torso.mesh.scale.x = 1.18;
  torso.mesh.scale.z = 0.78;
  const shoulders = new Limb(0.07, jersey);
  shoulders.set(v([0.18, 1.4, 0.05]), v([-0.2, 1.42, 0.02]));
  const neck = new Limb(0.05, skin);
  neck.set(v([0.01, 1.3, 0.07]), v([0.05, 1.6, 0.06]));
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.105, 24, 16), skin);
  head.position.set(0.05, 1.6, 0.06);
  head.castShadow = true;
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.115, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), hat);
  helmet.position.y = 0.01;
  head.add(helmet);
  upper.add(torso.mesh, shoulders.mesh, neck.mesh, head);
  g.add(upper);

  // Arms run from the (turning) shoulders to the hands; the bat hangs off the hands.
  const armL = [new Limb(0.055, jersey), new Limb(0.045, skin)];
  const armR = [new Limb(0.055, jersey), new Limb(0.045, skin)];
  for (const l of [...armL, ...armR]) g.add(l.mesh);
  const bat = new THREE.Mesh(new THREE.CylinderGeometry(0.033, 0.016, BAT_LEN, 14), mat(0xc9a06a, 0.45));
  bat.castShadow = true;
  bat.name = "bat";
  g.add(bat);

  const shoulderL0 = v([0.18, 1.4, 0.05]);
  const shoulderR0 = v([-0.2, 1.42, 0.02]);
  const Y = new THREE.Vector3(0, 1, 0);
  const ease = (x: number) => x * x * (3 - 2 * x);

  const swing = (sIn: number) => {
    const s = THREE.MathUtils.clamp(sIn, 0, 1);
    let k = 0;
    while (k < KEYS.length - 2 && s > KEYS[k + 1].s) k++;
    const a = KEYS[k];
    const b = KEYS[k + 1];
    const f = ease((s - a.s) / (b.s - a.s));
    const yaw = THREE.MathUtils.degToRad(a.yaw + (b.yaw - a.yaw) * f);
    upper.rotation.y = yaw;
    // The head keeps watching the pitcher (local +x) until contact, then follows through.
    head.rotation.y = Math.PI / 2 - yaw * (s < 0.55 ? 1 : 0.6) - 0.15;
    const hands = v(a.hands).lerp(v(b.hands), f);
    const qa = new THREE.Quaternion().setFromUnitVectors(Y, v(a.bat).normalize());
    const qb = new THREE.Quaternion().setFromUnitVectors(Y, v(b.bat).normalize());
    const q = qa.slerp(qb, f);
    const dir = Y.clone().applyQuaternion(q);
    // Thick end (+y of the cylinder) is the barrel, out past the hands.
    bat.quaternion.copy(q);
    bat.position.copy(hands).addScaledVector(dir, BAT_LEN / 2 - 0.08);
    // Arms: shoulders turn with the upper body; elbows sag a little below the line.
    const sL = shoulderL0.clone().applyAxisAngle(Y, yaw);
    const sR = shoulderR0.clone().applyAxisAngle(Y, yaw);
    const handL = hands.clone().addScaledVector(dir, 0.05);
    const handR = hands.clone().addScaledVector(dir, -0.04);
    for (const [sh, hd, arm] of [
      [sL, handL, armL],
      [sR, handR, armR],
    ] as const) {
      const elbow = sh.clone().lerp(hd, 0.5).add(new THREE.Vector3(0, -0.12, 0));
      arm[0].set(sh, elbow);
      arm[1].set(elbow, hd);
    }
  };
  swing(0);
  g.userData.swing = swing;

  g.position.copy(at);
  g.rotation.y = Math.atan2(1, 0); // face +x world: the plate
  g.name = "batter";
  return g;
}

/** Where the bat's sweet spot is at swing progress s, in world coordinates (for tests). */
export function sweetSpot(batter: SwingingBatter, s: number): THREE.Vector3 {
  batter.userData.swing(s);
  batter.updateMatrixWorld(true);
  const bat = batter.getObjectByName("bat")!;
  return new THREE.Vector3(0, BAT_LEN * 0.3, 0).applyMatrix4(bat.matrixWorld);
}
