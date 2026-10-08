// Stylized jointed figures. Poses are joint positions in a local frame where the figure
// faces +z and its LEFT side is +x (so its right hand is at −x). Limbs are capsules strung
// between joints. `place()` turns the figure to face a world direction.

import * as THREE from "three";

type P = [number, number, number];

interface Pose {
  pelvis: P;
  chest: P;
  head: P;
  hip: [P, P]; // [left, right]
  knee: [P, P];
  ankle: [P, P];
  shoulder: [P, P];
  elbow: [P, P];
  wrist: [P, P];
}

interface Look {
  jersey: number;
  pants: number;
  /** Cap color; without one the figure gets short dark hair instead. */
  hat?: number;
  skin?: number;
  /** Extra props in the local frame (bat, mitt, mask…). */
  props?: (g: THREE.Group, pose: Pose) => void;
}

const v = (p: P) => new THREE.Vector3(...p);

function limb(a: P, b: P, r: number, mat: THREE.Material) {
  const A = v(a);
  const B = v(b);
  const d = B.clone().sub(A);
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(d.length() - r, 0.01), 4, 10), mat);
  m.position.copy(A).add(B).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  m.castShadow = true;
  return m;
}

const mat = (color: number, roughness = 0.75) => new THREE.MeshStandardMaterial({ color, roughness });

function build(pose: Pose, look: Look) {
  const g = new THREE.Group();
  const jersey = mat(look.jersey);
  const pants = mat(look.pants);
  const skin = mat(look.skin ?? 0xc79a7c, 0.6);
  const shoe = mat(0x1d2124, 0.5);
  for (const s of [0, 1]) {
    g.add(limb(pose.hip[s], pose.knee[s], 0.075, pants), limb(pose.knee[s], pose.ankle[s], 0.062, pants));
    g.add(limb(pose.shoulder[s], pose.elbow[s], 0.055, jersey), limb(pose.elbow[s], pose.wrist[s], 0.045, skin));
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.24), shoe);
    foot.position.set(pose.ankle[s][0], 0.04, pose.ankle[s][2] + 0.05);
    foot.castShadow = true;
    g.add(foot);
  }
  const torso = limb(pose.pelvis, pose.chest, 0.16, jersey);
  torso.scale.set(1.18, 1, 0.78);
  g.add(torso, limb(pose.shoulder[0], pose.shoulder[1], 0.07, jersey), limb(pose.hip[0], pose.hip[1], 0.1, pants));
  g.add(limb(pose.chest, pose.head, 0.05, skin));
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.105, 24, 16), skin);
  head.position.copy(v(pose.head));
  head.castShadow = true;
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.112, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), mat(look.hat ?? 0x2a2018, 0.5));
  if (look.hat !== undefined) {
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.012, 20, 1, false, -Math.PI / 2, Math.PI), mat(look.hat, 0.5));
    brim.position.set(0, 0.02, 0.09);
    cap.add(brim);
  }
  cap.position.y = 0.01;
  head.add(cap);
  g.add(head);
  look.props?.(g, pose);
  return { g, head };
}

/** Face world direction `facing`; optionally turn the head toward `look`. */
function place(fig: { g: THREE.Group; head: THREE.Mesh }, at: THREE.Vector3, facing: THREE.Vector3, look?: THREE.Vector3) {
  fig.g.position.copy(at);
  fig.g.rotation.y = Math.atan2(facing.x, facing.z);
  if (look) {
    const local = look.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -fig.g.rotation.y);
    fig.head.rotation.y = Math.atan2(local.x, local.z);
  }
  return fig.g;
}

/** Catcher crouched behind the plate, facing the pitcher (−z world), mitt up. */
export function catcher(at: THREE.Vector3) {
  const pose: Pose = {
    pelvis: [0, 0.52, -0.08],
    chest: [0, 0.92, 0.04],
    head: [0, 1.18, 0.08],
    hip: [
      [0.13, 0.52, -0.08],
      [-0.13, 0.52, -0.08],
    ],
    knee: [
      [0.32, 0.46, 0.3],
      [-0.32, 0.46, 0.3],
    ],
    ankle: [
      [0.26, 0.08, -0.05],
      [-0.26, 0.08, -0.05],
    ],
    shoulder: [
      [0.2, 1.0, 0.05],
      [-0.2, 1.0, 0.05],
    ],
    elbow: [
      [0.28, 0.82, 0.3],
      [-0.26, 0.76, 0.24],
    ],
    wrist: [
      [0.14, 0.98, 0.46],
      [-0.2, 0.7, 0.36],
    ],
  };
  const fig = build(pose, {
    jersey: 0x24467a,
    pants: 0xe9e6dd,
    hat: 0x1b1f22,
    props: (g, p) => {
      const mitt = new THREE.Mesh(new THREE.SphereGeometry(0.13, 18, 12), mat(0x7a4a26, 0.6));
      mitt.scale.set(1, 1.1, 0.45);
      mitt.position.copy(v(p.wrist[0])).add(new THREE.Vector3(0, 0.05, 0.05));
      mitt.castShadow = true;
      const pad = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.4, 0.06), mat(0x1b1f22, 0.6));
      pad.position.set(0, 0.8, 0.16);
      pad.rotation.x = -0.25;
      g.add(mitt, pad);
    },
  });
  const grp = place(fig, at, new THREE.Vector3(0, 0, -1));
  grp.name = "catcher";
  return grp;
}

/** Volleyball passer in a ready stance, facing the server (−z world), platform low. */
export function passer(at: THREE.Vector3) {
  const pose: Pose = {
    pelvis: [0, 0.74, -0.06],
    chest: [0, 1.14, 0.12],
    head: [0, 1.4, 0.19],
    hip: [
      [0.13, 0.74, -0.06],
      [-0.13, 0.74, -0.06],
    ],
    knee: [
      [0.3, 0.43, 0.22],
      [-0.3, 0.43, 0.22],
    ],
    ankle: [
      [0.34, 0.08, 0],
      [-0.34, 0.08, 0],
    ],
    shoulder: [
      [0.2, 1.22, 0.12],
      [-0.2, 1.22, 0.12],
    ],
    elbow: [
      [0.12, 0.98, 0.36],
      [-0.12, 0.98, 0.36],
    ],
    wrist: [
      [0.04, 0.86, 0.52],
      [-0.04, 0.86, 0.52],
    ],
  };
  const fig = build(pose, { jersey: 0x2d7a64, pants: 0x1d2a33 });
  const grp = place(fig, at, new THREE.Vector3(0, 0, -1));
  grp.name = "passer";
  return grp;
}
