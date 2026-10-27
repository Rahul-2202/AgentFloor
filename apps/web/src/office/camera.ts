/**
 * The office camera: a tilted perspective view from the front, like the
 * renders. One world unit is one floor tile; x runs right, z runs toward the
 * viewer, y is height. The 3D scene and the 2D layer (tags, bubbles, cards)
 * both project through this, so they always line up.
 */

/** Looking down this far below the horizon. */
export const PITCH = (52 * Math.PI) / 180;
/** Vertical field of view: low, so it reads like a miniature without strong distortion. */
export const FOV = (24 * Math.PI) / 180;

const SIN = Math.sin(PITCH);
const COS = Math.cos(PITCH);
const TAN = Math.tan(FOV / 2);

export interface Cam {
  /** The floor point at the centre of the view, in tiles. */
  x: number;
  z: number;
  /** Screen pixels per tile at that point. */
  s: number;
  /** Viewport size in CSS pixels. */
  w: number;
  h: number;
}

/** Focal length in pixels, and the camera's distance from its target. */
const focal = (c: Cam) => c.h / 2 / TAN;
export const distance = (c: Cam) => focal(c) / c.s;

/** Where the camera stands. */
export function eye(c: Cam): [number, number, number] {
  const d = distance(c);
  return [c.x, d * SIN, c.z + d * COS];
}

/** Floor plan (x, z) at height h → screen pixels, and the pixels per unit there. */
export function project(c: Cam, x: number, z: number, h = 0): { x: number; y: number; scale: number; depth: number } {
  const [ex, ey, ez] = eye(c);
  const vx = x - ex;
  const vy = h - ey;
  const vz = z - ez;
  // right = (1,0,0); up = (0, cos, -sin); forward = (0, -sin, -cos)
  const cx = vx;
  const cy = vy * COS - vz * SIN;
  const cz = -vy * SIN - vz * COS;
  const f = focal(c);
  const k = f / Math.max(0.001, cz);
  return { x: c.w / 2 + cx * k, y: c.h / 2 - cy * k, scale: k, depth: cz };
}

/** Screen pixels → the floor point under them (tiles). */
export function unproject(c: Cam, sx: number, sy: number): [number, number] {
  const [ex, ey, ez] = eye(c);
  const f = focal(c);
  const a = (sx - c.w / 2) / f;
  const b = -(sy - c.h / 2) / f;
  // direction = forward + right·a + up·b
  const dx = a;
  const dy = -SIN + COS * b;
  const dz = -COS - SIN * b;
  const t = -ey / dy;
  return [ex + dx * t, ez + dz * t];
}

/** How deep the floor looks on screen relative to its width (for fitting a rectangle in view). */
export const FLOOR_DEPTH = SIN;
/** How tall a unit of height looks, relative to a unit of floor width. */
export const RISE = COS;
