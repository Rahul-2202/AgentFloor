/**
 * Memory in the running office: agents' memory calls (over the office link),
 * their briefs kept current, and conversations turning into memory.
 */
import type { OfficeSetup } from "@agentfloor/shared/setup";
import type { OfficeEvent, Thread } from "@agentfloor/shared/types";
import type { OfficeHub } from "../link/hub.ts";
import type { SetupStore } from "../setup/store.ts";
import { MemoryError, type MemoryService } from "./service.ts";
import type { MemoryItem } from "./store.ts";

/** What the office said, from the projected tables. */
export interface ConversationSource {
  messages(officeId: string, threadId: string): Promise<{ from: string; to: string; type: string; body: string }[]>;
  /** Open task titles per agent (what its brief should bear on). */
  openTasks(officeId: string): Promise<{ owner: string; title: string; details: string }[]>;
}

const short = (i: MemoryItem) => ({ id: i.id.slice(0, 8), layer: i.layer, type: i.type, title: i.title, status: i.status });

export class OfficeMemory {
  private readonly memory: MemoryService;
  private readonly setups: SetupStore;
  private readonly hub: OfficeHub;
  private readonly source: ConversationSource;
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly delayMs: number;

  constructor(o: { memory: MemoryService; setups: SetupStore; hub: OfficeHub; source: ConversationSource; briefDelayMs?: number }) {
    this.memory = o.memory;
    this.setups = o.setups;
    this.hub = o.hub;
    this.source = o.source;
    this.delayMs = o.briefDelayMs ?? 2000;
    this.memory.onChange = (id) => this.refreshSoon(id);
  }

  /** An agent's memory call (memory_search, memory_write, ...). */
  async handle(officeId: string, req: { agent: string; op: string; args: Record<string, any> }): Promise<unknown> {
    const { setup } = await this.setups.load(officeId);
    const { agent, op, args } = req;
    if (!setup.agents.some((a) => a.id === agent)) throw new MemoryError("Unknown agent.");
    switch (op) {
      case "search": {
        const hits = await this.memory.search(officeId, setup, agent, String(args.query ?? ""));
        return hits.length ? hits.map((i) => ({ ...short(i), excerpt: i.body.slice(0, 240) })) : "Nothing in memory matches. If you find out, save it with memory_write.";
      }
      case "read": {
        const r = await this.memory.read(officeId, setup, agent, String(args.id));
        return { ...short(r.item), body: r.item.body, tags: r.item.tags, warnings: r.warnings };
      }
      case "write": {
        const r = await this.memory.write(officeId, setup, agent, {
          title: String(args.title ?? ""),
          body: String(args.body ?? ""),
          type: String(args.type ?? "lesson"),
          layer: args.layer,
          tags: args.tags,
          confidence: args.confidence,
          replaces: args.replaces ? (await this.memory.mustGet(officeId, String(args.replaces))).id : undefined,
          derivedFrom: args.derivedFrom ? await Promise.all((args.derivedFrom as string[]).map(async (id) => (await this.memory.mustGet(officeId, id)).id)) : undefined,
        });
        return { ...short(r.item), note: r.note };
      }
      case "flag": {
        const r = await this.memory.flag(officeId, setup, agent, String(args.id), String(args.reason ?? ""));
        return { flagged: true, note: `Flagged for ${r.owner === "ada" ? "Ada" : r.owner} to fix.` };
      }
      case "review": {
        const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
        const lessons = await this.memory.digest(officeId, setup, agent, since);
        const head = setup.agents.find((a) => a.id === agent)!;
        const waiting = (await this.memory.store.list(officeId, { scopes: [["room", head.room]], status: ["proposed"] }));
        return {
          lessons: lessons.map((i) => ({ ...short(i), by: i.scopeId, confidence: i.confidence, body: i.body.slice(0, 300) })),
          suggestions: waiting.map((i) => ({ ...short(i), by: i.source.by, body: i.body.slice(0, 300) })),
          note: "Accept or reject with memory_accept / memory_reject. Lessons you don't reject stay.",
        };
      }
      case "accept":
        return short(await this.memory.accept(officeId, setup, agent, (await this.memory.mustGet(officeId, String(args.id))).id));
      case "reject":
        return short(await this.memory.reject(officeId, setup, agent, (await this.memory.mustGet(officeId, String(args.id))).id, String(args.why ?? "")));
      default:
        throw new MemoryError(`Unknown memory call "${op}".`);
    }
  }

  /** Recomputes every agent's brief soon (memory changes come in bursts). */
  refreshSoon(officeId: string): void {
    clearTimeout(this.timers.get(officeId));
    this.timers.set(
      officeId,
      setTimeout(() => {
        this.timers.delete(officeId);
        void this.pushBriefs(officeId).catch(() => {});
      }, this.delayMs),
    );
  }

  /** Sends each agent its brief, bearing on its open tasks. */
  async pushBriefs(officeId: string): Promise<number> {
    if (!this.hub.isConnected(officeId)) return 0;
    const { setup } = await this.setups.load(officeId);
    const tasks = await this.source.openTasks(officeId);
    let n = 0;
    for (const a of setup.agents) {
      const work = tasks.filter((t) => t.owner === a.id).map((t) => `${t.title} ${t.details}`);
      if (this.hub.sendBrief(officeId, a.id, await this.memory.brief(officeId, setup, a.id, work))) n++;
    }
    return n;
  }

  /**
   * The office's events, as they're stored: conversations become memory
   * (questions answered, huddle agreements, the CEO's decisions), and briefs
   * follow changes in work.
   */
  async onEvents(officeId: string, events: OfficeEvent[]): Promise<void> {
    let setup: OfficeSetup | null = null;
    const need = async () => (setup ??= (await this.setups.load(officeId)).setup);
    let workChanged = false;
    for (const ev of events) {
      if (ev.type === "task.updated") workChanged = true;
      if (ev.type === "thread.updated" && (ev.data.change === "resolved" || ev.data.change === "huddle_ended")) {
        await this.remember(officeId, await need(), ev.data.thread as Thread).catch(() => {});
      }
      // A question to a colleague that memory could have answered.
      if (ev.type === "thread.opened") {
        const t = ev.data.thread as Thread;
        if (t.awaiting && t.createdBy !== "ceo" && t.awaiting.from !== "ceo") {
          const hits = await this.memory.search(officeId, await need(), t.createdBy, t.topic, 1);
          if (hits[0] && wordsShared(hits[0].title, t.topic) >= 2) await this.memory.store.measure(officeId, "asked_known");
        }
      }
    }
    if (workChanged) this.refreshSoon(officeId);
  }

  private async remember(officeId: string, setup: OfficeSetup, t: Thread): Promise<void> {
    if (t.kind === "meeting") return; // meetings get minutes (Ada)
    const existing = await this.memory.store.list(officeId, { scopes: [["conversation", t.id], ["room"]], limit: 500 });
    if (existing.some((i) => i.source.threadId === t.id)) return;
    const people = t.participants.filter((p) => p !== "office");
    const agents = people.filter((p) => p !== "ceo");
    const rooms = [...new Set(agents.map((p) => setup.agents.find((a) => a.id === p)?.room).filter(Boolean))] as string[];
    const name = (id: string) => (id === "ceo" ? "CEO" : setup.agents.find((a) => a.id === id)?.name ?? id);

    if (t.kind === "huddle") {
      if (!t.outcome) return;
      // An agreement between rooms is one shared object both rooms read.
      const cross = rooms.length > 1;
      await this.memory.write(officeId, setup, "system", {
        layer: "conversation",
        scopeId: t.id,
        type: cross ? "agreement" : "summary",
        title: `${cross ? "Agreement" : "Huddle"}: ${t.topic}`,
        body: `${people.map(name).join(" and ")} agreed: ${t.outcome}`,
        tags: cross ? ["agreement", ...rooms] : rooms,
        source: { threadId: t.id, participants: people, rooms },
      });
      return;
    }

    const msgs = await this.source.messages(officeId, t.id);
    const question = msgs.find((m) => m.type === "ask");
    const answer = [...msgs].reverse().find((m) => m.type === "answer");
    if (!question || !answer) return;

    if (answer.from === "ceo") {
      // The CEO decided: the asker's room keeps it in its decision log.
      const room = setup.agents.find((a) => a.id === question.from)?.room;
      if (!room) return;
      await this.memory.write(officeId, setup, "system", {
        layer: "room",
        scopeId: room,
        type: "decision",
        title: `Decision: ${t.topic.slice(0, 100)}`,
        body: `${name(question.from)} asked: ${clip(question.body, 600)}\nThe CEO decided: ${clip(answer.body, 1200)}`,
        tags: ["decision", "ceo"],
        source: { threadId: t.id, participants: people, rooms },
      });
      return;
    }
    await this.memory.write(officeId, setup, "system", {
      layer: "conversation",
      scopeId: t.id,
      type: "summary",
      title: `Q&A: ${t.topic.slice(0, 100)}`,
      body: `${name(question.from)} asked ${name(question.to)}: ${clip(question.body, 600)}\n${name(answer.from)}: ${clip(answer.body, 1200)}`,
      tags: rooms,
      source: { threadId: t.id, participants: people, rooms },
    });
  }
}

function clip(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function wordsShared(a: string, b: string): number {
  const w = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []);
  const x = w(a);
  return [...w(b)].filter((t) => x.has(t)).length;
}

export function supabaseConversationSource(db: import("@supabase/supabase-js").SupabaseClient): ConversationSource {
  return {
    async messages(officeId, threadId) {
      const { data, error } = await db.from("messages").select("from, to, type, body, created_at").eq("office_id", officeId).eq("thread_id", threadId).order("created_at");
      if (error) throw new Error(`reading messages: ${error.message}`);
      // A message to several people is stored once per recipient.
      const seen = new Set<string>();
      return (data ?? []).filter((m) => (seen.has(`${m.from}|${m.body}|${m.created_at}`) ? false : (seen.add(`${m.from}|${m.body}|${m.created_at}`), true)));
    },
    async openTasks(officeId) {
      const { data, error } = await db.from("tasks").select("owner_id, title, details").eq("office_id", officeId).neq("status", "done").limit(300);
      if (error) throw new Error(`reading tasks: ${error.message}`);
      return (data ?? []).map((t) => ({ owner: t.owner_id, title: t.title, details: t.details ?? "" }));
    },
  };
}
