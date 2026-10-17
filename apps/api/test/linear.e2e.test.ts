// Linear end to end: a real Control API and a real office daemon, with a fake
// Linear GraphQL API recording what was asked.
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { checkConfig, DEFAULT_POLICY } from "@agentfloor/daemon/config";
import { startDaemon } from "@agentfloor/daemon/daemon";
import { LINK_PATH, newOfficeToken } from "@agentfloor/shared/link";
import { buildApp } from "../src/app.ts";
import type { User } from "../src/auth.ts";
import { LinearClient } from "../src/linear/client.ts";
import { memoryLinearStore, type TaskLike } from "../src/linear/service.ts";
import { memoryLinkStore } from "../src/link/store.ts";
import type { OfficeStore } from "../src/offices.ts";
import { memoryProjectionStore } from "../src/projection/writer.ts";
import { createServices } from "../src/services.ts";
import { memorySetupStore } from "../src/setup/store.ts";

const OFFICE = randomUUID();
const USER: User = { id: "u1", email: null, githubLogin: "ceo-login", name: "CEO" };

async function until(what: string, ok: () => boolean | Promise<boolean>, ms = 8000) {
  const end = Date.now() + ms;
  while (!(await ok())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

const STATES = [
  { id: "s-todo", name: "Todo", type: "unstarted" },
  { id: "s-prog", name: "In Progress", type: "started" },
  { id: "s-rev", name: "In Review", type: "started" },
  { id: "s-done", name: "Done", type: "completed" },
  { id: "s-cancel", name: "Canceled", type: "canceled" },
];

/** Just enough of Linear's GraphQL API, recording each operation. */
async function fakeLinear() {
  const ops: { op: string; vars: any }[] = [];
  const issues = new Map<string, { id: string; identifier: string; url: string; title: string; state: (typeof STATES)[number] }>();
  let n = 0;
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    const { query, variables: v } = JSON.parse(raw);
    const send = (data: object) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data }));
    };
    const op = /(issueLabelCreate|projectCreate|webhookCreate|webhookDelete|issueCreate|issueUpdate|commentCreate|attachmentLinkURL|teams|team\(|issue\(|viewer)/.exec(query)?.[1] ?? "?";
    ops.push({ op, vars: v });
    if (op === "viewer") return send({ viewer: { id: "u", name: "Rahul" }, organization: { name: "Acme" } });
    if (op === "teams") return send({ teams: { nodes: [{ id: "team-1", key: "ENG", name: "Engineering" }] } });
    if (op === "team(") return send({ team: { id: "team-1", key: "ENG", name: "Engineering", states: { nodes: STATES }, labels: { nodes: [] } } });
    if (op === "issueLabelCreate") return send({ issueLabelCreate: { issueLabel: { id: `label-${++n}` } } });
    if (op === "projectCreate") return send({ projectCreate: { project: { id: "proj-1", url: "https://linear.app/acme/project/p1" } } });
    if (op === "webhookCreate") return send({ webhookCreate: { webhook: { id: "hook-1" } } });
    if (op === "issueCreate") {
      const id = `issue-${++n}`;
      const issue = { id, identifier: `ENG-${n}`, url: `https://linear.app/acme/issue/ENG-${n}`, title: v.i.title, state: STATES.find((s) => s.id === v.i.stateId) ?? STATES[0]! };
      issues.set(id, issue);
      return send({ issueCreate: { issue } });
    }
    if (op === "issue(") {
      const issue = [...issues.values()].find((i) => i.id === v.id || i.identifier === v.id);
      return send({ issue: issue ? { ...issue, team: { id: "team-1" } } : null });
    }
    return send({ [op]: { success: true } });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/graphql`, ops, issues, close: () => new Promise((ok) => server.close(ok)) };
}

test("Linear: tasks become issues, Linear changes reach the office, agents move tickets", async (t) => {
  const lin = await fakeLinear();
  const link = memoryLinkStore();
  const { token, hash } = newOfficeToken(OFFICE);
  await link.setTokenHash(OFFICE, hash);
  const proj = memoryProjectionStore(() => link.events.get(OFFICE) ?? []);
  const offices: OfficeStore = {
    officeOf: async () => ({ id: OFFICE, name: "Acme", onboardedAt: null, sandboxState: "started", daemonConnected: true }),
    ensureOffice: async () => ({ office: (await offices.officeOf("u1"))!, created: false }),
  };
  const toTask = (r: any): TaskLike => ({ id: r.id, title: r.title, details: r.details, owner: r.owner_id, status: r.status, note: r.note, blocker: r.blocker, outputs: r.outputs });
  const audits: string[] = [];
  const s = createServices({
    verify: async () => USER,
    stores: {
      offices,
      link,
      setups: memorySetupStore(),
      projections: proj.store,
      budgets: { spendSince: async () => [], held: async () => new Map(), alert: async () => {} },
      machines: { get: async () => ({ sandboxId: null, state: "none" }), set: async () => {} },
      linear: memoryLinearStore(),
      tasks: {
        open: async () => [...proj.tables.tasks.values()].filter((x: any) => x.status !== "done").map(toTask),
        one: async (_o, id) => (proj.tables.tasks.get(id) ? toTask(proj.tables.tasks.get(id)) : null),
      },
      audit: async (_o, actor, action) => void audits.push(`${actor}:${action}`),
    },
    machine: null,
    linear: { client: new LinearClient({ apiKey: "lin_test", url: lin.url }), publicUrl: "https://api.example.com", secret: "server-secret" },
  });
  const api = await buildApp({ verify: async () => USER, offices, hub: s.hub, setup: s.setup, linear: s.linear, webOrigins: [] });
  await api.listen({ port: 0, host: "127.0.0.1" });
  const port = (api.server.address() as AddressInfo).port;
  const daemon = await startDaemon({
    config: checkConfig({ name: "L", policy: { ...DEFAULT_POLICY }, rooms: [{ id: "x", name: "X", head: "solo" }], agents: [{ id: "solo", name: "Solo", room: "x", role: "head", runtime: "external", title: "" }] }),
    dataDir: mkdtempSync(join(tmpdir(), "agentfloor-linoffice-")),
    startAgents: false,
    log: () => {},
    link: { url: `ws://127.0.0.1:${port}${LINK_PATH}`, token },
  });
  t.after(async () => {
    await daemon.close();
    await api.close();
    await lin.close();
  });
  const call = (method: "GET" | "POST", url: string, payload?: object) => api.inject({ method, url, payload, headers: { authorization: "Bearer x" } });
  await until("setup", () => daemon.office.config.agents.some((a) => a.id === "pm"));

  // Connect: the teams to pick from, then a project, the label and the webhook.
  assert.deepEqual((await call("GET", "/office/linear")).json().teams.map((x: any) => x.key), ["ENG"]);
  const connected = await call("POST", "/office/linear/connect", { teamId: "team-1" });
  assert.equal(connected.statusCode, 200, connected.body);
  assert.equal(connected.json().link.teamKey, "ENG");
  const hook = lin.ops.find((o) => o.op === "webhookCreate")!.vars.i;
  assert.equal(hook.url, `https://api.example.com/linear/webhook/${OFFICE}`);

  // A task becomes an issue: in the project, labelled, in Todo.
  const assigned = await call("POST", "/office/call", { name: "ceo_assign", args: { to: "pm", title: "Add a health endpoint", done_means: "A PR with a test" } });
  assert.equal(assigned.statusCode, 200, assigned.body);
  const taskId = assigned.json().result.taskId;
  await until("the issue", () => lin.issues.size === 1);
  const created = lin.ops.find((o) => o.op === "issueCreate")!.vars.i;
  assert.equal(created.title, "Add a health endpoint");
  assert.equal(created.projectId, "proj-1");
  assert.equal(created.stateId, "s-todo");
  assert.match(created.description, /Done means:\*\* A PR with a test/);
  const issue = [...lin.issues.values()][0]!;

  // The agent works on it: the issue moves to In Progress, the blocker is a comment.
  daemon.office.updateTask("pm", { taskId, status: "blocked", blocker: "Which port?" });
  await until("the move", () => lin.ops.some((o) => o.op === "issueUpdate" && o.vars.i.stateId === "s-prog"));
  await until("the blocker comment", () => lin.ops.some((o) => o.op === "commentCreate" && /Blocked:\*\* Which port\?/.test(o.vars.i.body)));

  // Someone closes it in Linear: the task follows and the owner hears about it.
  const sign = (body: object) => {
    const raw = JSON.stringify(body);
    return { raw, sig: createHmac("sha256", s.linear!.secretFor(OFFICE)).update(raw).digest("hex") };
  };
  const moved = sign({ action: "update", type: "Issue", actor: { name: "Rahul" }, data: { id: issue.id, teamId: "team-1", stateId: "s-done", title: issue.title } });
  const bad = await api.inject({ method: "POST", url: `/linear/webhook/${OFFICE}`, payload: moved.raw, headers: { "content-type": "application/json", "linear-signature": "nope" } });
  assert.equal(bad.statusCode, 401);
  const ok = await api.inject({ method: "POST", url: `/linear/webhook/${OFFICE}`, payload: moved.raw, headers: { "content-type": "application/json", "linear-signature": moved.sig } });
  assert.equal(ok.statusCode, 200, ok.body);
  await until("the task follows", () => daemon.office.store.getTask(taskId)?.status === "done");
  // Messages wait in the owner's queue for its next break.
  const told = (re: RegExp) => daemon.office.store.queuedFor("pm").some((m) => re.test(m.body));
  await until("the owner is told", () => told(/moved ENG-\d+ .* to Done/));
  assert.ok(audits.includes("linear:linear.issue.moved"));

  // A comment in Linear reaches the owner; our own comments don't echo back.
  const comment = sign({ action: "create", type: "Comment", actor: { name: "Rahul" }, data: { issueId: issue.id, body: "Use port 8080." } });
  await api.inject({ method: "POST", url: `/linear/webhook/${OFFICE}`, payload: comment.raw, headers: { "content-type": "application/json", "linear-signature": comment.sig } });
  await until("the comment", () => told(/Comment on Linear ENG-\d+ from Rahul:\s+Use port 8080/));

  // Agents file tickets; closing one is a permission (asks the CEO by default).
  const ticket = (await daemon.office.ticket("pm", { op: "create", title: "Flaky login test" })) as { identifier: string };
  assert.match(ticket.identifier, /^ENG-\d+$/);
  await assert.rejects(daemon.office.ticket("pm", { op: "update", ticket: ticket.identifier, status: "done" }), /permission|approv|ask/i);
  const moving = (await daemon.office.ticket("pm", { op: "update", ticket: ticket.identifier, status: "in_review", comment: "Fixed on my branch." })) as { status: string };
  assert.equal(moving.status, "in_review");
  assert.ok(lin.ops.some((o) => o.op === "issueUpdate" && o.vars.i.stateId === "s-rev"));
});
