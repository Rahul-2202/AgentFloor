/**
 * An office's setup: what the CEO (or Ada) configures. Supabase holds it,
 * versioned; the policy engine is the only way it changes; the daemon gets the
 * part it runs on (OfficeConfig).
 */
import type { AgentDef, OfficeConfig, Policy, RoomDef } from "./types.ts";

export const DEFAULT_POLICY: Policy = {
  askDeadlineSec: 300,
  maxHops: 3,
  threadMaxMessages: 20,
  huddleMaxTurns: 10,
  ceoReach: "heads",
};

export interface RoomSetup extends RoomDef {
  /** One line: what the room is for. */
  purpose?: string;
  /** What the room owns. Config (not memory): it shapes routing and reviews. */
  responsibilities?: string;
  /** What "done" means for the room's work. */
  dod?: string;
  /** Its place on the floor plan. */
  slot?: number;
}

/** Spend limits per day, in US dollars of API-equivalent cost. */
export interface Budget {
  scope: "office" | "room" | "agent";
  /** Room or agent id; "" for the office. */
  id: string;
  /** Over this, the CEO gets an inbox warning. */
  dailyUsdSoft?: number | null;
  /** Over this, the agents in scope park their work and the CEO decides. */
  dailyUsdHard?: number | null;
}

export interface OfficeSetup {
  name: string;
  policy: Policy;
  rooms: RoomSetup[];
  agents: AgentDef[];
  budgets: Budget[];
}

/** The part of the setup the office daemon runs on. */
export function toDaemonConfig(s: OfficeSetup): OfficeConfig {
  return {
    name: s.name,
    policy: s.policy,
    rooms: s.rooms.map(({ id, name, head }) => ({ id, name, head })),
    agents: s.agents,
  };
}

/** A new office, until Ada's onboarding (M3) builds one with the CEO. */
export function defaultSetup(name: string): OfficeSetup {
  const agent = (id: string, nm: string, room: string, role: "head" | "member", title: string): AgentDef => ({
    id,
    name: nm,
    room,
    role,
    title,
    runtime: "claude-code",
    model: "haiku",
    effort: "low",
  });
  return {
    name,
    policy: { ...DEFAULT_POLICY },
    rooms: [
      { id: "dev", name: "Development", head: "pm", purpose: "Builds and ships the product", slot: 1 },
      { id: "marketing", name: "Marketing", head: "strategist", purpose: "Launches and tells the story", slot: 2 },
    ],
    agents: [
      agent("pm", "PM", "dev", "head", "Runs the Development room: plans work, owns priorities"),
      agent("backend", "Backend", "dev", "member", "APIs and databases"),
      agent("frontend", "Frontend", "dev", "member", "User interfaces"),
      agent("tester", "Tester", "dev", "member", "QA and regression"),
      agent("strategist", "Strategist", "marketing", "head", "Runs Marketing: launch plan and messaging"),
      agent("creator", "Creator", "marketing", "member", "Posts and case studies"),
    ],
    budgets: [{ scope: "office", id: "", dailyUsdSoft: 5, dailyUsdHard: 20 }],
  };
}
