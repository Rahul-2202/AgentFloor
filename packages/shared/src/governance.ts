/**
 * Who may do what, and the rules that can't be changed from chat.
 */
import type { AgentDef, OfficeConfig, RoomDef } from "./types.ts";

export type Permission = "push" | "open_pr" | "network" | "outside_worktree" | "close_tickets";
/** free: just do it. ask: the CEO approves each time. never: refused. */
export type Level = "free" | "ask" | "never";

export interface PermissionInfo {
  id: Permission;
  label: string;
  /** What it covers, for the permissions grid and read-backs. */
  covers: string;
  default: Level;
  /** Powerful: the first use asks the CEO even when it's free. */
  powerful: boolean;
}

export const PERMISSIONS: PermissionInfo[] = [
  { id: "push", label: "Push branches", covers: "git push to the office repo (never to the default branch)", default: "free", powerful: true },
  { id: "open_pr", label: "Open pull requests", covers: "open and update PRs on the office repo", default: "free", powerful: false },
  { id: "network", label: "Reach the internet", covers: "downloads and web requests from the shell (npm install, curl, ...)", default: "free", powerful: true },
  { id: "outside_worktree", label: "Work outside its folder", covers: "read, write or run commands outside its own working folder", default: "never", powerful: true },
  { id: "close_tickets", label: "Close tickets", covers: "close or cancel Linear issues", default: "ask", powerful: false },
];

export const PERMISSION_IDS = PERMISSIONS.map((p) => p.id);
export const LEVELS: Level[] = ["free", "ask", "never"];

export type WhenBlocked = "park_and_switch" | "best_guess_and_flag" | "stop_and_wait";
export const WHEN_BLOCKED: Record<WhenBlocked, string> = {
  park_and_switch: "park the blocked task, say what you need, and switch to other work",
  best_guess_and_flag: "make your best guess, carry on, and flag the guess clearly so it can be checked",
  stop_and_wait: "stop and wait for an answer before doing more on it",
};

/** drafts: PRs open as drafts for the CEO to review. direct: ready for review straight away. */
export type PublishMode = "drafts" | "direct";

/** Settings that can be locked. "merge" (only the CEO merges) is always locked. */
export type LockTarget = "merge" | "permissions" | "budgets" | "protocol" | "when_blocked" | "publish";
export const LOCK_TARGETS: Record<LockTarget, string> = {
  merge: "Only the CEO merges pull requests",
  permissions: "Agents' and rooms' permissions",
  budgets: "Daily budgets",
  protocol: "How the office talks (escalation times, message limits, who reaches the CEO)",
  when_blocked: "Each room's when-blocked policy",
  publish: "Whether work is published directly or as drafts",
};
export const ALWAYS_LOCKED: LockTarget[] = ["merge"];

/** The level that applies to an agent: its own setting, then its room's, then the default. */
export function levelFor(agent: Pick<AgentDef, "permissions" | "room">, rooms: Pick<RoomDef, "id" | "permissions">[], p: Permission): Level {
  return agent.permissions?.[p] ?? rooms.find((r) => r.id === agent.room)?.permissions?.[p] ?? PERMISSIONS.find((x) => x.id === p)!.default;
}

export function roomOf(config: OfficeConfig, agentId: string): RoomDef | undefined {
  const a = config.agents.find((x) => x.id === agentId);
  return a ? config.rooms.find((r) => r.id === a.room) : undefined;
}
