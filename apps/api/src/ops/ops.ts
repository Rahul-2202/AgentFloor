/**
 * Running AgentFloor: who may sign in (the allowlist, and admins), errors from
 * the web app, the API and the offices, what offices cost (model spend and
 * machine hours), and backups of office memory.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { User } from "../auth.ts";

/* ----------------------------------------------------------------- access */

export interface Access {
  /** Whether this user may use AgentFloor, and whether they run it. */
  check(user: User): Promise<{ allowed: boolean; admin: boolean }>;
  list(): Promise<AllowEntry[]>;
  add(e: { githubLogin?: string; email?: string; note?: string; admin?: boolean }): Promise<void>;
  remove(id: number): Promise<void>;
  /** Someone signed in who isn't on the list yet: admins see them in /admin. */
  request(user: User): Promise<void>;
  /** Those still waiting (not let in, not dismissed), newest first. */
  requests(): Promise<AccessRequest[]>;
  dismiss(id: number): Promise<void>;
}
export interface AccessRequest {
  id: number;
  userId: string;
  githubLogin: string | null;
  email: string | null;
  name: string | null;
  firstAt: string;
  lastAt: string;
}
export interface AllowEntry {
  id: number;
  githubLogin: string | null;
  email: string | null;
  note: string | null;
  admin: boolean;
}

export function supabaseAccess(db: SupabaseClient): Access {
  let cache: { at: number; rows: AllowEntry[] } | null = null;
  const asked = new Map<string, number>();
  const rows = async (): Promise<AllowEntry[]> => {
    if (cache && Date.now() - cache.at < 60_000) return cache.rows;
    const { data, error } = await db.from("allowlist").select("id, github_login, email, note, admin").order("id");
    if (error) throw new Error(`reading the allowlist: ${error.message}`);
    const list = (data ?? []).map((r) => ({ id: r.id, githubLogin: r.github_login, email: r.email, note: r.note, admin: r.admin }));
    cache = { at: Date.now(), rows: list };
    return list;
  };
  return {
    async check(user) {
      const login = user.githubLogin?.toLowerCase();
      const email = user.email?.toLowerCase();
      const hit = (await rows()).find((r) => (login && r.githubLogin?.toLowerCase() === login) || (email && r.email?.toLowerCase() === email));
      return { allowed: !!hit, admin: !!hit?.admin };
    },
    list: async () => {
      cache = null;
      return rows();
    },
    async add(e) {
      if (!e.githubLogin && !e.email) throw new Error("A GitHub login or an email is needed.");
      const { error } = await db.from("allowlist").insert({ github_login: e.githubLogin || null, email: e.email || null, note: e.note || null, admin: !!e.admin });
      if (error) throw new Error(error.message.includes("duplicate") ? "They're already on the list." : error.message);
      cache = null;
    },
    async remove(id) {
      const { error } = await db.from("allowlist").delete().eq("id", id);
      if (error) throw new Error(error.message);
      cache = null;
    },
    async request(user) {
      // The waiting page checks again every so often: a write every few minutes is plenty.
      if (Date.now() - (asked.get(user.id) ?? 0) < 5 * 60_000) return;
      asked.set(user.id, Date.now());
      const { error } = await db
        .from("access_requests")
        .upsert({ user_id: user.id, github_login: user.githubLogin, email: user.email, name: user.name, last_at: new Date().toISOString() }, { onConflict: "user_id" });
      if (error) throw new Error(`recording an access request: ${error.message}`);
    },
    async requests() {
      const { data, error } = await db.from("access_requests").select("id, user_id, github_login, email, name, first_at, last_at").is("dismissed_at", null).order("last_at", { ascending: false });
      if (error) throw new Error(`reading access requests: ${error.message}`);
      const list = await rows();
      const listed = (r: { github_login: string | null; email: string | null }) =>
        list.some((e) => (r.github_login && e.githubLogin?.toLowerCase() === r.github_login.toLowerCase()) || (r.email && e.email?.toLowerCase() === r.email.toLowerCase()));
      return (data ?? []).filter((r) => !listed(r)).map((r) => ({ id: r.id, userId: r.user_id, githubLogin: r.github_login, email: r.email, name: r.name, firstAt: r.first_at, lastAt: r.last_at }));
    },
    async dismiss(id) {
      const { error } = await db.from("access_requests").update({ dismissed_at: new Date().toISOString() }).eq("id", id);
      if (error) throw new Error(error.message);
    },
  };
}

/* ----------------------------------------------------------------- errors */

export type ErrorSource = "web" | "api" | "office";
export interface ErrorLog {
  record(source: ErrorSource, message: string, o?: { stack?: string; officeId?: string | null; context?: object }): void;
}

/** Ids, numbers and quoted bits vary between occurrences of the same error. */
export function fingerprint(source: string, message: string): string {
  const norm = message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>")
    .replace(/\b[A-Z]-\d+\b/g, "<ref>")
    .replace(/\d+/g, "<n>")
    .replace(/"[^"]*"/g, '"…"')
    .slice(0, 300);
  return `${source}:${norm}`;
}

export function supabaseErrorLog(db: SupabaseClient, log: (m: string) => void = () => {}): ErrorLog {
  // The same error in a burst is written once a minute (its count still goes up then).
  const recent = new Map<string, number>();
  return {
    record(source, message, o = {}) {
      const fp = fingerprint(source, message);
      const now = Date.now();
      if (now - (recent.get(fp) ?? 0) < 60_000) return;
      recent.set(fp, now);
      if (recent.size > 2000) recent.clear();
      void db
        .rpc("record_error", { fp, src: source, oid: o.officeId ?? null, msg: message, stk: o.stack ?? null, ctx: o.context ?? {} })
        .then(({ error }) => error && log(`recording an error: ${error.message}`));
    },
  };
}

/* ------------------------------------------------------------------ admin */

export interface AdminData {
  overview(): Promise<object>;
  errors(limit: number): Promise<object[]>;
  memoryExport(officeId: string): Promise<object>;
}

const DAY = 86_400_000;

export function supabaseAdminData(db: SupabaseClient): AdminData {
  const ok = <T>(r: { data: T | null; error: { message: string } | null }, what: string): NonNullable<T> => {
    if (r.error) throw new Error(`${what}: ${r.error.message}`);
    return (r.data ?? []) as NonNullable<T>;
  };
  return {
    async overview() {
      const since30 = new Date(Date.now() - 30 * DAY).toISOString();
      const [offices, profiles, usage, runs, errs] = await Promise.all([
        db.from("offices").select("id, owner_id, name, created_at, onboarded_at, sandbox_state, daemon_connected, daemon_seen_at"),
        db.from("profiles").select("id, github_login"),
        db.from("usage_events").select("office_id, cost_usd, created_at").gte("created_at", since30).limit(50_000),
        db.from("machine_runs").select("office_id, started_at, stopped_at").or(`stopped_at.is.null,stopped_at.gte.${since30}`).limit(20_000),
        db.from("errors").select("office_id, count, last_seen").gte("last_seen", new Date(Date.now() - DAY).toISOString()),
      ]);
      const login = new Map(ok(profiles, "profiles").map((p) => [p.id, p.github_login]));
      const spend = (id: string, days: number) =>
        ok(usage, "usage")
          .filter((u) => u.office_id === id && Date.parse(u.created_at) >= Date.now() - days * DAY)
          .reduce((n, u) => n + Number(u.cost_usd ?? 0), 0);
      const hours = (id: string, days: number) => {
        const from = Date.now() - days * DAY;
        return (
          ok(runs, "machine runs")
            .filter((r) => r.office_id === id)
            .reduce((n, r) => n + Math.max(0, (r.stopped_at ? Date.parse(r.stopped_at) : Date.now()) - Math.max(from, Date.parse(r.started_at))), 0) / 3_600_000
        );
      };
      const list = ok(offices, "offices").map((o) => ({
        id: o.id,
        name: o.name,
        owner: login.get(o.owner_id) ?? null,
        createdAt: o.created_at,
        onboarded: !!o.onboarded_at,
        machine: o.sandbox_state,
        connected: o.daemon_connected,
        seenAt: o.daemon_seen_at,
        spend: { today: round(spend(o.id, 1)), week: round(spend(o.id, 7)), month: round(spend(o.id, 30)) },
        machineHours: { week: round(hours(o.id, 7), 1), month: round(hours(o.id, 30), 1) },
        errors24h: ok(errs, "errors").filter((e) => e.office_id === o.id).reduce((n, e) => n + e.count, 0),
      }));
      const sum = (f: (x: (typeof list)[number]) => number) => round(list.reduce((n, x) => n + f(x), 0));
      return {
        offices: list,
        totals: {
          offices: list.length,
          running: list.filter((o) => o.machine === "started").length,
          spend: { today: sum((o) => o.spend.today), week: sum((o) => o.spend.week), month: sum((o) => o.spend.month) },
          machineHours: { week: sum((o) => o.machineHours.week), month: sum((o) => o.machineHours.month) },
          errors24h: ok(errs, "errors").reduce((n, e) => n + e.count, 0),
        },
      };
    },
    async errors(limit) {
      return ok(await db.from("errors").select("*").order("last_seen", { ascending: false }).limit(limit), "errors");
    },
    async memoryExport(officeId) {
      const [items, versions, links] = await Promise.all([
        db.from("memory_items").select("*").eq("office_id", officeId),
        db.from("memory_versions").select("*").eq("office_id", officeId),
        db.from("memory_links").select("*").eq("office_id", officeId),
      ]);
      return {
        officeId,
        exportedAt: new Date().toISOString(),
        items: ok(items, "memory"),
        versions: ok(versions, "memory versions"),
        links: ok(links, "memory links"),
      };
    },
  };
}

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

/* ---------------------------------------------------------------- backups */

/** Each office's memory as JSON in the private "backups" bucket; the last 30 days are kept. */
export async function backupMemory(db: SupabaseClient, admin: AdminData, now = new Date()): Promise<{ offices: number }> {
  const day = now.toISOString().slice(0, 10);
  const { data: offices, error } = await db.from("offices").select("id");
  if (error) throw new Error(`listing offices: ${error.message}`);
  for (const o of offices ?? []) {
    const body = JSON.stringify(await admin.memoryExport(o.id));
    const up = await db.storage.from("backups").upload(`memory/${o.id}/${day}.json`, body, { contentType: "application/json", upsert: true });
    if (up.error) throw new Error(`backing up ${o.id}: ${up.error.message}`);
    const listed = await db.storage.from("backups").list(`memory/${o.id}`, { limit: 200, sortBy: { column: "name", order: "desc" } });
    const old = (listed.data ?? []).slice(30).map((f) => `memory/${o.id}/${f.name}`);
    if (old.length) await db.storage.from("backups").remove(old);
  }
  return { offices: offices?.length ?? 0 };
}
