"use client";

import { useFrame } from "@react-three/fiber";
import { Suspense, useRef, type ReactNode } from "react";
import type { BufferGeometry, Group, Material } from "three";
import { ROOMS, SIZE, SPOTS, type Furniture } from "../layout";
import type { Board, RoomState } from "../types";
import { METRE, useModel, type ModelName } from "./assets";
import { clay, glass, shade } from "./materials";
import { capsule, cylinder, hash, rbox, sphere } from "./shapes";
import { seatFacing } from "./Person";

/* palette, from the renders */
const OAK = "#e0c29a";
const OAK_DARK = "#c49d70";
const WALNUT = "#9a6a45";
const WHITE = "#f5f2ed";
const STEEL = "#d6d3cd";
const CHAIR = "#6c7780";
const SCREEN = "#2c3036";
const POD = ["#c3b2e2", "#aecaa9", "#efb9b1", "#a9c4e6"];

type MeshProps = { geometry: BufferGeometry; material: Material; position?: [number, number, number]; rotation?: [number, number, number]; scale?: number | [number, number, number] };
const M = (p: MeshProps) => <mesh castShadow receiveShadow {...p} />;

/** A downloaded model at real-world scale, turned to face `face` (radians; 0 = toward the viewer). */
function Model({ name, x, z, face = 0, scale = 1, y = 0 }: { name: ModelName; x: number; z: number; face?: number; scale?: number; y?: number }) {
  return (
    <Suspense fallback={null}>
      <ModelInner name={name} x={x} z={z} face={face} scale={scale} y={y} />
    </Suspense>
  );
}
function ModelInner({ name, x, z, face, scale, y }: { name: ModelName; x: number; z: number; face: number; scale: number; y: number }) {
  const g = useModel(name);
  return <primitive object={g} position={[x, y, z]} rotation={[0, face, 0]} scale={METRE * scale} />;
}

/* ----------------------------------------------------------------- pieces */

/** An office chair: seat, back, armrests, gas lift and a five-star base. */
export function DeskChair({ x, z, face = 0, color = CHAIR }: { x: number; z: number; face?: number; color?: string }) {
  const c = clay(color, { rough: 0.85 });
  const metal = clay("#3f4347", { rough: 0.45 });
  return (
    <group position={[x, 0, z]} rotation={[0, face, 0]}>
      <group position={[0, 0, -0.34]}>
        <M geometry={rbox(0.62, 0.12, 0.58, 0.06)} material={c} position={[0, 0.48, 0]} />
        <M geometry={rbox(0.58, 0.62, 0.1, 0.06)} material={c} position={[0, 0.86, -0.28]} rotation={[-0.1, 0, 0]} />
        <M geometry={rbox(0.06, 0.05, 0.36, 0.02)} material={metal} position={[0.33, 0.66, 0]} />
        <M geometry={rbox(0.06, 0.05, 0.36, 0.02)} material={metal} position={[-0.33, 0.66, 0]} />
        <M geometry={rbox(0.03, 0.18, 0.03, 0.01)} material={metal} position={[0.33, 0.56, -0.1]} />
        <M geometry={rbox(0.03, 0.18, 0.03, 0.01)} material={metal} position={[-0.33, 0.56, -0.1]} />
        <M geometry={cylinder(0.035, 0.035, 0.36)} material={metal} position={[0, 0.27, 0]} />
        {[0, 1, 2, 3, 4].map((i) => (
          <group key={i} rotation={[0, (i / 5) * Math.PI * 2, 0]}>
            <M geometry={rbox(0.05, 0.04, 0.3, 0.015)} material={metal} position={[0, 0.07, 0.15]} />
            <M geometry={sphere(0.035)} material={metal} position={[0, 0.035, 0.29]} />
          </group>
        ))}
      </group>
    </group>
  );
}

function Desk({ f, ceo = false }: { f: Furniture; ceo?: boolean }) {
  const w = ceo ? 3 : 2;
  const cx = f.x + w / 2;
  const cz = f.y + 1;
  const top = clay(ceo ? WALNUT : OAK, { rough: 0.6 });
  const legs = clay(ceo ? shade(WALNUT, 0.8) : WHITE, { rough: 0.5 });
  const h = hash(f.id);
  return (
    <group>
      <group position={[cx, 0, cz]}>
        <M geometry={rbox(w, 0.07, 1.05, 0.025)} material={top} position={[0, 1.02, 0]} />
        {ceo ? (
          <>
            <M geometry={rbox(0.1, 0.98, 0.95, 0.03)} material={legs} position={[-w / 2 + 0.1, 0.49, 0]} />
            <M geometry={rbox(0.1, 0.98, 0.95, 0.03)} material={legs} position={[w / 2 - 0.1, 0.49, 0]} />
            <M geometry={rbox(w - 0.3, 0.5, 0.05, 0.02)} material={legs} position={[0, 0.7, 0.44]} />
          </>
        ) : (
          [
            [-1, -1],
            [1, -1],
            [-1, 1],
            [1, 1],
          ].map(([sx, sz], i) => <M key={i} geometry={rbox(0.05, 0.98, 0.05, 0.02)} material={legs} position={[sx! * (w / 2 - 0.08), 0.49, sz! * 0.44]} />)
        )}
        {/* an all-in-one monitor facing the chair: from here we see its white back */}
        <group position={[0, 1.05, 0.12]}>
          <M geometry={rbox(0.98, 0.62, 0.05, 0.04)} material={clay(WHITE, { rough: 0.35 })} position={[0, 0.48, 0]} />
          <M geometry={rbox(0.94, 0.56, 0.01, 0.02)} material={clay(SCREEN, { emissive: "#4c6a8a", rough: 0.2 })} position={[0, 0.5, -0.03]} />
          <M geometry={rbox(0.98, 0.14, 0.055, 0.03)} material={clay(STEEL, { rough: 0.35 })} position={[0, 0.12, 0]} />
          <M geometry={rbox(0.18, 0.2, 0.05, 0.02)} material={clay(STEEL, { rough: 0.35 })} position={[0, 0.08, 0.07]} rotation={[0.25, 0, 0]} />
          <M geometry={rbox(0.32, 0.02, 0.22, 0.01)} material={clay(STEEL, { rough: 0.35 })} position={[0, 0.01, 0.06]} />
        </group>
        <M geometry={rbox(0.72, 0.022, 0.22, 0.01)} material={clay(WHITE, { rough: 0.4 })} position={[-0.05, 1.065, -0.28]} />
        <M geometry={rbox(0.09, 0.025, 0.13, 0.02)} material={clay(WHITE, { rough: 0.4 })} position={[0.48, 1.065, -0.3]} />
        {h > 0.45 ? (
          <Model name="potted_plant_04" x={(h > 0.7 ? 1 : -1) * (w / 2 - 0.22)} z={0.1} y={1.055} scale={0.55} face={h * 6} />
        ) : (
          <M geometry={cylinder(0.06, 0.055, 0.12)} material={clay(h > 0.2 ? "#e8743b" : "#3b7be8", { rough: 0.4 })} position={[w / 2 - 0.25, 1.12, -0.15]} />
        )}
        {ceo && <M geometry={cylinder(0.05, 0.13, 0.5)} material={clay("#e0b34f", { rough: 0.5 })} position={[-1.1, 1.3, 0.25]} />}
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
        <M geometry={rbox(5, 0.09, 1.5, 0.04)} material={clay(OAK, { rough: 0.55 })} position={[0, 1.0, 0]} />
        <M geometry={rbox(0.12, 0.96, 1.1, 0.04)} material={clay(WHITE)} position={[-1.9, 0.48, 0]} />
        <M geometry={rbox(0.12, 0.96, 1.1, 0.04)} material={clay(WHITE)} position={[1.9, 0.48, 0]} />
        <M geometry={rbox(0.5, 0.02, 0.36, 0.01)} material={clay(WHITE)} position={[-0.8, 1.055, 0.1]} />
        <M geometry={rbox(0.3, 0.02, 0.4, 0.01)} material={clay("#f7f2e8")} position={[0.9, 1.055, -0.2]} rotation={[0, 0.3, 0]} />
        <Model name="potted_plant_04" x={0} z={0} y={1.045} scale={0.6} />
      </group>
      {seats.map((s) => {
        const p = SPOTS[s];
        if (!p) return null;
        return <DeskChair key={s} x={p[0]} z={p[1]} face={seatFacing(s) ?? 0} color="#e3dad0" />;
      })}
    </group>
  );
}

/**
 * Boards and screens: on the building's back wall for the top rooms (under the
 * windows); freestanding on legs elsewhere, since those rooms are open plan.
 */
function Mounted({ f, children }: { f: Furniture; children: (w: number, h: number) => ReactNode }) {
  const room = f.room === "hall" ? null : ROOMS[f.room];
  const onWall = !room || room.y < 3;
  const w = SIZE[f.kind][0] / 16;
  const h = f.kind === "tv" ? 1.15 : f.kind === "frame" ? 0.75 : 1.05;
  const x = f.x + w / 2;
  if (onWall) return <group position={[x, f.kind === "frame" ? 1.55 : 1.42, 3.06]}>{children(w, h)}</group>;
  const z = room.y + 2.55;
  const metal = clay("#4a4f55", { rough: 0.45 });
  return (
    <group position={[x, 0, z]}>
      <group position={[0, 1.45, 0]}>{children(w, h)}</group>
      <M geometry={rbox(0.06, 1.95, 0.06, 0.02)} material={metal} position={[-w / 2 + 0.2, 0.97, -0.05]} />
      <M geometry={rbox(0.06, 1.95, 0.06, 0.02)} material={metal} position={[w / 2 - 0.2, 0.97, -0.05]} />
      <M geometry={rbox(0.5, 0.04, 0.4, 0.02)} material={metal} position={[-w / 2 + 0.2, 0.02, -0.05]} />
      <M geometry={rbox(0.5, 0.04, 0.4, 0.02)} material={metal} position={[w / 2 - 0.2, 0.02, -0.05]} />
    </group>
  );
}

const NOTE = { todo: "#f4d35e", doing: "#7fb2e8", done: "#8fcf9a" };

function TaskBoard({ f, board }: { f: Furniture; board?: Board }) {
  const cols: [keyof Board, string][] = [
    ["todo", NOTE.todo],
    ["doing", NOTE.doing],
    ["done", NOTE.done],
  ];
  return (
    <Mounted f={f}>
      {(w, h) => (
        <group>
          <M geometry={rbox(w, h, 0.05, 0.03)} material={clay(WHITE, { rough: 0.3 })} />
          <M geometry={rbox(w + 0.06, 0.05, 0.1, 0.02)} material={clay(STEEL)} position={[0, -h / 2 - 0.02, 0.04]} />
          {cols.map(([k, c], ci) => {
            const n = Math.min(6, board?.[k] ?? 2);
            const colW = w / 3;
            return (
              <group key={k} position={[-w / 2 + colW * (ci + 0.5), 0, 0.035]}>
                <M geometry={rbox(colW - 0.3, 0.04, 0.01, 0.005)} material={clay(shade(c, 0.7))} position={[0, h / 2 - 0.13, 0]} />
                {Array.from({ length: n }, (_, i) => (
                  <M key={i} geometry={rbox(0.3, 0.26, 0.01, 0.01)} material={clay(c, { rough: 0.9 })} position={[((i % 3) - 1) * 0.42, h / 2 - 0.38 - Math.floor(i / 3) * 0.32, 0.005]} rotation={[0, 0, ((i * 7) % 5) * 0.03 - 0.06]} />
                ))}
              </group>
            );
          })}
        </group>
      )}
    </Mounted>
  );
}

function Boardish({ f }: { f: Furniture }) {
  return (
    <Mounted f={f}>
      {(w, h) => {
        if (f.kind === "moodboard")
          return (
            <group>
              <M geometry={rbox(w, h, 0.05, 0.03)} material={clay("#c9a57a", { rough: 1 })} />
              {["#e46f9a", "#f4d35e", "#7fb2e8", "#8fcf9a", "#f2a65a", "#b9a8ff", "#ffffff"].map((c, i) => (
                <M key={i} geometry={rbox(0.5 + (i % 2) * 0.16, 0.36 + (i % 3) * 0.06, 0.01, 0.01)} material={clay(c)} position={[-w / 2 + 0.45 + ((i * 0.52) % (w - 0.7)), ((i * 0.37) % 0.5) - 0.2, 0.035]} rotation={[0, 0, (i % 3) * 0.06 - 0.06]} />
              ))}
            </group>
          );
        if (f.kind === "tv")
          return (
            <group>
              <M geometry={rbox(w, h, 0.07, 0.03)} material={clay("#26292d", { rough: 0.35 })} />
              <M geometry={rbox(w - 0.1, h - 0.1, 0.01, 0.01)} material={clay("#38506a", { emissive: "#3a5878", rough: 0.15 })} position={[0, 0, 0.04]} />
            </group>
          );
        if (f.kind === "frame")
          return (
            <group>
              <M geometry={rbox(w, h, 0.04, 0.02)} material={clay(OAK_DARK)} />
              <M geometry={rbox(w - 0.12, h - 0.12, 0.01, 0.005)} material={clay("#f1e4cf")} position={[0, 0, 0.025]} />
              <mesh geometry={sphere(0.12)} material={clay("#e8743b")} position={[-0.08, 0.04, 0.035]} scale={[1, 1, 0.15]} />
              <mesh geometry={sphere(0.08)} material={clay("#7fb2e8")} position={[0.12, -0.07, 0.035]} scale={[1, 1, 0.15]} />
            </group>
          );
        const bars = f.kind === "chartboard" ? [0.3, 0.45, 0.4, 0.62, 0.8] : [0.85, 0.7, 0.55, 0.42];
        return (
          <group>
            <M geometry={rbox(w, h, 0.05, 0.03)} material={clay(WHITE, { rough: 0.3 })} />
            {bars.map((b, i) =>
              f.kind === "chartboard" ? (
                <M key={i} geometry={rbox(0.32, b * (h - 0.25), 0.01, 0.005)} material={clay(i === bars.length - 1 ? "#3f9b5f" : "#8fcf9a")} position={[-w / 2 + 0.55 + i * 0.6, -h / 2 + 0.12 + (b * (h - 0.25)) / 2, 0.035]} />
              ) : (
                <M key={i} geometry={rbox(b * (w - 0.4), 0.13, 0.01, 0.005)} material={clay(i === 0 ? "#f2a65a" : "#7fb2e8")} position={[-w / 2 + 0.2 + (b * (w - 0.4)) / 2, h / 2 - 0.22 - i * 0.22, 0.035]} />
              ),
            )}
          </group>
        );
      }}
    </Mounted>
  );
}

function Bookcase({ x, z, w = 2, id }: { x: number; z: number; w?: number; id: string }) {
  const wood = clay(OAK_DARK, { rough: 0.65 });
  const books = ["#e8743b", "#3b7be8", "#3f9b5f", "#f4d35e", "#9b6cd9", "#e46f9a", "#2f3440", "#efe7d8"];
  const s = hash(id);
  return (
    <group position={[x, 0, z]}>
      <M geometry={rbox(w, 2.3, 0.6, 0.03)} material={wood} position={[0, 1.15, 0]} />
      {[0.45, 1.1, 1.75].map((y, r) => (
        <group key={y} position={[0, y, 0.18]}>
          <M geometry={rbox(w - 0.12, 0.04, 0.5, 0.01)} material={clay(shade(OAK_DARK, 0.85))} position={[0, -0.22, -0.05]} />
          {Array.from({ length: Math.floor((w - 0.3) / 0.17) }, (_, i) => {
            const bh = 0.32 + ((i * 7 + r * 3 + Math.floor(s * 9)) % 5) * 0.035;
            const tilt = (i + r) % 9 === 4;
            return <M key={i} geometry={rbox(0.13, bh, 0.36, 0.015)} material={clay(books[(i + r * 3 + Math.floor(s * 8)) % books.length]!)} position={[-w / 2 + 0.24 + i * 0.17, bh / 2 - 0.2, 0]} rotation={[0, 0, tilt ? 0.28 : 0]} />;
          })}
        </group>
      ))}
    </group>
  );
}

function Counter({ f }: { f: Furniture }) {
  const w = f.w ?? 8;
  const d = f.h ?? 1.2;
  const front = clay("#bcd0c4", { rough: 0.7 });
  return (
    <group position={[f.x + w / 2, 0, f.y + d / 2]}>
      <M geometry={rbox(w, 1.05, d, 0.04)} material={front} position={[0, 0.53, 0]} />
      <M geometry={rbox(w + 0.1, 0.07, d + 0.1, 0.02)} material={clay(WHITE, { rough: 0.25 })} position={[0, 1.09, 0]} />
      {Array.from({ length: Math.floor(w / 1.1) }, (_, i) => (
        <M key={i} geometry={rbox(0.02, 0.8, 0.01, 0.005)} material={clay(shade("#bcd0c4", 0.85))} position={[-w / 2 + 1.1 * (i + 1), 0.55, d / 2 + 0.005]} />
      ))}
      {/* coffee machine, cups, a fruit bowl */}
      <group position={[-w / 2 + 1.2, 1.12, -0.1]}>
        <M geometry={rbox(0.6, 0.6, 0.5, 0.06)} material={clay("#2f3338", { rough: 0.35 })} position={[0, 0.3, 0]} />
        <M geometry={rbox(0.5, 0.06, 0.3, 0.02)} material={clay(STEEL, { rough: 0.3 })} position={[0, 0.05, 0.15]} />
      </group>
      {[0, 1, 2].map((i) => (
        <M key={i} geometry={cylinder(0.06, 0.05, 0.11)} material={clay(["#ffffff", "#e8743b", "#7fb2e8"][i]!)} position={[-w / 2 + 2.1 + i * 0.18, 1.18, 0.1]} />
      ))}
      <M geometry={cylinder(0.26, 0.16, 0.14, 24)} material={clay(WHITE)} position={[w / 2 - 1.4, 1.2, 0]} />
      {[0, 1, 2, 3].map((i) => (
        <mesh key={i} castShadow geometry={sphere(0.09)} material={clay(["#f2a65a", "#e8743b", "#9bc35a", "#f4d35e"][i]!)} position={[w / 2 - 1.4 + Math.cos(i * 1.6) * 0.1, 1.31, Math.sin(i * 1.6) * 0.1]} />
      ))}
      <Model name="potted_plant_04" x={w / 2 - 0.5} z={-0.15} y={1.12} scale={0.75} />
      {/* open shelves above, on the wall */}
      <M geometry={rbox(w * 0.6, 0.06, 0.35, 0.02)} material={clay(OAK)} position={[0.6, 2.0, -0.4]} />
    </group>
  );
}

function Booth({ f }: { f: Furniture }) {
  const c = POD[(Number(f.id.replace(/\D/g, "")) || 0) % POD.length]!;
  const shell = clay(c, { rough: 0.8 });
  const w = 2.5;
  const d = 2.4;
  const h = 2.1;
  const pane = glass("#e3eef5", 0.18);
  return (
    <group position={[f.x + w / 2, 0, f.y + d / 2]}>
      <M geometry={rbox(w, h, 0.14, 0.07)} material={shell} position={[0, h / 2, -d / 2 + 0.07]} />
      <M geometry={rbox(0.14, h, d, 0.07)} material={shell} position={[-w / 2 + 0.07, h / 2, 0]} />
      <M geometry={rbox(0.14, h, d, 0.07)} material={shell} position={[w / 2 - 0.07, h / 2, 0]} />
      <M geometry={rbox(w - 0.2, 0.06, d - 0.15, 0.02)} material={clay(shade(c, 0.85))} position={[0, 0.03, 0]} />
      {/* bench, a little table, a lamp */}
      <M geometry={rbox(w - 0.4, 0.4, 0.55, 0.08)} material={clay(shade(c, 0.78), { rough: 0.95 })} position={[0, 0.22, -d / 2 + 0.5]} />
      <M geometry={rbox(0.9, 0.05, 0.5, 0.02)} material={clay(OAK)} position={[0, 0.82, 0.05]} />
      <M geometry={cylinder(0.04, 0.04, 0.75)} material={clay("#3f4347")} position={[0, 0.42, 0.05]} />
      {/* glass front with a white frame */}
      <mesh geometry={rbox(w - 0.2, h - 0.25, 0.03, 0.01)} material={pane} position={[0, (h - 0.25) / 2 + 0.05, d / 2 - 0.05]} />
      <M geometry={rbox(0.06, h - 0.2, 0.06, 0.02)} material={clay(WHITE)} position={[0.15, (h - 0.2) / 2, d / 2 - 0.04]} />
    </group>
  );
}

/** A café table: light oak top on a white pedestal. */
function RoundTable({ x, z, r = 0.6, h = 1.02 }: { x: number; z: number; r?: number; h?: number }) {
  return (
    <group position={[x, 0, z]}>
      <M geometry={cylinder(r, r, 0.06, 40)} material={clay(OAK, { rough: 0.55 })} position={[0, h, 0]} />
      <M geometry={cylinder(0.05, 0.05, h - 0.05)} material={clay(WHITE, { rough: 0.4 })} position={[0, h / 2, 0]} />
      <M geometry={cylinder(0.3, 0.33, 0.04, 32)} material={clay(WHITE, { rough: 0.4 })} position={[0, 0.02, 0]} />
    </group>
  );
}

/** A stool: round sage seat on light legs. */
function Stool({ x, z, high = true }: { x: number; z: number; high?: boolean }) {
  const h = high ? 1.05 : 0.68;
  const seat = clay("#a9c2b0", { rough: 0.85 });
  const leg = clay(OAK, { rough: 0.6 });
  return (
    <group position={[x, 0, z]}>
      <M geometry={cylinder(0.26, 0.24, 0.1, 28)} material={seat} position={[0, h, 0]} />
      {[0, 1, 2, 3].map((i) => {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        return <M key={i} geometry={cylinder(0.025, 0.03, h)} material={leg} position={[Math.cos(a) * 0.17, h / 2, Math.sin(a) * 0.17]} rotation={[Math.sin(a) * 0.12, 0, -Math.cos(a) * 0.12]} />;
      })}
      {high && <M geometry={cylinder(0.2, 0.2, 0.025, 24)} material={leg} position={[0, 0.38, 0]} />}
    </group>
  );
}

/** A soft modern sofa, cream, facing the viewer. */
function Sofa({ x, z, w = 3 }: { x: number; z: number; w?: number }) {
  const fabric = clay("#ece4d6", { rough: 0.97 });
  const cushion = clay("#f3ede3", { rough: 0.97 });
  return (
    <group position={[x, 0, z]}>
      <M geometry={rbox(w, 0.42, 1.1, 0.18)} material={fabric} position={[0, 0.3, 0]} />
      <M geometry={rbox(w, 0.72, 0.32, 0.15)} material={fabric} position={[0, 0.68, -0.4]} />
      <M geometry={rbox(0.32, 0.62, 1.1, 0.15)} material={fabric} position={[-w / 2 + 0.16, 0.5, 0]} />
      <M geometry={rbox(0.32, 0.62, 1.1, 0.15)} material={fabric} position={[w / 2 - 0.16, 0.5, 0]} />
      {[-1, 0, 1].map((i) => (
        <M key={i} geometry={rbox((w - 0.7) / 3 - 0.04, 0.16, 0.78, 0.08)} material={cushion} position={[i * ((w - 0.7) / 3), 0.58, 0.1]} />
      ))}
      <M geometry={rbox(0.42, 0.38, 0.14, 0.07)} material={clay("#e8a87c", { rough: 0.95 })} position={[-w / 2 + 0.6, 0.85, -0.18]} rotation={[-0.25, 0.2, 0.08]} />
      <M geometry={rbox(0.4, 0.36, 0.14, 0.07)} material={clay("#a9c2b0", { rough: 0.95 })} position={[w / 2 - 0.6, 0.84, -0.18]} rotation={[-0.25, -0.2, -0.08]} />
    </group>
  );
}

function Rug({ f }: { f: Furniture }) {
  const w = f.w ?? 4;
  const d = f.h ?? 3;
  return (
    <group position={[f.x + w / 2, 0, f.y + d / 2]}>
      <mesh receiveShadow geometry={rbox(w, 0.03, d, 0.015)} material={clay(f.tint ?? "#e9d9c2", { rough: 1 })} position={[0, 0.05, 0]} />
      <mesh receiveShadow geometry={rbox(w - 0.3, 0.031, d - 0.3, 0.015)} material={clay(shade(f.tint ?? "#e9d9c2", 1.05), { rough: 1 })} position={[0, 0.056, 0]} />
    </group>
  );
}

function piece(f: Furniture, board?: Board): ReactNode {
  const h = hash(f.id);
  switch (f.kind) {
    case "desk":
      return <Desk f={f} />;
    case "ceoDesk":
      return <Desk f={f} ceo />;
    case "meetingTable":
      return <MeetingTable f={f} />;
    case "plant":
      return <Model name="potted_plant_02" x={f.x + 0.5} z={f.y + 1.05} face={h * 6.28} scale={0.95 + h * 0.2} />;
    case "plantSmall":
      return <Model name="potted_plant_04" x={f.x + 0.35} z={f.y + 0.7} face={h * 6.28} scale={1.1} />;
    case "board":
      return <TaskBoard f={f} board={board} />;
    case "moodboard":
    case "leaderboard":
    case "chartboard":
    case "tv":
    case "frame":
      return f.kind === "frame" && f.room !== "hall" && ROOMS[f.room].y > 3 ? null : <Boardish f={f} />;
    case "window":
      return null; // the building's window wall
    case "shelf":
      return <Bookcase x={f.x + 1} z={f.y + 1.45} id={f.id} />;
    case "bookcase":
      return <Bookcase x={f.x + 1} z={f.y + 0.35} id={f.id} />;
    case "couch":
      return <Sofa x={f.x + 1.25} z={f.y + 0.95} w={2.5} />;
    case "sofa":
      return <Sofa x={f.x + 1.5} z={f.y + 0.6} />;
    case "armchair":
      return <Model name="ArmChair_01" x={f.x + 0.62} z={f.y + 0.62} face={f.x < 53 ? Math.PI / 2 : f.x > 59 ? 0 : -Math.PI / 2} />;
    case "coffeeTable":
      return <Model name="coffee_table_round_01" x={f.x + 0.75} z={f.y + 0.62} />;
    case "huddle":
      return <RoundTable x={f.x + 0.75} z={f.y + 0.5} r={0.62} />;
    case "cafeTable":
      return (
        <group>
          <RoundTable x={f.x + 0.62} z={f.y + 0.62} />
          <Stool x={f.x + 0.62} z={f.y + 1.6} high={false} />
        </group>
      );
    case "barStool":
      return <Stool x={f.x + 0.3} z={f.y + 0.3} />;
    case "counter":
      return <Counter f={f} />;
    case "booth":
      return <Booth f={f} />;
    case "rug":
      return <Rug f={f} />;
    case "rack":
      return (
        <group position={[f.x + 0.5, 0, f.y + 1.25]}>
          <M geometry={rbox(0.9, 2.1, 1.1, 0.05)} material={clay("#3a3f47", { rough: 0.45 })} position={[0, 1.05, 0]} />
          {Array.from({ length: 6 }, (_, i) => (
            <group key={i} position={[0, 0.38 + i * 0.29, 0.56]}>
              <M geometry={rbox(0.76, 0.2, 0.02, 0.01)} material={clay("#2a2e34")} />
              <mesh geometry={sphere(0.022)} material={clay(i % 3 ? "#5fd08a" : "#f2a65a", { emissive: i % 3 ? "#5fd08a" : "#f2a65a" })} position={[0.3, 0, 0.02]} />
            </group>
          ))}
        </group>
      );
    case "cooler":
      return (
        <group position={[f.x + 0.38, 0, f.y + 1]}>
          <M geometry={rbox(0.55, 1.0, 0.55, 0.06)} material={clay(WHITE)} position={[0, 0.5, 0]} />
          <mesh castShadow geometry={capsule(0.21, 0.24)} material={glass("#9cc8ea", 0.7)} position={[0, 1.3, 0]} />
        </group>
      );
    case "safe":
      return (
        <group position={[f.x + 0.5, 0, f.y + 0.75]}>
          <M geometry={rbox(0.9, 0.85, 0.6, 0.06)} material={clay("#4a4f57", { rough: 0.4 })} position={[0, 0.43, 0]} />
          <M geometry={cylinder(0.09, 0.09, 0.04)} material={clay(STEEL, { rough: 0.3 })} position={[0, 0.48, 0.31]} rotation={[Math.PI / 2, 0, 0]} />
        </group>
      );
    case "cabinet":
      return (
        <group position={[f.x + 0.5, 0, f.y + 1.1]}>
          <M geometry={rbox(0.8, 1.3, 0.7, 0.04)} material={clay(STEEL)} position={[0, 0.65, 0]} />
          {[0.32, 0.72, 1.1].map((y) => (
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
  const cx = f.w ? f.x + f.w / 2 : f.x + pw / 32;
  const cz = f.h ? f.y + f.h / 2 : f.y + ph / 16;
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
  const white = clay("#ffffff", { opacity: 0.3 });
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
