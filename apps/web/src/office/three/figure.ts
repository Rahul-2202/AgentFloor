import { Group, Mesh, type BufferGeometry, type Material } from "three";
import type { Look } from "../look";
import { clay, shade } from "./materials";
import { capsule, cylinder, rbox, sphere, torus } from "./shapes";

/*
 * A clay figure, about 2.2 units tall: big round head, soft sweater body,
 * stubby limbs. Built facing +z (toward the viewer). The same build is used on
 * the floor and for the small portraits in name tags.
 */

export const HIP = 0.78;
const INK = "#2a2420";
/** Ada, the chief, wears black. */
export const CHIEF = "#1f1d1c";

export interface Rig {
  root: Group;
  body: Group;
  hips: Group;
  torso: Group;
  head: Group;
  thighL: Group;
  thighR: Group;
  shinL: Group;
  shinR: Group;
  armL: Group;
  armR: Group;
}

type V3 = [number, number, number];
function add(parent: Group, g: BufferGeometry, m: Material, pos: V3 = [0, 0, 0], rot?: V3, scale?: V3, shadow = true) {
  const mesh = new Mesh(g, m);
  mesh.position.set(...pos);
  if (rot) mesh.rotation.set(...rot);
  if (scale) mesh.scale.set(...scale);
  mesh.castShadow = shadow;
  parent.add(mesh);
  return mesh;
}
function group(parent: Group, pos: V3 = [0, 0, 0]) {
  const g = new Group();
  g.position.set(...pos);
  parent.add(g);
  return g;
}

const CURLS: V3[] = (() => {
  const out: V3[] = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const ring = i % 2 ? 0.55 : 0.85;
    const y = i % 2 ? 0.26 : 0.12;
    const z = Math.sin(a) * 0.32 * ring;
    if (z > 0.18 && y < 0.2) continue; // keep the face clear
    out.push([Math.cos(a) * 0.32 * ring, y + 0.06, z - 0.02]);
  }
  out.push([0, 0.36, 0], [0.12, 0.33, 0.12], [-0.12, 0.33, 0.1], [0, 0.3, -0.18]);
  return out;
})();

function hair(head: Group, look: Look) {
  const m = clay(look.hair, { rough: 0.9 });
  const front: [number, number] = [Math.PI / 2 + 1.0, Math.PI * 2 - 2.0]; // everything but the face
  const cap = (r: number, theta: number) => add(head, sphere(r, { theta: [0, theta] }), m, [0, 0.04, -0.03]);
  switch (look.style) {
    case "buzz":
      add(head, sphere(0.352, { theta: [0, 1.4] }), m, [0, 0.02, -0.02]);
      break;
    case "cap": {
      const c = clay(look.cap ?? "#2f6fd1");
      add(head, sphere(0.36, { theta: [0, 1.3] }), c, [0, 0.05, -0.02]);
      add(head, cylinder(0.2, 0.2, 0.03, 20), c, [0, 0.17, 0.27], undefined, [1.1, 1, 1]);
      add(head, sphere(0.35, { phi: front, theta: [1.2, 0.9] }), m);
      break;
    }
    case "curly":
      cap(0.36, 1.3);
      for (const p of CURLS) add(head, sphere(0.11), m, p);
      break;
    case "bob":
      cap(0.37, 1.25);
      add(head, sphere(0.385, { phi: front, theta: [0.6, 1.5] }), m, [0, -0.02, -0.02]);
      break;
    case "long":
      cap(0.37, 1.25);
      add(head, sphere(0.385, { phi: front, theta: [0.6, 1.6] }), m, [0, -0.02, -0.02]);
      add(head, rbox(0.62, 0.62, 0.2, 0.09), m, [0, -0.36, -0.2]);
      break;
    case "bun":
      cap(0.365, 1.3);
      add(head, sphere(0.15), m, [0, 0.36, -0.14]);
      break;
    case "pony":
      cap(0.365, 1.3);
      add(head, capsule(0.09, 0.3), m, [0, -0.12, -0.38], [0.35, 0, 0]);
      add(head, sphere(0.07), clay(shade(look.hair, 0.7)), [0, 0.08, -0.33]);
      break;
    default:
      add(head, sphere(0.365, { theta: [0, 1.25] }), m, [0, 0.05, -0.03]);
      add(head, sphere(0.13), m, [0.12, 0.27, 0.2], undefined, [1.5, 0.7, 1]);
  }
}

function face(head: Group, look: Look) {
  const skin = clay(look.skin, { rough: 0.75 });
  const ink = clay(INK, { rough: 0.5 });
  add(head, sphere(0.34), skin, [0, 0, 0], undefined, [1, 0.96, 0.95]);
  add(head, sphere(0.07), skin, [0.33, -0.02, 0], undefined, undefined, false);
  add(head, sphere(0.07), skin, [-0.33, -0.02, 0], undefined, undefined, false);
  add(head, sphere(0.042), ink, [0.115, 0.02, 0.305], undefined, [1, 1.3, 0.6], false);
  add(head, sphere(0.042), ink, [-0.115, 0.02, 0.305], undefined, [1, 1.3, 0.6], false);
  const blush = clay("#f0a08a", { opacity: 0.55 });
  add(head, sphere(0.05), blush, [0.19, -0.07, 0.27], undefined, [1, 0.6, 0.4], false);
  add(head, sphere(0.05), blush, [-0.19, -0.07, 0.27], undefined, [1, 0.6, 0.4], false);
  add(head, torus(0.06, 0.012, Math.PI), ink, [0, -0.09, 0.305], [0.25, 0, Math.PI], undefined, false);
  add(head, sphere(0.05), clay(shade(look.skin, 1.06)), [0, -0.03, 0.33], undefined, [1, 0.8, 0.6], false);
  if (look.glasses) {
    const g = group(head, [0, 0.02, 0.32]);
    add(g, torus(0.075, 0.014), ink, [0.115, 0, 0], undefined, undefined, false);
    add(g, torus(0.075, 0.014), ink, [-0.115, 0, 0], undefined, undefined, false);
    add(g, rbox(0.07, 0.016, 0.016, 0.006), ink, [0, 0, 0], undefined, undefined, false);
  }
  hair(head, look);
}

/** Builds a figure; the rig's groups are what the frame loop poses. */
export function buildFigure(look: Look, chief = false): Rig {
  const root = new Group();
  const body = group(root);
  const hips = group(body, [0, HIP, 0]);
  const pants = clay(look.pants);
  const shoe = clay(look.shoes ?? "#3a302b", { rough: 0.6 });
  const shirt = chief ? CHIEF : look.shirt;
  const leg = (side: 1 | -1) => {
    const thigh = group(hips, [0.13 * side, 0, 0]);
    add(thigh, capsule(0.11, 0.24), pants, [0, -0.18, 0]);
    const shin = group(thigh, [0, -0.38, 0]);
    add(shin, capsule(0.1, 0.18), pants, [0, -0.14, 0]);
    add(shin, rbox(0.2, 0.12, 0.3, 0.05), shoe, [0, -0.33, 0.05]);
    return { thigh, shin };
  };
  const L = leg(-1);
  const R = leg(1);
  const torso = group(hips);
  add(torso, rbox(0.5, 0.22, 0.36, 0.1), pants, [0, 0.02, 0]);
  add(torso, capsule(0.27, 0.34), clay(shirt, { rough: 0.95 }), [0, 0.4, 0], undefined, [1.08, 1, 0.82]);
  add(torso, torus(0.13, 0.04), clay(chief ? "#2e2b29" : (look.accent ?? shade(shirt, 0.86)), { rough: 0.95 }), [0, 0.74, 0], [Math.PI / 2, 0, 0], undefined, false);
  const arm = (side: 1 | -1) => {
    const a = group(torso, [0.34 * side, 0.58, 0]);
    a.rotation.z = 0.08 * side;
    add(a, capsule(0.085, 0.36), clay(shirt, { rough: 0.92 }), [0.02 * side, -0.22, 0]);
    add(a, sphere(0.085), clay(look.skin, { rough: 0.75 }), [0.025 * side, -0.47, 0]);
    return a;
  };
  const armL = arm(-1);
  const armR = arm(1);
  const head = group(torso, [0, 1.08, 0.02]);
  face(head, look);
  return { root, body, hips, torso, head, thighL: L.thigh, thighR: R.thigh, shinL: L.shin, shinR: R.shin, armL, armR };
}
