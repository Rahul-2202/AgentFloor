// The office's setup changing while it runs (the Control API owns it), holds,
// and the richer task fields.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Office } from "../src/core/office.ts";
import { Store } from "../src/core/store.ts";
import { checkConfig, DEFAULT_POLICY } from "../src/core/config.ts";
import { startDaemon } from "../src/daemon/daemon.ts";
import type { OfficeConfig, OfficeEvent } from "../src/core/types.ts";

const base = (): OfficeConfig =>
  checkConfig({
    name: "Setup",
    policy: { ...DEFAULT_POLICY },
    rooms: [{ id: "dev", name: "Development", head: "pm" }],
    agents: [
      { id: "pm", name: "PM", room: "dev", role: "head", runtime: "scripted", title: "Plans" },
      { id: "backend", name: "Backend", room: "dev", role: "member", runtime: "scripted", title: "API" },
    ],
  });

test("applying a new setup reports what changed and keeps existing agents' objects", () => {
  const office = new Office(base(), new Store(":memory:"));
  const pm = office.agent("pm");
  const events: OfficeEvent[] = [];
  office.bus.on("event", (e: OfficeEvent) => events.push(e));

  const next = base();
  next.name = "Setup v2";
  next.rooms.push({ id: "mkt", name: "Marketing", head: "writer" });
  next.agents.push({ id: "writer", name: "Writer", room: "mkt", role: "head", runtime: "scripted", title: "Copy" });
  next.agents = next.agents.filter((a) => a.id !== "backend");
  next.agents[0]!.title = "Plans and ships";
  next.policy.maxHops = 2;

  const diff = office.applyConfig(next);
  assert.deepEqual(diff, { added: ["writer"], removed: ["backend"], changed: ["pm"] });
  assert.equal(office.agent("pm"), pm, "same object, so hosts see the change");
  assert.equal(pm.title, "Plans and ships");
  assert.equal(office.config.name, "Setup v2");
  assert.equal(office.config.policy.maxHops, 2);
  assert.throws(() => office.agent("backend"), /No agent/);
  assert.equal(office.headOf("mkt"), "writer");
  assert.equal(events.filter((e) => e.type === "config.applied").length, 1);

  // The same setup again changes nothing and says nothing.
  assert.deepEqual(office.applyConfig(next), { added: [], removed: [], changed: [] });
  assert.equal(events.filter((e) => e.type === "config.applied").length, 1);
});

test("a bad setup is refused and the office keeps the old one", () => {
  const office = new Office(base(), new Store(":memory:"));
  const bad = base();
  bad.rooms[0]!.head = "nobody";
  assert.throws(() => office.applyConfig(bad), /unknown head/);
  assert.equal(office.headOf("dev"), "pm");
});

test("tasks carry done-means, steps, blockers, checklists, outputs and subtasks", () => {
  const office = new Office(base(), new Store(":memory:"));
  const { taskId } = office.requestWork("ceo", { to: "pm", title: "Online booking", dod: "Patients can book a slot" });
  const msg = office.take("pm", "turn_end")[0]!;
  assert.match(msg.body, /Done means: Patients can book a slot/);

  const sub = office.createTask("pm", { owner: "backend", title: "Slots API", parentId: taskId, dod: "GET /slots works" });
  const subTask = office.store.getTask(sub.taskId)!;
  assert.equal(subTask.parentId, taskId);

  office.updateTask("backend", { taskId: sub.taskId, status: "blocked", blocker: "Need the clinic time zone list", step: "Designing the schema" });
  assert.equal(office.store.getTask(sub.taskId)!.blocker, "Need the clinic time zone list");
  office.updateTask("backend", {
    taskId: sub.taskId,
    status: "ongoing",
    checklist: [{ text: "Schema", done: true }, { text: "Endpoint", done: false }],
    output: { kind: "pr", title: "Slots API", url: "https://github.com/x/y/pull/1" },
  });
  const t = office.store.getTask(sub.taskId)!;
  assert.equal(t.blocker, null, "unblocked when the status moves on");
  assert.equal(t.checklist!.length, 2);
  assert.equal(t.outputs![0]!.kind, "pr");
  // The same output again replaces rather than duplicates.
  office.updateTask("backend", { taskId: sub.taskId, output: { kind: "pr", title: "Slots API v2", url: "https://github.com/x/y/pull/1" } });
  assert.equal(office.store.getTask(sub.taskId)!.outputs!.length, 1);

  assert.throws(() => office.createTask("pm", { owner: "backend", title: "x", parentId: "K-99" }), /No task/);
});

test("the daemon starts added agents, stops removed ones, restarts changed ones, and saves the setup", async (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), "agentfloor-setup-"));
  const daemon = await startDaemon({ config: base(), dataDir, log: () => {}, link: { url: "ws://127.0.0.1:9/office-link", token: "afo_x" } });
  t.after(() => daemon.close());
  assert.deepEqual(daemon.hosts.map((h) => h.agent.id).sort(), ["backend", "pm"]);

  const next = base();
  next.agents = next.agents.filter((a) => a.id !== "backend");
  next.agents.push({ id: "tester", name: "Tester", room: "dev", role: "member", runtime: "scripted", title: "QA" });
  daemon.office.applyConfig(next);
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(daemon.hosts.map((h) => h.agent.id).sort(), ["pm", "tester"]);
  const saved = JSON.parse(readFileSync(join(dataDir, "office-config.json"), "utf8")) as OfficeConfig;
  assert.deepEqual(saved.agents.map((a) => a.id).sort(), ["pm", "tester"]);
});

test("a held agent starts no turns until released", async (t) => {
  const daemon = await startDaemon({ config: base(), dataDir: mkdtempSync(join(tmpdir(), "agentfloor-hold-")), log: () => {} });
  t.after(() => daemon.close());
  const statuses: string[] = [];
  daemon.office.bus.on("event", (e: OfficeEvent) => {
    if (e.type === "agent.status" && e.data.agent === "backend") statuses.push(String(e.data.status));
  });
  daemon.office.hold("backend", "daily budget reached");
  daemon.office.ceoMessage({ to: "backend", text: "Please start on the API" });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(daemon.office.pending("backend", "turn_end").length, 1, "message waits");
  assert.ok(!statuses.includes("working"));

  daemon.office.release("backend");
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(daemon.office.pending("backend", "turn_end").length, 0, "taken once released");
});
