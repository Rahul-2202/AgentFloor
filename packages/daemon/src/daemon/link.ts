import { CLOSE_BAD_TOKEN, type ApiMessage, type DaemonMessage } from "@agentfloor/shared/link";
import type { Office } from "../core/office.ts";
import { runTool } from "../core/tools.ts";
import { CEO, OfficeError, type OfficeEvent } from "../core/types.ts";

export interface LinkOptions {
  office: Office;
  /** wss://<api>/office-link */
  url: string;
  /** The office token (afo_…), given to the VM when the office is created. */
  token: string;
  log?: (line: string) => void;
  /** How long to gather events before sending a batch. */
  batchMs?: number;
  maxBackoffMs?: number;
}

export type LinkState = "connecting" | "open" | "closed" | "rejected";

/**
 * The daemon's side of the office link. Dials out to the Control API, sends
 * every event the API hasn't stored (from the local SQLite log, so nothing is
 * lost while offline), streams new ones, and answers the API's CEO calls.
 * Reconnects with backoff until stopped or the token is rejected.
 */
export class OfficeLink {
  state: LinkState = "closed";
  /** Highest seq the API has acknowledged. */
  acked = 0;
  private ws: WebSocket | null = null;
  private sent = 0;
  private pending: OfficeEvent[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private backoff = 500;
  private stopped = false;
  private readonly log: (line: string) => void;
  private readonly onEvent = (ev: OfficeEvent) => {
    if (this.state !== "open" || ev.seq <= this.sent) return;
    this.pending.push(ev);
    this.flushTimer ??= setTimeout(() => this.flush(), this.opts.batchMs ?? 100);
  };

  private readonly opts: LinkOptions;

  constructor(opts: LinkOptions) {
    this.opts = opts;
    this.log = opts.log ?? ((l) => console.log(`[link] ${l}`));
  }

  start(): void {
    this.stopped = false;
    this.opts.office.bus.on("event", this.onEvent);
    this.connect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.opts.office.bus.off("event", this.onEvent);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flush();
    const ws = this.ws;
    if (ws && ws.readyState === WebSocket.OPEN) {
      await new Promise<void>((ok) => {
        ws.addEventListener("close", () => ok(), { once: true });
        ws.close(1000, "daemon stopping");
        setTimeout(ok, 1000);
      });
    }
    this.state = "closed";
  }

  private connect(): void {
    this.state = "connecting";
    const ws = new WebSocket(this.opts.url);
    this.ws = ws;
    ws.addEventListener("open", () => this.send({ t: "hello", token: this.opts.token, version: "1" }));
    ws.addEventListener("message", (e) => this.onMessage(JSON.parse(String(e.data)) as ApiMessage));
    ws.addEventListener("error", () => {}); // followed by close
    ws.addEventListener("close", (e) => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.flushTimer) clearTimeout(this.flushTimer);
      this.flushTimer = null;
      this.pending = [];
      if (e.code === CLOSE_BAD_TOKEN) {
        this.state = "rejected";
        this.log("the API rejected the office token; not retrying");
        return;
      }
      this.state = "closed";
      if (this.stopped) return;
      const wait = this.backoff;
      this.backoff = Math.min(this.backoff * 2, this.opts.maxBackoffMs ?? 30_000);
      this.log(`disconnected (${e.code}); retrying in ${wait} ms`);
      this.retryTimer = setTimeout(() => this.connect(), wait);
    });
  }

  private onMessage(msg: ApiMessage): void {
    switch (msg.t) {
      case "welcome": {
        this.state = "open";
        this.backoff = 500;
        this.acked = msg.lastSeq;
        this.sent = msg.lastSeq;
        this.log(`connected; the API has events up to ${msg.lastSeq}`);
        this.replay();
        return;
      }
      case "ack":
        this.acked = Math.max(this.acked, msg.seq);
        return;
      case "call":
        void this.call(msg.id, msg.name, msg.args);
        return;
    }
  }

  /** Sends everything the API hasn't got, from the local log, in pages. */
  private replay(): void {
    for (;;) {
      const page = this.opts.office.store.events(this.sent, 500);
      if (!page.length) return;
      this.send({ t: "events", events: page });
      this.sent = page[page.length - 1].seq;
    }
  }

  private flush(): void {
    this.flushTimer = null;
    const batch = this.pending.filter((e) => e.seq > this.sent);
    this.pending = [];
    if (!batch.length || this.state !== "open") return;
    this.send({ t: "events", events: batch });
    this.sent = batch[batch.length - 1].seq;
  }

  private async call(id: string, name: string, args: unknown): Promise<void> {
    try {
      const result = await runTool(this.opts.office, CEO, name, args);
      this.send({ t: "result", id, ok: true, result });
    } catch (err) {
      const code = err instanceof OfficeError ? err.code : "internal";
      this.send({ t: "result", id, ok: false, error: { code, message: (err as Error).message } });
    }
  }

  private send(msg: DaemonMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }
}
