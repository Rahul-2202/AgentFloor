import { newOfficeToken } from "@agentfloor/shared/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LinkStore } from "../link/store.ts";
import type { Cloud } from "./cloud.ts";
import type { CodeBundle } from "./code.ts";

/** Where the office VM's id and state are kept (offices table). */
export interface MachineStore {
  get(officeId: string): Promise<{ sandboxId: string | null; state: string }>;
  /** sandboxId: a new machine's id, or null when it's gone. */
  set(officeId: string, patch: { sandboxId?: string | null; state: string; error?: string | null }): Promise<void>;
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
      if (p.sandboxId !== undefined) row.sandbox_id = p.sandboxId;
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
  /** "container" (stops when idle; the daemon restarts on start) or "vm" (pauses with memory kept). */
  kind?: "vm" | "container";
  /** Where the snapshot put the code. */
  appDir?: string;
  idleMinutes?: number;
  /** How long to wait for the daemon to dial in after a start. */
  connectTimeoutMs?: number;
  /** After resuming, how long to wait for a still-running daemon to reconnect before starting a new one. */
  resumeGraceMs?: number;
  touchEveryMs?: number;
  /** The daemon code machines should run; they're brought up to it on start. */
  code?: CodeBundle;
  log?: (msg: string) => void;
}

/** Where the office keeps its data (in the machine user's home, which survives stops). */
const DATA = "~/office-data";
const DAEMON_SESSION = "office-daemon";

/**
 * The office machine's life: created on the first start, resumed on later
 * ones, paused (VM, memory kept) or stopped (container, agents resume their
 * sessions on restart) when idle, kept awake while the office is busy.
 */
export class OfficeMachines {
  private readonly o: MachineOptions;
  private readonly busy = new Map<string, Promise<string>>();
  private readonly lastTouch = new Map<string, number>();

  private readonly kind: "vm" | "container";

  constructor(o: MachineOptions) {
    this.o = o;
    this.kind = o.kind ?? "container";
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
    if (this.kind === "container") {
      await this.o.machines.set(officeId, { state: "stopped" });
      await this.o.cloud.stop(m.sandboxId);
      return "stopped";
    }
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
      // A machine deleted outside AgentFloor (or destroyed by the provider): start afresh.
      if (m.sandboxId) {
        const state = await this.o.cloud.state(m.sandboxId).catch((err: Error) => (/not found/i.test(err.message) ? "destroyed" : Promise.reject(err)));
        if (state === "destroyed" || state === "destroying") {
          log(`office ${officeId}: machine ${m.sandboxId} is gone; creating a new one`);
          await this.o.machines.set(officeId, { sandboxId: null, state: "none" });
          m = { sandboxId: null, state: "none" };
        }
      }
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
          kind: this.kind,
          idleMinutes: this.o.idleMinutes ?? 15,
        });
        log(`office ${officeId}: created VM ${id}`);
        await this.o.machines.set(officeId, { sandboxId: id, state: "starting" });
        m = { sandboxId: id, state: "starting" };
        await this.ensureCode(id);
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
        // Older code: bring it up to date (the office's data stays), then restart the daemon.
        let restarted = false;
        if (await this.ensureCode(m.sandboxId)) {
          since = Date.now();
          await this.startDaemon(m.sandboxId);
          restarted = true;
        }
        // A resumed pause keeps the daemon running (give it a moment to reconnect);
        // after a stop, or if it's gone, it has to be started again.
        if (!restarted) {
          const resumed = state === "paused" || state === "pausing";
          const back = resumed ? await this.waitForDaemon(officeId, since, this.o.resumeGraceMs ?? 15_000) : (this.o.connectedSince(officeId) ?? -1) >= since;
          if (!back) await this.startDaemon(m.sandboxId);
        }
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

  /** Uploads this API's daemon code into the machine if it runs another version. True if it did. */
  private async ensureCode(sandboxId: string): Promise<boolean> {
    const code = this.o.code;
    if (!code) return false;
    const app = this.o.appDir ?? "/opt/agentfloor";
    const have = (await this.o.cloud.exec(sandboxId, `cat ${app}/.code-version 2>/dev/null || true`)).output.trim();
    if (have === code.version) return false;
    (this.o.log ?? (() => {}))(`machine ${sandboxId}: updating the office code (${have || "unknown"} → ${code.version})`);
    await this.o.cloud.upload(sandboxId, code.files.map((f) => ({ path: `${app.replace(/^~\//, "")}/${f.path}`, content: f.content })));
    const r = await this.o.cloud.exec(
      sandboxId,
      `export PATH="$HOME/.local/bin:$PATH"; cd ${app} && npm ci -w @agentfloor/daemon --omit=dev --no-audit --no-fund > /tmp/agentfloor-npm.log 2>&1 && echo ${code.version} > .code-version`,
      600,
    );
    if (r.exitCode !== 0) throw new Error(`couldn't update the office code (npm ci failed: ${(await this.o.cloud.exec(sandboxId, "tail -5 /tmp/agentfloor-npm.log")).output.trim()})`);
    return true;
  }

  private async startDaemon(sandboxId: string): Promise<void> {
    await this.o.cloud.exec(sandboxId, "pkill -f src/daemon/main.ts || true");
    await this.o.cloud.runInBackground(
      sandboxId,
      DAEMON_SESSION,
      // On VMs, Node and Claude Code live in ~/.local/bin (see infra/build-office-snapshot.ts).
      // NODE_USE_ENV_PROXY: the daemon's own requests (the model gateway) must go through Daytona's
      // outbound proxy like everything else, or the Claude secret's placeholder reaches Anthropic
      // unreplaced (401). Node's fetch ignores HTTPS_PROXY without it.
      `export PATH="$HOME/.local/bin:$PATH" NODE_USE_ENV_PROXY=1; mkdir -p ${DATA} && cd ${this.o.appDir ?? "/opt/agentfloor"} && npm run daemon -w @agentfloor/daemon -- --data ${DATA} >> ${DATA}/daemon.log 2>&1`,
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
