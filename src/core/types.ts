/**
 * The office protocol's domain model. Everything agents say to each other is a
 * Message inside a Thread; the daemon owns delivery, rules and escalation.
 */

/** The CEO is a participant like any agent, but a person, reached through the inbox. */
export const CEO = "ceo";
/** Messages the daemon itself sends (escalations, notices). */
export const OFFICE = "office";

export type AgentRole = "head" | "member";

export interface RoomDef {
  id: string;
  name: string;
  /** Agent id of the room's head. */
  head: string;
}

export interface AgentDef {
  id: string;
  name: string;
  room: string;
  role: AgentRole;
  /** Runtime adapter kind: "claude-code" (default), "junie", "antigravity", "scripted", ... */
  runtime: string;
  /** Model for the runtime (see the catalog); the runtime's default if unset. */
  model?: string;
  /** Effort level, where the runtime has one. */
  effort?: string;
  /** One line describing what the agent does, shown to other agents in the directory. */
  title: string;
  /** Seed lessons for the agent's own memory file. */
  lessons?: string[];
  /** Runtime-specific settings (for "scripted": its script). */
  options?: Record<string, unknown>;
}

/** What the office shows for an agent, derived from its runtime. */
export type AgentStatus = "offline" | "idle" | "working" | "waiting" | "stopped";

export interface Policy {
  /** An ask with no answer escalates after this long. */
  askDeadlineSec: number;
  /** A question may cause at most this many follow-up asks down the chain. */
  maxHops: number;
  /** Messages per thread before it stops and goes to the CEO. */
  threadMaxMessages: number;
  /** Messages per huddle before it ends without agreement. */
  huddleMaxTurns: number;
  /** Who may ask the CEO directly. Members' questions otherwise go to their head. */
  ceoReach: "anyone" | "heads";
}

export interface OfficeConfig {
  name: string;
  rooms: RoomDef[];
  agents: AgentDef[];
  policy: Policy;
}

export type Urgency = "normal" | "urgent" | "stop";
export type MsgType = "ask" | "answer" | "inform" | "request_work" | "huddle" | "stop";

export type ThreadKind = "message" | "huddle";
export type ThreadState = "open" | "resolved" | "escalated";

export interface Thread {
  id: string;
  kind: ThreadKind;
  topic: string;
  createdBy: string;
  participants: string[];
  state: ThreadState;
  /** The thread whose question led to this one; used for hop limits and cycles. */
  parentId: string | null;
  depth: number;
  taskId: string | null;
  /** Set while a question waits for an answer. */
  awaiting: { by: string; from: string; deadlineAt: number } | null;
  /** 0 none, 1 sent to the asker's head, 2 sent to the CEO. */
  escalation: number;
  /** Messages sent in the thread (one per send, whatever the recipients). */
  sent: number;
  outcome: string | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * When a message reaches its recipient:
 * - "now": interrupts (stop only)
 * - "tool": after the recipient's next tool call (questions, answers, urgent)
 * - "turn_end": when the recipient's current turn ends (everything else)
 */
export type DeliveryPoint = "now" | "tool" | "turn_end";

export interface Message {
  id: string;
  threadId: string;
  from: string;
  to: string;
  type: MsgType;
  urgency: Urgency;
  body: string;
  refs: string[];
  state: "queued" | "delivered";
  createdAt: number;
  deliveredAt: number | null;
}

export type TaskStatus = "queued" | "ongoing" | "blocked" | "review" | "done";

export interface Task {
  id: string;
  title: string;
  details: string;
  room: string;
  owner: string;
  createdBy: string;
  status: TaskStatus;
  progress: number;
  note: string | null;
  updatedAt: number;
}

export interface InboxItem {
  id: string;
  kind: "question" | "escalation" | "budget";
  from: string;
  threadId: string | null;
  title: string;
  body: string;
  state: "open" | "resolved";
  createdAt: number;
}

/** The parts of an agent the CEO can change from the console. */
export interface AgentSettings {
  runtime: string;
  model: string;
  effort: string | null;
}

export interface ConfigVersion {
  v: number;
  at: number;
  by: string;
  summary: string;
  changes: string[];
  agent: string;
  before: AgentSettings;
  after: AgentSettings;
}

export interface OfficeEvent {
  seq: number;
  at: number;
  type: string;
  data: Record<string, unknown>;
}

export class OfficeError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}
