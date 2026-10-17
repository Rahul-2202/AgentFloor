/**
 * Each office runs on its CEO's own Claude login: the token from
 * `claude setup-token` (their Pro, Max or Team plan). It's stored encrypted
 * (Supabase Vault), used by Ada for that office, and given to the office
 * machine as a Daytona secret that only reaches api.anthropic.com: agents see
 * a placeholder, never the token.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface ClaudeStatus {
  set: boolean;
  last4: string | null;
  /** "ok", or "invalid" once Claude has refused it. */
  status: "ok" | "invalid" | null;
  setAt: string | null;
  problem?: string | null;
}

export interface ClaudeTokenStore {
  status(officeId: string): Promise<ClaudeStatus>;
  get(officeId: string): Promise<string | null>;
  save(officeId: string, token: string): Promise<void>;
  markInvalid(officeId: string, why: string): Promise<void>;
}

export class ClaudeTokenError extends Error {}

/** The office machine's secret holding its token (one per office). */
export const secretNameFor = (officeId: string) => `agentfloor-claude-${officeId}`;

export class ClaudeTokens {
  private readonly store: ClaudeTokenStore;
  private readonly o: {
    /** Puts the token in the office's machine secret (null when there are no machines). */
    syncSecret?: ((name: string, token: string) => Promise<void>) | null;
    /** Checks a token with Anthropic: "ok", "invalid", or "unknown" (couldn't tell). */
    verify?: (token: string) => Promise<"ok" | "invalid" | "unknown">;
    log?: (msg: string) => void;
  };

  constructor(store: ClaudeTokenStore, o: ClaudeTokens["o"] = {}) {
    this.store = store;
    this.o = o;
  }

  status(officeId: string): Promise<ClaudeStatus> {
    return this.store.status(officeId);
  }

  /** The token for Ada and the office machine; a clear error when there isn't a usable one. */
  async need(officeId: string): Promise<string> {
    const token = await this.store.get(officeId);
    if (!token) throw new ClaudeTokenError("Add your Claude token first: run `claude setup-token` and paste it in Rules & settings → Integrations.");
    return token;
  }

  async set(officeId: string, raw: string): Promise<ClaudeStatus> {
    const token = raw.trim();
    if (!/^sk-ant-[a-z0-9]+-[\w-]{20,}$/i.test(token)) throw new ClaudeTokenError("That doesn't look like a Claude token. It starts with sk-ant-oat01- (from `claude setup-token`).");
    const check = (await this.o.verify?.(token).catch(() => "unknown" as const)) ?? "unknown";
    if (check === "invalid") throw new ClaudeTokenError("Claude didn't accept that token. Run `claude setup-token` again and paste the new one.");
    await this.store.save(officeId, token);
    await this.o.syncSecret?.(secretNameFor(officeId), token);
    return this.store.status(officeId);
  }

  /** The office's machine secret, refreshed from the stored token (before the machine starts). */
  async secretFor(officeId: string): Promise<string> {
    const token = await this.need(officeId);
    await this.o.syncSecret?.(secretNameFor(officeId), token);
    return secretNameFor(officeId);
  }

  /** Claude refused the token (Ada or an agent): the office asks for a new one. */
  async refused(officeId: string, why: string): Promise<void> {
    const s = await this.store.status(officeId);
    if (!s.set || s.status === "invalid") return;
    await this.store.markInvalid(officeId, why.slice(0, 300));
    this.o.log?.(`office ${officeId}: Claude token refused: ${why.slice(0, 120)}`);
  }
}

/** Claude's answer to a bad or expired login. */
export const looksLikeAuthFailure = (msg: string) => /\b401\b|invalid bearer|authentication_error|oauth token (has )?expired|invalid x-api-key|not logged in|please run \/login/i.test(msg);

/** Asks Anthropic whether a token works (a models list costs nothing). */
export async function verifyWithAnthropic(token: string): Promise<"ok" | "invalid" | "unknown"> {
  const res = await fetch("https://api.anthropic.com/v1/models?limit=1", {
    headers: { authorization: `Bearer ${token}`, "anthropic-version": "2023-06-01" },
  });
  if (res.ok) return "ok";
  if (res.status === 401 || res.status === 403) return "invalid";
  return "unknown";
}

export function supabaseClaudeTokens(db: SupabaseClient): ClaudeTokenStore {
  return {
    async status(officeId) {
      const { data, error } = await db.from("integrations").select("config, secret_id").eq("office_id", officeId).eq("provider", "claude").maybeSingle();
      if (error) throw new Error(`reading the Claude token: ${error.message}`);
      const c = (data?.config ?? {}) as { last4?: string; status?: "ok" | "invalid"; setAt?: string; problem?: string };
      return { set: !!data?.secret_id, last4: c.last4 ?? null, status: data?.secret_id ? (c.status ?? "ok") : null, setAt: c.setAt ?? null, problem: c.problem ?? null };
    },
    async get(officeId) {
      const { data, error } = await db.rpc("claude_token", { oid: officeId });
      if (error) throw new Error(`reading the Claude token: ${error.message}`);
      return (data as string | null) ?? null;
    },
    async save(officeId, token) {
      const { error } = await db.rpc("set_claude_token", { oid: officeId, token, last4: token.slice(-4) });
      if (error) throw new Error(`saving the Claude token: ${error.message}`);
    },
    async markInvalid(officeId, why) {
      const { data } = await db.from("integrations").select("config").eq("office_id", officeId).eq("provider", "claude").maybeSingle();
      const { error } = await db
        .from("integrations")
        .update({ config: { ...(data?.config ?? {}), status: "invalid", problem: why }, updated_at: new Date().toISOString() })
        .eq("office_id", officeId)
        .eq("provider", "claude");
      if (error) throw new Error(`marking the Claude token: ${error.message}`);
    },
  };
}

export function memoryClaudeTokens(): ClaudeTokenStore & { tokens: Map<string, string> } {
  const tokens = new Map<string, string>();
  const meta = new Map<string, { status: "ok" | "invalid"; setAt: string; problem?: string }>();
  return {
    tokens,
    status: async (o) => ({ set: tokens.has(o), last4: tokens.get(o)?.slice(-4) ?? null, status: meta.get(o)?.status ?? null, setAt: meta.get(o)?.setAt ?? null, problem: meta.get(o)?.problem ?? null }),
    get: async (o) => tokens.get(o) ?? null,
    save: async (o, t) => {
      tokens.set(o, t);
      meta.set(o, { status: "ok", setAt: new Date().toISOString() });
    },
    markInvalid: async (o, why) => void meta.set(o, { ...(meta.get(o) ?? { setAt: "" }), status: "invalid", problem: why }),
  };
}
