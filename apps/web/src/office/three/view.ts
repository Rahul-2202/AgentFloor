import { Matrix4 } from "three";
import { TILE, WORLD } from "../layout";

/**
 * The office is drawn in 3D but laid out on the same flat floor plan as
 * before: one world unit is one tile, x runs right, z runs down the screen,
 * y is height. The camera is an oblique (top-down) projection: the floor maps
 * to the screen exactly as the 2D plan did, and anything with height leans up
 * the screen by K per unit. So every overlay (name tags, bubbles, cards) keeps
 * its plan position, and the 3D picture lines up underneath it.
 */
export const K = 0.72;

/** How high something stands, in tiles on screen, for `h` units of height. */
export const lift = (h: number) => h * K;

/** Clip-space matrix for the world div's transform: screen = plan px × s + (x, y). */
export function viewMatrix(out: Matrix4, v: { s: number; x: number; y: number }, w: number, h: number, depth = WORLD.h + 12): Matrix4 {
  const a = (2 * TILE * v.s) / w;
  const b = (2 * TILE * v.s) / h;
  // Nearer the viewer = higher up and further down the floor: c = height + K·z.
  const cMin = -6;
  const cMax = 14 + K * depth;
  const r = cMax - cMin;
  const dz = -2 / r;
  // prettier-ignore
  return out.set(
    a, 0, 0, (2 * v.x) / w - 1,
    0, b * K, -b, 1 - (2 * v.y) / h,
    0, dz, dz * K, 1 + (2 * cMin) / r,
    0, 0, 0, 1,
  );
}
