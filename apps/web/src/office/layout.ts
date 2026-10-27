import type { Look } from "./look";
import type { Pt, RoomId } from "./types";

export const TILE = 16;
export const WORLD = { w: 50, h: 28 };

export interface RoomDef {
  id: RoomId;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  door: { side: "top" | "bottom"; at: number; w: number };
  floor: string;
  floorLine: string;
  pattern: "planks" | "carpet" | "tiles" | "herring";
  wall: string;
  suggestion?: string;
}

export const ROOMS: Record<RoomId, RoomDef> = {
  ceo: {
    id: "ceo",
    name: "Your office",
    x: 1,
    y: 1,
    w: 12,
    h: 11,
    door: { side: "bottom", at: 8, w: 3 },
    floor: "#dcbf96",
    floorLine: "#cfae80",
    pattern: "planks",
    wall: "#f4efe7",
  },
  dev: {
    id: "dev",
    name: "Development",
    x: 14,
    y: 1,
    w: 22,
    h: 11,
    door: { side: "bottom", at: 2, w: 3 },
    floor: "#cdd5c3",
    floorLine: "#c2cbb7",
    pattern: "carpet",
    wall: "#eef0e8",
    suggestion: "PM · Frontend · Backend · DevOps · Tester",
  },
  marketing: {
    id: "marketing",
    name: "Marketing",
    x: 37,
    y: 1,
    w: 12,
    h: 11,
    door: { side: "bottom", at: 2, w: 3 },
    floor: "#dcd5e8",
    floorLine: "#d1c9e0",
    pattern: "carpet",
    wall: "#f3f0f7",
    suggestion: "Strategist · 2 Creators · Editor",
  },
  meeting: {
    id: "meeting",
    name: "Meeting room",
    x: 1,
    y: 15,
    w: 12,
    h: 12,
    door: { side: "top", at: 8, w: 3 },
    floor: "#e6cfbe",
    floorLine: "#dcc2ae",
    pattern: "herring",
    wall: "#f6efe8",
  },
  sales: {
    id: "sales",
    name: "Sales",
    x: 14,
    y: 15,
    w: 10,
    h: 12,
    door: { side: "top", at: 1, w: 3 },
    floor: "#e9dfc6",
    floorLine: "#dfd3b6",
    pattern: "carpet",
    wall: "#f6f2e6",
    suggestion: "Lead · SDR · Researcher",
  },
  legal: {
    id: "legal",
    name: "Legal",
    x: 25,
    y: 15,
    w: 11,
    h: 12,
    door: { side: "top", at: 1, w: 3 },
    floor: "#cfd8e1",
    floorLine: "#c3cdd8",
    pattern: "carpet",
    wall: "#eff2f5",
    suggestion: "Counsel · Contract reviewer · Paralegal",
  },
  finance: {
    id: "finance",
    name: "Finance",
    x: 37,
    y: 15,
    w: 12,
    h: 12,
    door: { side: "top", at: 1, w: 3 },
    floor: "#d2e3d6",
    floorLine: "#c5d9ca",
    pattern: "carpet",
    wall: "#eff5f0",
    suggestion: "Controller · Bookkeeper · Analyst",
  },
};

export type FurnitureKind =
  | "desk"
  | "ceoDesk"
  | "plant"
  | "plantSmall"
  | "board"
  | "rack"
  | "huddle"
  | "couch"
  | "rug"
  | "shelf"
  | "window"
  | "meetingTable"
  | "tv"
  | "cooler"
  | "moodboard"
  | "leaderboard"
  | "chartboard"
  | "safe"
  | "cabinet"
  | "frame";

export interface Furniture {
  id: string;
  room: RoomId | "hall";
  kind: FurnitureKind;
  x: number;
  y: number;
  w?: number;
  h?: number;
  tint?: string;
  /** Only in the walkable office app (desks for people). */
  app?: boolean;
}

/** The office app adds desks for people; the landing pages don't show them. */
export const layoutMode = { app: false };
export function setAppLayout(on: boolean) {
  layoutMode.app = on;
}
export const inLayout = (f: Furniture) => !f.app || layoutMode.app;

export const SIZE: Record<FurnitureKind, [number, number]> = {
  desk: [32, 22],
  ceoDesk: [48, 24],
  plant: [14, 22],
  plantSmall: [10, 14],
  board: [96, 22],
  rack: [16, 30],
  huddle: [24, 16],
  couch: [40, 20],
  rug: [0, 0],
  shelf: [32, 30],
  window: [32, 16],
  meetingTable: [80, 32],
  tv: [48, 22],
  cooler: [10, 22],
  moodboard: [64, 20],
  leaderboard: [64, 20],
  chartboard: [64, 20],
  safe: [18, 16],
  cabinet: [16, 24],
  frame: [16, 14],
};

/** Walk-blocking footprint, in tiles, relative to the piece's position. */
export const BLOCK: Partial<Record<FurnitureKind, [number, number, number, number]>> = {
  desk: [0, 0.5, 2, 1],
  ceoDesk: [0, 0.5, 3, 1],
  plant: [0, 0.5, 1, 1],
  rack: [0, 0.5, 1, 1.5],
  huddle: [0, 0.5, 1.5, 0.5],
  couch: [0, 0.5, 2.5, 0.75],
  shelf: [0, 1, 2, 1],
  meetingTable: [0, 0.5, 5, 1.5],
  cooler: [0, 0.5, 0.75, 1],
  safe: [0, 0.5, 1, 0.5],
  cabinet: [0, 0.75, 1, 0.75],
};

export const WALL_ITEMS: FurnitureKind[] = ["board", "window", "tv", "moodboard", "leaderboard", "chartboard", "frame"];

export const FURNITURE: Furniture[] = [
  // Your office
  { id: "ceo-win1", room: "ceo", kind: "window", x: 2.5, y: 1.55 },
  { id: "ceo-win2", room: "ceo", kind: "window", x: 6, y: 1.55 },
  { id: "ceo-frame", room: "ceo", kind: "frame", x: 9.6, y: 1.7 },
  { id: "ceo-shelf", room: "ceo", kind: "shelf", x: 10, y: 2.1 },
  { id: "ceo-rug", room: "ceo", kind: "rug", x: 2.5, y: 7, w: 6, h: 3.5, tint: "#e9d9c2" },
  { id: "ceo-desk", room: "ceo", kind: "ceoDesk", x: 4, y: 4 },
  { id: "ceo-couch", room: "ceo", kind: "couch", x: 2, y: 9.6 },
  { id: "ceo-plant", room: "ceo", kind: "plant", x: 1.6, y: 2.6 },
  { id: "ceo-plant2", room: "ceo", kind: "plant", x: 11.5, y: 9.6 },

  // Development
  { id: "dev-board", room: "dev", kind: "board", x: 18.5, y: 1.45 },
  { id: "dev-win", room: "dev", kind: "window", x: 26, y: 1.55 },
  { id: "dev-win2", room: "dev", kind: "window", x: 29.5, y: 1.55 },
  { id: "dev-fe", room: "dev", kind: "desk", x: 17, y: 4 },
  { id: "dev-be", room: "dev", kind: "desk", x: 21, y: 4 },
  { id: "dev-pm", room: "dev", kind: "desk", x: 29, y: 4 },
  { id: "dev-ops", room: "dev", kind: "desk", x: 17, y: 7.5 },
  { id: "dev-qa", room: "dev", kind: "desk", x: 21, y: 7.5 },
  { id: "dev-rug", room: "dev", kind: "rug", x: 26.5, y: 7.25, w: 6, h: 3.5, tint: "#bfcab3" },
  { id: "dev-huddle", room: "dev", kind: "huddle", x: 28.75, y: 8.25 },
  { id: "dev-rack", room: "dev", kind: "rack", x: 34, y: 2.6 },
  { id: "dev-plant", room: "dev", kind: "plant", x: 14.6, y: 2.6 },
  { id: "dev-plant2", room: "dev", kind: "plant", x: 34.3, y: 9.8 },
  { id: "dev-plant3", room: "dev", kind: "plantSmall", x: 25.2, y: 3.3 },

  // Marketing
  { id: "mkt-mood", room: "marketing", kind: "moodboard", x: 40, y: 1.45 },
  { id: "mkt-c1", room: "marketing", kind: "desk", x: 38.25, y: 4 },
  { id: "mkt-c2", room: "marketing", kind: "desk", x: 41.25, y: 4 },
  { id: "mkt-st", room: "marketing", kind: "desk", x: 45, y: 4 },
  { id: "mkt-ed", room: "marketing", kind: "desk", x: 41.25, y: 7.5 },
  { id: "mkt-plant", room: "marketing", kind: "plant", x: 47.4, y: 9.6 },
  { id: "mkt-rug", room: "marketing", kind: "rug", x: 44, y: 7.5, w: 4, h: 3, tint: "#cfc6e0" },

  // Meeting room
  { id: "mt-tv", room: "meeting", kind: "tv", x: 4.5, y: 15.55 },
  { id: "mt-rug", room: "meeting", kind: "rug", x: 2.5, y: 18.5, w: 8, h: 5, tint: "#dcc0ac" },
  { id: "mt-table", room: "meeting", kind: "meetingTable", x: 4, y: 19.75 },
  { id: "mt-plant", room: "meeting", kind: "plant", x: 1.6, y: 16.6 },
  { id: "mt-plant2", room: "meeting", kind: "plant", x: 11.4, y: 24.6 },

  // Sales
  { id: "sl-board", room: "sales", kind: "leaderboard", x: 19, y: 15.45 },
  { id: "sl-lead", room: "sales", kind: "desk", x: 20, y: 18 },
  { id: "sl-sdr", room: "sales", kind: "desk", x: 15.5, y: 21.5 },
  { id: "sl-res", room: "sales", kind: "desk", x: 19.5, y: 21.5 },
  { id: "sl-plant", room: "sales", kind: "plant", x: 22.4, y: 24.6 },

  // Legal
  { id: "lg-shelf", room: "legal", kind: "shelf", x: 32.5, y: 16.1 },
  { id: "lg-frame", room: "legal", kind: "frame", x: 30.4, y: 15.7 },
  { id: "lg-counsel", room: "legal", kind: "desk", x: 31, y: 18.5 },
  { id: "lg-rev", room: "legal", kind: "desk", x: 26.5, y: 21.5 },
  { id: "lg-para", room: "legal", kind: "desk", x: 31, y: 21.75 },
  { id: "lg-cab", room: "legal", kind: "cabinet", x: 34.3, y: 24 },

  // Finance
  { id: "fn-chart", room: "finance", kind: "chartboard", x: 42.5, y: 15.45 },
  { id: "fn-ctrl", room: "finance", kind: "desk", x: 44.5, y: 18 },
  { id: "fn-book", room: "finance", kind: "desk", x: 38.5, y: 21.5 },
  { id: "fn-an", room: "finance", kind: "desk", x: 42.5, y: 21.5 },
  { id: "fn-safe", room: "finance", kind: "safe", x: 46.8, y: 23.5 },

  // People's desks (office app only)
  { id: "dev-priya", room: "dev", kind: "desk", x: 32, y: 5.5, app: true },
  { id: "dev-sam", room: "dev", kind: "desk", x: 24.5, y: 7.5, app: true },
  { id: "mkt-marco", room: "marketing", kind: "desk", x: 38, y: 7.5, app: true },
  { id: "mkt-lena", room: "marketing", kind: "desk", x: 43.2, y: 10, app: true },

  // Hallway
  { id: "hall-cooler", room: "hall", kind: "cooler", x: 24.6, y: 12.05 },
  { id: "hall-plant", room: "hall", kind: "plant", x: 0.05, y: 12.3 },
  { id: "hall-plant2", room: "hall", kind: "plantSmall", x: 36.2, y: 12.4 },
];

const seat = (deskId: string): Pt => {
  const d = FURNITURE.find((f) => f.id === deskId)!;
  return d.kind === "ceoDesk" ? [d.x + 1.5, d.y + 0.4] : [d.x + 1, d.y + 0.4];
};

export const SPOTS: Record<string, Pt> = {
  // Your office
  "seat:you": seat("ceo-desk"),
  "ada:home": [8.25, 5.25],
  "ada:desk": [7.6, 5.4],
  "ceo:visitor": [5.5, 7.25],
  "ceo:visitor2": [7, 7.25],
  "ceo:door": [10.5, 11.25],
  "ceo:outside": [10.5, 13.4],
  "ceo:outside2": [8.75, 13.4],

  // Development
  "seat:pm": seat("dev-pm"),
  "seat:fe": seat("dev-fe"),
  "seat:be": seat("dev-be"),
  "seat:ops": seat("dev-ops"),
  "seat:qa": seat("dev-qa"),
  "dev:door": [17.5, 11.25],
  "dev:outside": [17.5, 13.4],
  "dev:huddleL": [28.25, 8.75],
  "dev:huddleR": [30.75, 8.75],
  "dev:huddleT": [29.5, 7.75],
  "dev:front": [25, 10.25],
  "dev:board": [21.5, 3.4],
  "dev:beside-be": [23.5, 4.75],
  "dev:beside-pm": [28.25, 4.75],
  "dev:brief": [25.5, 6.25],

  "dev:beside-fe": [20, 4.4],
  "dev:beside-ops": [20, 7.9],

  // Marketing
  "mkt:brief": [45.5, 9.4],
  "mkt:beside-ed": [43.75, 8.25],
  "mkt:beside-st": [43.6, 4.4],
  "seat:strat": seat("mkt-st"),
  "seat:cr1": seat("mkt-c1"),
  "seat:cr2": seat("mkt-c2"),
  "seat:editor": seat("mkt-ed"),
  "mkt:door": [39.5, 11.25],
  "mkt:outside": [39.5, 13.4],

  // Meeting room
  "mt:door": [10.5, 16.75],
  "mt:head": [10, 20.75],
  "mt:t1": [5, 19.4],
  "mt:t2": [6.5, 19.4],
  "mt:t3": [8, 19.4],
  "mt:b1": [5, 21.9],
  "mt:b2": [6.5, 21.9],
  "mt:b3": [8, 21.9],
  "mt:foot": [3.1, 20.75],

  // Sales / Legal / Finance
  "seat:lead": seat("sl-lead"),
  "seat:sdr": seat("sl-sdr"),
  "seat:res": seat("sl-res"),
  "seat:counsel": seat("lg-counsel"),
  "seat:reviewer": seat("lg-rev"),
  "seat:para": seat("lg-para"),
  "seat:ctrl": seat("fn-ctrl"),
  "seat:book": seat("fn-book"),
  "seat:analyst": seat("fn-an"),

  // People
  "seat:priya": seat("dev-priya"),
  "seat:sam": seat("dev-sam"),
  "seat:marco": seat("mkt-marco"),
  "seat:lena": seat("mkt-lena"),
  "dev:new": [27, 6.3],
  "mkt:new": [41, 6.4],
  "dev:new2": [27, 10.2],
  "mkt:new2": [38.6, 10.4],
  "sales:new": [17.5, 25],
  "legal:new": [28, 19],
  "fin:new": [40, 19],
  // More standing room for rooms beyond their desks (up to six agents a room).
  "sales:new2": [21, 25],
  "sales:new3": [15.6, 25.2],
  "legal:new2": [28, 25],
  "legal:new3": [31.5, 25.2],
  "fin:new2": [40, 25],
  "fin:new3": [44, 25.2],
  "lobby:1": [2.6, 13.5],
  "lobby:2": [4, 13.6],
  "lobby:3": [5.4, 13.5],

  // Hallway
  "hall:entry": [0.75, 13.5],
  "hall:mid": [25, 13.6],
  "hall:cooler": [25.4, 13.4],
};

export function spot(at: Pt | string): Pt {
  if (typeof at !== "string") return at;
  const p = SPOTS[at];
  if (!p) throw new Error(`Unknown spot ${at}`);
  return p;
}

export interface CastMember {
  id: string;
  name: string;
  role: string;
  room: RoomId;
  head?: boolean;
  runtime?: string;
  look: Look;
  /** A person, not an agent. */
  human?: boolean;
  /** A real person, connected live. */
  real?: boolean;
}

export const CAST: Record<string, CastMember> = {
  you: {
    id: "you",
    name: "You",
    role: "CEO",
    room: "ceo",
    look: { skin: "#f1c7a5", hair: "#2b2522", style: "short", shirt: "#4f9a6a", accent: "#3f8159", pants: "#3a4a63" },
  },
  ada: {
    id: "ada",
    name: "Ada",
    role: "Office manager",
    room: "ceo",
    look: { skin: "#e8b48f", hair: "#9c4a2c", style: "bun", shirt: "#e8743b", accent: "#f7d3bb", pants: "#4a3f3a", prop: "tablet" },
  },
  pm: {
    id: "pm",
    name: "PM",
    role: "Product manager",
    room: "dev",
    head: true,
    runtime: "Claude Code",
    look: { skin: "#c68a62", hair: "#1f1a17", style: "pony", shirt: "#5b6cc9", accent: "#a9b4ec", pants: "#2f3440", prop: "tablet" },
  },
  fe: {
    id: "fe",
    name: "Frontend",
    role: "Frontend developer",
    room: "dev",
    runtime: "Claude Code",
    look: { skin: "#f3cfb1", hair: "#e2b24c", style: "bob", shirt: "#3fa27a", pants: "#34495e" },
  },
  be: {
    id: "be",
    name: "Backend",
    role: "Backend developer",
    room: "dev",
    runtime: "Codex",
    look: { skin: "#8d5a3b", hair: "#1a1513", style: "curly", shirt: "#d9534a", pants: "#2f3440", glasses: true },
  },
  ops: {
    id: "ops",
    name: "DevOps",
    role: "DevOps engineer",
    room: "dev",
    runtime: "Codex",
    look: { skin: "#e6b590", hair: "#4a3426", style: "cap", cap: "#2f6fd1", shirt: "#4a4f57", pants: "#2b2f36" },
  },
  qa: {
    id: "qa",
    name: "Tester",
    role: "QA tester",
    room: "dev",
    runtime: "Claude Code",
    look: { skin: "#d9a27c", hair: "#2b2522", style: "long", shirt: "#9b6cd9", pants: "#3a3340" },
  },
  strat: {
    id: "strat",
    name: "Strategist",
    role: "Marketing strategist",
    room: "marketing",
    head: true,
    runtime: "Claude Code",
    look: { skin: "#f1c7a5", hair: "#6b3e26", style: "short", shirt: "#e0a43b", pants: "#3a3a3d", glasses: true, prop: "tablet" },
  },
  cr1: {
    id: "cr1",
    name: "Creator",
    role: "Content creator",
    room: "marketing",
    runtime: "Claude Code",
    look: { skin: "#a86b48", hair: "#2b2522", style: "bun", shirt: "#e46f9a", pants: "#2f3440" },
  },
  cr2: {
    id: "cr2",
    name: "Creator",
    role: "Content creator",
    room: "marketing",
    runtime: "Codex",
    look: { skin: "#f3cfb1", hair: "#c9612f", style: "curly", shirt: "#3ba6c9", pants: "#3a4a63" },
  },
  editor: {
    id: "editor",
    name: "Editor",
    role: "Editor",
    room: "marketing",
    runtime: "Claude Code",
    look: { skin: "#d4986f", hair: "#3a2a22", style: "bob", shirt: "#2f3440", accent: "#5a6170", pants: "#4a3f3a", glasses: true },
  },
  priya: {
    id: "priya",
    name: "Priya",
    role: "Engineering lead",
    room: "dev",
    human: true,
    look: { skin: "#b97a55", hair: "#1a1513", style: "long", shirt: "#2b4fb8", accent: "#8fa6e8", pants: "#2b2f36", glasses: true },
  },
  sam: {
    id: "sam",
    name: "Sam",
    role: "Software engineer",
    room: "dev",
    human: true,
    look: { skin: "#7a4b30", hair: "#1a1513", style: "buzz", shirt: "#e8743b", pants: "#34495e", prop: "mug" },
  },
  marco: {
    id: "marco",
    name: "Marco",
    role: "Marketing lead",
    room: "marketing",
    human: true,
    look: { skin: "#e6b590", hair: "#3a2a22", style: "curly", shirt: "#1f7a6d", accent: "#7cc4b8", pants: "#2f3440" },
  },
  lena: {
    id: "lena",
    name: "Lena",
    role: "Content designer",
    room: "marketing",
    human: true,
    look: { skin: "#f3cfb1", hair: "#2b2522", style: "bob", shirt: "#d94f7a", pants: "#3a3340", glasses: true },
  },
  jordan: {
    id: "jordan",
    name: "Jordan",
    role: "Account executive",
    room: "ceo",
    human: true,
    look: { skin: "#d9a27c", hair: "#c9612f", style: "short", shirt: "#6b7a3a", pants: "#2b2f36" },
  },
  nina: {
    id: "nina",
    name: "Nina",
    role: "Brand designer",
    room: "marketing",
    human: true,
    look: { skin: "#a86b48", hair: "#2b2522", style: "pony", shirt: "#7b6cd9", accent: "#c9bff5", pants: "#2f3440" },
  },
  lead: {
    id: "lead",
    name: "Sales lead",
    role: "Sales lead",
    room: "sales",
    head: true,
    look: { skin: "#c68a62", hair: "#1a1513", style: "short", shirt: "#2f6fd1", pants: "#2b2f36" },
  },
  sdr: {
    id: "sdr",
    name: "SDR",
    role: "Sales development",
    room: "sales",
    look: { skin: "#f1c7a5", hair: "#e2b24c", style: "pony", shirt: "#e0a43b", pants: "#34495e" },
  },
  res: {
    id: "res",
    name: "Researcher",
    role: "Lead researcher",
    room: "sales",
    look: { skin: "#8d5a3b", hair: "#2b2522", style: "buzz", shirt: "#3fa27a", pants: "#2f3440", glasses: true },
  },
  counsel: {
    id: "counsel",
    name: "Counsel",
    role: "Legal counsel",
    room: "legal",
    head: true,
    look: { skin: "#e8b48f", hair: "#8a8580", style: "short", shirt: "#2f3440", accent: "#d9d4cc", pants: "#2b2f36", glasses: true },
  },
  reviewer: {
    id: "reviewer",
    name: "Reviewer",
    role: "Contract reviewer",
    room: "legal",
    look: { skin: "#d9a27c", hair: "#3a2a22", style: "long", shirt: "#7b8fa8", pants: "#3a3340" },
  },
  para: {
    id: "para",
    name: "Paralegal",
    role: "Paralegal",
    room: "legal",
    look: { skin: "#a86b48", hair: "#1a1513", style: "bun", shirt: "#c9a26b", pants: "#2f3440" },
  },
  ctrl: {
    id: "ctrl",
    name: "Controller",
    role: "Financial controller",
    room: "finance",
    head: true,
    look: { skin: "#f3cfb1", hair: "#4a3426", style: "short", shirt: "#3f9b5f", pants: "#2b2f36", glasses: true },
  },
  book: {
    id: "book",
    name: "Bookkeeper",
    role: "Bookkeeper",
    room: "finance",
    look: { skin: "#c68a62", hair: "#2b2522", style: "bob", shirt: "#e46f9a", pants: "#3a4a63" },
  },
  analyst: {
    id: "analyst",
    name: "Analyst",
    role: "Financial analyst",
    room: "finance",
    look: { skin: "#e6b590", hair: "#c9612f", style: "short", shirt: "#5b6cc9", pants: "#2f3440" },
  },
};
