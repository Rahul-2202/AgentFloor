import type { SupabaseClient } from "@supabase/supabase-js";

export interface InboxRow {
  id: string;
  kind: string;
  from: string;
  title: string;
  body: string;
  state: string;
  priority: number;
  adaNote: string | null;
  action: any;
  threadId: string | null;
  createdAt: string;
}
export interface TaskRow {
  id: string;
  title: string;
  owner: string;
  room: string;
  status: string;
  progress: number;
  blocker: string | null;
  step: string | null;
  updatedAt: string;
}
export interface AgentState {
  id: string;
  status: string;
  activity: string | null;
  heldReason: string | null;
}
export interface Card {
  id: string;
  type: "proposal";
  ops: object[];
  baseVersion: number;
  readback: string[];
  summary: string;
  state: "pending" | "applied" | "dismissed" | "stale";
  version?: number;
}
export interface ChatMessage {
  id: number;
  role: "ceo" | "ada";
  content: string;
  cards: Card[];
  mode: "chat" | "onboarding" | "job";
  createdAt: string;
}
export interface Meeting {
  id: string;
  title: string;
  requestedBy: string;
  chair: "ada" | "ceo";
  attendees: string[];
  agenda: string[];
  preRead: string | null;
  threadId: string | null;
  state: "requested" | "scheduled" | "live" | "ended" | "declined";
  requestInboxId: string | null;
  startsAt: string | null;
}
export interface Minutes {
  meetingId: string;
  summary: string;
  decisions: { text: string; rationale?: string; room?: string }[];
  actionItems: { text: string; owner: string; taskId?: string; due?: string }[];
}

/** What Ada and meetings read and write, beyond setup and memory. */
export interface OfficeData {
  inbox(officeId: string, open?: boolean): Promise<InboxRow[]>;
  triage(officeId: string, id: string, priority: number, note: string): Promise<void>;
  /** An inbox item from the office itself (Ada's briefings, budget alerts): same id twice is ignored. */
  raise(officeId: string, item: { id: string; kind: string; from: string; title: string; body: string; priority?: number }): Promise<void>;
  resolveOwn(officeId: string, id: string): Promise<void>;
  tasks(officeId: string): Promise<TaskRow[]>;
  thread(officeId: string, id: string): Promise<{ topic: string; kind: string; participants: string[]; messages: { from: string; to: string; type: string; body: string; at: string }[] } | null>;
  agents(officeId: string): Promise<AgentState[]>;
  onboarded(officeId: string): Promise<boolean>;
  markOnboarded(officeId: string, company: object): Promise<void>;

  history(officeId: string, limit: number): Promise<ChatMessage[]>;
  say(officeId: string, m: Omit<ChatMessage, "id" | "createdAt">): Promise<ChatMessage>;
  updateCard(officeId: string, cardId: string, patch: Partial<Card>): Promise<Card | null>;
  findCard(officeId: string, cardId: string): Promise<Card | null>;

  meeting(officeId: string, id: string): Promise<Meeting | null>;
  meetings(officeId: string): Promise<Meeting[]>;
  saveMeeting(officeId: string, m: Partial<Meeting> & { id?: string }): Promise<Meeting>;
  saveMinutes(officeId: string, m: Minutes, memoryIds: string[]): Promise<void>;
  minutes(officeId: string, meetingId: string): Promise<Minutes | null>;
}

/* --------------------------------------------------------------- Supabase */

export function supabaseOfficeData(db: SupabaseClient): OfficeData {
  const ok = <T>(r: { data: T; error: { message: string } | null }, what: string): NonNullable<T> => {
    if (r.error) throw new Error(`${what}: ${r.error.message}`);
    return r.data as NonNullable<T>;
  };
  const toMeeting = (r: any): Meeting => ({
    id: r.id,
    title: r.title,
    requestedBy: r.requested_by,
    chair: r.chair,
    attendees: r.attendees,
    agenda: r.agenda ?? [],
    preRead: r.pre_read,
    threadId: r.thread_id,
    state: r.state,
    requestInboxId: r.request_inbox_id,
    startsAt: r.starts_at,
  });
  return {
    async inbox(officeId, open = true) {
      let q = db.from("inbox_items").select("*").eq("office_id", officeId);
      if (open) q = q.eq("state", "open");
      const rows = ok(await q.order("created_at", { ascending: false }).limit(100), "reading inbox") as any[];
      return rows.map((r) => ({ id: r.id, kind: r.kind, from: r.from, title: r.title, body: r.body, state: r.state, priority: r.priority, adaNote: r.ada_note, action: r.action, threadId: r.thread_id, createdAt: r.created_at }));
    },
    async triage(officeId, id, priority, note) {
      ok(await db.from("inbox_items").update({ priority, ada_note: note }).eq("office_id", officeId).eq("id", id), "triage");
    },
    async raise(officeId, i) {
      ok(await db.from("inbox_items").upsert({ office_id: officeId, id: i.id, kind: i.kind, from: i.from, title: i.title, body: i.body, priority: i.priority ?? 2 }, { onConflict: "office_id,id", ignoreDuplicates: true }), "raising inbox");
    },
    async resolveOwn(officeId, id) {
      ok(await db.from("inbox_items").update({ state: "resolved", resolved_at: new Date().toISOString() }).eq("office_id", officeId).eq("id", id), "resolving");
    },
    async tasks(officeId) {
      const rows = ok(await db.from("tasks").select("*").eq("office_id", officeId).order("updated_at", { ascending: false }).limit(200), "reading tasks") as any[];
      return rows.map((t) => ({ id: t.id, title: t.title, owner: t.owner_id, room: t.room_id, status: t.status, progress: t.progress, blocker: t.blocker, step: t.step, updatedAt: t.updated_at }));
    },
    async thread(officeId, id) {
      const t = ok(await db.from("threads").select("*").eq("office_id", officeId).eq("id", id).maybeSingle(), "reading thread") as any;
      if (!t) return null;
      const msgs = ok(await db.from("messages").select("from, to, type, body, created_at").eq("office_id", officeId).eq("thread_id", id).order("created_at"), "reading messages") as any[];
      const seen = new Set<string>();
      return {
        topic: t.topic,
        kind: t.kind,
        participants: t.participants,
        messages: msgs.filter((m) => (seen.has(`${m.from}|${m.body}`) ? false : (seen.add(`${m.from}|${m.body}`), true))).map((m) => ({ from: m.from, to: m.to, type: m.type, body: m.body, at: m.created_at })),
      };
    },
    async agents(officeId) {
      const rows = ok(await db.from("agents").select("id, status, activity, held_reason").eq("office_id", officeId), "reading agents") as any[];
      return rows.map((a) => ({ id: a.id, status: a.status, activity: a.activity, heldReason: a.held_reason }));
    },
    async onboarded(officeId) {
      const r = ok(await db.from("offices").select("onboarded_at").eq("id", officeId).single(), "reading office") as any;
      return !!r.onboarded_at;
    },
    async markOnboarded(officeId, company) {
      ok(await db.from("offices").update({ onboarded_at: new Date().toISOString(), company }).eq("id", officeId), "marking onboarded");
    },
    async history(officeId, limit) {
      const rows = ok(await db.from("ada_messages").select("*").eq("office_id", officeId).neq("mode", "job").order("id", { ascending: false }).limit(limit), "reading Ada's chat") as any[];
      return rows.reverse().map((r) => ({ id: r.id, role: r.role, content: r.content, cards: r.cards ?? [], mode: r.mode, createdAt: r.created_at }));
    },
    async say(officeId, m) {
      const r = ok(await db.from("ada_messages").insert({ office_id: officeId, role: m.role, content: m.content, cards: m.cards, mode: m.mode }).select("*").single(), "saving chat") as any;
      return { id: r.id, role: r.role, content: r.content, cards: r.cards, mode: r.mode, createdAt: r.created_at };
    },
    async findCard(officeId, cardId) {
      const rows = ok(await db.from("ada_messages").select("cards").eq("office_id", officeId).contains("cards", [{ id: cardId }]).limit(1), "finding card") as any[];
      return (rows[0]?.cards as Card[] | undefined)?.find((c) => c.id === cardId) ?? null;
    },
    async updateCard(officeId, cardId, patch) {
      const rows = ok(await db.from("ada_messages").select("id, cards").eq("office_id", officeId).contains("cards", [{ id: cardId }]).limit(1), "finding card") as any[];
      if (!rows[0]) return null;
      const cards = (rows[0].cards as Card[]).map((c) => (c.id === cardId ? { ...c, ...patch } : c));
      ok(await db.from("ada_messages").update({ cards }).eq("id", rows[0].id), "updating card");
      return cards.find((c) => c.id === cardId) ?? null;
    },
    async meeting(officeId, id) {
      const r = ok(await db.from("meetings").select("*").eq("office_id", officeId).eq("id", id).maybeSingle(), "reading meeting");
      return r ? toMeeting(r) : null;
    },
    async meetings(officeId) {
      const rows = ok(await db.from("meetings").select("*").eq("office_id", officeId).order("created_at", { ascending: false }).limit(50), "reading meetings") as any[];
      return rows.map(toMeeting);
    },
    async saveMeeting(officeId, m) {
      const row: Record<string, unknown> = { office_id: officeId };
      if (m.id) row.id = m.id;
      if (m.title !== undefined) row.title = m.title;
      if (m.requestedBy !== undefined) row.requested_by = m.requestedBy;
      if (m.chair !== undefined) row.chair = m.chair;
      if (m.attendees !== undefined) row.attendees = m.attendees;
      if (m.agenda !== undefined) row.agenda = m.agenda;
      if (m.preRead !== undefined) row.pre_read = m.preRead;
      if (m.threadId !== undefined) row.thread_id = m.threadId;
      if (m.state !== undefined) row.state = m.state;
      if (m.requestInboxId !== undefined) row.request_inbox_id = m.requestInboxId;
      if (m.startsAt !== undefined) row.starts_at = m.startsAt;
      if (m.state === "ended") row.ended_at = new Date().toISOString();
      const r = m.id
        ? ok(await db.from("meetings").update(row).eq("office_id", officeId).eq("id", m.id).select("*").single(), "saving meeting")
        : ok(await db.from("meetings").insert(row).select("*").single(), "saving meeting");
      return toMeeting(r);
    },
    async saveMinutes(officeId, m, memoryIds) {
      ok(
        await db.from("minutes").upsert({ meeting_id: m.meetingId, office_id: officeId, summary: m.summary, decisions: m.decisions, action_items: m.actionItems, memory_ids: memoryIds }, { onConflict: "meeting_id" }),
        "saving minutes",
      );
    },
    async minutes(officeId, meetingId) {
      const r = ok(await db.from("minutes").select("*").eq("office_id", officeId).eq("meeting_id", meetingId).maybeSingle(), "reading minutes") as any;
      return r ? { meetingId, summary: r.summary, decisions: r.decisions, actionItems: r.action_items } : null;
    },
  };
}

/* ----------------------------------------------------------------- memory */

export function memoryOfficeData(src: {
  inbox: () => Map<string, any>;
  tasks: () => Map<string, any>;
  threads: () => Map<string, any>;
  messages: () => Map<string, any>;
  agents: () => Map<string, any>;
}): OfficeData & { chat: ChatMessage[]; meetingsList: Meeting[]; minutesList: Minutes[]; company: object | null } {
  const chat: ChatMessage[] = [];
  const meetingsList: Meeting[] = [];
  const minutesList: Minutes[] = [];
  const triage = new Map<string, { priority: number; note: string }>();
  const own = new Map<string, any>();
  let onboarded = false;
  const self = {
    chat,
    meetingsList,
    minutesList,
    company: null as object | null,
    async inbox(_o: string, open = true) {
      const rows = [...src.inbox().values(), ...own.values()].map((r) => ({
        id: r.id,
        kind: r.kind,
        from: r.from,
        title: r.title,
        body: r.body ?? "",
        state: r.state ?? "open",
        priority: triage.get(r.id)?.priority ?? r.priority ?? 2,
        adaNote: triage.get(r.id)?.note ?? null,
        action: r.action ?? null,
        threadId: r.thread_id ?? null,
        createdAt: r.created_at ?? new Date().toISOString(),
      }));
      return open ? rows.filter((r) => r.state === "open") : rows;
    },
    async triage(_o: string, id: string, priority: number, note: string) {
      triage.set(id, { priority, note });
    },
    async raise(_o: string, i: any) {
      if (!own.has(i.id)) own.set(i.id, { ...i, state: "open" });
    },
    async resolveOwn(_o: string, id: string) {
      if (own.has(id)) own.get(id).state = "resolved";
    },
    async tasks() {
      return [...src.tasks().values()].map((t) => ({ id: t.id, title: t.title, owner: t.owner_id, room: t.room_id, status: t.status, progress: t.progress, blocker: t.blocker, step: t.step, updatedAt: t.updated_at }));
    },
    async thread(_o: string, id: string) {
      const t = src.threads().get(id);
      if (!t) return null;
      const seen = new Set<string>();
      const messages = [...src.messages().values()]
        .filter((m) => m.thread_id === id)
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .filter((m) => (seen.has(`${m.from}|${m.body}`) ? false : (seen.add(`${m.from}|${m.body}`), true)))
        .map((m) => ({ from: m.from, to: m.to, type: m.type, body: m.body, at: m.created_at }));
      return { topic: t.topic, kind: t.kind, participants: t.participants, messages };
    },
    async agents() {
      return [...src.agents().entries()].map(([id, a]) => ({ id, status: a.status ?? "idle", activity: a.activity ?? null, heldReason: a.held_reason ?? null }));
    },
    async onboarded() {
      return onboarded;
    },
    async markOnboarded(_o: string, company: object) {
      onboarded = true;
      self.company = company;
    },
    async history(_o: string, limit: number) {
      return chat.filter((m) => m.mode !== "job").slice(-limit);
    },
    async say(_o: string, m: Omit<ChatMessage, "id" | "createdAt">) {
      const msg = { ...m, id: chat.length + 1, createdAt: new Date().toISOString() };
      chat.push(msg);
      return msg;
    },
    async findCard(_o: string, cardId: string) {
      return chat.flatMap((m) => m.cards).find((c) => c.id === cardId) ?? null;
    },
    async updateCard(_o: string, cardId: string, patch: Partial<Card>) {
      const c = chat.flatMap((m) => m.cards).find((x) => x.id === cardId);
      if (!c) return null;
      Object.assign(c, patch);
      return c;
    },
    async meeting(_o: string, id: string) {
      return meetingsList.find((m) => m.id === id) ?? null;
    },
    async meetings() {
      return [...meetingsList].reverse();
    },
    async saveMeeting(_o: string, m: Partial<Meeting> & { id?: string }) {
      let cur = m.id ? meetingsList.find((x) => x.id === m.id) : undefined;
      if (!cur) {
        cur = { id: m.id ?? `mtg-${meetingsList.length + 1}`, title: "", requestedBy: "ceo", chair: "ada", attendees: [], agenda: [], preRead: null, threadId: null, state: "scheduled", requestInboxId: null, startsAt: null };
        meetingsList.push(cur);
      }
      Object.assign(cur, Object.fromEntries(Object.entries(m).filter(([, v]) => v !== undefined)));
      return { ...cur };
    },
    async saveMinutes(_o: string, m: Minutes) {
      const i = minutesList.findIndex((x) => x.meetingId === m.meetingId);
      if (i >= 0) minutesList[i] = m;
      else minutesList.push(m);
    },
    async minutes(_o: string, meetingId: string) {
      return minutesList.find((m) => m.meetingId === meetingId) ?? null;
    },
  };
  return self;
}
