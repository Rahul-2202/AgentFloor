import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Office } from "../src/core/office.ts";
import { classify } from "../src/core/permissions.ts";
import { Store } from "../src/core/store.ts";
import { checkConfig, DEFAULT_POLICY } from "../src/core/config.ts";
import { startDaemon } from "../src/daemon/daemon.ts";
import { memoryFile } from "../src/runtimes/briefing.ts";
import type { OfficeConfig } from "../src/core/types.ts";

const run = promisify(execFile);
const ROOT = join(import.meta.dirname, "..");

const config = (): OfficeConfig =>
  checkConfig({
    name: "Gov",
    policy: { ...DEFAULT_POLICY },
    rooms: [
      { id: "dev", name: "Development", head: "pm", whenBlocked: "stop_and_wait", permissions: { network: "ask" } },
      { id: "mkt", name: "Marketing", head: "strat" },
    ],
    agents: [
      { id: "pm", name: "PM", room: "dev", role: "head", runtime: "scripted", title: "" },
      { id: "backend", name: "Backend", room: "dev", role: "member", runtime: "scripted", title: "", permissions: { push: "never" } },
      { id: "strat", name: "Strat", room: "mkt", role: "head", runtime: "scripted", title: "" },
    ],
  });

const roots = { workdir: "/data/agents/backend/repo", home: "/data/agents/backend" };

test("tool calls are classified by what they touch", () => {
  const perms = (tool: string, input: object) => classify(tool, input as Record<string, unknown>, roots).map((n) => n.permission);
  assert.deepEqual(perms("Bash", { command: "npm test" }), []);
  assert.deepEqual(perms("Bash", { command: "git commit -m x && git push -u origin HEAD" }), ["push"]);
  assert.deepEqual(perms("Bash", { command: "npm install left-pad" }), ["network"]);
  assert.deepEqual(perms("Bash", { command: "curl https://example.com" }), ["network"]);
  assert.deepEqual(perms("Bash", { command: "cat /etc/passwd" }), ["outside_worktree"]);
  assert.deepEqual(perms("Bash", { command: "ls ../../other-agent" }), ["outside_worktree"]);
  assert.deepEqual(perms("Bash", { command: "ls src/ && cat /tmp/x.log" }), []);
  assert.deepEqual(perms("Write", { file_path: "/data/agents/backend/repo/src/a.ts" }), []);
  assert.deepEqual(perms("Edit", { file_path: "/data/agents/frontend/repo/src/a.ts" }), ["outside_worktree"]);
  assert.deepEqual(perms("WebFetch", { url: "https://docs.x" }), ["network"]);
});

test("never refuses, ask goes to the CEO once, a grant is used up", () => {
  const office = new Office(config(), new Store(":memory:"));
  assert.match(office.checkPermission("backend", "push", "git push").reason!, /not allowed to push branches/);
  // The room says network is "ask".
  const first = office.checkPermission("backend", "network", "npm install zod");
  assert.equal(first.allow, false);
  assert.match(first.reason!, /CEO's OK[\s\S]*inbox I-1/);
  office.checkPermission("backend", "network", "npm install zod");
  assert.equal(office.store.inbox().filter((i) => i.state === "open").length, 1, "one open ask, not two");
  office.answerPermission("I-1", true);
  assert.equal(office.checkPermission("backend", "network", "npm install zod").allow, true, "the grant");
  assert.equal(office.checkPermission("backend", "network", "npm install zod").allow, false, "used up");
  assert.ok(office.take("backend", "turn_end").some((m) => /Yes, go ahead and reach the internet/.test(m.body)));
});

test("the first use of a powerful permission asks the CEO, then never again", () => {
  const office = new Office(config(), new Store(":memory:"));
  const r = office.checkPermission("pm", "push", "git push origin af/pm/K-1");
  assert.equal(r.allow, false);
  assert.match(r.reason!, /first time you push branches, the CEO checks it/);
  const item = office.store.inbox().find((i) => i.state === "open")!;
  assert.equal(item.action?.type === "permission" && item.action.firstUse, true);
  office.answerPermission(item.id, true);
  assert.equal(office.checkPermission("pm", "push", "again").allow, true);
  assert.equal(office.checkPermission("pm", "push", "and again").allow, true);
  // Refusing says so.
  office.checkPermission("pm", "outside_worktree", "cat /etc/hosts"); // default never
  assert.equal(office.checkPermission("strat", "network", "curl x").allow, false, "first use for strat too");
  const ask = office.store.inbox().find((i) => i.state === "open" && i.from === "strat")!;
  office.answerPermission(ask.id, false, "use the docs we have");
  assert.ok(office.take("strat", "turn_end").some((m) => /No, don't reach the internet: use the docs we have/.test(m.body)));
});

test("agents ask for permissions, heads ask for meetings, and meetings run as threads", () => {
  const office = new Office(config(), new Store(":memory:"));
  const pr = office.requestPermission("backend", { permission: "push", why: "I need to ship the slots PR" });
  assert.equal(office.store.getInbox(pr.inboxId)!.action?.type, "permission_request");
  assert.throws(() => office.requestPermission("backend", { permission: "fly", why: "" }), /Permissions are/);

  assert.throws(() => office.requestMeeting("backend", { topic: "x", why: "y" }), /for heads/);
  const req = office.requestMeeting("pm", { topic: "Launch scope", why: "We can't do both", attendees: ["strat"], options: ["Cut reminders", "Slip a week"] });
  const item = office.store.getInbox(req.inboxId)!;
  assert.deepEqual(item.action, { type: "meeting", topic: "Launch scope", why: "We can't do both", attendees: ["pm", "strat"], options: ["Cut reminders", "Slip a week"] });

  const { threadId } = office.startMeeting({ topic: "Launch scope", attendees: ["pm", "strat"], agenda: ["Scope", "Date"], chair: "ada" });
  const opening = office.take("pm", "tool"); // meetings reach heads mid-task
  assert.match(opening[0]!.body, /Chair: Ada[\s\S]*1\. Scope[\s\S]*states the question and their recommendation/);
  assert.match(office.render(opening), /You're in a meeting/);
  office.reply("pm", { threadId, text: "Recommend cutting reminders." });
  office.reply("ceo", { threadId, text: "Agreed: cut reminders, launch on time." });
  assert.equal(office.thread(threadId).state, "open", "meetings don't resolve on a reply");
  office.endMeeting({ threadId, outcome: "Reminders cut; launch March 1." });
  assert.equal(office.thread(threadId).state, "resolved");
  assert.ok(office.take("strat", "turn_end").some((m) => /meeting "Launch scope" ended/.test(m.body)));
});

test("PRs follow the room's publish mode and the agent's permissions", async () => {
  const office = new Office({ ...config(), repo: { fullName: "a/b", defaultBranch: "main", cloneUrl: "x" } }, new Store(":memory:"));
  let drafted: boolean | null = null;
  office.hooks.push = async () => "af/pm/K-1";
  office.hooks.api = async (_n, args: any) => ((drafted = args.draft), { number: 1, url: "u" });
  await assert.rejects(office.openPr("backend", { title: "x" }), /not allowed to push/);
  office.store.setKv("firstuse:pm:push", true);
  await office.openPr("pm", { title: "x" });
  assert.equal(drafted, true, "drafts by default");
  office.config.rooms[0]!.publish = "direct";
  await office.openPr("pm", { title: "y" });
  assert.equal(drafted, false);
});

test("the memory file carries the room's when-blocked rule and the agent's brief", () => {
  const c = config();
  const text = memoryFile(c.agents[1]!, c, "## What you know (office memory)\n\n- [abcd1234] **Times in UTC**: store UTC");
  assert.match(text, /Your room's rule: stop and wait for an answer/);
  assert.match(text, /Times in UTC/);
});

test("the PreToolUse hook refuses what the agent may not do, with the reason", async (t) => {
  const daemon = await startDaemon({ config: config(), dataDir: mkdtempSync(join(tmpdir(), "agentfloor-gov-")), startAgents: false, log: () => {} });
  t.after(() => daemon.close());
  const hook = async (agent: string, tool: string, input: object) => {
    const env = daemon.envFor(agent);
    const child = execFile(join(ROOT, "bin/office"), ["pretool"], { env });
    child.stdin!.end(JSON.stringify({ tool_name: tool, tool_input: input, cwd: join(env.AGENTFLOOR_URL ? "" : "", "/") }));
    let out = "";
    child.stdout!.on("data", (d) => (out += d));
    await new Promise((ok) => child.on("close", ok));
    return out.trim() ? JSON.parse(out).hookSpecificOutput : null;
  };
  assert.equal(await hook("backend", "Bash", { command: "npm test" }), null, "allowed: no output");
  const denied = await hook("backend", "Bash", { command: "git push origin HEAD" });
  assert.equal(denied.permissionDecision, "deny");
  assert.match(denied.permissionDecisionReason, /not allowed to push/);
  assert.equal(await hook("backend", "mcp__office__ask", {}), null, "office tools always pass");
  void run;
});
