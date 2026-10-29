import type { ReactNode } from "react";
import type { Board } from "./types";
import { SIZE, type Furniture, type FurnitureKind } from "./layout";

const O = "#2b2522";

export type Layer = "back" | "front";
export const HAS_BACK = new Set<FurnitureKind>(["desk", "ceoDesk", "meetingTable"]);

function r(x: number, y: number, w: number, h: number, fill: string, key?: string | number) {
  return <rect key={key ?? `${x}-${y}-${w}-${h}-${fill}`} x={x} y={y} width={w} height={h} fill={fill} />;
}

/** Outlined box: dark 1px border with a filled inside. */
function box(x: number, y: number, w: number, h: number, fill: string, k?: string) {
  return (
    <g key={k ?? `b${x}-${y}-${w}-${h}`}>
      {r(x, y, w, h, O)}
      {r(x + 1, y + 1, w - 2, h - 2, fill)}
    </g>
  );
}

function Desk({ tint = "#d6ae80", layer }: { tint?: string; layer: Layer }) {
  if (layer === "back")
    return (
      <>
        {box(8, -10, 16, 14, "#4b4f58", "chair")}
        {r(9, -9, 14, 2, "#5d626c")}
      </>
    );
  return (
    <>
      {r(2, 15, 2, 7, O)}
      {r(28, 15, 2, 7, O)}
      {box(0, 4, 32, 13, tint, "top")}
      {r(1, 12, 30, 4, "#b98d5f")}
      {r(1, 5, 30, 1, "#e4c39b")}
      {/* laptop seen from behind, off to one side so the face stays visible */}
      {box(2, 0, 11, 8, "#a8adb5", "lap")}
      {r(3, 1, 9, 1, "#c3c8cf")}
      {r(7, 3, 2, 2, "#e8ebef")}
      {r(1, 7, 13, 2, O)}
      {r(2, 7, 11, 1, "#8c9199")}
      {/* mug + papers */}
      {box(25, 3, 4, 5, "#f4f1ea", "mug")}
      {r(26, 4, 2, 1, "#8a5a3c")}
      {box(17, 7, 7, 5, "#fbfaf7", "paper")}
      {r(18, 9, 5, 1, "#cfcac0")}
    </>
  );
}

function CeoDesk({ layer }: { layer: Layer }) {
  if (layer === "back")
    return (
      <>
        {box(16, -10, 16, 14, "#3a3d44", "chair")}
        {r(17, -9, 14, 3, "#4d515a")}
      </>
    );
  return (
    <>
      {r(3, 16, 3, 8, O)}
      {r(42, 16, 3, 8, O)}
      {box(0, 4, 48, 14, "#9a6b45", "top")}
      {r(1, 13, 46, 4, "#7d5534")}
      {r(1, 5, 46, 1, "#b38358")}
      {/* monitor back */}
      {box(2, -3, 15, 10, "#3f434b", "mon")}
      {r(3, -2, 13, 1, "#575c66")}
      {r(8, 7, 3, 2, O)}
      {/* lamp */}
      {box(39, -6, 7, 4, "#e8743b", "lamp")}
      {r(42, -2, 1, 7, O)}
      {r(40, 4, 5, 2, O)}
      {/* notebook + mug */}
      {box(29, 7, 8, 6, "#f4f1ea", "note")}
      {r(30, 8, 1, 4, "#e8743b")}
      {box(19, 6, 4, 5, "#f4f1ea", "mug")}
      {r(20, 7, 2, 1, "#8a5a3c")}
    </>
  );
}

function Plant({ small }: { small?: boolean }) {
  if (small)
    return (
      <>
        {box(2, 7, 6, 7, "#d9d2c5")}
        {r(1, 2, 3, 5, "#6e9a5b")}
        {r(4, 0, 3, 7, "#88b270")}
        {r(7, 3, 2, 4, "#6e9a5b")}
        {r(4, 1, 1, 2, "#a9cc8c")}
      </>
    );
  return (
    <>
      {box(2, 13, 10, 9, "#c8734f")}
      {r(3, 14, 8, 2, "#dd8a63")}
      {r(0, 4, 4, 8, "#5f8c4f")}
      {r(3, 0, 4, 13, "#7aa865")}
      {r(7, 2, 4, 11, "#88b270")}
      {r(10, 6, 4, 6, "#5f8c4f")}
      {r(4, 2, 1, 3, "#a9cc8c")}
      {r(8, 4, 1, 3, "#a9cc8c")}
      {r(1, 5, 1, 2, "#7aa865")}
    </>
  );
}

const STICKY = ["#f6d36b", "#f2a6a0", "#a7d3b0", "#a9c3f0", "#d9c2f0"];

function KanbanBoard({ board }: { board?: Board }) {
  const b = board ?? { todo: 3, doing: 2, done: 1 };
  const col = (n: number, cx: number, seed: number) =>
    Array.from({ length: Math.min(n, 6) }, (_, i) =>
      box(cx + (i % 2) * 7, 7 + Math.floor(i / 2) * 5, 6, 4, STICKY[(i + seed) % STICKY.length], `s${cx}-${i}`),
    );
  return (
    <>
      {box(0, 0, 96, 22, "#fbfaf7")}
      {r(1, 1, 94, 4, "#ebe7df")}
      {r(31, 2, 1, 19, "#e2ddd3")}
      {r(63, 2, 1, 19, "#e2ddd3")}
      {r(4, 2, 10, 2, "#9a968e")}
      {r(36, 2, 12, 2, "#d99a2b")}
      {r(68, 2, 8, 2, "#3f9b5f")}
      {col(b.todo, 6, 0)}
      {col(b.doing, 38, 2)}
      {col(b.done, 70, 1)}
      {r(4, 22, 2, 2, O)}
      {r(90, 22, 2, 2, O)}
    </>
  );
}

function Rack() {
  return (
    <>
      {box(0, 0, 16, 30, "#3a3d44")}
      {[3, 9, 15, 21].map((y, i) => (
        <g key={y}>
          {r(2, y, 12, 4, "#4d515a")}
          {r(3, y + 1, 6, 1, "#2b2e33")}
          <rect className="led" style={{ animationDelay: `${i * 0.35}s` }} x={11} y={y + 1} width={1} height={1} fill="#6fe39a" />
          <rect className="led" style={{ animationDelay: `${i * 0.2 + 0.5}s` }} x={12} y={y + 2} width={1} height={1} fill="#f6c453" />
        </g>
      ))}
    </>
  );
}

function Huddle() {
  return (
    <>
      {r(4, 10, 2, 6, O)}
      {r(18, 10, 2, 6, O)}
      {box(0, 2, 24, 10, "#e9dcc6")}
      {r(1, 9, 22, 2, "#d3c3a8")}
      {box(5, 0, 5, 4, "#f4f1ea")}
      {box(14, 1, 6, 4, "#fbfaf7")}
    </>
  );
}

function Couch() {
  return (
    <>
      {box(0, 0, 40, 12, "#7f8fa6")}
      {box(0, 6, 6, 14, "#6c7b91")}
      {box(34, 6, 6, 14, "#6c7b91")}
      {box(5, 8, 30, 10, "#94a3b9")}
      {r(6, 9, 28, 1, "#a9b6c9")}
      {r(19, 9, 1, 8, "#7f8fa6")}
      {box(8, 3, 8, 7, "#e8743b")}
    </>
  );
}

function Shelf() {
  const books = ["#e8743b", "#5b6cc9", "#3f9b5f", "#d9534a", "#e0a43b", "#7b6cd9", "#3ba6c9"];
  return (
    <>
      {box(0, 0, 32, 30, "#a27650")}
      {r(2, 2, 28, 26, "#7d5534")}
      {[2, 11, 20].map((y, row) => (
        <g key={y}>
          {r(2, y + 8, 28, 1, "#a27650")}
          {books.slice(row, row + 5).map((c, i) => r(4 + i * 5 + (row % 2), y + 1 + (i % 2), 4, 7 - (i % 2), c, `${y}-${i}`))}
        </g>
      ))}
    </>
  );
}

function Window() {
  return (
    <>
      {box(0, 0, 32, 16, "#cfe3ee")}
      {r(1, 1, 30, 6, "#e4f0f6")}
      {r(15, 1, 2, 14, "#f4efe7")}
      {r(1, 7, 30, 1, "#f4efe7")}
      {r(4, 2, 4, 1, "#ffffff")}
      {r(20, 3, 3, 1, "#ffffff")}
      {r(-1, 15, 34, 2, "#d9cdbb")}
    </>
  );
}

function MeetingTable({ layer }: { layer: Layer }) {
  const chair = (x: number, y: number, k: string) => box(x, y, 10, 7, "#4b4f58", k);
  if (layer === "back") return <>{[8, 24, 40, 56].map((x, i) => chair(x - 2, -5, `ct${i}`))}</>;
  return (
    <>
      {box(0, 2, 80, 26, "#9a6b45")}
      {r(1, 22, 78, 5, "#7d5534")}
      {r(1, 3, 78, 1, "#b38358")}
      {box(10, 8, 12, 8, "#fbfaf7", "p1")}
      {box(44, 9, 10, 7, "#fbfaf7", "p2")}
      {box(62, 6, 5, 5, "#f4f1ea", "m1")}
      {[8, 24, 40, 56].map((x, i) => chair(x - 2, 28, `cb${i}`))}
    </>
  );
}

function Tv() {
  return (
    <>
      {box(0, 0, 48, 22, "#2b2e33")}
      {r(2, 2, 44, 18, "#3a4a63")}
      {r(5, 5, 18, 2, "#a9c3f0")}
      {r(5, 9, 28, 1, "#7f93b3")}
      {r(5, 12, 22, 1, "#7f93b3")}
      {r(34, 12, 8, 5, "#e8743b")}
      {r(36, 9, 4, 3, "#e8743b")}
    </>
  );
}

function Cooler() {
  return (
    <>
      {box(0, 0, 10, 9, "#bfe0f0")}
      {r(2, 2, 6, 2, "#e4f4fb")}
      {box(-1, 8, 12, 14, "#e9e6df")}
      {r(3, 12, 4, 2, "#3b7be8")}
    </>
  );
}

function WallBoard({ kind }: { kind: "moodboard" | "leaderboard" | "chartboard" }) {
  if (kind === "moodboard")
    return (
      <>
        {box(0, 0, 64, 20, "#c9a26b")}
        {r(2, 2, 60, 16, "#d8b98a")}
        {box(4, 3, 12, 10, "#e46f9a", "m1")}
        {box(18, 5, 10, 12, "#3ba6c9", "m2")}
        {box(30, 3, 14, 9, "#fbfaf7", "m3")}
        {r(32, 6, 9, 1, "#9a968e")}
        {box(46, 4, 12, 12, "#e0a43b", "m4")}
        {r(9, 2, 2, 2, "#d9534a")}
        {r(51, 3, 2, 2, "#d9534a")}
      </>
    );
  if (kind === "leaderboard")
    return (
      <>
        {box(0, 0, 64, 20, "#fbfaf7")}
        {[0, 1, 2].map((i) => (
          <g key={i}>
            {r(4, 4 + i * 5, 3, 3, ["#e0a43b", "#9a968e", "#c8734f"][i])}
            {r(9, 5 + i * 5, 34 - i * 8, 2, "#2f6fd1")}
          </g>
        ))}
        {r(50, 4, 10, 12, "#e8f0fd")}
        {r(52, 10, 2, 5, "#2f6fd1")}
        {r(55, 7, 2, 8, "#2f6fd1")}
      </>
    );
  return (
    <>
      {box(0, 0, 64, 20, "#fbfaf7")}
      {[6, 12, 9, 15, 13, 17, 16].map((h, i) => r(5 + i * 8, 18 - h, 5, h - 1, i === 6 ? "#3f9b5f" : "#a7d3b0", i))}
    </>
  );
}

function Safe() {
  return (
    <>
      {box(0, 0, 18, 16, "#6c737d")}
      {r(2, 2, 14, 12, "#808892")}
      {box(7, 5, 5, 5, "#c9ccd1")}
      {r(14, 6, 1, 4, O)}
    </>
  );
}

function Cabinet() {
  return (
    <>
      {box(0, 0, 16, 24, "#b7bcc4")}
      {r(1, 11, 14, 1, "#8c9199")}
      {r(6, 5, 4, 1, O)}
      {r(6, 16, 4, 1, O)}
    </>
  );
}

function Frame() {
  return (
    <>
      {box(0, 0, 16, 14, "#a27650")}
      {r(2, 2, 12, 10, "#f2e4d0")}
      {r(3, 7, 10, 4, "#88b270")}
      {r(9, 3, 3, 3, "#e8743b")}
    </>
  );
}

export function FurnitureArt({ f, board, layer = "front" }: { f: Furniture; board?: Board; layer?: Layer }) {
  const [w, h] = f.kind === "rug" ? [(f.w ?? 4) * 16, (f.h ?? 3) * 16] : SIZE[f.kind];
  let art: ReactNode = null;
  const k: FurnitureKind = f.kind;
  switch (k) {
    case "desk":
      art = <Desk tint={f.tint} layer={layer} />;
      break;
    case "ceoDesk":
      art = <CeoDesk layer={layer} />;
      break;
    case "plant":
      art = <Plant />;
      break;
    case "plantSmall":
      art = <Plant small />;
      break;
    case "board":
      art = <KanbanBoard board={board} />;
      break;
    case "rack":
      art = <Rack />;
      break;
    case "huddle":
      art = <Huddle />;
      break;
    case "couch":
      art = <Couch />;
      break;
    case "shelf":
      art = <Shelf />;
      break;
    case "window":
      art = <Window />;
      break;
    case "meetingTable":
      art = <MeetingTable layer={layer} />;
      break;
    case "tv":
      art = <Tv />;
      break;
    case "cooler":
      art = <Cooler />;
      break;
    case "moodboard":
    case "leaderboard":
    case "chartboard":
      art = <WallBoard kind={k} />;
      break;
    case "safe":
      art = <Safe />;
      break;
    case "cabinet":
      art = <Cabinet />;
      break;
    case "frame":
      art = <Frame />;
      break;
    case "rug":
      art = (
        <>
          <rect x={0} y={0} width={w} height={h} rx={3} fill={f.tint ?? "#e9d9c2"} />
          <rect x={3} y={3} width={w - 6} height={h - 6} rx={2} fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth={1} />
        </>
      );
      break;
  }
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: "block", overflow: "visible" }}>
      {art}
    </svg>
  );
}
