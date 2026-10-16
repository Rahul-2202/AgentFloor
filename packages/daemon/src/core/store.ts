import { DatabaseSync } from "node:sqlite";
import type { AgentSettings, ConfigVersion, InboxItem, Message, OfficeEvent, Task, Thread } from "./types.ts";

/**
 * Durable state for one office, in SQLite (built into Node). Threads, tasks and
 * inbox items are stored as JSON with the columns we query on alongside.
 * Pass ":memory:" for tests.
 */
export class Store {
  readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS threads (id TEXT PRIMARY KEY, state TEXT NOT NULL, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, to_agent TEXT NOT NULL,
        state TEXT NOT NULL, created_at INTEGER NOT NULL, json TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS messages_inbox ON messages (to_agent, state);
      CREATE INDEX IF NOT EXISTS messages_thread ON messages (thread_id);
      CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS inbox (id TEXT PRIMARY KEY, state TEXT NOT NULL, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS usage (agent TEXT PRIMARY KEY, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS agent_settings (id TEXT PRIMARY KEY, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS versions (v INTEGER PRIMARY KEY AUTOINCREMENT, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, type TEXT NOT NULL, json TEXT NOT NULL);
    `);
  }

  nextId(prefix: string): string {
    const row = this.db
      .prepare("INSERT INTO counters (name, value) VALUES (?, 1) ON CONFLICT(name) DO UPDATE SET value = value + 1 RETURNING value")
      .get(prefix) as { value: number };
    return `${prefix}-${row.value}`;
  }

  /* ---------------------------------------------------------------- threads */

  putThread(t: Thread): void {
    this.db.prepare("INSERT OR REPLACE INTO threads (id, state, json) VALUES (?, ?, ?)").run(t.id, t.state, JSON.stringify(t));
  }

  getThread(id: string): Thread | undefined {
    const row = this.db.prepare("SELECT json FROM threads WHERE id = ?").get(id) as { json: string } | undefined;
    return row ? (JSON.parse(row.json) as Thread) : undefined;
  }

  threads(state?: Thread["state"]): Thread[] {
    const rows = (
      state
        ? this.db.prepare("SELECT json FROM threads WHERE state = ? ORDER BY rowid").all(state)
        : this.db.prepare("SELECT json FROM threads ORDER BY rowid").all()
    ) as { json: string }[];
    return rows.map((r) => JSON.parse(r.json) as Thread);
  }

  /* --------------------------------------------------------------- messages */

  putMessage(m: Message): void {
    this.db
      .prepare("INSERT OR REPLACE INTO messages (id, thread_id, to_agent, state, created_at, json) VALUES (?, ?, ?, ?, ?, ?)")
      .run(m.id, m.threadId, m.to, m.state, m.createdAt, JSON.stringify(m));
  }

  queuedFor(agent: string): Message[] {
    const rows = this.db
      .prepare("SELECT json FROM messages WHERE to_agent = ? AND state = 'queued' ORDER BY created_at, rowid")
      .all(agent) as { json: string }[];
    return rows.map((r) => JSON.parse(r.json) as Message);
  }

  threadMessages(threadId: string): Message[] {
    const rows = this.db.prepare("SELECT json FROM messages WHERE thread_id = ? ORDER BY created_at, rowid").all(threadId) as {
      json: string;
    }[];
    return rows.map((r) => JSON.parse(r.json) as Message);
  }

  /** One row per sent message (deduplicated across recipients), oldest first. */
  messages(limit = 500): Message[] {
    const rows = this.db.prepare("SELECT json FROM messages ORDER BY created_at DESC, rowid DESC LIMIT ?").all(limit) as {
      json: string;
    }[];
    return rows.map((r) => JSON.parse(r.json) as Message).reverse();
  }

  /* ------------------------------------------------------------------ tasks */

  putTask(t: Task): void {
    this.db.prepare("INSERT OR REPLACE INTO tasks (id, json) VALUES (?, ?)").run(t.id, JSON.stringify(t));
  }

  getTask(id: string): Task | undefined {
    const row = this.db.prepare("SELECT json FROM tasks WHERE id = ?").get(id) as { json: string } | undefined;
    return row ? (JSON.parse(row.json) as Task) : undefined;
  }

  tasks(): Task[] {
    return (this.db.prepare("SELECT json FROM tasks ORDER BY rowid").all() as { json: string }[]).map((r) => JSON.parse(r.json) as Task);
  }

  /* ------------------------------------------------------------------ inbox */

  putInbox(i: InboxItem): void {
    this.db.prepare("INSERT OR REPLACE INTO inbox (id, state, json) VALUES (?, ?, ?)").run(i.id, i.state, JSON.stringify(i));
  }

  getInbox(id: string): InboxItem | undefined {
    const row = this.db.prepare("SELECT json FROM inbox WHERE id = ?").get(id) as { json: string } | undefined;
    return row ? (JSON.parse(row.json) as InboxItem) : undefined;
  }

  inbox(): InboxItem[] {
    return (this.db.prepare("SELECT json FROM inbox ORDER BY rowid").all() as { json: string }[]).map(
      (r) => JSON.parse(r.json) as InboxItem,
    );
  }

  /* ------------------------------------------------------------------ usage */

  putUsage(agent: string, usage: object): void {
    this.db.prepare("INSERT OR REPLACE INTO usage (agent, json) VALUES (?, ?)").run(agent, JSON.stringify(usage));
  }

  usage(): Record<string, any> {
    const rows = this.db.prepare("SELECT agent, json FROM usage").all() as { agent: string; json: string }[];
    return Object.fromEntries(rows.map((r) => [r.agent, JSON.parse(r.json)]));
  }

  /* --------------------------------------------------- settings, versions */

  putAgentSettings(id: string, settings: AgentSettings): void {
    this.db.prepare("INSERT OR REPLACE INTO agent_settings (id, json) VALUES (?, ?)").run(id, JSON.stringify(settings));
  }

  agentSettings(): Record<string, AgentSettings> {
    const rows = this.db.prepare("SELECT id, json FROM agent_settings").all() as { id: string; json: string }[];
    return Object.fromEntries(rows.map((r) => [r.id, JSON.parse(r.json) as AgentSettings]));
  }

  addVersion(v: Omit<ConfigVersion, "v">): ConfigVersion {
    const row = this.db.prepare("INSERT INTO versions (json) VALUES (?) RETURNING v").get(JSON.stringify(v)) as { v: number };
    return { ...v, v: row.v };
  }

  versions(): ConfigVersion[] {
    const rows = this.db.prepare("SELECT v, json FROM versions ORDER BY v").all() as { v: number; json: string }[];
    return rows.map((r) => ({ ...(JSON.parse(r.json) as Omit<ConfigVersion, "v">), v: r.v }));
  }

  /* ----------------------------------------------------------------- events */

  addEvent(at: number, type: string, data: Record<string, unknown>): OfficeEvent {
    const row = this.db.prepare("INSERT INTO events (at, type, json) VALUES (?, ?, ?) RETURNING seq").get(at, type, JSON.stringify(data)) as {
      seq: number;
    };
    return { seq: row.seq, at, type, data };
  }

  events(afterSeq = 0, limit = 1000): OfficeEvent[] {
    const rows = this.db.prepare("SELECT seq, at, type, json FROM events WHERE seq > ? ORDER BY seq LIMIT ?").all(afterSeq, limit) as {
      seq: number;
      at: number;
      type: string;
      json: string;
    }[];
    return rows.map((r) => ({ seq: r.seq, at: r.at, type: r.type, data: JSON.parse(r.json) }));
  }
}
