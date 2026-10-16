import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { User } from "./auth.ts";

export interface Office {
  id: string;
  name: string;
  onboardedAt: string | null;
  sandboxState: string;
  daemonConnected: boolean;
}

/** Where offices live. Supabase in production; an in-memory store in tests. */
export interface OfficeStore {
  officeOf(userId: string): Promise<Office | null>;
  /** Creates the user's office if they have none; returns it either way. */
  ensureOffice(user: User): Promise<{ office: Office; created: boolean }>;
}

const COLUMNS = "id, name, onboarded_at, sandbox_state, daemon_connected";

function toOffice(row: Record<string, any>): Office {
  return {
    id: row.id,
    name: row.name,
    onboardedAt: row.onboarded_at,
    sandboxState: row.sandbox_state,
    daemonConnected: row.daemon_connected,
  };
}

export function defaultOfficeName(user: User): string {
  const who = user.name?.split(" ")[0] ?? user.githubLogin;
  return who ? `${who}'s office` : "My office";
}

/** A server-side Supabase client (service role: bypasses row-level security). */
export function serviceClient(url: string, secretKey: string): SupabaseClient {
  return createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function supabaseOfficeStore(db: SupabaseClient): OfficeStore {

  async function officeOf(userId: string): Promise<Office | null> {
    const { data, error } = await db.from("offices").select(COLUMNS).eq("owner_id", userId).maybeSingle();
    if (error) throw new Error(`reading office: ${error.message}`);
    return data ? toOffice(data) : null;
  }

  return {
    officeOf,
    async ensureOffice(user) {
      const existing = await officeOf(user.id);
      if (existing) return { office: existing, created: false };
      const { data, error } = await db
        .from("offices")
        .insert({ owner_id: user.id, name: defaultOfficeName(user) })
        .select(COLUMNS)
        .single();
      if (error) {
        // Two first requests at once: the other one created it (owner_id is unique).
        if (error.code === "23505") return { office: (await officeOf(user.id))!, created: false };
        throw new Error(`creating office: ${error.message}`);
      }
      await db.from("audit_log").insert({ office_id: data.id, actor: "system", action: "office.created" });
      return { office: toOffice(data), created: true };
    },
  };
}
