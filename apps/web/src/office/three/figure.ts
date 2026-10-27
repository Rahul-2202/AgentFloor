import { Group, Mesh, MeshPhysicalMaterial, Color, type BufferGeometry, type Material } from "three";
import type { Look } from "../look";
import { clay, shade } from "./materials";
import { capsule, cylinder, rbox, sphere, torus } from "./shapes";

/*
 * A clay figure, like the people in the renders: about 2.7 units tall (one
 * unit ≈ 0.7 m), soft knit sweater, trousers, round shoes, a calm face. Built
 * facing +z (toward the viewer). Used on the floor and for the portraits.
 */

export const HIP = 1.12;
export const SEAT_HIP = 0.6;
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
  foreL: Group;
  foreR: Group;
}

/** Knitwear: matte with a soft sheen at the edges, like the renders' sweaters. */
const knits = new Map<string, MeshPhysicalMaterial>();
function knit(color: string) {
  let m = knits.get(color);
  if (!m) {
    m = new MeshPhysicalMaterial({ color: new Color(color), roughness: 0.92, sheen: 0.6, sheenRoughness: 0.75, sheenColor: new Color(shade(color, 1.35)) });
    knits.set(color, m);
  }
  return m;
}

type V3 = [number, number, number];
function add(parent: Group, g: BufferGeometry, m: Material, pos: V3 = [0, 0, 0], rot?: V3, scale?: V3, shadow = true) {
  const mesh = new Mesh(g, m);
  mesh.position.set(...pos);
  if (rot) mesh.rotation.set(...rot);
  if (scale) mesh.scale.set(...scale);
  mesh.castShadow = shadow;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}
function group(parent: Group, pos: V3 = [0, 0, 0]) {
  const g = new Group();
  g.position.set(...pos);
  parent.add(g);
  return g;
}

const R = 0.27; // head radius

const CURLS: V3[] = (() => {
  const out: V3[] = [];
  for (let ring = 0; ring < 3; ring++) {
    const n = [10, 8, 4][ring]!;
    const lat = [0.35, 0.85, 1.25][ring]!;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + ring * 0.4;
      const x = Math.sin(lat) * Math.cos(a) * R * 1.02;
      const z = Math.sin(lat) * Math.sin(a) * R * 1.02;
      const y = Math.cos(lat) * R * 1.02;
      if (z > R * 0.55 && y < R * 0.55) continue; // keep the face clear
      out.push([x, y + 0.02, z - 0.02]);
    }
  }
  return out;
})();

function hair(head: Group, look: Look) {
  const m = clay(look.hair, { rough: 0.85 });
  const front: [number, number] = [Math.PI / 2 + 0.95, Math.PI * 2 - 1.9]; // everything but the face
  const cap = (theta = 1.25, r = R * 1.07) => add(head, sphere(r, { theta: [0, theta] }), m, [0, 0.03, -0.02]);
  switch (look.style) {
    case "buzz":
      add(head, sphere(R * 1.03, { theta: [0, 1.3] }), m, [0, 0.015, -0.015]);
      break;
    case "cap": {
      const c = clay(look.cap ?? "#2f6fd1", { rough: 0.7 });
      add(head, sphere(R * 1.08, { theta: [0, 1.25] }), c, [0, 0.04, -0.02]);
      add(head, cylinder(0.17, 0.17, 0.025, 24), c, [0, 0.13, 0.21], [0.12, 0, 0], [1.05, 1, 1]);
      add(head, sphere(R * 1.04, { phi: front, theta: [1.15, 0.85] }), m);
      break;
    }
    case "curly":
      cap(1.2);
      for (const p of CURLS) add(head, sphere(0.085), m, p);
      break;
    case "bob":
      cap(1.2);
      add(head, sphere(R * 1.13, { phi: front, theta: [0.5, 1.55] }), m, [0, -0.015, -0.015]);
      break;
    case "long":
      cap(1.2);
      add(head, sphere(R * 1.13, { phi: front, theta: [0.5, 1.65] }), m, [0, -0.015, -0.015]);
      add(head, rbox(0.5, 0.62, 0.16, 0.08), m, [0, -0.36, -0.16]);
      break;
    case "bun":
      cap(1.25);
      add(head, sphere(0.12), m, [0, 0.27, -0.12]);
      break;
    case "pony":
      cap(1.25);
      add(head, capsule(0.07, 0.28), m, [0, -0.1, -0.31], [0.3, 0, 0]);
      add(head, sphere(0.055), clay(shade(look.hair, 0.7)), [0, 0.07, -0.27]);
      break;
    default:
      cap(1.22);
      add(head, sphere(0.1), m, [0.08, 0.21, 0.15], undefined, [1.6, 0.6, 1]);
  }
}

function face(head: Group, look: Look) {
  const skin = clay(look.skin, { rough: 0.6 });
  const ink = clay(INK, { rough: 0.4 });
  add(head, sphere(R), skin, [0, 0, 0], undefined, [1, 1.04, 0.96]);
  add(head, sphere(0.055), skin, [R * 0.98, -0.02, -0.01], undefined, [0.6, 1, 1], false);
  add(head, sphere(0.055), skin, [-R * 0.98, -0.02, -0.01], undefined, [0.6, 1, 1], false);
  add(head, sphere(0.03), ink, [0.088, 0.015, R * 0.9], undefined, [1, 1.3, 0.5], false);
  add(head, sphere(0.03), ink, [-0.088, 0.015, R * 0.9], undefined, [1, 1.3, 0.5], false);
  add(head, rbox(0.06, 0.012, 0.012, 0.005), clay(shade(look.hair, 0.85)), [0.09, 0.075, R * 0.9], [0, 0, -0.12], undefined, false);
  add(head, rbox(0.06, 0.012, 0.012, 0.005), clay(shade(look.hair, 0.85)), [-0.09, 0.075, R * 0.9], [0, 0, 0.12], undefined, false);
  add(head, sphere(0.035), clay(shade(look.skin, 0.97)), [0, -0.03, R * 0.97], undefined, [0.9, 0.9, 0.8], false);
  add(head, torus(0.042, 0.009, Math.PI), ink, [0, -0.085, R * 0.9], [0.3, 0, Math.PI], undefined, false);
  const blush = clay("#f0a08a", { opacity: 0.45 });
  add(head, sphere(0.04), blush, [0.15, -0.055, R * 0.8], undefined, [1, 0.6, 0.4], false);
  add(head, sphere(0.04), blush, [-0.15, -0.055, R * 0.8], undefined, [1, 0.6, 0.4], false);
  if (look.glasses) {
    const g = group(head, [0, 0.015, R * 0.93]);
    add(g, torus(0.058, 0.01), ink, [0.09, 0, 0], undefined, undefined, false);
    add(g, torus(0.058, 0.01), ink, [-0.09, 0, 0], undefined, undefined, false);
    add(g, rbox(0.06, 0.012, 0.012, 0.005), ink, [0, 0, 0], undefined, undefined, false);
  }
  hair(head, look);
}

/** Builds a figure; the rig's groups are what the frame loop poses. */
export function buildFigure(look: Look, chief = false): Rig {
  const root = new Group();
  const body = group(root);
  const hips = group(body, [0, HIP, 0]);
  const pants = clay(look.pants, { rough: 0.85 });
  const shoe = clay(look.shoes ?? "#3a302b", { rough: 0.55 });
  const shirt = chief ? CHIEF : look.shirt;
  const sweater = knit(shirt);
  const skin = clay(look.skin, { rough: 0.6 });

  const leg = (side: 1 | -1) => {
    const thigh = group(hips, [0.12 * side, -0.02, 0]);
    add(thigh, capsule(0.11, 0.36), pants, [0, -0.25, 0]);
    const shin = group(thigh, [0, -0.52, 0]);
    add(shin, capsule(0.095, 0.36), pants, [0, -0.22, 0]);
    add(shin, rbox(0.17, 0.11, 0.3, 0.05), shoe, [0, -0.5, 0.05]);
    return { thigh, shin };
  };
  const L = leg(-1);
  const R2 = leg(1);

  const torso = group(hips);
  add(torso, rbox(0.42, 0.24, 0.28, 0.1), pants, [0, 0.02, 0]);
  add(torso, capsule(0.24, 0.42), sweater, [0, 0.42, 0], undefined, [1.08, 1, 0.78]);
  add(torso, cylinder(0.075, 0.08, 0.14, 16), skin, [0, 0.84, 0.005], undefined, undefined, false);
  add(torso, torus(0.09, 0.035), knit(chief ? "#2b2826" : (look.accent ?? shade(shirt, 0.9))), [0, 0.79, 0], [Math.PI / 2, 0, 0], undefined, false);

  const arm = (side: 1 | -1) => {
    const a = group(torso, [0.29 * side, 0.7, 0]);
    a.rotation.z = 0.07 * side;
    add(a, sphere(0.1), sweater, [0, -0.01, 0], undefined, undefined, false);
    add(a, capsule(0.075, 0.2), sweater, [0.01 * side, -0.16, 0]);
    const fore = group(a, [0.01 * side, -0.32, 0]);
    add(fore, capsule(0.068, 0.2), sweater, [0, -0.14, 0]);
    add(fore, sphere(0.06), skin, [0, -0.31, 0.01], undefined, [0.9, 1.1, 0.8]);
    return { a, fore };
  };
  const AL = arm(-1);
  const AR = arm(1);
  const head = group(torso, [0, 1.13, 0.02]);
  face(head, look);
  return { root, body, hips, torso, head, thighL: L.thigh, thighR: R2.thigh, shinL: L.shin, shinR: R2.shin, armL: AL.a, armR: AR.a, foreL: AL.fore, foreR: AR.fore };
}
