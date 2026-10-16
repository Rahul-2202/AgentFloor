import type { Office } from "../core/office.ts";
import { CEO, type AgentDef, type Message, type OfficeEvent } from "../core/types.ts";
import type { AgentRuntime } from "./types.ts";

/**
 * Runs one agent's runtime and decides when office messages reach it:
 * - idle: anything queued starts a turn straight away
 * - busy: questions reach it mid-task through its tool hooks (the runtime pulls
 *   them); everything else waits for the turn to end
 * - stop: interrupts the turn, then is delivered
 */
export class AgentHost {
  readonly agent: AgentDef;
  private readonly office: Office;
  private runtime: AgentRuntime;
  /** A runtime to switch to once the current turn ends. */
  private next: AgentRuntime | null = null;
  private busy = false;
  private stopped = false;
  private readonly onQueued: (to: string, m: Message) => void;
  private readonly onEvent: (ev: OfficeEvent) => void;

  constructor(office: Office, agent: AgentDef, runtime: AgentRuntime) {
    this.office = office;
    this.agent = agent;
    this.runtime = runtime;
    // Held (budget reached, terminal taken over): stop the turn, start none until released.
    this.onEvent = (ev) => {
      if (ev.data.agent !== this.agent.id) return;
      if (ev.type === "agent.held") {
        if (this.busy) void this.runtime.interrupt();
        else this.office.setStatus(this.agent.id, "stopped", `on hold: ${String(ev.data.reason)}`);
      } else if (ev.type === "agent.released") {
        this.office.setStatus(this.agent.id, "idle");
        setImmediate(() => void this.kick());
      }
    };
    this.onQueued = (to, m) => {
      if (to !== this.agent.id || this.stopped) return;
      if (m.urgency === "stop" && this.busy) void this.runtime.interrupt();
      // Let a burst of messages land before starting a turn.
      setImmediate(() => void this.kick());
    };
  }

  async start(): Promise<void> {
    await this.runtime.start();
    this.office.bus.on("queued", this.onQueued);
    this.office.bus.on("event", this.onEvent);
    const held = this.office.heldReason(this.agent.id);
    this.office.setStatus(this.agent.id, held ? "stopped" : "idle", held ? `on hold: ${held}` : "");
    const kickoff = this.agent.options?.kickoff;
    // The kickoff turn runs in the background: starting an agent doesn't wait for its work.
    // It runs once per office, not on every restart.
    if (typeof kickoff === "string" && this.office.firstTime(`kickoff:${this.agent.id}`)) void this.runTurn(kickoff, "starting", false);
    else void this.kick();
  }

  /**
   * Switches the agent to another runtime (or the same runtime with new
   * settings). A turn in progress finishes first; queued messages wait for the
   * new runtime.
   */
  async swap(runtime: AgentRuntime, detail: string): Promise<void> {
    this.next = runtime;
    this.office.setStatus(this.agent.id, this.busy ? "working" : "idle", this.busy ? `switching to ${detail} after this turn` : `switching to ${detail}`);
    if (!this.busy) await this.applySwap(detail);
  }

  private async applySwap(detail = ""): Promise<void> {
    const next = this.next;
    if (!next) return;
    this.next = null;
    await this.runtime.stop();
    this.runtime = next;
    await next.start();
    this.office.setStatus(this.agent.id, "idle", detail ? `now on ${detail}` : "");
    await this.kick();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.office.bus.off("queued", this.onQueued);
    this.office.bus.off("event", this.onEvent);
    await this.runtime.stop();
    this.office.setStatus(this.agent.id, "offline");
  }

  /**
   * Starts a turn with whatever is due, if the agent is free. FYIs alone don't
   * start one: a turn costs a full model call, so they wait and arrive with the
   * agent's next real turn.
   */
  async kick(): Promise<void> {
    if (this.busy || this.stopped || this.office.heldReason(this.agent.id)) return;
    const due = this.office.pending(this.agent.id, "turn_end");
    if (!due.length) return;
    if (due.every(isFyi)) {
      this.office.setStatus(this.agent.id, "idle", `${due.length} FYI${due.length > 1 ? "s" : ""} waiting for its next turn`);
      return;
    }
    const msgs = this.office.take(this.agent.id, "turn_end");
    await this.runTurn(this.office.render(msgs), describe(msgs), msgs.some((m) => m.urgency === "stop"), msgs.map((m) => m.threadId));
  }

  private async runTurn(input: string, detail: string, halted: boolean, threadIds: string[] = []): Promise<void> {
    this.busy = true;
    this.office.setWorkingOn(this.agent.id, threadIds);
    this.office.setStatus(this.agent.id, "working", detail);
    try {
      await this.runtime.turn(input);
    } catch (err) {
      this.office.setStatus(this.agent.id, "idle", `turn failed: ${(err as Error).message}`);
    } finally {
      this.busy = false;
      this.office.setWorkingOn(this.agent.id, []);
      this.office.setActivity(this.agent.id, null);
    }
    if (this.stopped) return;
    const held = this.office.heldReason(this.agent.id);
    if (held) return this.office.setStatus(this.agent.id, "stopped", `on hold: ${held}`);
    this.office.setStatus(this.agent.id, halted ? "stopped" : "idle");
    if (this.next) await this.applySwap();
    else await this.kick();
  }
}

/** Something to read, not act on: an agent's or the office's normal-urgency inform. The CEO's messages always wake an agent. */
export function isFyi(m: Message): boolean {
  return m.type === "inform" && m.urgency === "normal" && m.from !== CEO;
}

function describe(msgs: Message[]): string {
  const first = msgs[0]!;
  const what = first.type === "ask" ? "answering" : first.type === "request_work" ? "on a new task" : first.type === "huddle" ? "in a huddle" : "reading";
  return `${what} (${first.threadId})${msgs.length > 1 ? ` +${msgs.length - 1}` : ""}`;
}
