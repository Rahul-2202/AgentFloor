"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import {
  BufferAttribute,
  BufferGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  LineDashedMaterial,
  LineSegments,
  MeshStandardMaterial,
  PlaneGeometry,
  Shape,
  Color,
  type Group,
} from "three";
import { ROOMS, WORLD, type RoomDef } from "../layout";
import type { RoomId, RoomState } from "../types";
import { useSurface } from "./assets";
import { carpet, clay } from "./materials";
import { hash, rbox, sphere } from "./shapes";

/*
 * The building, open plan like the renders: a wood floor, team zones as soft
 * coloured rugs edged with low wooden planters, glass rooms for meetings and
 * your office, a tall window wall at the back and a cut-away front.
 */

/** Zone colours, from the renders. */
const ZONE: Record<RoomId, string> = {
  ceo: "#e7cfae",
  dev: "#b4cdb3",
  marketing: "#cfc4e6",
  meeting: "#e9b8a4",
  sales: "#efd79a",
  legal: "#b3cbe8",
  finance: "#b9dcc6",
};
const GLASS_ROOMS: RoomId[] = ["meeting", "ceo"];

export const WALL_H = 3.8;
const PLASTER = "#f3efe8";
const OAK = "#d8b88f";
const LEAVES = ["#5f8f4c", "#6f9f57", "#557f43", "#7cab5e"];

/** A flat patch whose textures repeat every `tile` units. */
function patch(w: number, d: number, tile: number) {
  const g = new PlaneGeometry(w, d);
  const uv = g.attributes.uv as BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / tile, (uv.getY(i) * d) / tile);
  g.rotateX(-Math.PI / 2);
  return g;
}

/** A rug: a rounded rectangle with a little thickness. */
function rugGeometry(w: number, d: number, r = 0.45) {
  const s = new Shape();
  const x0 = -w / 2;
  const z0 = -d / 2;
  s.moveTo(x0 + r, z0);
  s.lineTo(x0 + w - r, z0);
  s.quadraticCurveTo(x0 + w, z0, x0 + w, z0 + r);
  s.lineTo(x0 + w, z0 + d - r);
  s.quadraticCurveTo(x0 + w, z0 + d, x0 + w - r, z0 + d);
  s.lineTo(x0 + r, z0 + d);
  s.quadraticCurveTo(x0, z0 + d, x0, z0 + d - r);
  s.lineTo(x0, z0 + r);
  s.quadraticCurveTo(x0, z0, x0 + r, z0);
  const g = new ExtrudeGeometry(s, { depth: 0.04, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.03, bevelSegments: 2, curveSegments: 10 });
  g.rotateX(Math.PI / 2);
  g.translate(0, 0.055, 0);
  // UVs in world units / 3 for the weave
  const uv = g.attributes.uv as BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 3, uv.getY(i) / 3);
  return g;
}

function Floor() {
  const tex = useSurface("laminate_floor_02");
  const geo = useMemo(() => patch(WORLD.w, WORLD.h, 4), []);
  // The laminate is a mid oak; lift it to the renders' light honey wood.
  const mat = useMemo(() => new MeshStandardMaterial({ ...tex, color: new Color(1.45, 1.3, 1.12), roughness: 0.8 }), [tex]);
  return (
    <group>
      {/* the diorama base under the cut-away front */}
      <mesh geometry={rbox(WORLD.w + 1.2, 0.7, WORLD.h + 1.0, 0.18)} material={clay("#f4f1ec", { rough: 0.9 })} position={[WORLD.w / 2, -0.36, WORLD.h / 2 + 0.2]} receiveShadow />
      <mesh geometry={geo} material={mat} position={[WORLD.w / 2, 0.002, WORLD.h / 2]} receiveShadow />
    </group>
  );
}

/** Plaster walls (box with the plaster's normal map). */
function usePlaster() {
  const tex = useSurface("white_plaster_02");
  return useMemo(() => new MeshStandardMaterial({ normalMap: tex.normalMap, roughnessMap: tex.roughnessMap, color: new Color(PLASTER), roughness: 0.95 }), [tex]);
}

function WindowRow({ x0, x1, z, y0, y1, along = "x" }: { x0: number; x1: number; z: number; y0: number; y1: number; along?: "x" | "z" }) {
  const len = x1 - x0;
  const n = Math.max(1, Math.round(len / 2.4));
  const pw = len / n;
  const h = y1 - y0;
  const frame = clay("#ffffff", { rough: 0.5 });
  const glassMat = useMemo(() => new MeshStandardMaterial({ color: new Color("#cfe4f4"), emissive: new Color("#bcd8ef"), emissiveIntensity: 0.55, roughness: 0.08, metalness: 0 }), []);
  return (
    <group position={along === "x" ? [x0, 0, z] : [z, 0, x0]} rotation={along === "x" ? [0, 0, 0] : [0, -Math.PI / 2, 0]}>
      {Array.from({ length: n }, (_, i) => (
        <group key={i} position={[pw * (i + 0.5), y0 + h / 2, 0]}>
          <mesh geometry={rbox(pw - 0.08, h, 0.04, 0.01)} material={glassMat} />
          <mesh geometry={rbox(0.07, h + 0.02, 0.1, 0.02)} material={frame} position={[-pw / 2 + 0.035, 0, 0.03]} castShadow />
          <mesh geometry={rbox(pw, 0.07, 0.1, 0.02)} material={frame} position={[0, h * 0.18, 0.03]} />
        </group>
      ))}
      <mesh geometry={rbox(len, 0.1, 0.14, 0.02)} material={frame} position={[len / 2, y0 - 0.05, 0.04]} />
      <mesh geometry={rbox(len, 0.1, 0.14, 0.02)} material={frame} position={[len / 2, y1 + 0.05, 0.04]} />
      <mesh geometry={rbox(0.07, h, 0.1, 0.02)} material={frame} position={[len - 0.035, y0 + h / 2, 0.03]} />
    </group>
  );
}

/** The building's walls: tall plaster with windows at the back and right, cut away at the front. */
function Shell() {
  const plaster = usePlaster();
  const W = WORLD.w;
  const H = WORLD.h;
  return (
    <group>
      {/* back wall, its face at z = 3 */}
      <mesh geometry={rbox(W + 0.6, WALL_H, 0.4, 0.04)} material={plaster} position={[W / 2, WALL_H / 2, 2.8]} castShadow receiveShadow />
      <mesh geometry={rbox(W, 0.16, 0.06, 0.02)} material={clay(OAK)} position={[W / 2, 0.08, 3.02]} />
      <WindowRow x0={0.3} x1={W - 0.3} z={3.02} y0={2.05} y1={3.55} />
      {/* right wall with windows, left wall plain with the entrance */}
      <mesh geometry={rbox(0.4, WALL_H, H - 2.6, 0.04)} material={plaster} position={[W + 0.1, WALL_H / 2, 3 + (H - 3) / 2 - 0.2]} castShadow receiveShadow />
      <WindowRow x0={3.4} x1={H - 0.6} z={W - 0.11} y0={1.2} y1={3.4} along="z" />
      <mesh geometry={rbox(0.4, WALL_H, 9.2, 0.04)} material={plaster} position={[-0.1, WALL_H / 2, 3 + 9.2 / 2 - 0.2]} castShadow receiveShadow />
      <mesh geometry={rbox(0.4, WALL_H, H - 15, 0.04)} material={plaster} position={[-0.1, WALL_H / 2, 15 + (H - 15) / 2]} castShadow receiveShadow />
      {/* the cut-away front: a low wall with planters */}
      <mesh geometry={rbox(W + 0.6, 0.55, 0.4, 0.06)} material={plaster} position={[W / 2, 0.27, H + 0.15]} castShadow receiveShadow />
      <mesh geometry={rbox(0.4, 0.55, 3, 0.06)} material={plaster} position={[-0.1, 0.27, 13.5]} />
      {/* entrance mat */}
      <mesh geometry={rbox(1.2, 0.03, 2.6, 0.01)} material={clay("#9a8572", { rough: 1 })} position={[0.8, 0.02, 13.5]} receiveShadow />
    </group>
  );
}

/** A low wooden planter with greenery: the renders' zone edges. */
function Planter({ x0, z0, x1, z1 }: { x0: number; z0: number; x1: number; z1: number }) {
  const along = Math.abs(x1 - x0) >= Math.abs(z1 - z0);
  const len = along ? Math.abs(x1 - x0) : Math.abs(z1 - z0);
  if (len < 0.6) return null;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const n = Math.max(1, Math.round(len / 0.9));
  const seed = hash(`${x0},${z0}`);
  return (
    <group position={[cx, 0, cz]} rotation={[0, along ? 0 : Math.PI / 2, 0]}>
      <mesh geometry={rbox(len, 0.5, 0.42, 0.05)} material={clay(OAK, { rough: 0.7 })} position={[0, 0.25, 0]} castShadow receiveShadow />
      <mesh geometry={rbox(len - 0.08, 0.04, 0.34, 0.02)} material={clay("#5b4636")} position={[0, 0.49, 0]} />
      {Array.from({ length: n }, (_, i) => {
        const x = -len / 2 + (len / n) * (i + 0.5);
        const k = (i * 7 + Math.floor(seed * 10)) % 4;
        return (
          <group key={i} position={[x, 0.5, 0]}>
            <mesh geometry={sphere(0.26)} material={clay(LEAVES[k]!, { rough: 0.75 })} position={[0, 0.16, 0]} scale={[1.1, 0.8, 0.9]} castShadow />
            <mesh geometry={sphere(0.18)} material={clay(LEAVES[(k + 1) % 4]!, { rough: 0.75 })} position={[0.2, 0.24, 0.05]} castShadow />
            <mesh geometry={sphere(0.16)} material={clay(LEAVES[(k + 2) % 4]!, { rough: 0.75 })} position={[-0.2, 0.2, -0.04]} castShadow />
          </group>
        );
      })}
    </group>
  );
}

/** A glass partition with white frames. */
const PANE = new MeshStandardMaterial({ color: new Color("#dbe9f1"), transparent: true, opacity: 0.22, roughness: 0.05, depthWrite: false });

function Glass({ x0, z0, x1, z1, h = 2.4 }: { x0: number; z0: number; x1: number; z1: number; h?: number }) {
  const pane = PANE;
  const along = Math.abs(x1 - x0) >= Math.abs(z1 - z0);
  const len = along ? Math.abs(x1 - x0) : Math.abs(z1 - z0);
  if (len < 0.3) return null;
  const n = Math.max(1, Math.round(len / 1.6));
  const frame = clay("#f7f5f1", { rough: 0.5 });
  return (
    <group position={[(x0 + x1) / 2, 0, (z0 + z1) / 2]} rotation={[0, along ? 0 : Math.PI / 2, 0]}>
      <mesh geometry={rbox(len, h, 0.05, 0.01)} material={pane} position={[0, h / 2, 0]} />
      <mesh geometry={rbox(len, 0.08, 0.1, 0.02)} material={frame} position={[0, h, 0]} castShadow />
      <mesh geometry={rbox(len, 0.1, 0.1, 0.02)} material={frame} position={[0, 0.05, 0]} />
      {Array.from({ length: n + 1 }, (_, i) => (
        <mesh key={i} geometry={rbox(0.07, h, 0.1, 0.02)} material={frame} position={[-len / 2 + (len / n) * i, h / 2, 0]} castShadow />
      ))}
    </group>
  );
}

type Edge = { x0: number; z0: number; x1: number; z1: number };
/** A room's edges, leaving its doorway open. */
function edges(r: RoomDef): Edge[] {
  const top = r.y + 2;
  const bottom = r.y + r.h;
  const out: Edge[] = [
    { x0: r.x, z0: top, x1: r.x, z1: bottom },
    { x0: r.x + r.w, z0: top, x1: r.x + r.w, z1: bottom },
  ];
  const along = (z: number, door: boolean) => {
    if (!door) return out.push({ x0: r.x, z0: z, x1: r.x + r.w, z1: z });
    out.push({ x0: r.x, z0: z, x1: r.x + r.door.at, z1: z }, { x0: r.x + r.door.at + r.door.w, z0: z, x1: r.x + r.w, z1: z });
  };
  along(bottom, r.door.side === "bottom");
  if (r.y > 3) along(top, r.door.side === "top");
  return out;
}

function DashedOutline({ r, color }: { r: RoomDef; color: string }) {
  const obj = useMemo(() => {
    const y = 0.07;
    const x0 = r.x + 0.3;
    const x1 = r.x + r.w - 0.3;
    const z0 = r.y + 2.3;
    const z1 = r.y + r.h - 0.3;
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute([x0, y, z0, x1, y, z0, x1, y, z0, x1, y, z1, x1, y, z1, x0, y, z1, x0, y, z1, x0, y, z0], 3));
    const line = new LineSegments(g, new LineDashedMaterial({ color, dashSize: 0.35, gapSize: 0.25, transparent: true, opacity: 0.9 }));
    line.computeLineDistances();
    return line;
  }, [r, color]);
  return <primitive object={obj} />;
}

function Zone({ r, opacity = 1, color }: { r: RoomDef; opacity?: number; color?: string }) {
  const w = r.w - 0.6;
  const d = r.h - 2.6;
  const geo = useMemo(() => rugGeometry(w, d), [w, d]);
  const tint = color ?? ZONE[r.id];
  const mat = color ? clay(tint, { opacity, rough: 1 }) : clay("#ffffff", { map: carpet(tint), rough: 0.98 });
  return <mesh geometry={geo} material={mat} position={[r.x + r.w / 2, 0, r.y + 2.3 + d / 2]} receiveShadow />;
}

/** A room in its state: built zones rise in; planned and suggested ones are outlines on the floor. */
function RoomShape({ r, state }: { r: RoomDef; state: RoomState }) {
  const g = useRef<Group>(null);
  const since = useRef<{ state: RoomState; at: number }>({ state, at: -1 });
  useFrame((st) => {
    const s = since.current;
    const t = st.clock.elapsedTime;
    if (s.state !== state || s.at < 0) {
      s.at = s.at < 0 ? -10 : t;
      s.state = state;
    }
    if (!g.current) return;
    const p = Math.max(0, Math.min(1, (t - s.at) / 0.8));
    g.current.scale.y = 0.001 + 0.999 * (1 - Math.pow(1 - p, 3));
  });
  if (state === "hidden") return null;
  if (state !== "built")
    return (
      <group>
        <Zone r={r} color={state === "ghost" ? "#fff1e6" : "#ffffff"} opacity={state === "ghost" ? 0.7 : 0.35} />
        <DashedOutline r={r} color={state === "ghost" ? "#e8743b" : "#8a7d70"} />
      </group>
    );
  const glass = GLASS_ROOMS.includes(r.id);
  return (
    <group>
      <Zone r={r} />
      <group ref={g}>
        {edges(r).map((e, i) => (glass ? <Glass key={i} {...e} /> : <Planter key={i} {...e} />))}
      </group>
    </group>
  );
}

export function Building({ rooms }: { rooms: Partial<Record<RoomId, RoomState>> }) {
  return (
    <group>
      <Floor />
      <Shell />
      {Object.values(ROOMS).map((r) => (
        <RoomShape key={r.id} r={r} state={rooms[r.id] ?? "hidden"} />
      ))}
    </group>
  );
}

