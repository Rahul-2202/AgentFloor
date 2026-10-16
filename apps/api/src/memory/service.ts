/**
 * Office memory: layers, who reads and writes what, and how memory moves.
 *
 *   company       written by Ada; read by heads (who derive a room version) and Ada
 *   ceo           CEO preferences, written by Ada; read by heads, filtered to their room
 *   room          written by the head (Ada's edits arrive as suggestions); read by the room and Ada
 *   agent         the agent's lessons and notes; its head reviews (auto-accepted unless doubtful)
 *   conversation  summaries of threads, huddles and meetings; read by participants and their heads
 *   short_term    the agent's scratchpad; only the agent
 *
 * The CEO reads and edits everything. Org setup (rooms, agents, permissions)
 * is config, not memory.
 */
import type { OfficeSetup } from "@agentfloor/shared/setup";
import type { Layer, MemoryItem, MemoryStore, NewItem } from "./store.ts";

/** Who is acting: "ceo", "ada", "system", or an agent id. */
export type MemoryActor = string;

export class MemoryError extends Error {}

/** Below this, a new lesson waits for its head's approval. */
export const LOW_CONFIDENCE = 0.6;

export interface WriteInput {
  layer?: Layer;
  /** Room, agent or thread id; defaults from the layer and the writer. */
  scopeId?: string;
  type: string;
  title: string;
  body: string;
  tags?: string[];
  confidence?: number | null;
  /** An item this one replaces (marked superseded, linked). */
  replaces?: string;
  /** Items this one was derived from (company → room → agent). */
  derivedFrom?: string[];
  /** Items this one summarises (conversation → lesson → room → company). */
  distilledFrom?: string[];
  source?: MemoryItem["source"];
  /** CEO preferences: which rooms see it. */
  rooms?: string[] | null;
}

export class MemoryService {
  readonly store: MemoryStore;
  /** Called when memory an agent reads may have changed (its brief needs refreshing). */
  onChange: (officeId: string) => void = () => {};

  constructor(store: MemoryStore) {
    this.store = store;
  }

  /* -------------------------------------------------------------- access */

  /** The [layer, scope] pairs an actor may read. */
  readable(setup: OfficeSetup, actor: MemoryActor): [Layer, string?][] | null {
    if (actor === "ceo" || actor === "ada" || actor === "system") return null; // everything
    const me = setup.agents.find((a) => a.id === actor);
    if (!me) return [];
    const scopes: [Layer, string?][] = [
      ["agent", me.id],
      ["short_term", me.id],
      ["room", me.room],
    ];
    if (me.role === "head") {
      scopes.push(["company"], ["ceo"]);
      for (const m of setup.agents.filter((a) => a.room === me.room && a.id !== me.id)) scopes.push(["agent", m.id]);
    }
    return scopes;
  }

  /** Conversation items are readable by their participants and those participants' heads. */
  private canReadConversation(setup: OfficeSetup, actor: MemoryActor, item: MemoryItem): boolean {
    if (actor === "ceo" || actor === "ada" || actor === "system") return true;
    const people = item.source.participants ?? [];
    if (people.includes(actor)) return true;
    const me = setup.agents.find((a) => a.id === actor);
    if (me?.role !== "head") return false;
    return people.some((p) => setup.agents.find((a) => a.id === p)?.room === me.room);
  }

  canRead(setup: OfficeSetup, actor: MemoryActor, item: MemoryItem): boolean {
    if (item.layer === "conversation") return this.canReadConversation(setup, actor, item);
    if (item.layer === "ceo" && item.rooms?.length && actor !== "ceo" && actor !== "ada") {
      const room = setup.agents.find((a) => a.id === actor)?.room;
      if (!room || !item.rooms.includes(room)) return false;
    }
    const scopes = this.readable(setup, actor);
    return !scopes || scopes.some(([l, s]) => l === item.layer && (s === undefined || s === item.scopeId));
  }

  /* --------------------------------------------------------------- write */

  /**
   * Writes an item as `actor`, applying ownership: what's the writer's own is
   * active (lessons unless doubtful); what belongs to someone else arrives as
   * a suggestion for its owner.
   */
  async write(officeId: string, setup: OfficeSetup, actor: MemoryActor, w: WriteInput): Promise<{ item: MemoryItem; note: string }> {
    const me = setup.agents.find((a) => a.id === actor);
    const layer = w.layer ?? (me ? "agent" : "company");
    const scopeId = w.scopeId ?? (layer === "agent" || layer === "short_term" ? actor : layer === "room" ? me?.room ?? "" : "");
    if (!w.title?.trim() || !w.body?.trim()) throw new MemoryError("A memory item needs a title and a body.");
    if (w.body.length > 8000) throw new MemoryError("Keep a memory item under 8,000 characters; split it, or link to a file.");

    const owner = ownerOf(setup, layer, scopeId);
    let status: MemoryItem["status"] = "active";
    let note = "Saved.";

    if (actor !== "ceo" && actor !== "system") {
      if (actor === "ada") {
        if (layer === "room") {
          status = "proposed";
          note = `Suggested to ${nameOf(setup, owner)}, who owns the room's memory.`;
        } else if (layer !== "company" && layer !== "ceo" && layer !== "conversation") {
          throw new MemoryError("Ada writes company memory and the CEO's preferences; agents keep their own.");
        }
      } else {
        if (!me) throw new MemoryError("Unknown agent.");
        if (layer === "company" || layer === "ceo") throw new MemoryError("Company memory and the CEO's preferences are Ada's. Tell your head, or ask_ceo.");
        if (layer === "conversation") throw new MemoryError("Conversation summaries are written by the office.");
        if ((layer === "agent" || layer === "short_term") && scopeId !== actor) throw new MemoryError("You can only write your own notes and lessons.");
        if (layer === "room") {
          if (scopeId !== me.room) throw new MemoryError("You can only write your own room's memory.");
          if (me.role !== "head") {
            status = "proposed";
            note = `Suggested to ${nameOf(setup, owner)}, who owns ${roomName(setup, scopeId)}'s memory.`;
          }
        }
        if (layer === "agent" && w.type === "lesson") {
          // Lessons are accepted automatically; doubtful or conflicting ones wait for the head.
          const conflict = await this.conflicting(officeId, layer, scopeId, w.title, w.body, w.replaces);
          if ((w.confidence ?? 1) < LOW_CONFIDENCE || conflict) {
            status = "proposed";
            note = conflict
              ? `It conflicts with "${conflict.title}", so it waits for your head's approval.`
              : `Your confidence is low (${w.confidence}), so it waits for your head's approval.`;
          }
        }
      }
    }

    const item = await this.store.create(officeId, {
      layer,
      scopeId,
      type: w.type,
      title: w.title.trim(),
      body: w.body.trim(),
      owner,
      status,
      source: { by: actor, ...w.source },
      confidence: w.confidence ?? null,
      tags: [...new Set((w.tags ?? []).map((t) => t.toLowerCase()))],
      rooms: layer === "ceo" ? w.rooms ?? null : null,
      updatedBy: actor,
    } satisfies NewItem);

    for (const id of w.derivedFrom ?? []) await this.store.link(officeId, { from: item.id, to: id, kind: "derived_from" });
    for (const id of w.distilledFrom ?? []) await this.store.link(officeId, { from: item.id, to: id, kind: "distilled_from" });
    if (w.replaces && status === "active") await this.supersede(officeId, w.replaces, item.id, actor);
    if (layer === "ceo" && actor === "ada") {
      // The CEO said something like this before: a repeated correction.
      const before = await this.store.search(officeId, w.title, { scopes: [["ceo"]], limit: 3 });
      if (before.some((b) => b.id !== item.id && similar(b.title, w.title))) await this.store.measure(officeId, "repeated_corrections");
    }
    this.onChange(officeId);
    return { item, note };
  }

  /** Marks `oldId` superseded by `newId`; whatever was derived from it is flagged for refresh. */
  async supersede(officeId: string, oldId: string, newId: string, by: MemoryActor): Promise<void> {
    await this.store.update(officeId, oldId, { status: "superseded", supersededBy: newId, updatedBy: by });
    await this.store.link(officeId, { from: newId, to: oldId, kind: "supersedes" });
    // Derived items now point at an old version: they refresh lazily, when next read.
    for (const l of await this.store.links(officeId, oldId)) {
      if (l.kind === "derived_from" && l.to === oldId) await this.store.link(officeId, { from: l.from, to: newId, kind: "derived_from" });
    }
    await this.store.markDerivedForRefresh(officeId, newId);
    await this.store.resolveFlags(officeId, oldId);
  }

  /** Edits an item in place (the owner, or the CEO). Flags on it are resolved; derived items need a refresh. */
  async edit(officeId: string, setup: OfficeSetup, actor: MemoryActor, id: string, patch: { title?: string; body?: string; tags?: string[] }) {
    const item = await this.mustGet(officeId, id);
    if (actor !== "ceo" && actor !== item.owner && !(actor === "ada" && (item.layer === "company" || item.layer === "ceo"))) {
      throw new MemoryError(`Only ${nameOf(setup, item.owner)} (or the CEO) edits this.`);
    }
    const next = await this.store.update(officeId, id, { ...patch, status: item.status === "stale" ? "active" : item.status, updatedBy: actor });
    await this.store.resolveFlags(officeId, id);
    await this.store.markDerivedForRefresh(officeId, id);
    await this.store.clearRefresh(officeId, id);
    this.onChange(officeId);
    return next;
  }

  /** The owner accepts a suggestion or a doubtful lesson. */
  async accept(officeId: string, setup: OfficeSetup, actor: MemoryActor, id: string) {
    const item = await this.mustGet(officeId, id);
    if (item.status !== "proposed") throw new MemoryError("That isn't waiting for approval.");
    if (!this.mayReview(setup, actor, item)) throw new MemoryError(`It's ${nameOf(setup, item.owner)}'s to review.`);
    const next = await this.store.update(officeId, id, { status: "active", updatedBy: actor });
    this.onChange(officeId);
    return next;
  }

  /** The owner rejects it (lessons can be rejected even after they were auto-accepted). */
  async reject(officeId: string, setup: OfficeSetup, actor: MemoryActor, id: string, why: string) {
    const item = await this.mustGet(officeId, id);
    if (!this.mayReview(setup, actor, item)) throw new MemoryError(`It's ${nameOf(setup, item.owner)}'s to review.`);
    const next = await this.store.update(officeId, id, { status: "superseded", updatedBy: actor, body: `${item.body}\n\n(Rejected by ${nameOf(setup, actor)}: ${why})` });
    this.onChange(officeId);
    return next;
  }

  /** Heads review their members' lessons; owners their own layer; the CEO anything. */
  private mayReview(setup: OfficeSetup, actor: MemoryActor, item: MemoryItem): boolean {
    if (actor === "ceo" || actor === item.owner) return true;
    const head = setup.agents.find((a) => a.id === actor && a.role === "head");
    const writer = setup.agents.find((a) => a.id === item.scopeId);
    return !!head && (item.layer === "agent" || item.layer === "room") && (writer?.room === head.room || item.scopeId === head.room);
  }

  async flag(officeId: string, setup: OfficeSetup, actor: MemoryActor, id: string, reason: string) {
    const item = await this.mustGet(officeId, id);
    if (!this.canRead(setup, actor, item)) throw new MemoryError("You can't see that item.");
    const f = await this.store.flag(officeId, id, actor, reason);
    if (item.status === "active") await this.store.update(officeId, id, { status: "stale" });
    this.onChange(officeId);
    return { flag: f, owner: item.owner };
  }

  /* ---------------------------------------------------------------- read */

  async read(officeId: string, setup: OfficeSetup, actor: MemoryActor, id: string) {
    const item = await this.mustGet(officeId, id);
    if (!this.canRead(setup, actor, item)) throw new MemoryError("You can't see that item.");
    const [links, flags] = await Promise.all([this.store.links(officeId, id), this.store.openFlags(officeId, [id])]);
    const refresh = links.some((l) => l.from === id && l.kind === "derived_from" && l.needsRefresh);
    const warnings: string[] = [];
    if (item.status === "superseded") warnings.push(`Superseded${item.supersededBy ? ` by ${item.supersededBy}` : ""}: don't act on it.`);
    if (item.status === "stale" || flags.length) warnings.push(`Flagged stale: ${flags.flatMap((f) => f.reasons).join("; ") || "see the owner"}.`);
    if (refresh) warnings.push("The item it was derived from has changed since: check it, and refresh this one.");
    if (warnings.length && setup.agents.some((a) => a.id === actor)) await this.store.measure(officeId, "stale_reads");
    return { item, links, warnings };
  }

  async search(officeId: string, setup: OfficeSetup, actor: MemoryActor, query: string, limit = 8) {
    const scopes = this.readable(setup, actor);
    const hits = await this.store.search(officeId, query, { scopes: scopes ?? undefined, limit: limit * 2 });
    const convo = scopes ? (await this.store.search(officeId, query, { scopes: [["conversation"]], limit: limit * 2 })).filter((i) => this.canRead(setup, actor, i)) : [];
    return [...hits, ...convo].filter((i) => this.canRead(setup, actor, i)).slice(0, limit);
  }

  /** New lessons from a head's members since `since`, for their digest (they can reject any). */
  async digest(officeId: string, setup: OfficeSetup, headId: string, since: string) {
    const head = setup.agents.find((a) => a.id === headId && a.role === "head");
    if (!head) throw new MemoryError("Only heads get a digest.");
    const members = setup.agents.filter((a) => a.room === head.room && a.id !== head.id).map((a) => a.id);
    const items = await this.store.list(officeId, { scopes: members.map((m) => ["agent", m] as [Layer, string]), status: ["active", "proposed"], type: "lesson" });
    return items.filter((i) => i.createdAt > since);
  }

  /* --------------------------------------------------------------- brief */

  /**
   * What an agent's memory file says: its notes and lessons, its room's
   * memory, what heads see of company memory and the CEO's preferences, an
   * index of everything else it may read, and the bodies that bear on its
   * current tasks. Kept short: agents pull more with memory_read.
   */
  async brief(officeId: string, setup: OfficeSetup, agentId: string, currentWork: string[] = []): Promise<string> {
    const me = setup.agents.find((a) => a.id === agentId);
    if (!me) return "";
    const scopes = this.readable(setup, agentId)!;
    const visible = (await this.store.list(officeId, { scopes, status: ["active", "proposed", "stale"], limit: 300 })).filter((i) => this.canRead(setup, agentId, i));
    const convo = (await this.store.list(officeId, { scopes: [["conversation"]], status: ["active"], limit: 100 })).filter((i) => this.canRead(setup, agentId, i));
    const ids = [...visible, ...convo].map((i) => i.id);
    const flagged = new Set((await this.store.openFlags(officeId, ids)).map((f) => f.itemId));
    const refresh = new Set<string>();
    for (const i of visible.filter((x) => x.layer === "room" || x.layer === "agent")) {
      if ((await this.store.links(officeId, i.id)).some((l) => l.from === i.id && l.kind === "derived_from" && l.needsRefresh)) refresh.add(i.id);
    }
    const mark = (i: MemoryItem) =>
      [i.status === "proposed" ? " (waiting for approval)" : "", flagged.has(i.id) || i.status === "stale" ? " (flagged stale)" : "", refresh.has(i.id) ? " (its source changed: refresh it)" : ""].join("");
    const line = (i: MemoryItem, chars = 280) => `- [${i.id.slice(0, 8)}] **${i.title}**${mark(i)}: ${clip(i.body, chars)}`;

    const mine = visible.filter((i) => i.layer === "agent" && i.scopeId === agentId);
    const room = visible.filter((i) => i.layer === "room");
    const company = visible.filter((i) => i.layer === "company");
    const prefs = visible.filter((i) => i.layer === "ceo");
    const words = currentWork.join(" ").toLowerCase().match(/[a-z0-9]{4,}/g) ?? [];
    const shown = new Set([...mine.slice(0, 12), ...room.slice(0, 12)].map((i) => i.id));
    const relevant = words.length ? rankByWordsLocal([...visible, ...convo].filter((i) => !shown.has(i.id)), words).slice(0, 5) : [];
    for (const i of relevant) shown.add(i.id);
    const rest = [...visible, ...convo].filter((i) => !shown.has(i.id) && i.layer !== "short_term");

    const out: string[] = ["## What you know (office memory)", "", "Pull any item with memory_read(id); search with memory_search(query). Write lessons with memory_write when you learn something durable.", ""];
    out.push("### Your notes and lessons", ...(mine.length ? mine.slice(0, 12).map((i) => line(i)) : ["- Nothing yet."]), "");
    out.push(`### ${roomName(setup, me.room)} room`, ...(room.length ? room.slice(0, 12).map((i) => line(i)) : ["- Nothing yet."]), "");
    if (me.role === "head") {
      if (company.length) out.push("### Company (derive what your room needs into room memory)", ...company.slice(0, 8).map((i) => line(i, 200)), "");
      if (prefs.length) out.push("### The CEO's preferences", ...prefs.slice(0, 8).map((i) => line(i, 200)), "");
    }
    if (relevant.length) out.push("### Relevant to your current work", ...relevant.map((i) => line(i, 600)), "");
    if (rest.length) out.push("### Also in memory (titles; read when needed)", ...rest.slice(0, 30).map((i) => `- [${i.id.slice(0, 8)}] ${i.title}${mark(i)}`), "");
    const text = out.join("\n");
    await this.store.measure(officeId, "memory_tokens", Math.ceil(text.length / 4));
    return text;
  }

  /* ------------------------------------------------------------- helpers */

  private async conflicting(officeId: string, layer: Layer, scopeId: string, title: string, body: string, replaces?: string) {
    const same = await this.store.list(officeId, { scopes: [[layer, scopeId]], status: ["active"] });
    return same.find((i) => i.id !== replaces && similar(i.title, title) && i.body.trim() !== body.trim()) ?? null;
  }

  async mustGet(officeId: string, id: string): Promise<MemoryItem> {
    // Agents see 8-character ids in their brief; accept those too.
    const item = id.length === 8 ? (await this.store.list(officeId, { limit: 1000 })).find((i) => i.id.startsWith(id)) ?? null : await this.store.get(officeId, id);
    if (!item) throw new MemoryError(`No memory item "${id}".`);
    return item;
  }
}

export function ownerOf(setup: OfficeSetup, layer: Layer, scopeId: string): string {
  if (layer === "company" || layer === "ceo") return "ada";
  if (layer === "room") return setup.rooms.find((r) => r.id === scopeId)?.head ?? "ceo";
  if (layer === "agent" || layer === "short_term") return scopeId;
  return "system";
}

function nameOf(setup: OfficeSetup, id: string): string {
  if (id === "ada") return "Ada";
  if (id === "ceo") return "the CEO";
  return setup.agents.find((a) => a.id === id)?.name ?? id;
}

function roomName(setup: OfficeSetup, id: string): string {
  return setup.rooms.find((r) => r.id === id)?.name ?? id;
}

function clip(s: string, n: number): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
}

/** Same subject: titles equal, or one contains the other, ignoring case and punctuation. */
export function similar(a: string, b: string): boolean {
  const n = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
  const x = n(a);
  const y = n(b);
  return x === y || (x.length > 8 && y.includes(x)) || (y.length > 8 && x.includes(y));
}

function rankByWordsLocal(items: MemoryItem[], words: string[]): MemoryItem[] {
  const uniq = [...new Set(words)];
  return items
    .map((i) => ({ i, s: uniq.reduce((n, w) => n + (i.title.toLowerCase().includes(w) ? 2 : 0) + (i.body.toLowerCase().includes(w) ? 1 : 0), 0) }))
    .filter((x) => x.s >= 2)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.i);
}
