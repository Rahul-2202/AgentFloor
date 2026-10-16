/**
 * The office's real data, in the shapes the pixel office (ported from the
 * demo) reads. Pure: the store calls it whenever the data changes.
 *
 * Rooms take the demo's five team-room slots in order (dev, marketing, sales,
 * legal, finance); the head sits at the slot's head desk, members at its
 * other desks, anyone beyond that at the room's spare spots. Agents never
 * wander: where they stand comes from what they're really doing.
 */
import { LOCK_TARGETS, PERMISSIONS, levelFor, type Level, type LockTarget } from "@agentfloor/shared/governance";
import type { OfficeSetupView } from "@/lib/api";
import { SPOTS } from "@/office/layout";
import type { AgentRow, InboxRow, RoomRow, MeetingRow, MemoryRow, MessageRow, OfficeData, TaskRow, ThreadRow } from "@/lib/office-data";
import type { AgentStatus } from "@/office/types";
import type {
  AgentConfig,
  AgentLive,
  CalEvent,
  ChatMsg,
  Conversation,
  InboxItem,
  LockedRule,
  MemItem,
  Output,
  PermKey,
  RoomConfig,
  Task,
  TaskState,
  Version,
  WhenBlocked,
} from "./types";

/** The demo floor's team-room slots, in the order rooms take them. */
export const SLOTS = ["dev", "marketing", "sales", "legal", "finance"] as const;

/** Desks per slot, head desk first; then spare spots for anyone beyond the desks. */
const DESKS: Record<string, string[]> = {
  dev: ["seat:pm", "seat:fe", "seat:be", "seat:ops", "seat:qa", "seat:priya", "seat:sam"],
  marketing: ["seat:strat", "seat:cr1", "seat:cr2", "seat:editor", "seat:marco", "seat:lena"],
  sales: ["seat:lead", "seat:sdr", "seat:res"],
  legal: ["seat:counsel", "seat:reviewer", "seat:para"],
  finance: ["seat:ctrl", "seat:book", "seat:analyst"],
};
const SPARE: Record<string, string[]> = {
  dev: ["dev:huddleL", "dev:huddleR", "dev:new", "dev:new2", "dev:front"],
  marketing: ["mkt:brief", "mkt:beside-ed", "mkt:new", "mkt:new2"],
  sales: ["sales:new", "sales:new2", "sales:new3"],
  legal: ["legal:new", "legal:new2", "legal:new3"],
  finance: ["fin:new", "fin:new2", "fin:new3"],
};
const MEETING_SEATS = ["mt:t2", "mt:b2", "mt:t1", "mt:b1", "mt:t3", "mt:b3"];

export interface Layout {
  /** Real room id → its slot on the floor. */
  slotOf: Record<string, string>;
  /** Slot → real room id. */
  roomIn: Record<string, string>;
  /** Agent id → its desk (or spare spot). */
  homes: Record<string, string>;
}

export function layoutOf(setup: OfficeSetupView | null, rows: RoomRow[]): Layout {
  const slotOf: Record<string, string> = {};
  const roomIn: Record<string, string> = {};
  const homes: Record<string, string> = { ada: "ada:home" };
  if (!setup) return { slotOf, roomIn, homes };
  const slotNo = (id: string) => rows.find((r) => r.id === id)?.slot ?? 99;
  const rooms = [...setup.rooms].sort((a, b) => slotNo(a.id) - slotNo(b.id));
  for (const r of rooms) {
    const want = slotNo(r.id);
    const slot = (want >= 1 && SLOTS[want - 1] && !roomIn[SLOTS[want - 1]] ? SLOTS[want - 1] : SLOTS.find((x) => !roomIn[x])) ?? null;
    if (!slot) continue; // more rooms than the floor has (the policy engine caps it)
    slotOf[r.id] = slot;
    roomIn[slot] = r.id;
    const people = setup.agents.filter((a) => a.room === r.id).sort((a, b) => (a.id === r.head ? -1 : b.id === r.head ? 1 : 0));
    const spots = [...DESKS[slot], ...SPARE[slot]];
    people.forEach((a, i) => (homes[a.id] = spots[i] ?? `hall:mid`));
  }
  return { slotOf, roomIn, homes };
}

/* ---------------------------------------------------------------- inputs */

export interface RealInputs {
  setup: OfficeSetupView | null;
  version: number;
  versions: { v: number; by: string; summary: string; readback: string[]; createdAt: string }[];
  data: OfficeData;
  spend: { agentId: string; costUsd: number }[];
  /** Live "thinking" per agent (from the office's live stream). */
  activity: Record<string, string | null>;
  /** Recent messages, shown as speech bubbles for a few seconds. */
  bubbles: Record<string, string>;
  ada: { role: "ceo" | "ada"; content: string; cards: { id: string; readback: string[]; summary: string; state: string; version?: number }[]; created_at: string }[];
  /** When agents last asked someone something (they walk over for a moment). */
  visits: Record<string, string>;
}

const WHEN: Record<string, WhenBlocked> = { park_and_switch: "park", best_guess_and_flag: "guess", stop_and_wait: "wait" };
const MODEL_LABEL: Record<string, string> = { haiku: "Claude Haiku", sonnet: "Claude Sonnet", opus: "Claude Opus" };

export const time = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "");
const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString([], { weekday: "short" }) : "");
export const when = (iso: string | null | undefined) => (iso ? `${day(iso)} ${time(iso)}` : "");

/* ------------------------------------------------------------------ build */

export function buildState(i: RealInputs, layout: Layout) {
  const { setup, data } = i;
  const agents = setup?.agents ?? [];
  const rowOf = new Map<string, AgentRow>(data.agents.map((a) => [a.id, a]));
  const spentOf = (id: string) => i.spend.filter((x) => x.agentId === id).reduce((n, x) => n + x.costUsd, 0);
  const budgetOf = (id: string) => setup?.budgets.find((b) => b.scope === "agent" && b.id === id)?.dailyUsdHard ?? 0;

  // Who's where: a live meeting, a visit (asking someone), a huddle, or their desk.
  const live: Record<string, AgentLive> = {};
  const liveMeeting = data.meetings.find((m) => m.state === "live");
  const queued = new Map<string, number>();
  for (const m of data.messages) if (m.to !== "ceo" && (m as MessageRow & { state?: string }).state === "queued") queued.set(m.to, (queued.get(m.to) ?? 0) + 1);
  const openTasks = data.tasks.filter((t) => t.status !== "done");

  for (const a of agents) {
    const row = rowOf.get(a.id);
    const task = openTasks.filter((t) => t.owner_id === a.id).sort((x, y) => y.updated_at.localeCompare(x.updated_at))[0];
    const meetingSeat = liveMeeting?.attendees.includes(a.id) ? MEETING_SEATS[liveMeeting.attendees.indexOf(a.id) % MEETING_SEATS.length] : null;
    const visit = i.visits[a.id]?.startsWith("beside:") ? SPOTS[i.visits[a.id]!.slice(7)] : undefined;
    const at: AgentLive["at"] = meetingSeat ?? (visit ? [visit[0] + 1.2, visit[1] + 0.6] : undefined) ?? layout.homes[a.id] ?? "hall:mid";
    let status: AgentStatus = "idle";
    if (row?.held_reason || row?.status === "stopped" || row?.status === "offline") status = "away";
    else if (meetingSeat) status = "meeting";
    else if (i.activity[a.id]) status = "thinking";
    else if (task?.status === "blocked") status = "blocked";
    else if (row?.status === "working") status = "working";
    live[a.id] = {
      at,
      status,
      taskId: task?.id,
      step: row?.held_reason ? `On hold: ${row.held_reason}` : (row?.activity ?? task?.step ?? undefined) || undefined,
      upNext: openTasks.filter((t) => t.owner_id === a.id && t.id !== task?.id).slice(0, 2).map((t) => t.id),
      paused: !!row?.held_reason,
      bubble: i.bubbles[a.id] ?? null,
      emote: task?.status === "blocked" ? "!" : null,
      queued: queued.get(a.id) ?? 0,
    };
  }
  live.ada = { at: "ada:home", status: "idle", upNext: [], queued: 0, bubble: i.bubbles.ada ?? null };

  // Agents' settings.
  const configs: Record<string, AgentConfig> = {};
  for (const a of agents) {
    const perms = Object.fromEntries(PERMISSIONS.map((p) => [p.id, levelFor(a as never, (setup?.rooms ?? []) as never, p.id)])) as Record<PermKey, Level>;
    const room = setup?.rooms.find((r) => r.id === a.room);
    configs[a.id] = {
      id: a.id,
      runtime: "Claude Code",
      model: MODEL_LABEL[a.model ?? "haiku"] ?? a.model ?? "Claude Haiku",
      roleCard: a.title,
      tools: ["GitHub", "Office memory"],
      permissions: perms,
      budget: budgetOf(a.id),
      spent: spentOf(a.id),
      whenBlocked: WHEN[room?.whenBlocked ?? "park_and_switch"] ?? "park",
      autonomy: 3,
      hours: "Always on",
    };
  }

  // Rooms, keyed by their slot on the floor.
  const rooms: Record<string, RoomConfig> = {};
  for (const r of setup?.rooms ?? []) {
    const slot = layout.slotOf[r.id];
    if (!slot) continue;
    const members = agents.filter((a) => a.room === r.id).map((a) => a.id);
    const roomBudget = setup?.budgets.find((b) => b.scope === "room" && b.id === r.id)?.dailyUsdHard ?? 0;
    rooms[slot] = {
      id: slot,
      realId: r.id,
      purpose: r.purpose,
      name: r.name,
      head: r.head,
      members,
      responsibilities: r.responsibilities ? r.responsibilities.split(/\n|; /).filter(Boolean) : [],
      dod: r.dod ?? "",
      outputs: ["Pull requests"],
      tools: ["GitHub"],
      budget: roomBudget,
      spent: members.reduce((n, id) => n + spentOf(id), 0),
      convBudget: setup?.policy.threadMaxMessages as number,
      whenBlocked: WHEN[r.whenBlocked ?? "park_and_switch"] ?? "park",
      publishing: r.publish === "direct" ? "direct" : "drafts",
      merge: "approval",
      norms: [],
      channel: `room:${slot}`,
      reportsTo: "ceo",
    };
  }

  const locks = new Set(setup?.locks ?? ["merge"]);
  const locked: LockedRule[] = (Object.keys(LOCK_TARGETS) as LockTarget[]).map((t) => ({ id: t, text: LOCK_TARGETS[t], locked: locks.has(t) }));

  const slotOfRoom = (realRoom: string | null | undefined) => (realRoom ? layout.slotOf[realRoom] ?? realRoom : "dev");
  const tasks: Task[] = data.tasks.map((t) => toTask(t, slotOfRoom(t.room_id)));
  const outputs: Output[] = data.tasks.flatMap((t) => toOutputs(t, slotOfRoom(t.room_id), data.audit));
  const calendar: CalEvent[] = data.meetings.map(toEvent);
  const conversations: Conversation[] = toConversations(data.threads, data.messages, layout, agents);
  const memory: MemItem[] = data.memory.map((m) => toMem(m, layout));
  const inbox: InboxItem[] = data.inbox.map(toInbox);
  const versions: Version[] = i.versions.map((v) => ({ v: v.v, at: when(v.createdAt), who: v.by === "ceo" ? "You" : v.by === "ada" ? "Ada" : "Office", summary: v.summary, changes: v.readback, snapshot: { configs: {}, rooms: {}, locked: [] } }));

  // Ada's chat (and the CEO's direct threads with agents) as chat windows.
  const chats: Record<string, ChatMsg[]> = { ada: i.ada.map((m, n) => toChat(m, n)) };
  for (const t of data.threads.filter((x) => x.participants.includes("ceo") && x.kind === "message")) {
    const other = t.participants.find((p) => p !== "ceo" && p !== "office");
    if (!other) continue;
    for (const m of dedup(data.messages.filter((x) => x.thread_id === t.id))) {
      (chats[other] ??= []).push({ id: m.id, from: m.from === "ceo" ? "you" : m.from === other ? "agent" : "system", text: m.body, t: time(m.created_at) });
    }
  }
  for (const k of Object.keys(chats)) if (k !== "ada") chats[k]!.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));

  return { live, configs, rooms, locked, tasks, outputs, calendar, conversations, memory, inbox, versions, chats };
}

/* --------------------------------------------------------------- mappers */

const STATE: Record<string, TaskState> = { queued: "queued", ongoing: "ongoing", blocked: "blocked", review: "review", done: "done" };

function toTask(t: TaskRow, room: string): Task {
  return {
    id: t.id,
    key: t.id,
    title: t.title,
    room,
    owner: t.owner_id,
    state: STATE[t.status] ?? "queued",
    progress: t.progress,
    step: t.step ?? undefined,
    priority: "P2",
    due: "",
    dod: t.definition_of_done ?? undefined,
    source: t.created_by === "ceo" ? "you" : t.created_by === "ada" ? "ada" : "head",
    updates: [
      ...(t.note ? [{ t: time(t.updated_at), who: t.owner_id, text: t.note }] : []),
      ...(t.blocker ? [{ t: time(t.updated_at), who: t.owner_id, text: `Blocked: ${t.blocker}` }] : []),
    ],
    blocker: t.blocker ?? undefined,
    outputs: t.outputs.map((o, n) => outputId(t, n)),
    subtasks: t.checklist.map((c) => ({ title: c.text, done: c.done })),
  };
}

const outputId = (t: TaskRow, n: number) => `${t.id}:${n}`;

function toOutputs(t: TaskRow, room: string, audit: OfficeData["audit"]): Output[] {
  return t.outputs.map((o, n) => {
    const pr = o.kind === "pr" ? /\/pull\/(\d+)/.exec(o.url ?? "")?.[1] : undefined;
    const merged = pr ? audit.some((a) => (a.action === "pr.merged" || a.action === "pr.closed.merged") && a.target === `#${pr}`) : false;
    return {
      id: outputId(t, n),
      kind: o.kind === "pr" ? "pr" : o.kind === "file" ? "report" : "design",
      title: o.title,
      by: t.owner_id,
      room,
      at: when(t.updated_at),
      status: merged ? "merged" : t.status === "done" ? "approved" : "review",
      viewed: false,
      taskId: t.id,
      summary: t.definition_of_done ? `For “${t.title}”. Done means: ${t.definition_of_done}` : `For “${t.title}”.`,
      url: o.url,
      pr: pr ? Number(pr) : undefined,
    };
  });
}

function toEvent(m: MeetingRow): CalEvent {
  const at = new Date(m.created_at);
  const wd = (at.getDay() + 6) % 7; // Mon = 0
  const start = `${String(at.getHours()).padStart(2, "0")}:${at.getMinutes() < 30 ? "00" : "30"}`;
  const endH = at.getHours() + (at.getMinutes() < 30 ? 0 : 1);
  return {
    id: m.id,
    title: m.title,
    day: Math.min(4, wd),
    start,
    end: `${String(endH).padStart(2, "0")}:${at.getMinutes() < 30 ? "30" : "00"}`,
    kind: m.requested_by === "ceo" ? "ceo" : "request",
    attendees: ["you", ...m.attendees],
    organizer: m.chair === "ada" ? "ada" : "you",
    status: m.state === "requested" ? "pending" : "confirmed",
    preread: m.pre_read ?? undefined,
    agenda: m.agenda,
    conversationId: m.thread_id ?? undefined,
  };
}

function dedup(ms: MessageRow[]): MessageRow[] {
  const seen = new Set<string>();
  return ms
    .slice()
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .filter((m) => (seen.has(`${m.from}|${m.body}|${m.created_at}`) ? false : (seen.add(`${m.from}|${m.body}|${m.created_at}`), true)));
}

function toConversations(threads: ThreadRow[], messages: MessageRow[], layout: Layout, agents: { id: string; room: string }[]): Conversation[] {
  const roomOf = (id: string) => layout.slotOf[agents.find((a) => a.id === id)?.room ?? ""] ?? undefined;
  return threads.map((t) => {
    const people = t.participants.filter((p) => p !== "office").map((p) => (p === "ceo" ? "you" : p));
    const rooms = new Set(people.map(roomOf).filter(Boolean));
    return {
      id: t.id,
      kind: t.kind === "meeting" ? "meeting" : rooms.size > 1 ? "cross" : "dm",
      title: t.topic,
      participants: people,
      at: when(t.updated_at),
      room: [...rooms][0],
      messages: dedup(messages.filter((m) => m.thread_id === t.id)).map((m) => ({ who: m.from === "ceo" ? "you" : m.from === "office" ? "ada" : m.from, text: m.body, t: time(m.created_at) })),
    };
  });
}

function toMem(m: MemoryRow, layout: Layout): MemItem {
  const layer =
    m.layer === "company" || m.layer === "ceo"
      ? m.layer
      : m.layer === "room"
        ? (`room:${layout.slotOf[m.scope_id] ?? m.scope_id}` as const)
        : m.layer === "conversation"
          ? (`conversation:${m.scope_id}` as const)
          : (`agent:${m.scope_id}` as const);
  const conf = m.confidence == null ? undefined : m.confidence >= 0.75 ? "high" : m.confidence >= 0.5 ? "medium" : "low";
  return {
    id: m.id,
    layer,
    type: m.type,
    title: m.title,
    body: m.body,
    owner: m.owner === "system" ? "ada" : m.owner,
    status: m.status === "superseded" ? "superseded" : m.status === "stale" ? "stale" : "active",
    pending: m.status === "proposed",
    source: m.source?.by ? `by ${m.source.by}` : "",
    date: when(m.updated_at),
    confidence: conf,
    version: m.version,
    tags: m.tags,
  };
}

const KIND: Record<string, InboxItem["kind"]> = {
  question: "question",
  escalation: "escalation",
  approval: "approval",
  meeting_request: "meeting",
  permission: "permission",
  permission_request: "approval",
  budget: "fyi",
  briefing: "fyi",
};

function toInbox(r: InboxRow): InboxItem {
  return {
    id: r.id,
    kind: KIND[r.kind] ?? "fyi",
    from: r.from === "office" ? "ada" : r.from,
    title: r.title,
    sub: r.ada_note ?? r.body.slice(0, 160),
    body: r.body,
    note: r.ada_note,
    priority: r.priority === 1 ? "high" : r.priority === 3 ? "low" : "normal",
    at: when(r.created_at),
    resolved: r.state !== "open",
    batched: r.priority === 3,
    action: r.action as InboxItem["action"],
    threadId: r.thread_id,
    ref: r.thread_id ? { type: "thread", id: r.thread_id } : undefined,
  };
}

function toChat(m: RealInputs["ada"][number], n: number): ChatMsg {
  const card = m.cards[0];
  return {
    id: `ada-${n}`,
    from: m.role === "ceo" ? "you" : "agent",
    text: m.content,
    t: time(m.created_at),
    card: card
      ? { kind: "readback", title: card.summary, items: card.readback, actionId: card.id, applied: card.state === "applied", cancelled: card.state === "dismissed" || card.state === "stale" }
      : undefined,
  };
}

export type { InboxRow, MemoryRow };
