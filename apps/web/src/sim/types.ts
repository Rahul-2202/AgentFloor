import type { AgentStatus, Pt } from "@/office/types";

/** A room's slot on the floor plan: dev, marketing, sales, legal or finance (the demo's five team rooms). */
export type RoomKey = string;
export type Runtime = "Claude Code" | "Codex";

export type TaskState = "queued" | "ongoing" | "blocked" | "question" | "review" | "done";

export interface TaskUpdate {
  t: string;
  who: string;
  text: string;
}

export interface Task {
  id: string;
  key: string;
  title: string;
  room: RoomKey;
  owner: string;
  state: TaskState;
  progress: number;
  step?: string;
  priority: "P1" | "P2" | "P3";
  due: string;
  dod?: string;
  source: "you" | "linear" | "ada" | "head";
  updates: TaskUpdate[];
  question?: { text: string; options: string[] };
  blocker?: string;
  outputs?: string[];
  subtasks?: { title: string; done: boolean }[];
  /** Its Linear issue, when the office is connected to Linear. */
  linear?: { identifier: string; url: string };
}

export interface AgentLive {
  at: Pt | string;
  status: AgentStatus;
  taskId?: string;
  step?: string;
  upNext: string[];
  paused?: boolean;
  bubble?: string | null;
  emote?: "!" | "?" | "✓" | "…" | "★" | null;
  /** Messages waiting for the next break point. */
  queued: number;
}

/** The office's real permissions (see @agentfloor/shared/governance). */
export type PermKey = "push" | "open_pr" | "network" | "outside_worktree" | "close_tickets";
/** free, ask, never. */
export type PermLevel = "free" | "ask" | "never";

export interface AgentConfig {
  id: string;
  runtime: Runtime;
  model: string;
  roleCard: string;
  tools: string[];
  permissions: Record<PermKey, PermLevel>;
  budget: number;
  spent: number;
  whenBlocked: WhenBlocked;
  /** 1 = asks about everything, 5 = acts on what you always approve. */
  autonomy: number;
  hours: string;
}

export type WhenBlocked = "park" | "guess" | "wait";

export interface RoomConfig {
  id: RoomKey;
  /** The room's id in the office's setup (the slot id is only where it sits on the floor). */
  realId: string;
  purpose?: string;
  name: string;
  head: string;
  members: string[];
  responsibilities: string[];
  dod: string;
  outputs: string[];
  tools: string[];
  budget: number;
  spent: number;
  convBudget: number;
  whenBlocked: WhenBlocked;
  publishing: "drafts" | "direct";
  merge: "approval" | "head";
  norms: string[];
  channel: string;
  /** The human who owns the room. Agent heads report to them. */
  lead?: string;
  /** Who the agent head reports to. */
  reportsTo?: "lead" | "ceo";
}

export type OutputKind = "pr" | "ticket" | "post" | "video" | "report" | "design" | "blog" | "deploy";
export type OutputStatus = "review" | "approved" | "merged" | "closed" | "changes" | "shipped";

export interface Output {
  id: string;
  kind: OutputKind;
  title: string;
  by: string;
  room: RoomKey;
  at: string;
  status: OutputStatus;
  viewed: boolean;
  taskId?: string;
  summary: string;
  body?: string[];
  meta?: [string, string][];
  /** Where it lives (a PR or file link), and the PR number for pull requests. */
  url?: string;
  /** A file in the agent's working folder (not on the web). */
  file?: string;
  pr?: number;
}

export interface CalEvent {
  id: string;
  title: string;
  day: number; // 0 = Mon … 4 = Fri
  start: string;
  end: string;
  kind: "standup" | "review" | "ceo" | "request" | "external" | "focus" | "meeting";
  attendees: string[];
  organizer: string;
  status: "confirmed" | "pending";
  preread?: string;
  agenda?: string[];
  conversationId?: string;
  source?: "google" | "apple";
}

export interface Msg {
  who: string;
  text: string;
  t: string;
  /** Yours, on its way to the office (or not sent, with why). */
  sending?: boolean;
  failed?: string;
}

export interface Conversation {
  id: string;
  kind: "meeting" | "channel" | "dm" | "cross";
  title: string;
  participants: string[];
  at: string;
  room?: RoomKey;
  messages: Msg[];
  minutes?: { decision: string; why?: string; actions: { who: string; text: string }[]; open?: string[] };
  voice?: boolean;
}

export type MemLayer = "company" | "ceo" | `room:${string}` | `agent:${string}` | `conversation:${string}`;

export interface MemItem {
  id: string;
  /** "proposed": waiting for its owner's approval. */
  pending?: boolean;
  version?: number;
  tags?: string[];
  layer: MemLayer;
  /** decision, lesson, preference, fact, role, scratch, minutes… */
  type: string;
  title: string;
  body: string;
  owner: string;
  status: "active" | "superseded" | "stale";
  source: string;
  date: string;
  confidence?: "high" | "medium" | "low";
  supersededBy?: string;
}

export interface InboxItem {
  /** Ada's one-line note from triage. */
  note?: string | null;
  action?: { type: string; [k: string]: unknown } | null;
  threadId?: string | null;
  body?: string;
  id: string;
  kind: "approval" | "question" | "meeting" | "escalation" | "fyi" | "permission";
  from: string;
  title: string;
  sub: string;
  priority: "high" | "normal" | "low";
  at: string;
  ref?: { type: "task" | "output" | "event" | "request" | "person" | "thread"; id: string };
  resolved?: boolean;
  batched?: boolean;
  /** Who it's for. Unset: worked out from the hierarchy. */
  to?: string[];
}

export interface Toast {
  id: string;
  who: string;
  text: string;
  action?: { label: string; panel: PanelKey; ref?: string };
}

export interface Version {
  v: number;
  at: string;
  who: string;
  summary: string;
  changes: string[];
  snapshot: { configs: Record<string, AgentConfig>; rooms: Record<RoomKey, RoomConfig>; locked: LockedRule[] };
}

export interface LockedRule {
  id: string;
  text: string;
  locked: boolean;
}

export type ChatFrom = "you" | "agent" | "system";
export interface ChatMsg {
  id: string;
  from: ChatFrom;
  text: string;
  t: string;
  card?: ChatCard;
  chips?: string[];
}

export type ChatCard =
  | { kind: "readback"; title: string; items: string[]; actionId: string; applied?: boolean; cancelled?: boolean }
  | { kind: "task"; taskId: string }
  | { kind: "event"; eventId: string }
  | { kind: "memory"; memId: string }
  | { kind: "list"; title: string; items: { who?: string; text: string; sub?: string }[] };

export type PanelKey =
  | "assign"
  | "dashboard"
  | "team"
  | "calendar"
  | "outputs"
  | "conversations"
  | "memory"
  | "inbox"
  | "governance"
  | "room";

export interface Pending {
  /** A change waiting for the CEO to confirm its read-back. */
  id: string;
  summary: string;
  items: string[];
  /** The setup operations behind it, and the version the read-back was made from. */
  ops?: object[];
  baseVersion?: number;
  /** Why it can't be applied (from the policy engine), if so. */
  problems?: string[];
  apply: Partial<{
    configs: Record<string, Partial<AgentConfig>>;
    rooms: Partial<Record<RoomKey, Partial<RoomConfig>>>;
    locked: LockedRule[];
  }>;
}
