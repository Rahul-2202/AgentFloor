import type { SupabaseClient } from "@supabase/supabase-js";
import type { OfficeEvent } from "@agentfloor/shared/types";

/** What the office link needs from the database. */
export interface LinkStore {
  tokenHash(officeId: string): Promise<string | null>;
  setTokenHash(officeId: string, hash: string): Promise<void>;
  lastSeq(officeId: string): Promise<number>;
  /** Stores events (duplicates ignored); returns the highest seq stored. */
  ingest(officeId: string, events: OfficeEvent[]): Promise<number>;
  setConnected(officeId: string, connected: boolean): Promise<void>;
}

export function supabaseLinkStore(db: SupabaseClient): LinkStore {
  const check = <T>({ data, error }: { data: T; error: { message: string } | null }, what: string): T => {
    if (error) throw new Error(`${what}: ${error.message}`);
    return data;
  };
  return {
    async tokenHash(officeId) {
      return check(await db.rpc("office_token_hash", { oid: officeId }), "reading office token") as string | null;
    },
    async setTokenHash(officeId, hash) {
      check(await db.rpc("set_office_token", { oid: officeId, hash }), "saving office token");
    },
    async lastSeq(officeId) {
      const row = check(await db.from("offices").select("last_event_seq").eq("id", officeId).single(), "reading office");
      return Number(row?.last_event_seq ?? 0);
    },
    async ingest(officeId, events) {
      return Number(check(await db.rpc("ingest_office_events", { oid: officeId, events }), "storing events"));
    },
    async setConnected(officeId, connected) {
      check(
        await db.from("offices").update({ daemon_connected: connected, daemon_seen_at: new Date().toISOString() }).eq("id", officeId),
        "updating office health",
      );
    },
  };
}

/** In-memory store for tests. */
export function memoryLinkStore(): LinkStore & { events: Map<string, OfficeEvent[]>; connected: Map<string, boolean> } {
  const hashes = new Map<string, string>();
  const events = new Map<string, OfficeEvent[]>();
  const connected = new Map<string, boolean>();
  const top = (id: string) => Math.max(0, ...(events.get(id) ?? []).map((e) => e.seq));
  return {
    events,
    connected,
    async tokenHash(id) {
      return hashes.get(id) ?? null;
    },
    async setTokenHash(id, hash) {
      hashes.set(id, hash);
    },
    async lastSeq(id) {
      return top(id);
    },
    async ingest(id, batch) {
      const have = events.get(id) ?? [];
      const seen = new Set(have.map((e) => e.seq));
      events.set(id, [...have, ...batch.filter((e) => !seen.has(e.seq))].sort((a, b) => a.seq - b.seq));
      return top(id);
    },
    async setConnected(id, c) {
      connected.set(id, c);
    },
  };
}
