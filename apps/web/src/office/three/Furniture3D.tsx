"use client";

import { useFrame } from "@react-three/fiber";
import { useRef, type ReactNode } from "react";
import type { BufferGeometry, Group, Material } from "three";
import { ROOMS, SIZE, SPOTS, type Furniture } from "../layout";
import type { Board, RoomState } from "../types";
import { clay, glass, shade } from "./materials";
import { capsule, cylinder, hash, rbox, sphere } from "./shapes";
import { K } from "./view";
import { seatFacing } from "./Person";

/* palette, from the renders */
const OAK = "#e2c39b";
const OAK_DARK = "#c9a273";
const WALNUT = "#9c6b45";
const WHITE = "#f4f1ec";
const CREAM = "#efe8dc";
const STEEL = "#d9d6d0";
const CHAIR = "#6f7a82";
const SCREEN = "#2f3338";
const LEAF = ["#5b8c4a", "#6fa058", "#4f7d42", "#7aab5f"];
const POTS = ["#d9875a", "#f2ede6", "#c9b8a3", "#e3a57a"];

type MeshProps = { geometry: BufferGeometry; material: Material; position?: [number, number, number]; rotation?: [number, number, number]; scale?: number | [number, number, number] };
const M = (p: MeshProps) => <mesh castShadow receiveShadow {...p} />;

/* ----------------------------------------------------------------- pieces */

export function DeskChair({ x, z, face = 0, color = CHAIR }: { x: number; z: number; face?: number; color?: string }) {
  const c = clay(color);
  const metal = clay("#4a4f55", { rough: 0.5 });
  return (
    <group position={[x, 0, z]} rotation={[0, face, 0]}>
      <group position={[0, 0, -0.3]}>
        <M geometry={rbox(0.62, 0.12, 0.56, 0.06)} material={c} position={[0, 0.55, 0]} />
        <M geometry={rbox(0.6, 0.58, 0.1, 0.05)} material={c} position={[0, 0.92, -0.27]} rotation={[-0.08, 0, 0]} />
        <M geometry={cylinder(0.04, 0.04, 0.42)} material={metal} position={[0, 0.3, 0]} />
        <M geometry={cylinder(0.26, 0.28, 0.05)} material={metal} position={[0, 0.06, 0]} />
      </group>
    </group>
  );
}

function Plant({ x, z, size = 1, id }: { x: number; z: number; size?: number; id: string }) {
  const h = hash(id);
  const pot = clay(POTS[Math.floor(h * POTS.length)]!);
  const leaves = Array.from({ length: size > 0.8 ? 11 : 7 }, (_, i) => {
    const a = i * 2.39996 + h * 6;
    const up = 0.35 + ((i * 37) % 10) / 22;
    return { a, up, c: LEAF[(i + Math.floor(h * 4)) % LEAF.length]! };
  });
  return (
    <group position={[x, 0, z]} scale={size}>
      <M geometry={cylinder(0.3, 0.24, 0.48)} material={pot} position={[0, 0.24, 0]} />
      <M geometry={cylinder(0.27, 0.27, 0.04)} material={clay("#5a4334")} position={[0, 0.47, 0]} />
      {leaves.map((l, i) => (
        <group key={i} position={[0, 0.5 + l.up * 0.35, 0]} rotation={[0, l.a, 0]}>
          <mesh castShadow geometry={sphere(0.2)} material={clay(l.c, { rough: 0.7 })} position={[0, 0.18 + l.up * 0.3, 0.2]} rotation={[-0.9 + l.up, 0, 0]} scale={[0.55, 0.22, 1.5]} />
        </group>
      ))}
      <M geometry={sphere(0.2)} material={clay(LEAF[1]!)} position={[0, 0.95, 0]} scale={[1, 1.2, 1]} />
    </group>
  );
}

function Desk({ f, ceo = false }: { f: Furniture; ceo?: boolean }) {
  const w = ceo ? 3 : 2;
  const cx = f.x + w / 2;
  const cz = f.y + 1;
  const top = clay(ceo ? WALNUT : OAK);
  const legs = clay(ceo ? shade(WALNUT, 0.8) : WHITE);
  const h = hash(f.id);
  const side = h > 0.5 ? 1 : -1;
  return (
    <group>
      <group position={[cx, 0, cz]}>
        <M geometry={rbox(w, 0.08, 1, 0.03)} material={top} position={[0, 0.98, 0]} />
        {ceo ? (
          <>
            <M geometry={rbox(0.12, 0.94, 0.9, 0.03)} material={legs} position={[-w / 2 + 0.1, 0.47, 0]} />
            <M geometry={rbox(0.12, 0.94, 0.9, 0.03)} material={legs} position={[w / 2 - 0.1, 0.47, 0]} />
            <M geometry={rbox(w - 0.3, 0.5, 0.06, 0.02)} material={legs} position={[0, 0.65, 0.42]} />
          </>
        ) : (
          [
            [-1, -1],
            [1, -1],
            [-1, 1],
            [1, 1],
          ].map(([sx, sz], i) => <M key={i} geometry={rbox(0.06, 0.94, 0.06, 0.02)} material={legs} position={[sx! * (w / 2 - 0.1), 0.47, sz! * 0.4]} />)
        )}
        {/* monitor, to one side so the face stays in view; seen from behind */}
        <group position={[side * (w / 2 - 0.55), 1.02, 0.05]}>
          <M geometry={rbox(0.78, 0.48, 0.06, 0.03)} material={clay(WHITE, { rough: 0.4 })} position={[0, 0.42, 0]} />
          <M geometry={rbox(0.72, 0.42, 0.02, 0.01)} material={clay(SCREEN, { emissive: "#3a4f66" })} position={[0, 0.42, -0.035]} />
          <M geometry={rbox(0.08, 0.2, 0.06, 0.02)} material={clay(STEEL, { rough: 0.4 })} position={[0, 0.12, 0.02]} />
          <M geometry={rbox(0.28, 0.02, 0.2, 0.01)} material={clay(STEEL, { rough: 0.4 })} position={[0, 0.01, 0]} />
        </group>
        <M geometry={rbox(0.62, 0.025, 0.2, 0.01)} material={clay(WHITE)} position={[0, 1.03, -0.28]} />
        {/* a mug or a small plant on the other side */}
        {h > 0.35 ? (
          <group position={[-side * (w / 2 - 0.3), 1.02, 0.15]}>
            <M geometry={cylinder(0.1, 0.09, 0.14)} material={clay(POTS[Math.floor(h * 4) % 4]!)} position={[0, 0.07, 0]} />
            <mesh castShadow geometry={sphere(0.13)} material={clay(LEAF[0]!)} position={[0, 0.22, 0]} scale={[1, 1.1, 1]} />
          </group>
        ) : (
          <M geometry={cylinder(0.065, 0.06, 0.13)} material={clay(h > 0.15 ? "#e8743b" : "#3b7be8")} position={[-side * (w / 2 - 0.3), 1.09, -0.1]} />
        )}
        {ceo && <M geometry={cylinder(0.05, 0.12, 0.5)} material={clay("#e0b34f")} position={[side * -0.9, 1.27, 0.25]} />}
      </group>
      <DeskChair x={cx} z={f.y + 0.4} color={ceo ? "#3d3a38" : CHAIR} />
    </group>
  );
}

function MeetingTable({ f }: { f: Furniture }) {
  const cx = f.x + 2.5;
  const cz = f.y + 1.25;
  const seats = ["mt:t1", "mt:t2", "mt:t3", "mt:b1", "mt:b2", "mt:b3", "mt:head", "mt:foot"];
  return (
    <group>
      <group position={[cx, 0, cz]}>
        <M geometry={rbox(5, 0.1, 1.5, 0.05)} material={clay(OAK)} position={[0, 0.98, 0]} />
        <M geometry={rbox(0.14, 0.94, 1.1, 0.04)} material={clay(WHITE)} position={[-1.9, 0.47, 0]} />
        <M geometry={rbox(0.14, 0.94, 1.1, 0.04)} material={clay(WHITE)} position={[1.9, 0.47, 0]} />
        <M geometry={rbox(0.5, 0.02, 0.36, 0.01)} material={clay(WHITE)} position={[-0.8, 1.04, 0.1]} />
        <M geometry={rbox(0.3, 0.02, 0.4, 0.01)} material={clay("#f7f2e8")} position={[0.9, 1.04, -0.2]} rotation={[0, 0.3, 0]} />
        <mesh castShadow geometry={sphere(0.18)} material={clay(LEAF[1]!)} position={[0, 1.18, 0]} />
        <M geometry={cylinder(0.12, 0.1, 0.16)} material={clay(WHITE)} position={[0, 1.1, 0]} />
      </group>
      {seats.map((s) => {
        const p = SPOTS[s];
        if (!p) return null;
        return <DeskChair key={s} x={p[0]} z={p[1]} face={seatFacing(s) ?? 0} color="#d8cfc4" />;
      })}
    </group>
  );
}

/** Wall-mounted pieces sit on their room's back wall: height comes from where the 2D plan drew them. */
function OnWall({ f, children }: { f: Furniture; children: (w: number, h: number) => ReactNode }) {
  const room = f.room === "hall" ? null : ROOMS[f.room];
  const zw = room ? room.y + 2 : 3;
  const [pw, ph] = SIZE[f.kind];
  const w = pw / 16;
  const hTop = (zw - f.y) / K;
  const hh = ph / 16 / K;
  return <group position={[f.x + w / 2, hTop - hh / 2, zw + 0.04]}>{children(w, hh)}</group>;
}

const NOTE = { todo: "#f4d35e", doing: "#7fb2e8", done: "#8fcf9a" };

function TaskBoard({ f, board }: { f: Furniture; board?: Board }) {
  const cols: [keyof Board, string][] = [
    ["todo", NOTE.todo],
    ["doing", NOTE.doing],
    ["done", NOTE.done],
  ];
  return (
    <OnWall f={f}>
      {(w, h) => (
        <group>
          <M geometry={rbox(w, h, 0.06, 0.04)} material={clay(WHITE, { rough: 0.35 })} />
          <M geometry={rbox(w + 0.08, 0.06, 0.1, 0.02)} material={clay(STEEL)} position={[0, -h / 2 - 0.02, 0.03]} />
          {cols.map(([k, c], ci) => {
            const n = Math.min(6, board?.[k] ?? 2);
            const colW = w / 3;
            return (
              <group key={k} position={[-w / 2 + colW * (ci + 0.5), 0, 0.04]}>
                <M geometry={rbox(colW - 0.2, 0.05, 0.02, 0.01)} material={clay(shade(c, 0.75))} position={[0, h / 2 - 0.18, 0]} />
                {Array.from({ length: n }, (_, i) => (
                  <M key={i} geometry={rbox(0.36, 0.3, 0.02, 0.02)} material={clay(c)} position={[((i % 3) - 1) * 0.45, h / 2 - 0.5 - Math.floor(i / 3) * 0.38, 0.01]} rotation={[0, 0, ((i * 7) % 5) * 0.03 - 0.06]} />
                ))}
              </group>
            );
          })}
        </group>
      )}
    </OnWall>
  );
}

function WallBoard({ f }: { f: Furniture }) {
  return (
    <OnWall f={f}>
      {(w, h) => {
        if (f.kind === "moodboard")
          return (
            <group>
              <M geometry={rbox(w, h, 0.06, 0.04)} material={clay("#c9a57a", { rough: 1 })} />
              {["#e46f9a", "#f4d35e", "#7fb2e8", "#8fcf9a", "#f2a65a", "#b9a8ff", "#ffffff"].map((c, i) => (
                <M key={i} geometry={rbox(0.5 + (i % 2) * 0.2, 0.42 + (i % 3) * 0.08, 0.02, 0.02)} material={clay(c)} position={[-w / 2 + 0.45 + (i * 0.52) % (w - 0.7), ((i * 0.37) % 0.6) - 0.25, 0.04]} rotation={[0, 0, (i % 3) * 0.06 - 0.06]} />
              ))}
            </group>
          );
        if (f.kind === "tv")
          return (
            <group>
              <M geometry={rbox(w, h, 0.08, 0.04)} material={clay("#26292d", { rough: 0.4 })} />
              <M geometry={rbox(w - 0.12, h - 0.12, 0.02, 0.02)} material={clay("#33475e", { emissive: "#2c4561" })} position={[0, 0, 0.045]} />
            </group>
          );
        if (f.kind === "frame")
          return (
            <group>
              <M geometry={rbox(w, h, 0.05, 0.02)} material={clay(OAK_DARK)} />
              <M geometry={rbox(w - 0.14, h - 0.14, 0.02, 0.01)} material={clay("#f1e4cf")} position={[0, 0, 0.03]} />
              <mesh geometry={sphere(0.14)} material={clay("#e8743b")} position={[-0.1, 0.05, 0.05]} scale={[1, 1, 0.2]} />
              <mesh geometry={sphere(0.1)} material={clay("#7fb2e8")} position={[0.15, -0.08, 0.05]} scale={[1, 1, 0.2]} />
            </group>
          );
        if (f.kind === "window")
          return (
            <group>
              <M geometry={rbox(w, h, 0.08, 0.03)} material={clay(WHITE)} />
              <mesh geometry={rbox(w - 0.16, h - 0.16, 0.02, 0.01)} material={clay("#bcd9ee", { emissive: "#9ec4e2", rough: 0.2 })} position={[0, 0, 0.045]} />
              <M geometry={rbox(0.05, h - 0.1, 0.03, 0.01)} material={clay(WHITE)} position={[0, 0, 0.06]} />
            </group>
          );
        // leaderboard, chartboard
        const bars = f.kind === "chartboard" ? [0.3, 0.45, 0.4, 0.62, 0.78] : [0.85, 0.7, 0.55, 0.42];
        return (
          <group>
            <M geometry={rbox(w, h, 0.06, 0.04)} material={clay(WHITE, { rough: 0.35 })} />
            {bars.map((b, i) =>
              f.kind === "chartboard" ? (
                <M key={i} geometry={rbox(0.36, b * (h - 0.3), 0.02, 0.01)} material={clay(i === bars.length - 1 ? "#3f9b5f" : "#8fcf9a")} position={[-w / 2 + 0.6 + i * 0.6, -h / 2 + 0.15 + (b * (h - 0.3)) / 2, 0.04]} />
              ) : (
                <M key={i} geometry={rbox(b * (w - 0.5), 0.16, 0.02, 0.01)} material={clay(i === 0 ? "#f2a65a" : "#7fb2e8")} position={[-w / 2 + 0.25 + (b * (w - 0.5)) / 2, h / 2 - 0.3 - i * 0.26, 0.04]} />
              ),
            )}
          </group>
        );
      }}
    </OnWall>
  );
}

function Shelf({ f }: { f: Furniture }) {
  const wood = clay(OAK_DARK);
  const books = ["#e8743b", "#3b7be8", "#3f9b5f", "#f4d35e", "#9b6cd9", "#e46f9a", "#2f3440"];
  return (
    <group position={[f.x + 1, 0, f.y + 1.5]}>
      <M geometry={rbox(2, 2.1, 0.7, 0.04)} material={wood} position={[0, 1.05, -0.05]} />
      {[0.5, 1.15, 1.8].map((y, r) => (
        <group key={y} position={[0, y, 0.3]}>
          {Array.from({ length: 9 }, (_, i) => {
            const bh = 0.38 + ((i * 7 + r * 3) % 5) * 0.04;
            return <M key={i} geometry={rbox(0.15, bh, 0.42, 0.02)} material={clay(books[(i + r * 2) % books.length]!)} position={[-0.8 + i * 0.2, bh / 2 - 0.2, -0.05]} rotation={[0, 0, i === 7 ? 0.25 : 0]} />;
          })}
        </group>
      ))}
    </group>
  );
}

function Couch({ f }: { f: Furniture }) {
  const c = clay("#d9cdbb", { rough: 0.95 });
  const cushion = clay("#e6dccd", { rough: 0.95 });
  return (
    <group position={[f.x + 1.25, 0, f.y + 0.9]}>
      <M geometry={rbox(2.5, 0.42, 0.95, 0.15)} material={c} position={[0, 0.3, 0]} />
      <M geometry={rbox(2.5, 0.62, 0.3, 0.14)} material={c} position={[0, 0.72, -0.34]} />
      <M geometry={rbox(0.3, 0.6, 0.95, 0.14)} material={c} position={[-1.15, 0.52, 0]} />
      <M geometry={rbox(0.3, 0.6, 0.95, 0.14)} material={c} position={[1.15, 0.52, 0]} />
      <M geometry={rbox(0.98, 0.16, 0.66, 0.08)} material={cushion} position={[-0.5, 0.58, 0.08]} />
      <M geometry={rbox(0.98, 0.16, 0.66, 0.08)} material={cushion} position={[0.5, 0.58, 0.08]} />
      <M geometry={rbox(0.4, 0.36, 0.14, 0.07)} material={clay("#e8743b")} position={[0.75, 0.82, -0.12]} rotation={[-0.2, 0.2, 0.1]} />
    </group>
  );
}

function Rug({ f }: { f: Furniture }) {
  const w = f.w ?? 4;
  const d = f.h ?? 3;
  return (
    <group position={[f.x + w / 2, 0, f.y + d / 2]}>
      <mesh receiveShadow geometry={rbox(w, 0.03, d, 0.015)} material={clay(f.tint ?? "#e9d9c2", { rough: 1 })} position={[0, 0.03, 0]} />
      <mesh receiveShadow geometry={rbox(w - 0.3, 0.031, d - 0.3, 0.015)} material={clay(shade(f.tint ?? "#e9d9c2", 1.06), { rough: 1 })} position={[0, 0.035, 0]} />
    </group>
  );
}

function piece(f: Furniture, board?: Board): ReactNode {
  switch (f.kind) {
    case "desk":
      return <Desk f={f} />;
    case "ceoDesk":
      return <Desk f={f} ceo />;
    case "meetingTable":
      return <MeetingTable f={f} />;
    case "plant":
      return <Plant x={f.x + 0.5} z={f.y + 1.05} id={f.id} />;
    case "plantSmall":
      return <Plant x={f.x + 0.35} z={f.y + 0.7} id={f.id} size={0.6} />;
    case "board":
      return <TaskBoard f={f} board={board} />;
    case "moodboard":
    case "leaderboard":
    case "chartboard":
    case "tv":
    case "frame":
    case "window":
      return <WallBoard f={f} />;
    case "shelf":
      return <Shelf f={f} />;
    case "couch":
      return <Couch f={f} />;
    case "rug":
      return <Rug f={f} />;
    case "rack":
      return (
        <group position={[f.x + 0.5, 0, f.y + 1.25]}>
          <M geometry={rbox(0.9, 2.0, 1.2, 0.06)} material={clay("#3a3f47", { rough: 0.5 })} position={[0, 1, 0]} />
          {Array.from({ length: 6 }, (_, i) => (
            <group key={i} position={[0, 0.35 + i * 0.28, 0.61]}>
              <M geometry={rbox(0.76, 0.2, 0.02, 0.01)} material={clay("#2a2e34")} />
              <mesh geometry={sphere(0.025)} material={clay(i % 3 ? "#5fd08a" : "#f2a65a", { emissive: i % 3 ? "#5fd08a" : "#f2a65a" })} position={[0.3, 0, 0.02]} />
            </group>
          ))}
        </group>
      );
    case "huddle":
      return (
        <group position={[f.x + 0.75, 0, f.y + 0.5]}>
          <M geometry={cylinder(0.55, 0.55, 0.07, 32)} material={clay(OAK)} position={[0, 0.72, 0]} />
          <M geometry={cylinder(0.05, 0.05, 0.7)} material={clay(WHITE)} position={[0, 0.36, 0]} />
          <M geometry={cylinder(0.28, 0.3, 0.04)} material={clay(WHITE)} position={[0, 0.02, 0]} />
        </group>
      );
    case "cooler":
      return (
        <group position={[f.x + 0.38, 0, f.y + 1]}>
          <M geometry={rbox(0.55, 0.95, 0.55, 0.06)} material={clay(WHITE)} position={[0, 0.48, 0]} />
          <mesh castShadow geometry={capsule(0.22, 0.25)} material={glass("#9cc8ea", 0.7)} position={[0, 1.25, 0]} />
        </group>
      );
    case "safe":
      return (
        <group position={[f.x + 0.5, 0, f.y + 0.75]}>
          <M geometry={rbox(0.9, 0.8, 0.6, 0.06)} material={clay("#4a4f57", { rough: 0.45 })} position={[0, 0.4, 0]} />
          <M geometry={cylinder(0.09, 0.09, 0.04)} material={clay(STEEL, { rough: 0.3 })} position={[0, 0.45, 0.31]} rotation={[Math.PI / 2, 0, 0]} />
        </group>
      );
    case "cabinet":
      return (
        <group position={[f.x + 0.5, 0, f.y + 1.1]}>
          <M geometry={rbox(0.8, 1.25, 0.7, 0.04)} material={clay(STEEL)} position={[0, 0.63, 0]} />
          {[0.3, 0.7, 1.08].map((y) => (
            <M key={y} geometry={rbox(0.3, 0.05, 0.03, 0.01)} material={clay("#9a978f")} position={[0, y, 0.36]} />
          ))}
        </group>
      );
    default:
      return null;
  }
}

/**
 * One piece of furniture in its room's state: built pieces settle in when the
 * room is built; a planned room shows them as a faint white model.
 */
export function Piece({ f, state, board, index }: { f: Furniture; state: RoomState; board?: Board; index: number }) {
  const g = useRef<Group>(null);
  const anim = useRef({ state, since: -1 });
  useFrame((st) => {
    const a = anim.current;
    const t = st.clock.elapsedTime;
    if (a.state !== state || a.since < 0) {
      // A piece already built when the office opens doesn't animate in.
      a.since = a.since < 0 && state === "built" ? -10 : t;
      a.state = state;
    }
    if (!g.current) return;
    const p = Math.max(0, Math.min(1, (t - a.since - 0.3 - (index % 9) * 0.05) / 0.5));
    const e = 1 - Math.pow(1 - p, 3);
    const built = state === "built";
    g.current.scale.setScalar(built ? 0.001 + 0.999 * e : 1);
    g.current.position.y = built ? (1 - e) * 0.6 : 0;
  });
  if (state === "hidden" || state === "ghost") return null;
  const node = piece(f, board);
  if (!node) return null;
  const [pw, ph] = SIZE[f.kind];
  const cx = f.kind === "rug" ? f.x + (f.w ?? 4) / 2 : f.x + pw / 32;
  const cz = f.kind === "rug" ? f.y + (f.h ?? 3) / 2 : f.y + ph / 16;
  return (
    <group position={[cx, 0, cz]}>
      <group ref={g}>
        <group position={[-cx, 0, -cz]}>{state === "blueprint" ? <Faint>{node}</Faint> : node}</group>
      </group>
    </group>
  );
}

/** A planned room's furniture: the same pieces, as faint white clay. */
function Faint({ children }: { children: ReactNode }) {
  const ref = useRef<Group>(null);
  const white = clay("#ffffff", { opacity: 0.28 });
  useFrame(() => {
    ref.current?.traverse((o) => {
      const m = o as { isMesh?: boolean; material?: Material; castShadow?: boolean };
      if (m.isMesh && m.material !== white) {
        m.material = white;
        m.castShadow = false;
      }
    });
  });
  return <group ref={ref}>{children}</group>;
}
