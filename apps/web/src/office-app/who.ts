import { CAST, ROOMS, SPOTS, setAppLayout, type CastMember } from "@/office/layout";
import type { Look } from "@/office/sprites";
import type { RoomId } from "@/office/types";
import type { OfficeSetupView } from "@/lib/api";
import type { Layout } from "@/sim/real";

const NEW_LOOKS: Look[] = [
  { skin: "#e8b48f", hair: "#4a3426", style: "curly", shirt: "#c9612f", pants: "#2f3440" },
  { skin: "#8d5a3b", hair: "#1a1513", style: "bun", shirt: "#3ba6c9", pants: "#34495e", glasses: true },
  { skin: "#f3cfb1", hair: "#e2b24c", style: "short", shirt: "#5b6cc9", pants: "#2b2f36" },
  { skin: "#c68a62", hair: "#2b2522", style: "pony", shirt: "#3f9b5f", pants: "#3a3340" },
];
const lookFor = (id: string) => NEW_LOOKS[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % NEW_LOOKS.length];

// Whoever sits at a desk looks like the demo's character for that desk.
const DESK_LOOK: Record<string, Look> = {};
for (const [id, m] of Object.entries(CAST)) if (SPOTS[`seat:${id}`]) DESK_LOOK[`seat:${id}`] = m.look;
// Empty slots keep the demo's names and suggestions (as Ada's ideas for rooms to add).
const ORIGINAL = Object.fromEntries(Object.values(ROOMS).map((r) => [r.id, { name: r.name, suggestion: r.suggestion }]));
/** The demo's characters (for the sign-in page's story); the office itself only shows real agents. */
export const DEMO_CAST: Record<string, CastMember> = { ...CAST };
// The office starts with only you and Ada; real agents are added from the setup.
for (const id of Object.keys(CAST)) if (id !== "you" && id !== "ada") delete CAST[id];
// The extra desks (the demo's people's desks) seat agents 6 and 7 of a room.
setAppLayout(true);

export const ROOM_LABEL: Record<string, string> = Object.fromEntries(Object.values(ROOMS).map((r) => [r.id, r.name]));
ROOM_LABEL.ceo = "Your office";

/** Puts the office's real rooms and agents on the floor plan the renderer draws. */
export function syncCast(setup: OfficeSetupView | null, layout: Layout) {
  for (const [slot, orig] of Object.entries(ORIGINAL)) {
    const real = setup?.rooms.find((r) => layout.slotOf[r.id] === slot);
    ROOMS[slot as RoomId].name = real?.name ?? orig.name;
    ROOMS[slot as RoomId].suggestion = real ? undefined : orig.suggestion;
    ROOM_LABEL[slot] = slot === "ceo" ? "Your office" : ROOMS[slot as RoomId].name;
  }
  const ids = new Set(setup?.agents.map((a) => a.id) ?? []);
  for (const id of Object.keys(CAST)) if (id !== "you" && id !== "ada" && !ids.has(id)) delete CAST[id];
  for (const a of setup?.agents ?? []) {
    const slot = layout.slotOf[a.room] as RoomId | undefined;
    if (!slot) continue;
    const home = layout.homes[a.id];
    const head = setup?.rooms.find((r) => r.id === a.room)?.head === a.id;
    const prev = CAST[a.id];
    const next: CastMember = { id: a.id, name: a.name, role: a.title, room: slot, head, runtime: "Claude Code", look: DESK_LOOK[home] ?? lookFor(a.id) };
    if (!prev || prev.name !== next.name || prev.role !== next.role || prev.room !== next.room || prev.head !== next.head || prev.look !== next.look) CAST[a.id] = next;
  }
}

export const viewerId = () => "you";
export const member = (id: string): CastMember | undefined => CAST[id];
export const nameOf = (id: string) => (id === "you" || id === "ceo" ? "You" : id === "office" ? "Office" : (CAST[id]?.name ?? id));
export const roleOf = (id: string) => (id === "you" || id === "ceo" ? "CEO" : (CAST[id]?.role ?? ""));

export function roomAt(x: number, y: number): RoomId | null {
  for (const r of Object.values(ROOMS)) if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return r.id;
  return null;
}
