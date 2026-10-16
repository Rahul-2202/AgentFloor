import { test } from "node:test";
import assert from "node:assert/strict";
import { Office } from "../src/core/office.ts";
import { Store } from "../src/core/store.ts";
import { checkConfig, DEFAULT_POLICY } from "../src/core/config.ts";
import { CEO, OFFICE, type OfficeConfig } from "../src/core/types.ts";

function makeOffice(policy: Partial<OfficeConfig["policy"]> = {}) {
  let now = 1_000_000;
  const config = checkConfig({
    name: "Test",
    policy: { ...DEFAULT_POLICY, askDeadlineSec: 60, ...policy },
    rooms: [
      { id: "dev", name: "Development", head: "pm" },
      { id: "mkt", name: "Marketing", head: "strategist" },
    ],
    agents: [
      { id: "pm", name: "PM", room: "dev", role: "head", runtime: "scripted", title: "" },
      { id: "backend", name: "Backend", room: "dev", role: "member", runtime: "scripted", title: "" },
      { id: "frontend", name: "Frontend", room: "dev", role: "member", runtime: "scripted", title: "" },
      { id: "tester", name: "Tester", room: "dev", role: "member", runtime: "scripted", title: "" },
      { id: "strategist", name: "Strategist", room: "mkt", role: "head", runtime: "scripted", title: "" },
      { id: "creator", name: "Creator", room: "mkt", role: "member", runtime: "scripted", title: "" },
    ],
  });
  const office = new Office(config, new Store(":memory:"), { now: () => now });
  return { office, advance: (sec: number) => (now += sec * 1000) };
}

test("ask and reply: the answer reaches the asker and resolves the thread", () => {
  const { office } = makeOffice();
  const { threadId } = office.ask("backend", { to: "frontend", question: "Local time or UTC?" });

  const got = office.take("frontend", "tool");
  assert.equal(got.length, 1);
  assert.equal(got[0]!.body, "Local time or UTC?");
  assert.match(office.render(got), /From: Frontend|From: Backend \(backend\) · ask · normal · thread T-1/);

  office.reply("frontend", { threadId, text: "UTC plus the clinic's time zone.", resolves: true });
  const answer = office.take("backend", "tool");
  assert.equal(answer[0]!.type, "answer");
  assert.equal(answer[0]!.from, "frontend");
  assert.equal(office.thread(threadId).state, "resolved");
  assert.equal(office.thread(threadId).awaiting, null);
});

test("delivery points: questions mid-task, work at turn end, stop right away", () => {
  const { office } = makeOffice();
  office.requestWork("pm", { to: "backend", title: "Build slots API" });
  office.ask("frontend", { to: "backend", question: "Response shape?" });
  office.stop("pm", { to: "backend", reason: "Wrong branch" });

  assert.deepEqual(office.pending("backend", "now").map((m) => m.type), ["stop"]);
  assert.deepEqual(office.pending("backend", "tool").map((m) => m.type).sort(), ["ask", "stop"]);
  assert.deepEqual(office.pending("backend", "turn_end").map((m) => m.type).sort(), ["ask", "request_work", "stop"]);

  office.take("backend", "tool");
  assert.deepEqual(office.pending("backend", "turn_end").map((m) => m.type), ["request_work"]);
});

test("work for another room goes through its head; questions go direct", () => {
  const { office } = makeOffice();
  assert.throws(() => office.requestWork("tester", { to: "creator", title: "Release notes" }), { code: "route", message: /through their head.*Strategist/ });
  assert.doesNotThrow(() => office.requestWork("tester", { to: "strategist", title: "Release notes" }));
  assert.doesNotThrow(() => office.ask("tester", { to: "creator", question: "Which clinics are in the post?" }));
});

test("only a head or the CEO can stop an agent", () => {
  const { office } = makeOffice();
  assert.throws(() => office.stop("tester", { to: "backend", reason: "x" }), { code: "not_allowed" });
  assert.throws(() => office.stop("strategist", { to: "backend", reason: "x" }), { code: "not_allowed" });
  assert.doesNotThrow(() => office.stop("pm", { to: "backend", reason: "x" }));
  assert.doesNotThrow(() => office.ceoMessage({ to: "creator", text: "Halt", urgency: "stop" }));
});

test("ask_ceo: members go through their head; the CEO's answer reaches the head and clears the inbox", () => {
  const { office } = makeOffice();
  assert.throws(() => office.askCeo("backend", { question: "Ship Friday?" }), { code: "route", message: /Ask PM/ });

  const { threadId, inboxId } = office.askCeo("pm", { question: "Ship Friday without SMS?", options: ["Ship", "Slip"] });
  assert.equal(office.store.getInbox(inboxId)!.state, "open");

  office.reply(CEO, { threadId, text: "Ship it." });
  assert.equal(office.take("pm", "tool")[0]!.body, "Ship it.");
  assert.equal(office.store.getInbox(inboxId)!.state, "resolved");
});

test("the CEO messaging a member copies their head", () => {
  const { office } = makeOffice();
  office.ceoMessage({ to: "backend", text: "Prioritise the timezone bug." });
  assert.equal(office.take("backend", "turn_end")[0]!.from, CEO);
  const copy = office.take("pm", "turn_end")[0]!;
  assert.equal(copy.from, OFFICE);
  assert.match(copy.body, /CEO messaged Backend directly/);
});

test("escalation: unanswered goes to the asker's head, then the CEO; a late answer still lands", () => {
  const { office, advance } = makeOffice();
  const { threadId } = office.ask("tester", { to: "strategist", question: "Which clinics launch?" });

  advance(59);
  office.tick();
  assert.equal(office.thread(threadId).escalation, 0);

  advance(2);
  office.tick();
  const t1 = office.thread(threadId);
  assert.equal(t1.escalation, 1);
  assert.ok(t1.participants.includes("pm"));
  const toHead = office.take("pm", "tool");
  assert.equal(toHead[0]!.type, "ask");
  assert.match(toHead[0]!.body, /Escalated to you: Tester asked Strategist/);

  advance(61);
  office.tick();
  const t2 = office.thread(threadId);
  assert.equal(t2.state, "escalated");
  assert.equal(office.store.inbox()[0]!.kind, "escalation");
  assert.match(office.take("tester", "turn_end").at(-1)!.body, /with the CEO now/);

  office.reply("strategist", { threadId, text: "Sydney, Leeds, Austin." });
  assert.equal(office.take("tester", "tool")[0]!.body, "Sydney, Leeds, Austin.");
  assert.equal(office.store.inbox()[0]!.state, "resolved");
  assert.equal(office.thread(threadId).awaiting, null);
});

test("a head's unanswered question goes straight to the CEO", () => {
  const { office, advance } = makeOffice();
  const { threadId } = office.ask("strategist", { to: "creator", question: "Photos?" });
  advance(61);
  office.tick();
  assert.equal(office.thread(threadId).escalation, 2);
  assert.equal(office.store.inbox().length, 1);
});

test("cycles are refused: you can't ask back someone who is waiting on you", () => {
  const { office } = makeOffice();
  office.ask("frontend", { to: "backend", question: "Response shape?" });
  office.take("backend", "tool"); // backend is now working on frontend's question
  assert.throws(() => office.ask("backend", { to: "frontend", question: "What do you need?" }), { code: "cycle", message: /Frontend is already waiting on you/ });
  // A question to someone else is a follow-up, one hop down.
  const { threadId } = office.ask("backend", { to: "pm", question: "Do we expose practitioner ids?" });
  assert.equal(office.thread(threadId).depth, 1);
});

test("a question that hasn't reached you yet doesn't make your asks follow-ups", () => {
  const { office } = makeOffice();
  office.ask("frontend", { to: "backend", question: "Response shape?" });
  // Not delivered to backend yet: its own question is independent, not a cycle.
  const { threadId } = office.ask("backend", { to: "frontend", question: "UTC or local?" });
  assert.equal(office.thread(threadId).depth, 0);
});

test("hop limit stops long chains of follow-up questions", () => {
  const { office } = makeOffice({ maxHops: 2 });
  office.ask("frontend", { to: "backend", question: "q0" });
  office.take("backend", "tool");
  office.ask("backend", { to: "pm", question: "q1" });
  office.take("pm", "tool");
  office.ask("pm", { to: "tester", question: "q2" });
  office.take("tester", "tool");
  assert.throws(() => office.ask("tester", { to: "strategist", question: "q3" }), { code: "hop_limit", message: /3 hops/ });
});

test("a thread over its message budget stops and goes to the CEO, who can reopen it", () => {
  const { office } = makeOffice({ threadMaxMessages: 3 });
  const { threadId } = office.ask("backend", { to: "frontend", question: "1" });
  office.reply("frontend", { threadId, text: "2" });
  office.reply("backend", { threadId, text: "3" });
  assert.equal(office.thread(threadId).state, "escalated");
  assert.equal(office.store.inbox()[0]!.kind, "budget");
  assert.throws(() => office.reply("frontend", { threadId, text: "4" }), { code: "budget_exceeded" });

  office.reply(CEO, { threadId, text: "Go with UTC. Carry on." });
  assert.equal(office.thread(threadId).state, "open");
  assert.doesNotThrow(() => office.reply("frontend", { threadId, text: "Will do." }));
});

test("huddle: quick turns, then an outcome both sides get", () => {
  const { office } = makeOffice();
  const { threadId } = office.huddle("frontend", { with: "backend", topic: "Confirmation payload", opening: "Include clinic name?" });
  const first = office.take("backend", "tool")[0]!;
  assert.equal(first.type, "huddle");
  assert.equal(first.urgency, "urgent");
  assert.match(office.render([first]), /end_huddle/);

  office.reply("backend", { threadId, text: "Yes, and address." });
  assert.equal(office.take("frontend", "tool")[0]!.urgency, "urgent");

  office.endHuddle("frontend", { threadId, outcome: "Confirmation has clinic {name, address}." });
  const t = office.thread(threadId);
  assert.equal(t.state, "resolved");
  assert.equal(t.outcome, "Confirmation has clinic {name, address}.");
  assert.match(office.take("backend", "tool")[0]!.body, /Outcome: Confirmation has clinic/);
});

test("huddle turn cap ends it without agreement", () => {
  const { office } = makeOffice({ huddleMaxTurns: 3 });
  const { threadId } = office.huddle("frontend", { with: "backend", topic: "Shape", opening: "a" });
  office.reply("backend", { threadId, text: "b" });
  office.reply("frontend", { threadId, text: "c" });
  assert.equal(office.thread(threadId).state, "escalated");
  assert.match(office.store.inbox()[0]!.title, /ended without agreement/);
});

test("wait: returns the answer, or a question from someone else, or nothing at the timeout", async () => {
  const { office } = makeOffice();
  const { threadId } = office.ask("frontend", { to: "backend", question: "Shape?" });

  const answered = office.wait("frontend", { threadId, timeoutMs: 1000 });
  setTimeout(() => office.reply("backend", { threadId, text: "{start, end}" }), 10);
  assert.equal((await answered)[0]!.body, "{start, end}");

  const interrupted = office.wait("frontend", { threadId, timeoutMs: 1000 });
  setTimeout(() => office.ask("tester", { to: "frontend", question: "Which browser?" }), 10);
  assert.equal((await interrupted)[0]!.body, "Which browser?");

  const quiet = await office.wait("frontend", { threadId, timeoutMs: 20 });
  assert.equal(quiet.length, 0);
});

test("tasks: owners and their head update them; others can't", () => {
  const { office } = makeOffice();
  const { taskId } = office.requestWork("pm", { to: "backend", title: "Slots API" });
  office.updateTask("backend", { taskId, status: "ongoing", progress: 40 });
  office.updateTask("pm", { taskId, note: "Due Thursday" });
  assert.throws(() => office.updateTask("frontend", { taskId, progress: 90 }), { code: "not_allowed" });
  office.updateTask("backend", { taskId, status: "done" });
  assert.equal(office.store.getTask(taskId)!.progress, 100);
});

test("config check catches bad heads and ids", () => {
  assert.throws(
    () =>
      checkConfig({
        name: "x",
        policy: DEFAULT_POLICY,
        rooms: [{ id: "dev", name: "Dev", head: "backend" }],
        agents: [
          { id: "backend", name: "B", room: "dev", role: "member", runtime: "scripted", title: "" },
          { id: "ceo", name: "C", room: "dev", role: "member", runtime: "scripted", title: "" },
        ],
      }),
    /reserved[\s\S]*must be in the room with role "head"/,
  );
});

test("agents default to Claude Code on Haiku at low effort", () => {
  const c = checkConfig({
    name: "x",
    policy: DEFAULT_POLICY,
    rooms: [{ id: "dev", name: "Dev", head: "pm" }],
    agents: [{ id: "pm", name: "PM", room: "dev", role: "head", title: "" } as any],
  });
  assert.deepEqual([c.agents[0]!.runtime, c.agents[0]!.model, c.agents[0]!.effort], ["claude-code", "haiku", "low"]);
});

test("changing an agent's runtime: read-back first, then apply, versioned and kept across restarts", () => {
  const store = new Store(":memory:");
  const config = () =>
    checkConfig({
      name: "x",
      policy: DEFAULT_POLICY,
      rooms: [{ id: "dev", name: "Dev", head: "pm" }],
      agents: [
        { id: "pm", name: "PM", room: "dev", role: "head", title: "" } as any,
        { id: "frontend", name: "Frontend", room: "dev", role: "member", title: "" } as any,
      ],
    });
  const office = new Office(config(), store);

  const preview = office.configureAgent(CEO, { agent: "frontend", runtime: "antigravity" });
  assert.equal(preview.applied, false);
  assert.match(preview.changes[0]!, /Frontend will run on Antigravity instead of Claude Code/);
  assert.equal(preview.after.model, "gemini-3.8-flash-low");
  assert.equal(office.agent("frontend").runtime, "claude-code");

  assert.throws(() => office.configureAgent(CEO, { agent: "frontend", runtime: "junie", model: "opus" }), { code: "bad_input", message: /Junie has no model "opus"/ });
  assert.throws(() => office.configureAgent(CEO, { agent: "frontend", runtime: "nope" }), { code: "bad_input" });
  assert.throws(() => office.configureAgent(CEO, { agent: "frontend", effort: "max" }), { code: "bad_input", message: /effort must be one of/ });

  const done = office.configureAgent(CEO, { agent: "frontend", runtime: "junie", confirm: true });
  assert.equal(done.applied, true);
  assert.deepEqual(office.settingsOf("frontend"), { runtime: "junie", model: "gemini-3.5-flash-lite", effort: "low" });
  assert.equal(store.versions().length, 1);
  assert.deepEqual(store.versions()[0]!.before, { runtime: "claude-code", model: "haiku", effort: "low" });

  // Only the model changes: same runtime, so the agent keeps its session.
  const model = office.configureAgent(CEO, { agent: "pm", model: "sonnet" });
  assert.deepEqual(model.changes.slice(0, 1), ["Model: Claude Sonnet (was Claude Haiku)."]);

  // A restarted office keeps the CEO's choice over the config file.
  const again = new Office(config(), store);
  assert.equal(again.agent("frontend").runtime, "junie");
  assert.equal(again.agent("pm").model, "haiku");
});

test("FYIs don't wake an idle agent; they arrive with its next real turn", async () => {
  const { office } = makeOffice();
  const { AgentHost } = await import("../src/runtimes/supervisor.ts");
  const turns: string[] = [];
  const host = new AgentHost(office, office.agent("pm"), {
    capabilities: { structuredOutput: true, resume: true, mcp: true, toolHooks: true, interrupt: true, memoryFile: "x" },
    async start() {},
    async turn(input) {
      turns.push(input);
    },
    async interrupt() {},
    async stop() {},
  });
  await host.start();
  const settle = () => new Promise((r) => setTimeout(r, 20));

  office.inform("backend", { to: "pm", text: "Slots API will return UTC." });
  office.ceoMessage({ to: "frontend", text: "Prioritise the calendar." }); // copies PM: an office FYI
  await settle();
  assert.equal(turns.length, 0, "FYIs alone don't start a turn");
  assert.equal(office.pending("pm", "turn_end").length, 2);

  office.ask("frontend", { to: "pm", question: "Is the launch still Friday?" });
  await settle();
  assert.equal(turns.length, 1, "a question wakes it");
  assert.match(turns[0]!, /Slots API will return UTC/);
  assert.match(turns[0]!, /Is the launch still Friday/);
  assert.equal(office.pending("pm", "turn_end").length, 0);

  office.ceoMessage({ to: "pm", text: "Ship it." });
  office.inform("backend", { to: "pm", text: "Tests are green.", urgency: "urgent" });
  await settle();
  assert.equal(turns.length, 2, "the CEO's messages and urgent informs wake it");
  await host.stop();
});
