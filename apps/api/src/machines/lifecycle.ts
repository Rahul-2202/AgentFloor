import { newOfficeToken } from "@agentfloor/shared/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LinkStore } from "../link/store.ts";
import type { Cloud } from "./cloud.ts";

/** Where the office VM's id and state are kept (offices table). */
export interface MachineStore {
  get(officeId: string): Promise<{ sandboxId: string | null; state: string }>;
  set(officeId: string, patch: { sandboxId?: string; state: string; error?: string | null }): Promise<void>;
}

export function supabaseMachineStore(db: SupabaseClient): MachineStore {
  return {
    async get(officeId) {
      const { data, error } = await db.from("offices").select("sandbox_id, sandbox_state").eq("id", officeId).single();
      if (error) throw new Error(`reading office machine: ${error.message}`);
      return { sandboxId: data.sandbox_id, state: data.sandbox_state };
    },
    async set(officeId, p) {
      const row: Record<string, unknown> = { sandbox_state: p.state, sandbox_error: p.error ?? null };
      if (p.sandboxId) row.sandbox_id = p.sandboxId;
      const { error } = await db.from("offices").update(row).eq("id", officeId);
      if (error) throw new Error(`saving office machine: ${error.message}`);
    },
  };
}

export interface MachineOptions {
  cloud: Cloud;
  machines: MachineStore;
  link: LinkStore;
  /** When the office's daemon connected (ms), or null if it isn't. */
  connectedSince: (officeId: string) => number | null;
  /** Daytona snapshot built by infra/build-office-snapshot.ts. */
  snapshot: string;
  /** wss://<api>/office-link, as the VM reaches it. */
  linkUrl: string;
  /** Provider secret holding the Claude credential (limited to api.anthropic.com). */
  claudeSecret: string;
  autoPauseMinutes?: number;
  /** How long to wait for the daemon to dial in after a start. */
  connectTimeoutMs?: number;
  /** After resuming, how long to wait for a still-running daemon to reconnect before starting a new one. */
  resumeGraceMs?: number;
  touchEveryMs?: number;
  log?: (msg: string) => void;
}

/** Where the snapshot puts the code, and where the office keeps its data (in the VM user's home). */
const APP = "~/agentfloor";
const DATA = "~/office-data";
const DAEMON_SESSION = "office-daemon";

/**
 * The office VM's life: created on the first start, resumed on later ones,
 * paused when idle (memory kept, so agents carry on where they were), kept
 * awake while the office is busy.
 */
export class OfficeMachines {
  private readonly o: MachineOptions;
  private readonly busy = new Map<string, Promise<string>>();
  private readonly lastTouch = new Map<string, number>();

  constructor(o: MachineOptions) {
    this.o = o;
  }

  /** Creates or resumes the office VM and waits for its daemon. Returns the state. */
  start(officeId: string): Promise<string> {
    // One start at a time per office; a second click joins the first.
    const running = this.busy.get(officeId);
    if (running) return running;
    const p = this.doStart(officeId).finally(() => this.busy.delete(officeId));
    this.busy.set(officeId, p);
    return p;
  }

  async pause(officeId: string): Promise<string> {
    const m = await this.o.machines.get(officeId);
    if (!m.sandboxId) return m.state;
    await this.o.machines.set(officeId, { state: "pausing" });
    await this.o.cloud.pause(m.sandboxId);
    await this.o.machines.set(officeId, { state: "paused" });
    return "paused";
  }

  /** The office did something: keep its VM awake (at most one call per interval). */
  async activity(officeId: string): Promise<void> {
    const now = Date.now();
    if (now - (this.lastTouch.get(officeId) ?? 0) < (this.o.touchEveryMs ?? 5 * 60_000)) return;
    this.lastTouch.set(officeId, now);
    const m = await this.o.machines.get(officeId);
    if (m.sandboxId && m.state === "started") await this.o.cloud.touch(m.sandboxId);
  }

  /** Reads the VM's real state (it may have auto-paused) and saves it. */
  async refresh(officeId: string): Promise<string> {
    const m = await this.o.machines.get(officeId);
    if (!m.sandboxId) return m.state;
    const state = normalize(await this.o.cloud.state(m.sandboxId));
    if (state !== m.state) await this.o.machines.set(officeId, { state });
    return state;
  }

  private async doStart(officeId: string): Promise<string> {
    const log = this.o.log ?? (() => {});
    let m = await this.o.machines.get(officeId);
    let since = 0;
    try {
      if (!m.sandboxId) {
        await this.o.machines.set(officeId, { state: "creating" });
        // A fresh token per VM; only its hash is kept.
        const { token, hash } = newOfficeToken(officeId);
        await this.o.link.setTokenHash(officeId, hash);
        const { id } = await this.o.cloud.create({
          snapshot: this.o.snapshot,
          labels: { app: "agentfloor", office: officeId },
          env: { AGENTFLOOR_LINK_URL: this.o.linkUrl, AGENTFLOOR_OFFICE_TOKEN: token },
          secrets: { AGENTFLOOR_CLAUDE_TOKEN: this.o.claudeSecret },
          autoPauseMinutes: this.o.autoPauseMinutes ?? 15,
        });
        log(`office ${officeId}: created VM ${id}`);
        await this.o.machines.set(officeId, { sandboxId: id, state: "starting" });
        m = { sandboxId: id, state: "starting" };
        await this.startDaemon(id);
      } else {
        const state = normalize(await this.o.cloud.state(m.sandboxId));
        if (state !== "started") {
          await this.o.machines.set(officeId, { state: "starting" });
          // Only a connection made after this start counts: the old one may not have been dropped yet.
          since = Date.now();
          await this.o.cloud.start(m.sandboxId);
          log(`office ${officeId}: resumed VM from ${state}`);
        }
        // A resumed pause keeps the daemon running; after a stop it has to be started again.
        if (!(await this.waitForDaemon(officeId, since, this.o.resumeGraceMs ?? 15_000))) await this.startDaemon(m.sandboxId);
      }
      if (!(await this.waitForDaemon(officeId, since, this.o.connectTimeoutMs ?? 60_000))) {
        throw new Error("the office started but its daemon didn't connect");
      }
      await this.o.machines.set(officeId, { state: "started" });
      return "started";
    } catch (err) {
      const message = (err as Error).message;
      log(`office ${officeId}: ${message}`);
      await this.o.machines.set(officeId, { state: "error", error: message }).catch(() => {});
      throw err;
    }
  }

  private async startDaemon(sandboxId: string): Promise<void> {
    await this.o.cloud.exec(sandboxId, "pkill -f src/daemon/main.ts || true");
    await this.o.cloud.runInBackground(
      sandboxId,
      DAEMON_SESSION,
      // Node and Claude Code live in ~/.local/bin (see infra/build-office-snapshot.ts).
      `export PATH="$HOME/.local/bin:$PATH"; mkdir -p ${DATA} && cd ${APP} && npm run daemon -w @agentfloor/daemon -- --data ${DATA} >> ${DATA}/daemon.log 2>&1`,
    );
  }

  /** Waits for a daemon connection made at or after `since`. */
  private async waitForDaemon(officeId: string, since: number, ms: number): Promise<boolean> {
    const ok = () => (this.o.connectedSince(officeId) ?? -1) >= since;
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (ok()) return true;
      await new Promise((r) => setTimeout(r, 250));
    }
    return ok();
  }
}

/** Daytona's states, folded into the ones the office shows. */
export function normalize(state: string): string {
  switch (state) {
    case "started":
    case "paused":
    case "stopped":
    case "archived":
    case "error":
      return state;
    case "pausing":
      return "pausing";
    case "starting":
    case "resuming":
    case "restoring":
    case "creating":
    case "pulling_snapshot":
      return "starting";
    case "stopping":
    case "archiving":
      return "stopped";
    case "build_failed":
    case "destroyed":
    case "destroying":
      return "error";
    default:
      return "starting";
  }
}
