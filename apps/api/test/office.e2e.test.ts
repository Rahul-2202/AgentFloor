// M2 end to end: a real Control API (memory stores) and a real office daemon
// over the office link. Setup changes through read-backs, the office
// following them, work showing up in the tables, budgets holding agents, and
// live output reaching a watching browser.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { checkConfig, DEFAULT_POLICY } from "@agentfloor/daemon/config";
import { startDaemon } from "@agentfloor/daemon/daemon";
import { LINK_PATH, newOfficeToken } from "@agentfloor/shared/link";
import type { OfficeEvent } from "@agentfloor/shared/types";
import { buildApp } from "../src/app.ts";
import type { User } from "../src/auth.ts";
import type { BudgetStore } from "../src/budgets.ts";
import { memoryLinkStore } from "../src/link/store.ts";
import type { MachineStore } from "../src/machines/lifecycle.ts";
import type { OfficeStore } from "../src/offices.ts";
import { memoryProjectionStore } from "../src/projection/writer.ts";
import { memoryMemoryStore } from "../src/memory/store.ts";
import { createServices } from "../src/services.ts";
import { memorySetupStore } from "../src/setup/store.ts";

const OFFICE = randomUUID();
const USER: User = { id: "u1", email: null, githubLogin: "ceo", name: "Rahul" };

async function until(what: string, ok: () => boolean | Promise<boolean>, ms = 5000) {
  const end = Date.now() + ms;
  while (!(await ok())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

async function setup(t: any) {
  const link = memoryLinkStore();
  const { token, hash } = newOfficeToken(OFFICE);
  await link.setTokenHash(OFFICE, hash);
  const setups = memorySetupStore();
  const proj = memoryProjectionStore(() => link.events.get(OFFICE) ?? [], { pm: "dev", backend: "dev", frontend: "dev", tester: "dev", strategist: "marketing", creator: "marketing" });
  const tables = proj.tables;
  const budgets: BudgetStore = {
    async spendSince() {
      return [...tables.usage.values()].map((u) => ({ agentId: u.agent_id, roomId: u.room_id, calls: 1, tokens: 0, costUsd: u.cost_usd }));
    },
    async held() {
      return new Map([...tables.agents].filter(([, v]) => v.held_reason).map(([k, v]) => [k, v.held_reason]));
    },
    async alert(_o, item) {
      if (!tables.inbox.has(item.id)) tables.inbox.set(item.id, { ...item, kind: "budget", state: "open" });
    },
  };
  const offices: OfficeStore = {
    officeOf: async () => ({ id: OFFICE, name: "Acme", onboardedAt: null, sandboxState: "started", daemonConnected: true }),
    ensureOffice: async () => ({ office: (await offices.officeOf("u1"))!, created: false }),
  };
  const machines: MachineStore = { get: async () => ({ sandboxId: null, state: "none" }), set: async () => {} };
  const memory = memoryMemoryStore();
  const conversations = {
    messages: async (_o: string, threadId: string) => [...tables.messages.values()].filter((m) => m.thread_id === threadId).sort((a, b) => a.created_at.localeCompare(b.created_at)),
    openTasks: async () => [...tables.tasks.values()].filter((t) => t.status !== "done").map((t) => ({ owner: t.owner_id, title: t.title, details: t.details })),
  };
  const s = createServices({ verify: async () => USER, stores: { offices, link, setups, projections: proj.store, budgets, machines, memory, conversations }, machine: null });
  const app = await buildApp({ verify: async () => USER, offices, hub: s.hub, setup: s.setup, budgets: s.budgets, spend: budgets, watchers: s.watchers, webOrigins: [] });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const { port } = app.server.address() as AddressInfo;

  // The office starts from its own file; the API's setup replaces it on connect.
  const daemon = await startDaemon({
    config: checkConfig({ name: "Local", policy: { ...DEFAULT_POLICY }, rooms: [{ id: "x", name: "X", head: "solo" }], agents: [{ id: "solo", name: "Solo", room: "x", role: "head", runtime: "external", title: "" }] }),
    dataDir: mkdtempSync(join(tmpdir(), "agentfloor-m2-")),
    startAgents: false,
    log: () => {},
    link: { url: `ws://127.0.0.1:${port}${LINK_PATH}`, token },
  });
  t.after(async () => {
    await daemon.close();
    await app.close();
  });
  const api = (method: "GET" | "POST", url: string, payload?: object) => app.inject({ method, url, payload, headers: { authorization: "Bearer x" } });
  return { app, port, daemon, api, s, setups, tables, memory };
}

test("the office runs the API's setup, and changes follow read-backs", async (t) => {
  const { daemon, api, setups } = await setup(t);
  await until("the daemon to get its setup", () => setups.rows.get(OFFICE)?.pushed === 1);
  assert.equal(daemon.office.config.name, "Test office");
  assert.equal(daemon.office.headOf("dev"), "pm");

  const proposal = await api("POST", "/office/setup/propose", { ops: [{ op: "hire_agent", room: "dev", name: "Designer", title: "Product design" }] });
  assert.equal(proposal.statusCode, 200, proposal.body);
  const { baseVersion, readback } = proposal.json();
  assert.deepEqual(readback, ["Hire Designer into Development as Product design, on Claude Code, Claude Haiku, low effort."]);

  const applied = await api("POST", "/office/setup/apply", { ops: [{ op: "hire_agent", room: "dev", name: "Designer", title: "Product design" }], baseVersion });
  assert.equal(applied.statusCode, 200, applied.body);
  assert.equal(applied.json().version, 2);
  await until("the office to hire Designer", () => daemon.office.config.agents.some((a) => a.id === "designer"));
  await until("the push to be confirmed", () => setups.rows.get(OFFICE)?.pushed === 2);

  // A read-back made before that change is stale now.
  const stale = await api("POST", "/office/setup/apply", { ops: [{ op: "remove_agent", id: "tester" }], baseVersion });
  assert.equal(stale.statusCode, 409);
  const bad = await api("POST", "/office/setup/propose", { ops: [{ op: "remove_agent", id: "pm" }] });
  assert.equal(bad.statusCode, 422);
  assert.match(bad.json().problems[0], /heads Development/);

  // Roll back to version 1.
  const back = await api("POST", "/office/setup/apply", { ops: [{ op: "restore_version", version: 1 }], baseVersion: 2 });
  assert.equal(back.statusCode, 200, back.body);
  await until("Designer to leave", () => !daemon.office.config.agents.some((a) => a.id === "designer"));
  const versions = (await api("GET", "/office/setup/versions")).json().versions;
  assert.deepEqual(versions.map((v: any) => v.v), [3, 2, 1]);
  assert.equal(versions[0].summary, "Restore the setup from version 1");

  // Setup can't be changed around the policy engine.
  assert.equal((await api("POST", "/office/call", { name: "ceo_configure_agent", args: { agent: "pm", model: "opus", confirm: true } })).statusCode, 400);
});

test("work, conversations and inbox show up in the tables; budgets hold and release agents", async (t) => {
  const { daemon, api, tables, setups } = await setup(t);
  await until("setup", () => setups.rows.get(OFFICE)?.pushed === 1);

  const res = await api("POST", "/office/call", { name: "ceo_assign", args: { to: "pm", title: "Online booking", done_means: "Patients book a slot" } });
  assert.equal(res.statusCode, 200, res.body);
  const { taskId, threadId } = res.json().result;
  await until("the task row", () => tables.tasks.has(taskId));
  assert.equal(tables.tasks.get(taskId).definition_of_done, "Patients book a slot");
  assert.equal(tables.threads.get(threadId).topic, "Online booking");
  assert.ok([...tables.messages.values()].some((m) => m.thread_id === threadId && m.type === "request_work"));

  // The head asks the CEO: an inbox item.
  daemon.office.askCeo("pm", { question: "Which clinic first?", options: ["Sydney", "Melbourne"] });
  await until("the inbox row", () => [...tables.inbox.values()].some((i) => i.title === "Which clinic first?"));

  // Spend: one big Sonnet call by Backend, over the office's $20 hard limit.
  daemon.office.recordModelCall("backend", { provider: "anthropic", model: "claude-sonnet-4-6", inputTokens: 2_000_000, outputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0 });
  await until("the usage row", () => tables.usage.size === 1);
  assert.equal([...tables.usage.values()][0].cost_usd, 21);
  await until("agents on hold", () => daemon.office.heldReason("backend") !== null && daemon.office.heldReason("pm") !== null);
  assert.match(daemon.office.heldReason("backend")!, /daily budget reached \(The office\)/);
  await until("budget alerts", () => [...tables.inbox.keys()].filter((k) => k.startsWith("B-")).length === 2);
  await until("holds in the tables", () => tables.agents.get("backend")?.held_reason != null);

  const spend = (await api("GET", "/office/spend")).json();
  assert.equal(spend.total.costUsd, 21);

  // Raising the limit lets them carry on.
  const base = (await api("GET", "/office/setup")).json().version;
  const raised = await api("POST", "/office/setup/apply", { ops: [{ op: "set_budget", scope: "office", id: "", dailyUsdSoft: 5, dailyUsdHard: 50 }], baseVersion: base });
  assert.equal(raised.statusCode, 200, raised.body);
  await until("release", () => daemon.office.heldReason("backend") === null && daemon.office.heldReason("pm") === null);
});

test("a browser watching the office gets live output", async (t) => {
  const { daemon, port, setups } = await setup(t);
  await until("setup", () => setups.rows.get(OFFICE)?.pushed === 1);
  const ws = new WebSocket(`ws://127.0.0.1:${port}/office/live`);
  const got: any[] = [];
  ws.addEventListener("message", (e) => got.push(JSON.parse(String(e.data))));
  await new Promise((ok) => ws.addEventListener("open", ok, { once: true }));
  ws.send(JSON.stringify({ t: "auth", token: "x" }));
  await until("ready", () => got.some((m) => m.t === "ready"));
  daemon.office.output("backend", "text", "Reading the schema…");
  await until("the live line", () => got.some((m) => m.t === "live" && (m.event as OfficeEvent).type === "agent.output"));
  const line = got.find((m) => m.t === "live").event.data;
  assert.deepEqual([line.agent, line.text], ["backend", "Reading the schema…"]);
  // Take-over needs office machines; without them it says so.
  ws.send(JSON.stringify({ t: "takeover", agent: "backend" }));
  await until("the error", () => got.some((m) => m.t === "error"));
  ws.close();
});

test("memory through the office: agents write and read, briefs arrive, conversations become memory", async (t) => {
  const { daemon, setups, memory, s } = await setup(t);
  await until("setup", () => setups.rows.get(OFFICE)?.pushed === 1);
  const o = daemon.office;

  const saved = (await o.memory("backend", "write", { title: "Times in UTC", body: "Store times in UTC; show clinic local time", type: "lesson", confidence: 0.9 })) as any;
  assert.equal(saved.status, "active");
  const found = (await o.memory("backend", "search", { query: "UTC times" })) as any[];
  assert.equal(found[0].title, "Times in UTC");
  const read = (await o.memory("pm", "read", { id: found[0].id })) as any;
  assert.match(read.body, /clinic local time/);
  await assert.rejects(o.memory("backend", "write", { title: "x", body: "y", layer: "company" }), /Ada's/);
  const review = (await o.memory("pm", "review", {})) as any;
  assert.equal(review.lessons[0].title, "Times in UTC");

  // The brief comes back to the office, for the agent's memory file.
  await s.officeMemory!.pushBriefs(OFFICE);
  await until("backend's brief", () => o.briefOf("backend").includes("Times in UTC"));

  // A huddle between rooms ends: one shared agreement both rooms can read.
  const { threadId } = o.huddle("pm", { with: "strategist", topic: "Launch date", opening: "Can we launch March 1?" });
  o.reply("strategist", { threadId, text: "Yes if reminders slip." });
  o.endHuddle("pm", { threadId, outcome: "Launch March 1; reminders in v1.1." });
  await until("the agreement in memory", async () => (await memory.list(OFFICE, { scopes: [["conversation", threadId]] })).length === 1);
  const [agreement] = await memory.list(OFFICE, { scopes: [["conversation", threadId]] });
  assert.equal(agreement!.type, "agreement");
  assert.deepEqual(agreement!.tags, ["agreement", "dev", "marketing"]);
  const seen = (await o.memory("creator", "search", { query: "launch reminders" })) as any;
  assert.ok(Array.isArray(seen) ? seen.length === 0 : /Nothing in memory/.test(seen), `a member who was not there does not see it: ${JSON.stringify(seen)}`);
  assert.equal(((await o.memory("strategist", "search", { query: "launch reminders" })) as any[]).length, 1, "the other head does");

  // The CEO answers a head's question: a decision in that room's log.
  const ask = o.askCeo("pm", { question: "Which clinic launches first?" });
  o.reply("ceo", { threadId: ask.threadId, text: "Sydney first.", resolves: true });
  await until("the decision", async () => (await memory.list(OFFICE, { scopes: [["room", "dev"]], type: "decision" })).length === 1);
  const [decision] = await memory.list(OFFICE, { scopes: [["room", "dev"]], type: "decision" });
  assert.match(decision!.body, /The CEO decided: Sydney first/);
});
