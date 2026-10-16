import type { OfficeEvent } from "@agentfloor/shared/types";
import type { WebSocket } from "ws";
import type { User, Verify } from "../auth.ts";
import type { OfficeHub } from "../link/hub.ts";
import type { Cloud, Terminal } from "../machines/cloud.ts";
import type { MachineStore } from "../machines/lifecycle.ts";
import type { OfficeStore } from "../offices.ts";

/**
 * Browser → API (one WebSocket per open office page):
 *   auth        {token}                     the Supabase access token, first
 *   takeover    {agent, cols, rows}         open a real terminal in the agent's folder; the agent is put on hold
 *   input       {data}  resize {cols, rows}
 *   handback    {}                          close the terminal; the agent carries on
 * API → browser:
 *   ready       {officeId}
 *   live        {event}                     session output and "thinking", as they happen
 *   terminal    {data} | terminal_closed {reason}
 *   error       {message}
 */
type ClientMsg =
  | { t: "auth"; token: string }
  | { t: "takeover"; agent: string; cols?: number; rows?: number }
  | { t: "input"; data: string }
  | { t: "resize"; cols: number; rows: number }
  | { t: "handback" };

export const TAKEOVER_HOLD = "the CEO took over the terminal";

export interface WatcherDeps {
  verify: Verify;
  offices: OfficeStore;
  hub: OfficeHub;
  /** For take-over; null when office machines aren't configured. */
  machines: { cloud: Cloud; store: MachineStore } | null;
}

export class Watchers {
  private readonly deps: WatcherDeps;
  private readonly byOffice = new Map<string, Set<WebSocket>>();

  constructor(deps: WatcherDeps) {
    this.deps = deps;
  }

  /** Sends a live event to everyone watching the office. */
  broadcast(officeId: string, event: OfficeEvent): void {
    for (const ws of this.byOffice.get(officeId) ?? []) send(ws, { t: "live", event });
  }

  watching(officeId: string): number {
    return this.byOffice.get(officeId)?.size ?? 0;
  }

  accept(ws: WebSocket): void {
    let user: User | null = null;
    let officeId: string | null = null;
    let terminal: { agent: string; t: Terminal } | null = null;
    const authTimer = setTimeout(() => ws.close(4401, "sign in first"), 10_000);

    const handback = async (reason: string) => {
      if (!terminal || !officeId) return;
      const { agent, t } = terminal;
      terminal = null;
      await t.close().catch(() => {});
      send(ws, { t: "terminal_closed", reason });
      if (this.deps.hub.isConnected(officeId)) await this.deps.hub.call(officeId, "ceo_release_agent", { agent }).catch(() => {});
    };

    ws.on("message", async (raw) => {
      let msg: ClientMsg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      try {
        if (!user) {
          if (msg.t !== "auth") return ws.close(4401, "sign in first");
          user = await this.deps.verify(msg.token).catch(() => null);
          if (!user) return ws.close(4401, "session expired or invalid");
          const office = await this.deps.offices.officeOf(user.id);
          if (!office) return ws.close(4404, "no office yet");
          clearTimeout(authTimer);
          officeId = office.id;
          const set = this.byOffice.get(officeId) ?? new Set();
          set.add(ws);
          this.byOffice.set(officeId, set);
          return send(ws, { t: "ready", officeId });
        }
        if (msg.t === "takeover") {
          const m = this.deps.machines;
          if (!m) return send(ws, { t: "error", message: "Office machines aren't set up on this server." });
          const { sandboxId, state } = await m.store.get(officeId!);
          if (!sandboxId || state !== "started") return send(ws, { t: "error", message: "Start the office first." });
          if (!/^[a-z][a-z0-9-]*$/.test(msg.agent)) return send(ws, { t: "error", message: "Unknown agent." });
          await handback("switched agent");
          // Park the agent first, so it doesn't type over the CEO.
          await this.deps.hub.call(officeId!, "ceo_hold_agent", { agent: msg.agent, reason: TAKEOVER_HOLD });
          const t = await m.cloud.openTerminal(sandboxId, {
            cwd: `~/office-data/agents/${msg.agent}/work`,
            cols: msg.cols ?? 100,
            rows: msg.rows ?? 30,
            onData: (data) => send(ws, { t: "terminal", data }),
            onExit: () => void handback("the terminal exited"),
          });
          terminal = { agent: msg.agent, t };
          return;
        }
        if (msg.t === "input") return void terminal?.t.input(msg.data);
        if (msg.t === "resize") return void terminal?.t.resize(msg.cols, msg.rows);
        if (msg.t === "handback") return void handback("handed back");
      } catch (err) {
        send(ws, { t: "error", message: (err as Error).message });
      }
    });

    ws.on("close", () => {
      clearTimeout(authTimer);
      if (officeId) this.byOffice.get(officeId)?.delete(ws);
      void handback("the browser closed");
    });
  }
}

function send(ws: WebSocket, msg: object): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}
