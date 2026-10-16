import type { Budget } from "@agentfloor/shared/setup";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { OfficeHub } from "./link/hub.ts";
import type { SetupStore } from "./setup/store.ts";

export const BUDGET_HOLD = "daily budget reached";

export interface SpendRow {
  agentId: string;
  roomId: string | null;
  calls: number;
  tokens: number;
  costUsd: number;
}

export function startOfDayUtc(now: Date): Date {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export interface BudgetStore {
  /** API-equivalent spend per agent since a time. */
  spendSince(officeId: string, since: Date): Promise<SpendRow[]>;
  /** Agents on hold, with why. */
  held(officeId: string): Promise<Map<string, string>>;
  /** An inbox item from the office itself; a second one with the same id is ignored. */
  alert(officeId: string, item: { id: string; title: string; body: string }): Promise<void>;
}

/**
 * Daily budgets per office, room and agent. Over the warning limit, the CEO
 * gets one inbox item a day; over the hard limit, the agents in scope are put
 * on hold (their turn stops, work waits) until they're back under it: a new
 * day, or a raised limit.
 */
export class Budgets {
  private readonly setups: SetupStore;
  private readonly store: BudgetStore;
  private readonly hub: OfficeHub;
  private readonly now: () => Date;

  constructor(setups: SetupStore, store: BudgetStore, hub: OfficeHub, now: () => Date = () => new Date()) {
    this.setups = setups;
    this.store = store;
    this.hub = hub;
    this.now = now;
  }

  async check(officeId: string): Promise<{ held: string[]; released: string[] }> {
    const { setup } = await this.setups.load(officeId);
    const spend = await this.store.spendSince(officeId, startOfDayUtc(this.now()));
    const day = this.now().toISOString().slice(0, 10);
    const roomName = (id: string) => setup.rooms.find((r) => r.id === id)?.name ?? id;
    const agentName = (id: string) => setup.agents.find((a) => a.id === id)?.name ?? id;

    const over = new Map<string, string>(); // agent → which budget
    for (const b of setup.budgets) {
      const rows = spend.filter((s) => b.scope === "office" || (b.scope === "room" ? s.roomId === b.id : s.agentId === b.id));
      const spent = rows.reduce((n, s) => n + s.costUsd, 0);
      const label = b.scope === "office" ? "The office" : b.scope === "room" ? roomName(b.id) : agentName(b.id);
      const key = `B-${day}-${b.scope}-${b.id || "office"}`;
      if (b.dailyUsdSoft != null && spent >= b.dailyUsdSoft) {
        await this.store.alert(officeId, {
          id: `${key}-soft`,
          title: `${label} passed its $${b.dailyUsdSoft} daily warning`,
          body: `${label} has spent $${spent.toFixed(2)} today (API-equivalent).${b.dailyUsdHard != null ? ` Work stops at $${b.dailyUsdHard}.` : ""}`,
        });
      }
      if (b.dailyUsdHard != null && spent >= b.dailyUsdHard) {
        await this.store.alert(officeId, {
          id: `${key}-hard`,
          title: `${label} reached its $${b.dailyUsdHard} daily limit`,
          body: `${label} has spent $${spent.toFixed(2)} today, so its agents are on hold until tomorrow (UTC). Raise the limit to let them carry on.`,
        });
        for (const a of inScope(b, setup.agents)) over.set(a, label);
      }
    }

    const result = { held: [] as string[], released: [] as string[] };
    if (!this.hub.isConnected(officeId)) return result;
    const held = await this.store.held(officeId);
    for (const [agent, label] of over) {
      if (held.has(agent)) continue;
      await this.hub.call(officeId, "ceo_hold_agent", { agent, reason: `${BUDGET_HOLD} (${label})` }).catch(() => {});
      result.held.push(agent);
    }
    for (const [agent, reason] of held) {
      if (!reason.startsWith(BUDGET_HOLD) || over.has(agent)) continue;
      await this.hub.call(officeId, "ceo_release_agent", { agent }).catch(() => {});
      result.released.push(agent);
    }
    return result;
  }
}

function inScope(b: Budget, agents: { id: string; room: string }[]): string[] {
  if (b.scope === "office") return agents.map((a) => a.id);
  if (b.scope === "room") return agents.filter((a) => a.room === b.id).map((a) => a.id);
  return agents.filter((a) => a.id === b.id).map((a) => a.id);
}

export function supabaseBudgetStore(db: SupabaseClient): BudgetStore {
  const ok = <T>(r: { data: T; error: { message: string } | null }, what: string): T => {
    if (r.error) throw new Error(`${what}: ${r.error.message}`);
    return r.data;
  };
  return {
    async spendSince(officeId, since) {
      const rows = ok(await db.rpc("office_spend", { oid: officeId, since: since.toISOString() }), "reading spend") as any[];
      return rows.map((r) => ({
        agentId: r.agent_id,
        roomId: r.room_id,
        calls: Number(r.calls),
        tokens: Number(r.input_tokens) + Number(r.output_tokens),
        costUsd: Number(r.cost_usd),
      }));
    },
    async held(officeId) {
      const rows = ok(await db.from("agents").select("id, held_reason").eq("office_id", officeId).not("held_reason", "is", null), "reading holds");
      return new Map(rows!.map((r) => [r.id, r.held_reason as string]));
    },
    async alert(officeId, item) {
      ok(
        await db.from("inbox_items").upsert(
          { office_id: officeId, id: item.id, kind: "budget", from: "office", title: item.title, body: item.body, priority: 1 },
          { onConflict: "office_id,id", ignoreDuplicates: true },
        ),
        "budget alert",
      );
    },
  };
}
