import type { OfficeEvent } from "@agentfloor/shared/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { project, type Projection } from "./project.ts";

/** Writes projections; Supabase in production, memory in tests. */
export interface ProjectionStore {
  /** Events after the office's projected seq, oldest first. */
  pending(officeId: string, limit: number): Promise<OfficeEvent[]>;
  roomsOfAgents(officeId: string): Promise<Map<string, string>>;
  write(officeId: string, p: Projection, upToSeq: number): Promise<void>;
}

/**
 * Keeps the readable tables caught up with the office's event log. Runs after
 * every batch from the daemon; whatever didn't get projected (an error, a
 * restart) is picked up next time, since it works from the log, not the batch.
 */
export class Projector {
  private readonly store: ProjectionStore;
  private readonly running = new Map<string, Promise<number>>();
  /** Called with the usage rows written, so budgets can be checked. */
  onUsage: (officeId: string) => void = () => {};

  constructor(store: ProjectionStore) {
    this.store = store;
  }

  /** Projects everything pending for the office; returns how many events it projected. */
  catchUp(officeId: string): Promise<number> {
    const prev = this.running.get(officeId) ?? Promise.resolve(0);
    const next = prev.catch(() => 0).then(() => this.run(officeId));
    this.running.set(officeId, next);
    void next.finally(() => {
      if (this.running.get(officeId) === next) this.running.delete(officeId);
    }).catch(() => {});
    return next;
  }

  private async run(officeId: string): Promise<number> {
    let total = 0;
    let rooms: Map<string, string> | null = null;
    for (;;) {
      const events = await this.store.pending(officeId, 500);
      if (!events.length) return total;
      rooms ??= await this.store.roomsOfAgents(officeId);
      const p = project(officeId, events, (a) => rooms!.get(a) ?? null);
      await this.store.write(officeId, p, events.at(-1)!.seq);
      total += events.length;
      if (p.usage.length) this.onUsage(officeId);
    }
  }
}

export function supabaseProjectionStore(db: SupabaseClient): ProjectionStore {
  const ok = (r: { error: { message: string } | null }, what: string) => {
    if (r.error) throw new Error(`${what}: ${r.error.message}`);
  };
  return {
    async pending(officeId, limit) {
      const office = await db.from("offices").select("projected_seq").eq("id", officeId).single();
      ok(office, "reading office");
      const rows = await db
        .from("office_events")
        .select("seq, type, data, at")
        .eq("office_id", officeId)
        .gt("seq", office.data!.projected_seq)
        .order("seq")
        .limit(limit);
      ok(rows, "reading events");
      return rows.data!.map((r) => ({ seq: Number(r.seq), type: r.type, data: r.data, at: new Date(r.at).getTime() }));
    },
    async roomsOfAgents(officeId) {
      const r = await db.from("agents").select("id, room_id").eq("office_id", officeId);
      ok(r, "reading agents");
      return new Map(r.data!.map((a) => [a.id, a.room_id]));
    },
    async write(officeId, p, upToSeq) {
      // Threads before messages and tasks (messages reference threads).
      if (p.threads.size) ok(await db.from("threads").upsert([...p.threads.values()], { onConflict: "office_id,id" }), "threads");
      if (p.messages.size) ok(await db.from("messages").upsert([...p.messages.values()], { onConflict: "office_id,id" }), "messages");
      const byTime = new Map<string, string[]>();
      for (const [id, at] of p.delivered) byTime.set(at, [...(byTime.get(at) ?? []), id]);
      for (const [at, ids] of byTime) {
        ok(await db.from("messages").update({ state: "delivered", delivered_at: at }).eq("office_id", officeId).in("id", ids), "deliveries");
      }
      if (p.tasks.size) ok(await db.from("tasks").upsert([...p.tasks.values()], { onConflict: "office_id,id" }), "tasks");
      if (p.inbox.size) ok(await db.from("inbox_items").upsert([...p.inbox.values()], { onConflict: "office_id,id" }), "inbox");
      for (const [id, cols] of p.agents) ok(await db.from("agents").update(cols).eq("office_id", officeId).eq("id", id), "agent status");
      if (p.usage.length) {
        ok(await db.from("usage_events").upsert(p.usage, { onConflict: "office_id,seq", ignoreDuplicates: true }), "usage");
      }
      ok(await db.from("offices").update({ projected_seq: upToSeq }).eq("id", officeId), "projected seq");
    },
  };
}

/** In-memory projection store for tests: tables as maps. */
export function memoryProjectionStore(events: () => OfficeEvent[], rooms: Record<string, string> = {}) {
  const tables = { threads: new Map<string, any>(), messages: new Map<string, any>(), tasks: new Map<string, any>(), inbox: new Map<string, any>(), agents: new Map<string, any>(), usage: new Map<number, any>() };
  let projected = 0;
  const store: ProjectionStore = {
    async pending(_id, limit) {
      return events().filter((e) => e.seq > projected).slice(0, limit);
    },
    async roomsOfAgents() {
      return new Map(Object.entries(rooms));
    },
    async write(_id, p, upTo) {
      for (const [k, v] of p.threads) tables.threads.set(k, v);
      for (const [k, v] of p.messages) tables.messages.set(k, v);
      for (const [id, at] of p.delivered) if (tables.messages.has(id)) Object.assign(tables.messages.get(id), { state: "delivered", delivered_at: at });
      for (const [k, v] of p.tasks) tables.tasks.set(k, v);
      for (const [k, v] of p.inbox) tables.inbox.set(k, v);
      for (const [k, v] of p.agents) tables.agents.set(k, { ...tables.agents.get(k), ...v });
      for (const u of p.usage) if (!tables.usage.has(u.seq as number)) tables.usage.set(u.seq as number, u);
      projected = upTo;
    },
  };
  return { store, tables, projected: () => projected };
}
