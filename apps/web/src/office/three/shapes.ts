import { CapsuleGeometry, CylinderGeometry, SphereGeometry, TorusGeometry, type BufferGeometry } from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

/** Geometry is shared by size: a hundred desks use one tabletop. */
const cache = new Map<string, BufferGeometry>();
const once = <T extends BufferGeometry>(key: string, make: () => T): T => {
  let g = cache.get(key);
  if (!g) {
    g = make();
    cache.set(key, g);
  }
  return g as T;
};
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export const rbox = (w: number, h: number, d: number, radius = 0.04) =>
  once(`rb${r3(w)},${r3(h)},${r3(d)},${r3(radius)}`, () => new RoundedBoxGeometry(w, h, d, 3, Math.min(radius, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001)));

export const capsule = (r: number, len: number) => once(`cap${r3(r)},${r3(len)}`, () => new CapsuleGeometry(r, len, 6, 14));

export const sphere = (r: number, part?: { phi?: [number, number]; theta?: [number, number] }) =>
  once(`sp${r3(r)},${part?.phi?.join(",") ?? ""},${part?.theta?.join(",") ?? ""}`, () =>
    new SphereGeometry(r, 28, 20, part?.phi?.[0] ?? 0, part?.phi?.[1] ?? Math.PI * 2, part?.theta?.[0] ?? 0, part?.theta?.[1] ?? Math.PI),
  );

export const cylinder = (rTop: number, rBottom: number, h: number, seg = 24) => once(`cy${r3(rTop)},${r3(rBottom)},${r3(h)},${seg}`, () => new CylinderGeometry(rTop, rBottom, h, seg));

export const torus = (r: number, tube: number, arc = Math.PI * 2) => once(`to${r3(r)},${r3(tube)},${r3(arc)}`, () => new TorusGeometry(r, tube, 10, 28, arc));

/** A tiny deterministic hash, for picking variations by id. */
export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967295;
}
