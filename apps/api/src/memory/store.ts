import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export type Layer = "company" | "ceo" | "room" | "agent" | "conversation" | "short_term";
export type ItemStatus = "proposed" | "active" | "superseded" | "stale";

export interface MemoryItem {
  id: string;
  layer: Layer;
  /** Room id (room), agent id (agent, short_term), thread id (conversation); "" for company and ceo. */
  scopeId: string;
  /** fact, decision, lesson, preference, agreement, summary, charter, state, note, how_to_work, ... */
  type: string;
  title: string;
  body: string;
  /** Who approves changes: "ada", "ceo", or an agent id. */
  owner: string;
  status: ItemStatus;
  source: { by?: string; threadId?: string; meetingId?: string; taskId?: string; participants?: string[]; rooms?: string[] };
  confidence: number | null;
  tags: string[];
  /** CEO preferences: which rooms see it (null: all). */
  rooms: string[] | null;
  version: number;
  updatedBy: string | null;
  supersededBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryLink {
  from: string;
  to: string;
  kind: "distilled_from" | "derived_from" | "supersedes" | "relates" | "shared_with";
  needsRefresh: boolean;
}

export interface MemoryFlag {
  id: string;
  itemId: string;
  reasons: string[];
  flaggedBy: string[];
  state: "open" | "resolved";
}

export type NewItem = Omit<MemoryItem, "id" | "version" | "supersededBy" | "createdAt" | "updatedAt">;

export interface MemoryStore {
  create(officeId: string, item: NewItem): Promise<MemoryItem>;
  update(officeId: string, id: string, patch: Partial<Pick<MemoryItem, "title" | "body" | "status" | "tags" | "confidence" | "supersededBy" | "updatedBy" | "type">>): Promise<MemoryItem>;
  get(officeId: string, id: string): Promise<MemoryItem | null>;
  /** Items in these scopes, newest first. A scope is [layer, scopeId] or [layer] for any scope. */
  list(officeId: string, f: { scopes?: [Layer, string?][]; status?: ItemStatus[]; type?: string; limit?: number }): Promise<MemoryItem[]>;
  search(officeId: string, query: string, f: { scopes?: [Layer, string?][]; limit?: number }): Promise<MemoryItem[]>;
  link(officeId: string, l: Omit<MemoryLink, "needsRefresh">): Promise<void>;
  /** Links into or out of an item. */
  links(officeId: string, id: string): Promise<MemoryLink[]>;
  /** Items derived from `sourceId` are flagged for refresh. */
  markDerivedForRefresh(officeId: string, sourceId: string): Promise<number>;
  clearRefresh(officeId: string, derivedId: string): Promise<void>;
  flag(officeId: string, itemId: string, by: string, reason: string): Promise<MemoryFlag>;
  openFlags(officeId: string, itemIds?: string[]): Promise<MemoryFlag[]>;
  resolveFlags(officeId: string, itemId: string): Promise<void>;
  measure(officeId: string, metric: string, amount?: number): Promise<void>;
}

/* --------------------------------------------------------------- Supabase */

const toItem = (r: any): MemoryItem => ({
  id: r.id,
  layer: r.layer,
  scopeId: r.scope_id,
  type: r.type,
  title: r.title,
  body: r.body,
  owner: r.owner,
  status: r.status,
  source: r.source ?? {},
  confidence: r.confidence,
  tags: r.tags ?? [],
  rooms: r.rooms,
  version: r.version,
  updatedBy: r.updated_by,
  supersededBy: r.superseded_by,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export function supabaseMemoryStore(db: SupabaseClient): MemoryStore {
  const ok = <T>(r: { data: T; error: { message: string } | null }, what: string): NonNullable<T> => {
    if (r.error) throw new Error(`${what}: ${r.error.message}`);
    return r.data as NonNullable<T>;
  };
  const scoped = (q: any, scopes?: [Layer, string?][]) => {
    if (!scopes) return q;
    if (!scopes.length) return q.eq("layer", "__none__");
    return q.or(scopes.map(([l, s]) => (s === undefined ? `layer.eq.${l}` : `and(layer.eq.${l},scope_id.eq.${s})`)).join(","));
  };
  return {
    async create(officeId, i) {
      const row = ok(
        await db
          .from("memory_items")
          .insert({
            office_id: officeId,
            layer: i.layer,
            scope_id: i.scopeId,
            type: i.type,
            title: i.title,
            body: i.body,
            owner: i.owner,
            status: i.status,
            source: i.source,
            confidence: i.confidence,
            tags: i.tags,
            rooms: i.rooms,
            updated_by: i.updatedBy,
          })
          .select("*")
          .single(),
        "creating memory",
      );
      return toItem(row);
    },
    async update(officeId, id, p) {
      const patch: Record<string, unknown> = {};
      if (p.title !== undefined) patch.title = p.title;
      if (p.body !== undefined) patch.body = p.body;
      if (p.status !== undefined) patch.status = p.status;
      if (p.tags !== undefined) patch.tags = p.tags;
      if (p.type !== undefined) patch.type = p.type;
      if (p.confidence !== undefined) patch.confidence = p.confidence;
      if (p.supersededBy !== undefined) patch.superseded_by = p.supersededBy;
      if (p.updatedBy !== undefined) patch.updated_by = p.updatedBy;
      return toItem(ok(await db.from("memory_items").update(patch).eq("office_id", officeId).eq("id", id).select("*").single(), "updating memory"));
    },
    async get(officeId, id) {
      const r = ok(await db.from("memory_items").select("*").eq("office_id", officeId).eq("id", id).maybeSingle(), "reading memory");
      return r ? toItem(r) : null;
    },
    async list(officeId, f) {
      let q = db.from("memory_items").select("*").eq("office_id", officeId);
      q = scoped(q, f.scopes);
      if (f.status) q = q.in("status", f.status);
      if (f.type) q = q.eq("type", f.type);
      return (ok(await q.order("updated_at", { ascending: false }).limit(f.limit ?? 200), "listing memory") as any[]).map(toItem);
    },
    async search(officeId, query, f) {
      const words = query.toLowerCase().match(/[a-z0-9]{3,}/g)?.slice(0, 8) ?? [];
      if (!words.length) return [];
      let q = db.from("memory_items").select("*").eq("office_id", officeId).in("status", ["active", "stale", "proposed"]);
      q = scoped(q, f.scopes);
      q = q.or(words.flatMap((w) => [`title.ilike.%${w}%`, `body.ilike.%${w}%`]).join(","));
      const rows = (ok(await q.limit(100), "searching memory") as any[]).map(toItem);
      return rankByWords(rows, words).slice(0, f.limit ?? 10);
    },
    async link(officeId, l) {
      ok(await db.from("memory_links").upsert({ office_id: officeId, from_id: l.from, to_id: l.to, kind: l.kind }, { onConflict: "from_id,to_id,kind", ignoreDuplicates: true }), "linking memory");
    },
    async links(officeId, id) {
      const rows = ok(await db.from("memory_links").select("*").eq("office_id", officeId).or(`from_id.eq.${id},to_id.eq.${id}`), "reading links") as any[];
      return rows.map((r) => ({ from: r.from_id, to: r.to_id, kind: r.kind, needsRefresh: r.needs_refresh }));
    },
    async markDerivedForRefresh(officeId, sourceId) {
      const rows = ok(await db.from("memory_links").update({ needs_refresh: true }).eq("office_id", officeId).eq("to_id", sourceId).eq("kind", "derived_from").select("from_id"), "flagging derived memory") as any[];
      return rows.length;
    },
    async clearRefresh(officeId, derivedId) {
      ok(await db.from("memory_links").update({ needs_refresh: false }).eq("office_id", officeId).eq("from_id", derivedId).eq("kind", "derived_from"), "clearing refresh");
    },
    async flag(officeId, itemId, by, reason) {
      const open = ok(await db.from("memory_flags").select("*").eq("office_id", officeId).eq("item_id", itemId).eq("state", "open").maybeSingle(), "reading flags") as any;
      if (open) {
        const merged = ok(
          await db
            .from("memory_flags")
            .update({ reasons: [...new Set([...open.reasons, reason])], flagged_by: [...new Set([...open.flagged_by, by])] })
            .eq("id", open.id)
            .select("*")
            .single(),
          "merging flag",
        ) as any;
        return { id: merged.id, itemId, reasons: merged.reasons, flaggedBy: merged.flagged_by, state: "open" };
      }
      const r = ok(await db.from("memory_flags").insert({ office_id: officeId, item_id: itemId, reasons: [reason], flagged_by: [by] }).select("*").single(), "flagging") as any;
      return { id: r.id, itemId, reasons: r.reasons, flaggedBy: r.flagged_by, state: "open" };
    },
    async openFlags(officeId, itemIds) {
      let q = db.from("memory_flags").select("*").eq("office_id", officeId).eq("state", "open");
      if (itemIds) q = q.in("item_id", itemIds.length ? itemIds : ["00000000-0000-0000-0000-000000000000"]);
      return (ok(await q, "reading flags") as any[]).map((r) => ({ id: r.id, itemId: r.item_id, reasons: r.reasons, flaggedBy: r.flagged_by, state: r.state }));
    },
    async resolveFlags(officeId, itemId) {
      ok(await db.from("memory_flags").update({ state: "resolved", resolved_at: new Date().toISOString() }).eq("office_id", officeId).eq("item_id", itemId).eq("state", "open"), "resolving flags");
    },
    async measure(officeId, metric, amount = 1) {
      await db.rpc("bump_memory_measure", { oid: officeId, metric_name: metric, amount });
    },
  };
}

/** Items scored by how many of the words they contain (title words count double). */
export function rankByWords(items: MemoryItem[], words: string[]): MemoryItem[] {
  const score = (i: MemoryItem) => words.reduce((n, w) => n + (i.title.toLowerCase().includes(w) ? 2 : 0) + (i.body.toLowerCase().includes(w) ? 1 : 0), 0);
  return items
    .map((i) => ({ i, s: score(i) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.i);
}

/* ----------------------------------------------------------------- memory */

export function memoryMemoryStore(): MemoryStore & { items: Map<string, MemoryItem>; linksList: MemoryLink[]; flags: MemoryFlag[]; measures: Map<string, number> } {
  const items = new Map<string, MemoryItem>();
  const linksList: MemoryLink[] = [];
  const flags: MemoryFlag[] = [];
  const measures = new Map<string, number>();
  let clock = 0;
  const stamp = () => new Date(Date.UTC(2026, 0, 1) + ++clock * 1000).toISOString();
  const inScopes = (i: MemoryItem, scopes?: [Layer, string?][]) => !scopes || scopes.some(([l, s]) => i.layer === l && (s === undefined || i.scopeId === s));
  return {
    items,
    linksList,
    flags,
    measures,
    async create(_o, i) {
      const now = stamp();
      const item: MemoryItem = { ...structuredClone(i), id: randomUUID(), version: 1, supersededBy: null, createdAt: now, updatedAt: now };
      items.set(item.id, item);
      return structuredClone(item);
    },
    async update(_o, id, p) {
      const cur = items.get(id)!;
      const changed = (p.title !== undefined && p.title !== cur.title) || (p.body !== undefined && p.body !== cur.body) || (p.status !== undefined && p.status !== cur.status);
      Object.assign(cur, Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)), { updatedAt: stamp() });
      if (changed) cur.version += 1;
      return structuredClone(cur);
    },
    async get(_o, id) {
      return structuredClone(items.get(id) ?? null);
    },
    async list(_o, f) {
      return [...items.values()]
        .filter((i) => inScopes(i, f.scopes) && (!f.status || f.status.includes(i.status)) && (!f.type || i.type === f.type))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, f.limit ?? 200)
        .map((i) => structuredClone(i));
    },
    async search(_o, query, f) {
      const words = query.toLowerCase().match(/[a-z0-9]{3,}/g)?.slice(0, 8) ?? [];
      const pool = [...items.values()].filter((i) => inScopes(i, f.scopes) && ["active", "stale", "proposed"].includes(i.status));
      return rankByWords(pool, words).slice(0, f.limit ?? 10).map((i) => structuredClone(i));
    },
    async link(_o, l) {
      if (!linksList.some((x) => x.from === l.from && x.to === l.to && x.kind === l.kind)) linksList.push({ ...l, needsRefresh: false });
    },
    async links(_o, id) {
      return linksList.filter((l) => l.from === id || l.to === id).map((l) => ({ ...l }));
    },
    async markDerivedForRefresh(_o, sourceId) {
      const hit = linksList.filter((l) => l.to === sourceId && l.kind === "derived_from");
      for (const l of hit) l.needsRefresh = true;
      return hit.length;
    },
    async clearRefresh(_o, derivedId) {
      for (const l of linksList) if (l.from === derivedId && l.kind === "derived_from") l.needsRefresh = false;
    },
    async flag(_o, itemId, by, reason) {
      let f = flags.find((x) => x.itemId === itemId && x.state === "open");
      if (f) {
        f.reasons = [...new Set([...f.reasons, reason])];
        f.flaggedBy = [...new Set([...f.flaggedBy, by])];
      } else {
        f = { id: randomUUID(), itemId, reasons: [reason], flaggedBy: [by], state: "open" };
        flags.push(f);
      }
      return { ...f };
    },
    async openFlags(_o, ids) {
      return flags.filter((f) => f.state === "open" && (!ids || ids.includes(f.itemId))).map((f) => ({ ...f }));
    },
    async resolveFlags(_o, itemId) {
      for (const f of flags) if (f.itemId === itemId) f.state = "resolved";
    },
    async measure(_o, metric, amount = 1) {
      measures.set(metric, (measures.get(metric) ?? 0) + amount);
    },
  };
}
