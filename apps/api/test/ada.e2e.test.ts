// Ada end to end: a real Control API and office daemon; only Ada's model is scripted.
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
import { scriptedBrain, type BrainRun } from "../src/ada/brain.ts";
import { memoryOfficeData } from "../src/ada/data.ts";
import { buildApp } from "../src/app.ts";
import type { User } from "../src/auth.ts";
import { memoryLinkStore } from "../src/link/store.ts";
import { memoryMemoryStore } from "../src/memory/store.ts";
import type { OfficeStore } from "../src/offices.ts";
import { memoryProjectionStore } from "../src/projection/writer.ts";
import { createServices } from "../src/services.ts";
import { memorySetupStore } from "../src/setup/store.ts";

const OFFICE = randomUUID();
const USER: User = { id: "u1", email: null, githubLogin: "ceo", name: "Rahul" };

async function until(what: string, ok: () => boolean | Promise<boolean>, ms = 6000) {
  const end = Date.now() + ms;
  while (!(await ok())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

type Script = (r: BrainRun, call: (name: string, args: unknown) => Promise<string>) => Promise<string>;

async function setup(t: any, script: Script) {
  const link = memoryLinkStore();
  const { token, hash } = newOfficeToken(OFFICE);
  await link.setTokenHash(OFFICE, hash);
  const setups = memorySetupStore();
  const proj = memoryProjectionStore(() => link.events.get(OFFICE) ?? []);
  const tables = proj.tables;
  const data = memoryOfficeData({ inbox: () => tables.inbox, tasks: () => tables.tasks, threads: () => tables.threads, messages: () => tables.messages, agents: () => tables.agents });
  const memory = memoryMemoryStore();
  const brain = scriptedBrain(script);
  const offices: OfficeStore = {
    officeOf: async () => ({ id: OFFICE, name: "Acme", onboardedAt: null, sandboxState: "started", daemonConnected: true }),
    ensureOffice: async () => ({ office: (await offices.officeOf("u1"))!, created: false }),
  };
  const s = createServices({
    verify: async () => USER,
    stores: {
      offices,
      link,
      setups,
      projections: proj.store,
      budgets: { spendSince: async () => [], held: async () => new Map(), alert: async () => {} },
      machines: { get: async () => ({ sandboxId: null, state: "none" }), set: async () => {} },
      memory,
      conversations: {
        messages: async (_o, id) => [...tables.messages.values()].filter((m) => m.thread_id === id),
        openTasks: async () => [],
      },
      data,
    },
    machine: null,
    ada: { brain, triageDelayMs: 50 },
  });
  const app = await buildApp({ verify: async () => USER, offices, hub: s.hub, setup: s.setup, ada: s.ada, meetings: s.meetings, memory: s.memory, webOrigins: [] });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const port = (app.server.address() as AddressInfo).port;
  const daemon = await startDaemon({
    config: checkConfig({ name: "L", policy: { ...DEFAULT_POLICY }, rooms: [{ id: "x", name: "X", head: "solo" }], agents: [{ id: "solo", name: "Solo", room: "x", role: "head", runtime: "external", title: "" }] }),
    dataDir: mkdtempSync(join(tmpdir(), "agentfloor-ada-")),
    startAgents: false,
    log: () => {},
    link: { url: `ws://127.0.0.1:${port}${LINK_PATH}`, token },
  });
  t.after(async () => {
    await daemon.close();
    await app.close();
  });
  await until("setup", () => setups.rows.get(OFFICE)?.pushed === 1);
  const call = (method: "GET" | "POST", url: string, payload?: object) => app.inject({ method, url, payload, headers: { authorization: "Bearer x" } });
  /** Ada's chat over HTTP; returns the streamed events. */
  const chat = async (message: string) => {
    const res = await call("POST", "/office/ada/chat", { message });
    return res.body.split("\n\n").filter(Boolean).map((l) => JSON.parse(l.replace(/^data: /, "")));
  };
  return { s, daemon, data, memory, brain, tables, call, chat };
}

test("onboarding: Ada interviews, proposes the whole office, the CEO confirms, and it builds itself", async (t) => {
  const { daemon, data, memory, brain, chat, call } = await setup(t, async (r, call) => {
    if (!/The CEO says/.test(r.prompt)) return "Hi, I'm Ada. What does your company do?";
    const ops = [
      {
        op: "replace_setup",
        setup: {
          name: "Bright Dental",
          rooms: [{ id: "eng", name: "Engineering", head: "lead", purpose: "The booking app", whenBlocked: "best_guess_and_flag" }],
          agents: [
            { id: "lead", name: "Lead", room: "eng", role: "head", title: "Runs Engineering", runtime: "claude-code" },
            { id: "dev", name: "Dev", room: "eng", role: "member", title: "Builds the app", runtime: "claude-code" },
          ],
          budgets: [{ scope: "office", id: "", dailyUsdSoft: 3, dailyUsdHard: 10 }],
        },
      },
    ];
    const rb = await call("propose_change", { ops, why: "Your office: one Engineering room" });
    assert.match(rb, /Read-back card shown/);
    await call("finish_onboarding", { company_name: "Bright Dental", what_it_does: "Online booking for dental clinics", goals: ["Launch in Sydney by March"], rules: ["Never store card numbers"] });
    return "Here's your office. Confirm the card and it builds itself.";
  });
  const hello = await chat("");
  assert.equal(hello.at(-1).message.content, "Hi, I'm Ada. What does your company do?");
  assert.match(brain.runs[0]!.system, /onboarding interview/);

  const events = await chat("We do online booking for dental clinics; we need an app team.");
  const card = events.find((e) => e.type === "card").card;
  assert.ok(card.readback.some((l: string) => l.includes('Rename the office to "Bright Dental"')));
  assert.equal(events.at(-1).type, "done");
  assert.equal(await data.onboarded(OFFICE), false, "nothing changes until the CEO confirms");

  const confirmed = await call("POST", `/office/ada/cards/${card.id}/confirm`);
  assert.equal(confirmed.statusCode, 200, confirmed.body);
  await until("the office to rebuild", () => daemon.office.config.name === "Bright Dental" && daemon.office.config.agents.some((a) => a.id === "dev"));
  assert.equal(await data.onboarded(OFFICE), true);
  assert.deepEqual((data.company as any)?.rules, ["Never store card numbers"]);
  const company = await memory.list(OFFICE, { scopes: [["company"]] });
  assert.deepEqual(company.map((i) => i.type).sort(), ["charter", "goal", "rule"]);
  assert.equal((await call("POST", `/office/ada/cards/${card.id}/confirm`)).statusCode, 422, "a card applies once");
});

test("Ada can't change what's locked; the CEO can", async (t) => {
  let result = "";
  const { call, chat, data } = await setup(t, async (_r, call) => {
    result = await call("propose_change", { ops: [{ op: "set_budget", scope: "office", id: "", dailyUsdSoft: 100, dailyUsdHard: 500 }], why: "More budget" });
    return "Tried.";
  });
  await data.markOnboarded(OFFICE, {});
  const base = (await call("GET", "/office/setup")).json().version;
  assert.equal((await call("POST", "/office/setup/apply", { ops: [{ op: "lock", target: "budgets" }], baseVersion: base })).statusCode, 200);
  await chat("Raise the budget to 500 a day");
  assert.match(result, /Can't propose that: That's locked: daily budgets/);
});

test("triage, a meeting from a head's request, minutes that become memory and tasks", async (t) => {
  let minutesRun: BrainRun | null = null;
  const { s, daemon, data, memory, tables, call } = await setup(t, async (r, call) => {
    if (/New items in the CEO's inbox/.test(r.prompt)) {
      const item = (await data.inbox(OFFICE)).find((i) => i.kind === "meeting_request")!;
      await call("triage_inbox", { items: [{ id: item.id, priority: 1, note: "Scope call between Development and Marketing; worth a meeting." }] });
      await call("schedule_meeting", {
        topic: "Launch scope",
        attendees: ["pm", "strategist"],
        agenda: ["Reminders: in or out", "Launch date"],
        pre_read: "PM recommends cutting reminders; Strategist wants them for the campaign.",
        request_inbox_id: item.id,
      });
      return "Triaged.";
    }
    if (/Write the minutes/.test(r.prompt)) {
      minutesRun = r;
      await call("record_minutes", {
        summary: "Reminders move to v1.1; launch stays March 1.",
        decisions: [{ text: "Launch March 1 without reminders", rationale: "Booking matters more than reminders", room: "dev" }],
        action_items: [{ text: "Write the launch post without reminders", owner: "strategist" }],
      });
      return "Done.";
    }
    return "";
  });
  daemon.office.requestMeeting("pm", { topic: "Launch scope", why: "Reminders or the date", attendees: ["strategist"] });
  await until("Ada's meeting", async () => (await data.meetings(OFFICE)).length === 1);
  const inbox = await data.inbox(OFFICE);
  assert.equal(inbox[0]!.priority, 1);
  assert.match(inbox[0]!.adaNote!, /Booked as a meeting/);

  const [m] = (await call("GET", "/office/meetings")).json().meetings;
  assert.equal(m.preRead, "PM recommends cutting reminders; Strategist wants them for the campaign.");
  const started = await call("POST", `/office/meetings/${m.id}/start`);
  assert.equal(started.statusCode, 200, started.body);
  const threadId = started.json().meeting.threadId;
  daemon.office.reply("pm", { threadId, text: "I recommend shipping without reminders." });
  daemon.office.reply("strategist", { threadId, text: "OK if they come in v1.1." });
  await until("the transcript", () => [...tables.messages.values()].filter((x) => x.thread_id === threadId).length >= 3);

  const ended = await call("POST", `/office/meetings/${m.id}/end`);
  assert.equal(ended.statusCode, 200, ended.body);
  assert.match(minutesRun!.prompt, /PM: I recommend shipping without reminders/);
  assert.equal(daemon.office.thread(threadId).state, "resolved");
  const task = daemon.office.store.tasks().find((x) => x.title === "Write the launch post without reminders")!;
  assert.equal(task.owner, "strategist");
  const decisions = await memory.list(OFFICE, { scopes: [["room", "dev"]], type: "decision" });
  assert.match(decisions[0]!.body, /Booking matters more than reminders/);
  await until("the action item's task in the tables", () => tables.tasks.has(task.id));
  const mins = (await call("GET", `/office/meetings/${m.id}/minutes`)).json().minutes;
  assert.equal(mins.actionItems[0].taskId, task.id);
  assert.equal(mins.actionItems[0].status, "queued", "tracked through its task");
  await until("audit", () => tables.audit.some((a) => a.action === "meeting.started"));
  void s;
});
