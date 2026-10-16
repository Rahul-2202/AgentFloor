export type RoomId = "ceo" | "dev" | "marketing" | "meeting" | "sales" | "legal" | "finance";

export type RoomState = "hidden" | "blueprint" | "ghost" | "built";

export type AgentStatus = "idle" | "working" | "blocked" | "meeting" | "away" | "thinking";

export type BubbleTone = "default" | "ceo" | "ada" | "urgent" | "quiet";

export type Pt = [number, number];

export interface Bubble {
  text: string;
  tone?: BubbleTone;
}

export interface AgentScene {
  /** Feet position in tile units. A string names a spot from the layout. */
  at: Pt | string;
  status?: AgentStatus;
  bubble?: Bubble | string | null;
  badge?: number | null;
  emote?: "!" | "?" | "✓" | "…" | "★" | null;
  /** Seconds before this agent starts moving to the new spot. */
  delay?: number;
  /** Walk speed multiplier. */
  speed?: number;
  /** Teleport instead of walking. */
  snap?: boolean;
  /** Where the agent enters from the first time it appears. */
  from?: Pt | string;
}

export type PropKind = "ticket" | "doc" | "pr" | "lock" | "knock" | "note" | "calendar" | "check" | "memory";

export interface PropScene {
  kind: PropKind;
  at: Pt | string;
  label: string;
  sub?: string;
  delay?: number;
  tone?: "default" | "ok" | "warn" | "bad" | "violet";
}

export interface Camera {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Fill the viewport (crop) instead of fitting inside it. */
  cover?: boolean;
  /** Pin the world to the top when it is shorter than the viewport. */
  anchor?: "top";
}

export interface Board {
  todo: number;
  doing: number;
  done: number;
}

export interface Scene {
  rooms: Partial<Record<RoomId, RoomState>>;
  agents: Partial<Record<string, AgentScene>>;
  props?: Partial<Record<string, PropScene>>;
  camera?: Camera | RoomId | RoomId[];
  labels?: boolean;
  focus?: RoomId | null;
  board?: Board;
  roomNotes?: Partial<Record<RoomId, string>>;
  locked?: RoomId[];
}
