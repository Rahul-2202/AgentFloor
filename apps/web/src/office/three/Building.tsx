"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { BufferAttribute, BufferGeometry, Float32BufferAttribute, LineDashedMaterial, LineSegments, PlaneGeometry, type Group } from "three";
import { ROOMS, WORLD, type RoomDef } from "../layout";
import type { RoomId, RoomState } from "../types";
import { carpet, clay, herring, planks, shade } from "./materials";
import { rbox } from "./shapes";
import { K } from "./view";

/** The rooms' floor colours, closer to the renders' pastel zones than the 2D plan's. */
const ZONE: Record<RoomId, string> = {
  ceo: "#d9b88e",
  dev: "#b9d0b5",
  marketing: "#d8cdea",
  meeting: "#efcbbf",
  sales: "#efdc9f",
  legal: "#bfd2ea",
  finance: "#bfe1cc",
};

const WALL = "#f4eee5";
const TRIM = "#d8bf9b";
const PARTITION = 0.62;

/** A flat floor patch whose texture repeats every `tile` units (planks don't stretch). */
function floorGeometry(w: number, d: number, tile: number) {
  const g = new PlaneGeometry(w, d);
  const uv = g.attributes.uv as BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / tile, (uv.getY(i) * d) / tile);
  g.rotateX(-Math.PI / 2);
  return g;
}

function Floor() {
  const geo = useMemo(() => floorGeometry(WORLD.w, WORLD.h, 3), []);
  return (
    <group>
      {/* the diorama base: a white plinth showing under the front edge */}
      <mesh geometry={rbox(WORLD.w + 0.8, 0.5, WORLD.h + 0.6, 0.12)} material={clay("#f6f2ec")} position={[WORLD.w / 2, -0.26, WORLD.h / 2 + 0.1]} receiveShadow />
      <mesh geometry={geo} material={clay("#ffffff", { map: planks(), rough: 0.95 })} position={[WORLD.w / 2, 0.001, WORLD.h / 2]} receiveShadow />
    </group>
  );
}

/** A straight wall from (x0, z0) to (x1, z1) with its thickness centred on the line. */
function Wall({ x0, z0, x1, z1, h, t = 0.16, color = WALL, cap = true, glassy = false }: { x0: number; z0: number; x1: number; z1: number; h: number; t?: number; color?: string; cap?: boolean; glassy?: boolean }) {
  const along = Math.abs(x1 - x0) > Math.abs(z1 - z0);
  const len = along ? Math.abs(x1 - x0) : Math.abs(z1 - z0);
  if (len < 0.05) return null;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const [w, d] = along ? [len, t] : [t, len];
  if (glassy)
    return (
      <group position={[cx, 0, cz]}>
        <mesh geometry={rbox(w, h, d, 0.02)} material={clay("#d7e8f3", { opacity: 0.32, rough: 0.1 })} position={[0, h / 2, 0]} />
        <mesh geometry={rbox(along ? len : t + 0.04, 0.06, along ? t + 0.04 : len, 0.02)} material={clay("#e9e4dc")} position={[0, h, 0]} castShadow />
        <mesh geometry={rbox(along ? len : t + 0.04, 0.08, along ? t + 0.04 : len, 0.02)} material={clay("#e9e4dc")} position={[0, 0.04, 0]} />
      </group>
    );
  return (
    <group position={[cx, 0, cz]}>
      <mesh geometry={rbox(w, h, d, 0.03)} material={clay(color)} position={[0, h / 2, 0]} castShadow receiveShadow />
      {cap && <mesh geometry={rbox(w + 0.02, 0.06, d + 0.04, 0.02)} material={clay(TRIM)} position={[0, h, 0]} castShadow />}
    </group>
  );
}

/** Walls along one edge, leaving a doorway. */
function EdgeWithDoor({ x0, x1, z, door, h, glassy }: { x0: number; x1: number; z: number; door?: { at: number; w: number }; h: number; glassy?: boolean }) {
  if (!door) return <Wall x0={x0} z0={z} x1={x1} z1={z} h={h} glassy={glassy} />;
  return (
    <>
      <Wall x0={x0} z0={z} x1={x0 + door.at} z1={z} h={h} glassy={glassy} />
      <Wall x0={x0 + door.at + door.w} z0={z} x1={x1} z1={z} h={h} glassy={glassy} />
    </>
  );
}

/** The building: back wall with a band of windows, low side and front walls, planters. */
function Shell() {
  const hBack = 3 / K;
  const W = WORLD.w;
  const panes = Math.floor(W / 2.5);
  return (
    <group>
      <Wall x0={-0.1} z0={2.9} x1={W + 0.1} z1={2.9} h={hBack} t={0.2} cap={false} />
      {/* clerestory windows along the top of the back wall */}
      <group position={[0, 0, 3.02]}>
        {Array.from({ length: panes }, (_, i) => {
          const x = 1.25 + i * (W - 2.5) / (panes - 1);
          return (
            <group key={i} position={[x, (3 - 0.65) / K, 0]}>
              <mesh geometry={rbox(2.1, 1.25, 0.06, 0.03)} material={clay("#ffffff")} />
              <mesh geometry={rbox(1.9, 1.06, 0.02, 0.01)} material={clay("#c4def0", { emissive: "#a9cde8", rough: 0.15 })} position={[0, 0, 0.035]} />
              <mesh geometry={rbox(0.05, 1.06, 0.03, 0.01)} material={clay("#ffffff")} position={[0, 0, 0.05]} />
            </group>
          );
        })}
        <mesh geometry={rbox(W, 0.12, 0.08, 0.02)} material={clay(TRIM)} position={[W / 2, 0.06, 0]} />
      </group>
      {/* sides, with the entrance on the left */}
      <Wall x0={0} z0={3} x1={0} z1={12} h={PARTITION} />
      <Wall x0={0} z0={15} x1={0} z1={WORLD.h} h={PARTITION} />
      <Wall x0={W} z0={3} x1={W} z1={WORLD.h} h={PARTITION} />
      <Wall x0={0} z0={WORLD.h} x1={W} z1={WORLD.h} h={PARTITION} />
      {/* entrance mat */}
      <mesh geometry={rbox(0.8, 0.03, 2.4, 0.01)} material={clay("#8f7a66", { rough: 1 })} position={[0.6, 0.02, 13.5]} receiveShadow />
    </group>
  );
}

function DashedOutline({ r, color }: { r: RoomDef; color: string }) {
  const obj = useMemo(() => {
    const y = 0.05;
    const x0 = r.x + 0.15;
    const x1 = r.x + r.w - 0.15;
    const z0 = r.y + 0.15;
    const z1 = r.y + r.h - 0.15;
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute([x0, y, z0, x1, y, z0, x1, y, z0, x1, y, z1, x1, y, z1, x0, y, z1, x0, y, z1, x0, y, z0], 3));
    const line = new LineSegments(g, new LineDashedMaterial({ color, dashSize: 0.35, gapSize: 0.25, transparent: true, opacity: 0.85 }));
    line.computeLineDistances();
    return line;
  }, [r, color]);
  return <primitive object={obj} />;
}

function RoomFloor({ r, opacity = 1, color }: { r: RoomDef; opacity?: number; color?: string }) {
  const geo = useMemo(() => floorGeometry(r.w, r.h - 2, r.pattern === "planks" ? 4 : 3), [r]);
  const tint = color ?? ZONE[r.id];
  const map = color ? undefined : r.pattern === "planks" ? planks(tint, shade(tint, 0.9), r.id) : r.pattern === "herring" ? herring(tint, shade(tint, 0.9)) : carpet(tint);
  return <mesh geometry={geo} material={clay(color ? tint : "#ffffff", { map, opacity, rough: 0.95 })} position={[r.x + r.w / 2, 0.02, r.y + 2 + (r.h - 2) / 2]} receiveShadow />;
}

/** A built room rises out of the floor; planned and suggested rooms are outlines. */
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
        <RoomFloor r={r} color={state === "ghost" ? "#fff3ea" : "#ffffff"} opacity={state === "ghost" ? 0.75 : 0.4} />
        <DashedOutline r={r} color={state === "ghost" ? "#e8743b" : "#8a7d70"} />
      </group>
    );
  const top = r.y === 1;
  const glassy = r.id === "meeting";
  const backH = 2 / K;
  return (
    <group>
      <RoomFloor r={r} />
      <group ref={g}>
        {/* the back wall (the building's own back wall stands behind the top row) */}
        {!top && (
          <group>
            <EdgeWithDoor x0={r.x} x1={r.x + r.w} z={r.y + 1.92} door={r.door.side === "top" ? r.door : undefined} h={backH} />
            <mesh geometry={rbox(r.w, 0.14, 0.05, 0.02)} material={clay(TRIM)} position={[r.x + r.w / 2, 0.07, r.y + 2.02]} />
          </group>
        )}
        <Wall x0={r.x} z0={r.y + 2} x1={r.x} z1={r.y + r.h} h={glassy ? 1.5 : PARTITION} glassy={glassy} />
        <Wall x0={r.x + r.w} z0={r.y + 2} x1={r.x + r.w} z1={r.y + r.h} h={glassy ? 1.5 : PARTITION} glassy={glassy} />
        <EdgeWithDoor x0={r.x} x1={r.x + r.w} z={r.y + r.h} door={r.door.side === "bottom" ? r.door : undefined} h={glassy ? 1.5 : PARTITION} glassy={glassy} />
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
