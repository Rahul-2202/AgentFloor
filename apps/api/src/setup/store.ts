import { defaultSetup, DEFAULT_POLICY, type Budget, type OfficeSetup, type RoomSetup } from "@agentfloor/shared/setup";
import type { AgentDef } from "@agentfloor/shared/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Change } from "../policy/engine.ts";

export interface VersionInfo {
  v: number;
  by: string;
  summary: string;
  readback: string[];
  createdAt: string;
}

/** Where office setups live, versioned. */
export interface SetupStore {
  /** The current setup and its version; a new office gets the default setup as version 1. */
  load(officeId: string): Promise<{ setup: OfficeSetup; version: number; pushed: number }>;
  /** Saves a new version if the setup is still at baseVersion; throws StaleSetupError otherwise. */
  apply(officeId: string, baseVersion: number, setup: OfficeSetup, by: string, summary: string, readback: string[], diff: Change[]): Promise<number>;
  versions(officeId: string): Promise<VersionInfo[]>;
  setupAt(officeId: string, v: number): Promise<OfficeSetup | null>;
  /** The office's daemon confirmed it runs this version. */
  markPushed(officeId: string, v: number): Promise<void>;
}

export class StaleSetupError extends Error {}

export function supabaseSetupStore(db: SupabaseClient): SetupStore {
  const check = <T>(r: { data: T; error: { message: string } | null }, what: string): NonNullable<T> => {
    if (r.error) {
      if (r.error.message.includes("stale_setup")) throw new StaleSetupError(r.error.message);
      throw new Error(`${what}: ${r.error.message}`);
    }
    return r.data as NonNullable<T>;
  };

  const store: SetupStore = {
    async load(officeId) {
      const office = check(await db.from("offices").select("name, config_version, config_pushed").eq("id", officeId).single(), "reading office");
      if (office.config_version === 0) {
        const seed = defaultSetup(office.name);
        await store.apply(officeId, 0, seed, "system", "Starting setup", ["The office opens with its starting rooms and agents."], []);
        return { setup: seed, version: 1, pushed: office.config_pushed };
      }
      const [rooms, agents, policy] = await Promise.all([
        db.from("rooms").select("*").eq("office_id", officeId).order("slot"),
        db.from("agents").select("*").eq("office_id", officeId).order("created_at"),
        db.from("policies").select("settings").eq("office_id", officeId).eq("scope", "office").eq("scope_id", "").maybeSingle(),
      ]);
      const settings = ((check(policy, "reading policy") as { settings?: object } | null)?.settings ?? {}) as { protocol?: object; budgets?: Budget[] };
      return {
        version: office.config_version,
        pushed: office.config_pushed,
        setup: {
          name: office.name,
          policy: { ...DEFAULT_POLICY, ...settings.protocol },
          budgets: settings.budgets ?? [],
          rooms: check(rooms, "reading rooms").map(
            (r): RoomSetup =>
              strip({ id: r.id, name: r.name, head: r.head_id, purpose: r.purpose, responsibilities: r.responsibilities, dod: r.definition_of_done, slot: r.slot }),
          ),
          agents: check(agents, "reading agents").map(
            (a): AgentDef =>
              strip({
                id: a.id,
                name: a.name,
                room: a.room_id,
                role: a.role,
                title: a.title,
                runtime: a.runtime,
                model: a.model,
                effort: a.effort,
                options: Object.keys(a.options ?? {}).length ? a.options : undefined,
              }),
          ),
        },
      };
    },
    async apply(officeId, baseVersion, setup, by, summary, readback, diff) {
      return check(
        await db.rpc("apply_office_setup", { oid: officeId, base_version: baseVersion, setup, by_actor: by, summary, readback, diff }),
        "saving setup",
      ) as number;
    },
    async versions(officeId) {
      const rows = check(
        await db.from("config_versions").select("v, by, summary, readback, created_at").eq("office_id", officeId).order("v", { ascending: false }).limit(100),
        "reading versions",
      );
      return rows.map((r) => ({ v: r.v, by: r.by, summary: r.summary, readback: r.readback, createdAt: r.created_at }));
    },
    async setupAt(officeId, v) {
      const row = check(await db.from("config_versions").select("setup").eq("office_id", officeId).eq("v", v).maybeSingle(), "reading version");
      return ((row as { setup?: OfficeSetup } | null)?.setup as OfficeSetup) ?? null;
    },
    async markPushed(officeId, v) {
      check(await db.from("offices").update({ config_pushed: v }).eq("id", officeId), "saving pushed version");
    },
  };
  return store;
}

/** In-memory store for tests. */
export function memorySetupStore(): SetupStore & { rows: Map<string, { versions: { v: number; setup: OfficeSetup; info: VersionInfo }[]; pushed: number }> } {
  const rows = new Map<string, { versions: { v: number; setup: OfficeSetup; info: VersionInfo }[]; pushed: number }>();
  const get = (id: string) => rows.get(id) ?? (rows.set(id, { versions: [], pushed: 0 }), rows.get(id)!);
  const store = {
    rows,
    async load(officeId: string) {
      const r = get(officeId);
      if (!r.versions.length) await store.apply(officeId, 0, defaultSetup("Test office"), "system", "Starting setup", [], []);
      const last = r.versions.at(-1)!;
      return { setup: structuredClone(last.setup), version: last.v, pushed: r.pushed };
    },
    async apply(officeId: string, baseVersion: number, setup: OfficeSetup, by: string, summary: string, readback: string[], _diff?: Change[]) {
      const r = get(officeId);
      const v = r.versions.at(-1)?.v ?? 0;
      if (v !== baseVersion) throw new StaleSetupError(`stale_setup: the setup changed (now v${v})`);
      r.versions.push({ v: v + 1, setup: structuredClone(setup), info: { v: v + 1, by, summary, readback, createdAt: new Date().toISOString() } });
      return v + 1;
    },
    async versions(officeId: string) {
      return get(officeId).versions.map((x) => x.info).reverse();
    },
    async setupAt(officeId: string, v: number) {
      return structuredClone(get(officeId).versions.find((x) => x.v === v)?.setup ?? null);
    },
    async markPushed(officeId: string, v: number) {
      get(officeId).pushed = v;
    },
  };
  return store;
}

function strip<T extends object>(o: T): T {
  for (const k of Object.keys(o)) {
    const v = (o as Record<string, unknown>)[k];
    if (v === null || v === undefined) delete (o as Record<string, unknown>)[k];
  }
  return o;
}
