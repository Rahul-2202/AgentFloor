import { randomUUID } from "node:crypto";
import {
  CLOSE_BAD_TOKEN,
  CLOSE_REPLACED,
  parseOfficeToken,
  secretMatches,
  type ApiMessage,
  type DaemonMessage,
} from "@agentfloor/shared/link";
import type { OfficeConfig, OfficeEvent } from "@agentfloor/shared/types";
import type { WebSocket } from "ws";
import type { LinkStore } from "./store.ts";

export class LinkError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

interface Conn {
  socket: WebSocket;
  since: number;
  calls: Map<string, { ok: (v: unknown) => void; fail: (e: Error) => void; timer: NodeJS.Timeout }>;
}

/**
 * Every connected office daemon, by office id. Stores what daemons send and
 * forwards CEO calls to them.
 */
export class OfficeHub {
  private readonly conns = new Map<string, Conn>();

  private readonly store: LinkStore;
  private readonly log: (msg: string) => void;

  private readonly heartbeatMs: number;

  /** Called when an office sends events (it's doing something). */
  onActivity: (officeId: string) => void = () => {};
  /** Called after events are stored; projection into tables runs here (awaited before the ack). */
  onEvents: (officeId: string, events: OfficeEvent[]) => Promise<void> = async () => {};
  /** A daemon connected (send it its setup). */
  onConnect: (officeId: string) => void = () => {};
  onConfigApplied: (officeId: string, version: number, ok: boolean, error?: string) => void = () => {};
  /** The office asks the API for something (a git token, a PR opened). */
  onRequest: (officeId: string, name: string, args: unknown) => Promise<unknown> = async (_o, name) => {
    throw new LinkError("unavailable", `"${name}" isn't available on this server.`);
  };
  /** Live events (session output, "thinking"), for browsers watching the office. */
  onLive: (officeId: string, event: OfficeEvent) => void = () => {};

  constructor(store: LinkStore, log: (msg: string) => void = () => {}, opts: { heartbeatMs?: number } = {}) {
    this.store = store;
    this.log = log;
    this.heartbeatMs = opts.heartbeatMs ?? 30_000;
  }

  isConnected(officeId: string): boolean {
    return this.conns.has(officeId);
  }

  /** Offices with a daemon connected now. */
  connectedOffices(): string[] {
    return [...this.conns.keys()];
  }

  /** When the office's current connection was made (ms), or null if none. */
  connectedSince(officeId: string): number | null {
    return this.conns.get(officeId)?.since ?? null;
  }

  /** Sends the office's daemon its setup. */
  sendConfig(officeId: string, config: OfficeConfig, version: number): boolean {
    const conn = this.conns.get(officeId);
    if (!conn) return false;
    send(conn.socket, { t: "config", config, version });
    return true;
  }

  /** Sends an agent its memory brief. */
  sendBrief(officeId: string, agent: string, text: string): boolean {
    const conn = this.conns.get(officeId);
    if (!conn) return false;
    send(conn.socket, { t: "brief", agent, text });
    return true;
  }

  /** Runs one of the daemon's office calls as the CEO. */
  call(officeId: string, name: string, args: unknown, timeoutMs = 30_000): Promise<unknown> {
    const conn = this.conns.get(officeId);
    if (!conn) return Promise.reject(new LinkError("office_offline", "Your office isn't connected right now."));
    const id = randomUUID();
    return new Promise((ok, fail) => {
      const timer = setTimeout(() => {
        conn.calls.delete(id);
        fail(new LinkError("timeout", `The office didn't answer "${name}" in time.`));
      }, timeoutMs);
      conn.calls.set(id, { ok, fail, timer });
      send(conn.socket, { t: "call", id, name, args });
    });
  }

  /** Handles one daemon connection, from its hello to its close. */
  accept(socket: WebSocket): void {
    let officeId: string | null = null;
    let conn: Conn | null = null;
    let queue = Promise.resolve(); // keeps batches in order
    const helloTimer = setTimeout(() => socket.close(CLOSE_BAD_TOKEN, "no hello"), 10_000);

    // Heartbeat: a daemon that misses a pong (VM paused, network gone) is dropped,
    // so the office shows as disconnected instead of hanging.
    let alive = true;
    socket.on("pong", () => (alive = true));
    const heartbeat = setInterval(() => {
      if (!alive) return socket.terminate();
      alive = false;
      socket.ping();
    }, this.heartbeatMs);

    const handle = async (msg: DaemonMessage): Promise<void> => {
      if (!officeId) {
        if (msg.t !== "hello") return socket.close(CLOSE_BAD_TOKEN, "hello first");
        const parsed = parseOfficeToken(msg.token);
        const hash = parsed && (await this.store.tokenHash(parsed.officeId));
        if (!parsed || !hash || !secretMatches(parsed.secret, hash)) return socket.close(CLOSE_BAD_TOKEN, "bad office token");
        clearTimeout(helloTimer);
        officeId = parsed.officeId;
        // A newer connection from the same office wins (the daemon restarted).
        this.conns.get(officeId)?.socket.close(CLOSE_REPLACED, "replaced by a newer connection");
        conn = { socket, since: Date.now(), calls: new Map() };
        this.conns.set(officeId, conn);
        await this.store.setConnected(officeId, true);
        send(socket, { t: "welcome", officeId, lastSeq: await this.store.lastSeq(officeId) });
        this.log(`office ${officeId} connected`);
        this.onConnect(officeId);
        return;
      }
      if (msg.t === "events") {
        if (!msg.events.length) return;
        const seq = await this.store.ingest(officeId, msg.events);
        await this.onEvents(officeId, msg.events).catch((err) => this.log(`office ${officeId}: projecting events: ${(err as Error).message}`));
        send(socket, { t: "ack", seq });
        this.onActivity(officeId);
      } else if (msg.t === "request") {
        // Answered in the background, so a slow GitHub call doesn't hold up the office's events.
        const id = officeId;
        void this.onRequest(id, msg.name, msg.args).then(
          (result) => send(socket, { t: "response", id: msg.id, ok: true, result }),
          (err: Error & { code?: string }) => send(socket, { t: "response", id: msg.id, ok: false, error: { code: err.code ?? "error", message: err.message } }),
        );
      } else if (msg.t === "live") {
        this.onLive(officeId, msg.event);
      } else if (msg.t === "config_applied") {
        if (!msg.ok) this.log(`office ${officeId} refused setup v${msg.version}: ${msg.error}`);
        this.onConfigApplied(officeId, msg.version, msg.ok, msg.error);
      } else if (msg.t === "result") {
        const c = conn!.calls.get(msg.id);
        if (!c) return;
        conn!.calls.delete(msg.id);
        clearTimeout(c.timer);
        if (msg.ok) c.ok(msg.result);
        else c.fail(new LinkError(msg.error.code, msg.error.message));
      }
    };

    socket.on("message", (raw) => {
      let msg: DaemonMessage;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return socket.close(1003, "bad message");
      }
      queue = queue.then(() => handle(msg)).catch((err) => {
        this.log(`office link ${officeId ?? "?"}: ${(err as Error).message}`);
        socket.close(1011, "server error");
      });
    });

    socket.on("close", () => {
      clearTimeout(helloTimer);
      clearInterval(heartbeat);
      if (!officeId || !conn || this.conns.get(officeId) !== conn) return;
      this.conns.delete(officeId);
      for (const c of conn.calls.values()) {
        clearTimeout(c.timer);
        c.fail(new LinkError("office_offline", "The office disconnected."));
      }
      void this.store.setConnected(officeId, false).catch(() => {});
      this.log(`office ${officeId} disconnected`);
    });
  }
}

function send(socket: WebSocket, msg: ApiMessage): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
}
