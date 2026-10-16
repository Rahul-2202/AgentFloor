/**
 * The policy engine: the one way an office's setup changes, whether the CEO
 * clicks in the UI or Ada proposes it in chat. Structured operations are
 * applied to a copy of the setup, the result is validated, and the read-back
 * is written from the diff between the two setups, so what the CEO confirms
 * is exactly what changes. Ada can propose but never applies by herself.
 */
import { CATALOG } from "@agentfloor/shared/catalog";
import {
  ALWAYS_LOCKED,
  LEVELS,
  LOCK_TARGETS,
  PERMISSIONS,
  WHEN_BLOCKED,
  type Level,
  type LockTarget,
  type Permission,
  type PublishMode,
  type WhenBlocked,
} from "@agentfloor/shared/governance";
import type { Budget, OfficeSetup, RoomSetup } from "@agentfloor/shared/setup";
import type { AgentDef, Policy } from "@agentfloor/shared/types";

/** Runtimes offices can use in v1 (the others need Daytona network access we don't have). */
export const V1_RUNTIMES = ["claude-code"];
/** The floor plan has five team rooms (plus your office and the meeting room). */
export const MAX_ROOMS = 5;
/** The most agents a room's desks seat, head included. */
export const MAX_ROOM_AGENTS = 6;

type AgentFields = { name?: string; title?: string; runtime?: string; model?: string; effort?: string };

export type SetupOp =
  | { op: "rename_office"; name: string }
  | {
      op: "add_room";
      name: string;
      id?: string;
      purpose?: string;
      responsibilities?: string;
      dod?: string;
      head: AgentFields & { name: string; title: string; id?: string };
    }
  | { op: "update_room"; id: string; name?: string; purpose?: string; responsibilities?: string; dod?: string; head?: string }
  | { op: "remove_room"; id: string }
  | ({ op: "hire_agent"; room: string; name: string; title: string; id?: string } & AgentFields)
  | ({ op: "update_agent"; id: string; room?: string } & AgentFields)
  | { op: "remove_agent"; id: string }
  | { op: "set_policy"; policy: Partial<Policy> }
  | ({ op: "set_budget" } & Budget)
  /** Restores a whole earlier setup (rollback). */
  | { op: "restore"; setup: OfficeSetup; version: number }
  /** A whole new office (Ada's onboarding): rooms, agents, budgets and rules in one go. */
  | { op: "replace_setup"; setup: Omit<OfficeSetup, "locks" | "policy"> & Partial<Pick<OfficeSetup, "locks" | "policy">> }
  | { op: "set_permission"; scope: "room" | "agent"; id: string; permission: Permission; level: Level | null }
  | { op: "set_when_blocked"; room: string; policy: WhenBlocked }
  | { op: "set_publish"; room: string; mode: PublishMode }
  | { op: "lock"; target: LockTarget }
  /** CEO only, from the UI. */
  | { op: "unlock"; target: LockTarget };

/** Who's asking: the CEO (UI) or Ada (chat). Ada has the CEO's permissions, minus anything locked. */
export type Actor = "ceo" | "ada";

export interface Change {
  kind: "office" | "room" | "agent" | "policy" | "budget" | "lock";
  action: "add" | "remove" | "change";
  id: string;
  field?: string;
  from?: unknown;
  to?: unknown;
}

export interface Proposal {
  next: OfficeSetup;
  diff: Change[];
  readback: string[];
  summary: string;
}

export class PolicyError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(problems.join(" "));
    this.problems = problems;
  }
}

/** Works out what a set of operations would do. Throws PolicyError with every problem found. */
export function propose(current: OfficeSetup, ops: SetupOp[], actor: Actor = "ceo"): Proposal {
  if (!ops.length) throw new PolicyError(["Nothing to change."]);
  current = { ...current, locks: current.locks ?? [...ALWAYS_LOCKED] };
  const next = structuredClone(current);
  const problems: string[] = [];
  for (const op of ops) {
    try {
      if (op.op === "unlock" && actor !== "ceo") throw new Error("Only you can unlock a rule, in Rules and settings.");
      applyOp(next, op);
    } catch (err) {
      problems.push((err as Error).message);
    }
  }
  if (!problems.length) problems.push(...validate(next));
  if (problems.length) throw new PolicyError(problems);
  const diff = diffSetups(current, next);
  if (!diff.length) throw new PolicyError(["That's already how the office is set up."]);
  // Locked settings can't be changed from chat.
  if (actor === "ada") {
    const locked = [...new Set(diff.map(lockTargetOf).filter((t): t is LockTarget => !!t && current.locks.includes(t)))];
    if (locked.length) throw new PolicyError(locked.map((t) => `That's locked: ${LOCK_TARGETS[t].toLowerCase()}. Only the CEO can change it, in Rules and settings.`));
  }
  const restoring = ops.find((o) => o.op === "restore") as Extract<SetupOp, { op: "restore" }> | undefined;
  const readback = renderReadback(current, next, diff);
  const summary = restoring ? `Restore the setup from version ${restoring.version}` : readback[0]!;
  return { next, diff, readback, summary };
}

/* ----------------------------------------------------------------- ops */

function applyOp(s: OfficeSetup, op: SetupOp): void {
  switch (op.op) {
    case "rename_office":
      s.name = need(op.name, "The office needs a name.");
      return;

    case "add_room": {
      if (s.rooms.length >= MAX_ROOMS) throw new Error(`An office has at most ${MAX_ROOMS} rooms in v1.`);
      const id = op.id ?? uniqueId(op.name, s.rooms.map((r) => r.id));
      if (s.rooms.some((r) => r.id === id)) throw new Error(`There's already a room "${id}".`);
      const headId = op.head.id ?? uniqueId(op.head.name, s.agents.map((a) => a.id));
      const used = new Set(s.rooms.map((r) => r.slot));
      const slot = [1, 2, 3, 4, 5].find((n) => !used.has(n));
      s.rooms.push(clean({ id, name: need(op.name, "A room needs a name."), head: headId, purpose: op.purpose, responsibilities: op.responsibilities, dod: op.dod, slot }));
      s.agents.push(newAgent(headId, op.head, id, "head"));
      return;
    }

    case "update_room": {
      const room = findRoom(s, op.id);
      if (op.name !== undefined) room.name = need(op.name, "A room needs a name.");
      for (const k of ["purpose", "responsibilities", "dod"] as const) if (op[k] !== undefined) room[k] = op[k] || undefined;
      if (op.head && op.head !== room.head) {
        const next = findAgent(s, op.head);
        if (next.room !== room.id) throw new Error(`${next.name} isn't in ${room.name}; move them there first.`);
        const prev = s.agents.find((a) => a.id === room.head);
        if (prev) prev.role = "member";
        next.role = "head";
        room.head = next.id;
      }
      return;
    }

    case "remove_room": {
      const room = findRoom(s, op.id);
      s.rooms = s.rooms.filter((r) => r.id !== room.id);
      s.agents = s.agents.filter((a) => a.room !== room.id);
      s.budgets = s.budgets.filter((b) => !(b.scope === "room" && b.id === room.id));
      return;
    }

    case "hire_agent": {
      const room = findRoom(s, op.room);
      if (s.agents.filter((a) => a.room === room.id).length >= MAX_ROOM_AGENTS) throw new Error(`${room.name} is full: a room seats at most ${MAX_ROOM_AGENTS} agents.`);
      const id = op.id ?? uniqueId(op.name, s.agents.map((a) => a.id));
      if (s.agents.some((a) => a.id === id)) throw new Error(`There's already an agent "${id}".`);
      s.agents.push(newAgent(id, op, room.id, "member"));
      return;
    }

    case "update_agent": {
      const a = findAgent(s, op.id);
      if (op.name !== undefined) a.name = need(op.name, "An agent needs a name.");
      if (op.title !== undefined) a.title = op.title;
      if (op.room && op.room !== a.room) {
        const to = findRoom(s, op.room);
        if (s.agents.filter((x) => x.room === to.id).length >= MAX_ROOM_AGENTS) throw new Error(`${to.name} is full: a room seats at most ${MAX_ROOM_AGENTS} agents.`);
        if (a.role === "head") throw new Error(`${a.name} heads ${findRoom(s, a.room).name}; give the room a new head before moving them.`);
        a.room = to.id;
      }
      setRuntime(a, op);
      return;
    }

    case "remove_agent": {
      const a = findAgent(s, op.id);
      if (a.role === "head" && s.rooms.some((r) => r.head === a.id)) {
        throw new Error(`${a.name} heads ${findRoom(s, a.room).name}. Give the room a new head first, or remove the room.`);
      }
      s.agents = s.agents.filter((x) => x.id !== a.id);
      s.budgets = s.budgets.filter((b) => !(b.scope === "agent" && b.id === a.id));
      return;
    }

    case "set_policy": {
      const p = op.policy;
      const bounded = (k: keyof Policy, v: unknown, lo: number, hi: number) => {
        if (v === undefined) return;
        if (typeof v !== "number" || !Number.isInteger(v) || v < lo || v > hi) throw new Error(`${k} must be a whole number from ${lo} to ${hi}.`);
        (s.policy as unknown as Record<string, unknown>)[k] = v;
      };
      bounded("askDeadlineSec", p.askDeadlineSec, 30, 86_400);
      bounded("maxHops", p.maxHops, 0, 10);
      bounded("threadMaxMessages", p.threadMaxMessages, 2, 200);
      bounded("huddleMaxTurns", p.huddleMaxTurns, 2, 100);
      if (p.ceoReach !== undefined) {
        if (p.ceoReach !== "anyone" && p.ceoReach !== "heads") throw new Error(`ceoReach is "anyone" or "heads".`);
        s.policy.ceoReach = p.ceoReach;
      }
      return;
    }

    case "set_budget": {
      if (op.scope === "room") findRoom(s, op.id);
      if (op.scope === "agent") findAgent(s, op.id);
      const id = op.scope === "office" ? "" : op.id;
      for (const k of ["dailyUsdSoft", "dailyUsdHard"] as const) {
        const v = op[k];
        if (v != null && (typeof v !== "number" || v < 0 || v > 10_000)) throw new Error(`${k} must be between 0 and 10000 dollars.`);
      }
      if (op.dailyUsdSoft != null && op.dailyUsdHard != null && op.dailyUsdSoft > op.dailyUsdHard) {
        throw new Error("The warning limit has to be below the hard limit.");
      }
      s.budgets = s.budgets.filter((b) => !(b.scope === op.scope && b.id === id));
      if (op.dailyUsdSoft != null || op.dailyUsdHard != null) s.budgets.push(clean({ scope: op.scope, id, dailyUsdSoft: op.dailyUsdSoft ?? null, dailyUsdHard: op.dailyUsdHard ?? null }));
      return;
    }

    case "restore":
      Object.assign(s, structuredClone(op.setup));
      s.locks ??= [...ALWAYS_LOCKED];
      return;

    case "replace_setup": {
      const n = structuredClone(op.setup);
      if (n.rooms.length > MAX_ROOMS) throw new Error(`An office has at most ${MAX_ROOMS} rooms in v1.`);
      n.rooms.forEach((r, i) => (r.slot ??= i + 1));
      for (const r of n.rooms) {
        if (n.agents.filter((a) => a.room === r.id).length > MAX_ROOM_AGENTS) throw new Error(`${r.name} has too many agents: a room seats at most ${MAX_ROOM_AGENTS}.`);
      }
      for (const a of n.agents) {
        a.runtime ||= "claude-code";
        a.title ??= "";
        setRuntime(a, { runtime: a.runtime, model: a.model, effort: a.effort });
      }
      s.name = need(n.name, "The office needs a name.");
      s.rooms = n.rooms;
      s.agents = n.agents;
      s.budgets = n.budgets ?? s.budgets;
      if (n.policy) Object.assign(s.policy, n.policy);
      s.locks = [...new Set([...ALWAYS_LOCKED, ...(n.locks ?? s.locks ?? [])])];
      return;
    }

    case "set_permission": {
      if (!PERMISSIONS.some((p) => p.id === op.permission)) throw new Error(`There's no permission "${op.permission}".`);
      if (op.level !== null && !LEVELS.includes(op.level)) throw new Error(`A permission is free, ask or never.`);
      const target = op.scope === "room" ? findRoom(s, op.id) : findAgent(s, op.id);
      const perms = { ...(target.permissions ?? {}) };
      if (op.level === null) delete perms[op.permission];
      else perms[op.permission] = op.level;
      target.permissions = Object.keys(perms).length ? perms : undefined;
      if (!target.permissions) delete target.permissions;
      return;
    }

    case "set_when_blocked":
      if (!(op.policy in WHEN_BLOCKED)) throw new Error(`When blocked is one of: ${Object.keys(WHEN_BLOCKED).join(", ")}.`);
      findRoom(s, op.room).whenBlocked = op.policy;
      return;

    case "set_publish":
      if (op.mode !== "drafts" && op.mode !== "direct") throw new Error(`Publishing is "drafts" or "direct".`);
      findRoom(s, op.room).publish = op.mode;
      return;

    case "lock":
      if (!(op.target in LOCK_TARGETS)) throw new Error(`There's no rule "${op.target}" to lock.`);
      s.locks = [...new Set([...(s.locks ?? []), op.target])];
      return;

    case "unlock":
      if (ALWAYS_LOCKED.includes(op.target)) throw new Error(`"${LOCK_TARGETS[op.target]}" is always locked.`);
      s.locks = (s.locks ?? []).filter((t) => t !== op.target);
      return;
  }
}

/** Which locked setting a change touches, if any. */
function lockTargetOf(c: Change): LockTarget | null {
  if (c.kind === "budget") return "budgets";
  if (c.kind === "policy") return "protocol";
  if (c.kind === "lock") return c.action === "remove" ? (c.id as LockTarget) : null;
  if (c.field === "permissions") return "permissions";
  if (c.field === "whenBlocked") return "when_blocked";
  if (c.field === "publish") return "publish";
  return null;
}

function newAgent(id: string, f: AgentFields & { name: string; title: string }, room: string, role: "head" | "member"): AgentDef {
  const a: AgentDef = { id, name: need(f.name, "An agent needs a name."), room, role, title: f.title ?? "", runtime: "claude-code" };
  setRuntime(a, { runtime: f.runtime ?? "claude-code", model: f.model, effort: f.effort });
  return a;
}

/** Runtime, model and effort, checked against the catalog; a runtime switch takes its defaults. */
function setRuntime(a: AgentDef, f: AgentFields): void {
  const runtime = f.runtime ?? a.runtime;
  if (!V1_RUNTIMES.includes(runtime)) throw new Error(`Agents run on ${V1_RUNTIMES.map((r) => CATALOG[r]?.label ?? r).join(" or ")} for now, not "${runtime}".`);
  const info = CATALOG[runtime]!;
  const switching = runtime !== a.runtime || !a.model;
  const model = f.model ?? (switching ? info.defaultModel : a.model!);
  if (!info.models.some((m) => m.id === model)) throw new Error(`${info.label} has no model "${model}"; choose ${info.models.map((m) => m.id).join(", ")}.`);
  const effort = f.effort ?? (switching ? info.defaultEffort ?? undefined : a.effort);
  if (info.efforts.length && (!effort || !info.efforts.includes(effort))) throw new Error(`Effort is one of ${info.efforts.join(", ")}.`);
  Object.assign(a, { runtime, model, effort: info.efforts.length ? effort : undefined });
}

function validate(s: OfficeSetup): string[] {
  const problems: string[] = [];
  for (const r of s.rooms) {
    const head = s.agents.find((a) => a.id === r.head);
    if (!head || head.room !== r.id || head.role !== "head") problems.push(`${r.name} needs a head who works in it.`);
  }
  for (const a of s.agents) {
    if (!s.rooms.some((r) => r.id === a.room)) problems.push(`${a.name} is in a room that doesn't exist.`);
    if (a.role === "head" && !s.rooms.some((r) => r.head === a.id)) a.role = "member";
  }
  const ids = s.agents.map((a) => a.id);
  if (new Set(ids).size !== ids.length) problems.push("Two agents have the same id.");
  return problems;
}

/* ---------------------------------------------------------------- diff */

const ROOM_FIELDS = ["name", "head", "purpose", "responsibilities", "dod", "permissions", "whenBlocked", "publish"] as const;
const AGENT_FIELDS = ["name", "title", "room", "role", "runtime", "model", "effort", "permissions"] as const;
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function diffSetups(a: OfficeSetup, b: OfficeSetup): Change[] {
  const out: Change[] = [];
  if (a.name !== b.name) out.push({ kind: "office", action: "change", id: "", field: "name", from: a.name, to: b.name });

  const byId = <T extends { id: string }>(xs: T[]) => new Map(xs.map((x) => [x.id, x]));
  for (const [kind, before, after, fields] of [
    ["room", byId(a.rooms), byId(b.rooms), ROOM_FIELDS],
    ["agent", byId(a.agents), byId(b.agents), AGENT_FIELDS],
  ] as const) {
    for (const [id, x] of after) {
      const old = before.get(id);
      if (!old) out.push({ kind, action: "add", id, to: x });
      else
        for (const f of fields) {
          const from = (old as unknown as Record<string, unknown>)[f] ?? null;
          const to = (x as unknown as Record<string, unknown>)[f] ?? null;
          if (!same(from, to)) out.push({ kind, action: "change", id, field: f, from, to });
        }
    }
    for (const [id, x] of before) if (!after.has(id)) out.push({ kind, action: "remove", id, from: x });
  }

  for (const k of Object.keys(b.policy) as (keyof Policy)[]) {
    if (a.policy[k] !== b.policy[k]) out.push({ kind: "policy", action: "change", id: "", field: k, from: a.policy[k], to: b.policy[k] });
  }

  const key = (x: Budget) => `${x.scope}:${x.id}`;
  const ba = new Map(a.budgets.map((x) => [key(x), x]));
  const bb = new Map(b.budgets.map((x) => [key(x), x]));
  for (const [k, x] of bb) {
    const old = ba.get(k);
    if (!old || old.dailyUsdSoft !== x.dailyUsdSoft || old.dailyUsdHard !== x.dailyUsdHard) {
      out.push({ kind: "budget", action: old ? "change" : "add", id: k, from: old ?? null, to: x });
    }
  }
  for (const [k, x] of ba) if (!bb.has(k)) out.push({ kind: "budget", action: "remove", id: k, from: x });

  const la = new Set(a.locks ?? []);
  const lb = new Set(b.locks ?? []);
  for (const t of lb) if (!la.has(t)) out.push({ kind: "lock", action: "add", id: t });
  for (const t of la) if (!lb.has(t)) out.push({ kind: "lock", action: "remove", id: t });
  return out;
}

/* ------------------------------------------------------------ read-back */

const POLICY_LABELS: Record<keyof Policy, (v: unknown) => string> = {
  askDeadlineSec: (v) => `Unanswered questions escalate after ${duration(Number(v))}`,
  maxHops: (v) => `A question can lead to at most ${v} follow-up questions down a chain`,
  threadMaxMessages: (v) => `A conversation goes to you after ${v} messages`,
  huddleMaxTurns: (v) => `A huddle ends after ${v} turns without agreement`,
  ceoReach: (v) => (v === "anyone" ? "Any agent can ask you directly" : "Only heads ask you directly; members go through their head"),
};

/** Plain-language lines the CEO confirms, written from the diff. */
export function renderReadback(before: OfficeSetup, after: OfficeSetup, diff: Change[]): string[] {
  const lines: string[] = [];
  const agentName = (id: string) => after.agents.find((a) => a.id === id)?.name ?? before.agents.find((a) => a.id === id)?.name ?? id;
  const roomName = (id: string) => after.rooms.find((r) => r.id === id)?.name ?? before.rooms.find((r) => r.id === id)?.name ?? id;
  const runtimeLine = (a: AgentDef) =>
    `${CATALOG[a.runtime]?.label ?? a.runtime}, ${CATALOG[a.runtime]?.models.find((m) => m.id === a.model)?.label ?? a.model}${a.effort ? `, ${a.effort} effort` : ""}`;
  const addedRooms = new Set(diff.filter((c) => c.kind === "room" && c.action === "add").map((c) => c.id));
  const removedRooms = new Set(diff.filter((c) => c.kind === "room" && c.action === "remove").map((c) => c.id));

  for (const c of diff) {
    if (c.kind === "office") lines.push(`Rename the office to "${c.to}" (was "${c.from}").`);
    if (c.kind === "room") {
      const r = (c.to ?? c.from) as RoomSetup;
      if (c.action === "add") lines.push(`Open a new room, ${r.name}${r.purpose ? `: ${r.purpose}` : ""}, headed by ${agentName(r.head)}.`);
      else if (c.action === "remove") {
        const gone = before.agents.filter((a) => a.room === c.id).map((a) => a.name);
        lines.push(`Close ${r.name}${gone.length ? ` and let go ${list(gone)}` : ""}. Their threads and tasks stay in the log.`);
      } else if (c.field === "head") lines.push(`${agentName(String(c.to))} becomes head of ${roomName(c.id)} (was ${agentName(String(c.from))}).`);
      else if (c.field === "name") lines.push(`Rename the room ${c.from} to ${c.to}.`);
      else if (c.field === "permissions") lines.push(...permissionLines(roomName(c.id), "everyone in it", c.from, c.to));
      else if (c.field === "whenBlocked") lines.push(`When someone in ${roomName(c.id)} is blocked, they ${WHEN_BLOCKED[c.to as WhenBlocked]}.`);
      else if (c.field === "publish") lines.push(c.to === "direct" ? `${roomName(c.id)} opens PRs ready for review, not as drafts.` : `${roomName(c.id)} opens PRs as drafts for you to review first.`);
      else lines.push(`${roomName(c.id)}: ${fieldLabel(c.field!)} becomes "${c.to ?? "nothing"}".`);
    }
    if (c.kind === "agent") {
      const a = (c.action === "remove" ? c.from : after.agents.find((x) => x.id === c.id)) as AgentDef;
      if (c.action === "add") {
        if (addedRooms.has(a.room) && a.role === "head") continue; // said with the room
        lines.push(`Hire ${a.name} into ${roomName(a.room)}${a.title ? ` as ${a.title}` : ""}, on ${runtimeLine(a)}.`);
      } else if (c.action === "remove") {
        if (removedRooms.has(a.room)) continue;
        lines.push(`Let go ${a.name} from ${roomName(a.room)}. Their threads and tasks stay in the log; open work goes back to ${agentName(before.rooms.find((r) => r.id === a.room)?.head ?? "")}.`);
      } else if (c.field === "role") continue; // said with the head change
      else if (c.field === "room") lines.push(`Move ${a.name} from ${roomName(String(c.from))} to ${roomName(String(c.to))}; work for them now goes through ${agentName(after.rooms.find((r) => r.id === a.room)!.head)}.`);
      else if (c.field === "runtime") lines.push(`${a.name} switches to ${runtimeLine(a)}. It starts a fresh session; its memory and office threads carry over.`);
      else if (c.field === "model" || c.field === "effort") {
        if (diff.some((d) => d.kind === "agent" && d.id === c.id && d.field === "runtime")) continue;
        if (c.field === "effort" && diff.some((d) => d.kind === "agent" && d.id === c.id && d.field === "model")) continue;
        lines.push(`${a.name} runs on ${runtimeLine(a)} (was ${c.field === "model" ? c.from : `${c.from} effort`}). Its next turn uses the new setting.`);
      } else if (c.field === "permissions") lines.push(...permissionLines(a.name, a.name, c.from, c.to));
      else lines.push(`${a.name}: ${fieldLabel(c.field!)} becomes "${c.to}".`);
    }
    if (c.kind === "policy") lines.push(`${POLICY_LABELS[c.field as keyof Policy](c.to)} (was ${policyValue(c.field as keyof Policy, c.from)}).`);
    if (c.kind === "lock") {
      lines.push(c.action === "add" ? `Lock: ${LOCK_TARGETS[c.id as LockTarget].toLowerCase()} can't be changed from chat until you unlock it.` : `Unlock: ${LOCK_TARGETS[c.id as LockTarget].toLowerCase()} can be changed from chat again.`);
    }
    if (c.kind === "budget") {
      const b = (c.to ?? c.from) as Budget;
      const who = b.scope === "office" ? "the whole office" : b.scope === "room" ? roomName(b.id) : agentName(b.id);
      if (c.action === "remove") lines.push(`Remove the daily budget for ${who}.`);
      else {
        const parts = [b.dailyUsdSoft != null ? `warn you over $${b.dailyUsdSoft}` : "", b.dailyUsdHard != null ? `park the work over $${b.dailyUsdHard}` : ""].filter(Boolean);
        lines.push(`Daily budget for ${who}: ${parts.join(", and ")} (API-equivalent cost).`);
      }
    }
  }
  return lines;
}

/* ------------------------------------------------------------- helpers */

function findRoom(s: OfficeSetup, id: string): RoomSetup {
  const r = s.rooms.find((x) => x.id === id);
  if (!r) throw new Error(`There's no room "${id}".`);
  return r;
}

function findAgent(s: OfficeSetup, id: string): AgentDef {
  const a = s.agents.find((x) => x.id === id);
  if (!a) throw new Error(`There's no agent "${id}".`);
  return a;
}

function need(v: string | undefined, message: string): string {
  const t = v?.trim();
  if (!t) throw new Error(message);
  return t;
}

const RESERVED = new Set(["ceo", "office", "all", "ada"]);

/** A lowercase id from a name, unique among `taken`. */
export function uniqueId(name: string, taken: string[]): string {
  const base = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/^(?=\d)/, "a-").slice(0, 24) || "agent";
  let id = RESERVED.has(base) ? `${base}-1` : base;
  for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`;
  return id;
}

function clean<T extends object>(o: T): T {
  for (const k of Object.keys(o)) if ((o as Record<string, unknown>)[k] === undefined) delete (o as Record<string, unknown>)[k];
  return o;
}

function list(xs: string[]): string {
  return xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;
}

function duration(sec: number): string {
  return sec < 120 ? `${sec} seconds` : sec < 7200 ? `${Math.round(sec / 60)} minutes` : `${Math.round(sec / 360) / 10} hours`;
}

const LEVEL_WORDS: Record<Level, string> = { free: "can", ask: "must ask you before they", never: "can never" };

/** One line per permission that changed: "Backend must ask you before they reach the internet." */
function permissionLines(scope: string, who: string, from: unknown, to: unknown): string[] {
  const a = (from ?? {}) as Partial<Record<Permission, Level>>;
  const b = (to ?? {}) as Partial<Record<Permission, Level>>;
  return PERMISSIONS.filter((p) => a[p.id] !== b[p.id]).map((p) =>
    b[p.id] ? `${who === scope ? scope : `${scope}: ${who}`} ${LEVEL_WORDS[b[p.id]!]} ${p.label.toLowerCase()}.` : `${scope}: ${p.label.toLowerCase()} goes back to the ${scope === who ? "room's" : "default"} setting.`,
  );
}

function policyValue(k: keyof Policy, v: unknown): string {
  if (k === "askDeadlineSec") return duration(Number(v));
  if (k === "ceoReach") return v === "anyone" ? "anyone" : "heads only";
  return String(v);
}

function fieldLabel(f: string): string {
  return { purpose: "purpose", responsibilities: "responsibilities", dod: "definition of done", title: "job", name: "name" }[f] ?? f;
}
