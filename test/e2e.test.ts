import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { checkConfig, DEFAULT_POLICY, loadConfig } from "../src/core/config.ts";
import { startDaemon, type RunningOffice } from "../src/daemon/daemon.ts";
import { CEO } from "../src/core/types.ts";

const run = promisify(execFile);
const ROOT = join(import.meta.dirname, "..");

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "agentfloor-"));
}

/** An agent on an MCP runtime: the office MCP server, started with that agent's identity. */
async function mcpAgent(office: RunningOffice, id: string): Promise<Client> {
  const env = office.envFor(id);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--disable-warning=ExperimentalWarning", join(ROOT, "src/mcp/server.ts")],
    env,
  });
  const client = new Client({ name: `test-${id}`, version: "0" });
  await client.connect(transport);
  return client;
}

/** An agent on a runtime without MCP: it runs the `office` shell command. */
async function shell(office: RunningOffice, id: string, ...args: string[]): Promise<string> {
  const { stdout } = await run(join(ROOT, "bin/office"), args, { env: office.envFor(id) });
  return stdout.trim();
}

const text = (r: any): string => r.content.map((c: any) => c.text).join("\n");

test("an MCP agent and a shell-CLI agent talk to each other through the office", async (t) => {
  const dir = tempDir();
  const office = await startDaemon({
    dataDir: dir,
    startAgents: false,
    log: () => {},
    config: checkConfig({
      name: "E2E",
      policy: DEFAULT_POLICY,
      rooms: [{ id: "dev", name: "Development", head: "pm" }],
      agents: [
        { id: "pm", name: "PM", room: "dev", role: "head", runtime: "external", title: "Head" },
        { id: "backend", name: "Backend", room: "dev", role: "member", runtime: "claude-code", title: "API" },
        { id: "frontend", name: "Frontend", room: "dev", role: "member", runtime: "junie", title: "UI" },
      ],
    }),
  });
  const backend = await mcpAgent(office, "backend");
  t.after(async () => {
    await backend.close();
    await office.close();
    rmSync(dir, { recursive: true, force: true });
  });

  // The MCP server offers the agent tools and nothing for the CEO or adapters.
  const tools = (await backend.listTools()).tools.map((x) => x.name);
  for (const name of ["ask", "reply", "inform", "huddle", "end_huddle", "ask_ceo", "wait", "inbox"]) assert.ok(tools.includes(name), name);
  assert.ok(!tools.includes("ceo_message") && !tools.includes("delivery"));

  // Backend (MCP) asks Frontend (shell).
  const asked = JSON.parse(text(await backend.callTool({ name: "ask", arguments: { to: "frontend", question: "Local time or UTC for slots?" } })));
  assert.match(asked.threadId, /^T-\d+$/);

  // Frontend reads it with the CLI, exactly as its agent would.
  const inbox = await shell(office, "frontend", "inbox");
  assert.match(inbox, /From: Backend \(backend\) · ask · normal · thread T-\d+/);
  assert.match(inbox, /Local time or UTC for slots\?/);

  // Backend blocks on the answer while Frontend replies from the shell.
  const waiting = backend.callTool({ name: "wait", arguments: { thread_id: asked.threadId, timeout_sec: 10 } });
  await shell(office, "frontend", "reply", asked.threadId, "UTC plus the clinic's IANA time zone.", "--resolve");
  const answer = text(await waiting);
  assert.match(answer, /From: Frontend \(frontend\) · answer/);
  assert.match(answer, /UTC plus the clinic's IANA time zone\./);
  assert.equal(office.office.thread(asked.threadId).state, "resolved");

  // Rules reach both channels with the same explanation.
  const denied = await backend.callTool({ name: "ask_ceo", arguments: { question: "Ship Friday?" } });
  assert.equal(denied.isError, true);
  assert.match(text(denied), /route: Members ask the CEO through their head/);
  await assert.rejects(shell(office, "frontend", "stop", "backend", "nope"), /not_allowed/);

  // A huddle across the two channels.
  const h = await shell(office, "frontend", "huddle", "backend", "Confirmation payload", "Can it include the clinic address?");
  const threadId = JSON.parse(h).threadId as string;
  assert.match(text(await backend.callTool({ name: "inbox", arguments: {} })), /huddle · urgent/);
  await backend.callTool({ name: "reply", arguments: { thread_id: threadId, text: "Yes: clinic {name, address}." } });
  assert.match(await shell(office, "frontend", "inbox"), /Yes: clinic \{name, address\}\./);
  await shell(office, "frontend", "end-huddle", threadId, "Confirmation includes clinic {name, address}.");
  assert.match(text(await backend.callTool({ name: "inbox", arguments: {} })), /Outcome: Confirmation includes clinic/);

  // Tokens are per agent: the env file holds only that agent's identity.
  assert.match(readFileSync(join(dir, "agents/frontend/env"), "utf8"), /AGENTFLOOR_AGENT='frontend'/);
});

test("the API refuses missing or forged tokens", async (t) => {
  const dir = tempDir();
  const office = await startDaemon({ dataDir: dir, startAgents: false, log: () => {}, config: loadConfig(join(ROOT, "config/demo-scripted.json")) });
  t.after(async () => {
    await office.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const call = (token: string) => fetch(`${office.url}/rpc/whoami`, { method: "POST", headers: { authorization: `Bearer ${token}` } });
  assert.equal((await call("")).status, 401);
  assert.equal((await call("pm.0000")).status, 401);
  assert.equal((await call(office.auth.tokenFor("pm"))).status, 200);
  // Agents can't read the CEO's view.
  assert.equal((await fetch(`${office.url}/api/state`, { headers: { authorization: `Bearer ${office.auth.tokenFor("pm")}` } })).status, 403);
  assert.equal((await fetch(`${office.url}/api/state`, { headers: { authorization: `Bearer ${office.auth.tokenFor(CEO)}` } })).status, 200);
});

test("the scripted demo office plays every protocol path by itself", async (t) => {
  const dir = tempDir();
  const config = loadConfig(join(ROOT, "config/demo-scripted.json"));
  config.policy.askDeadlineSec = 1;
  for (const a of config.agents) ((a.options ??= {}).script ??= {} as any).stepMs = 30;
  const lines: string[] = [];
  const office = await startDaemon({ dataDir: dir, config, tickMs: 100, log: (l) => lines.push(l) });
  t.after(async () => {
    await office.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const o = office.office;
  const until = async (what: string, ok: () => boolean) => {
    const end = Date.now() + 15000;
    while (!ok()) {
      if (Date.now() > end) assert.fail(`timed out waiting for: ${what}\n${lines.join("\n")}`);
      await new Promise((r) => setTimeout(r, 50));
    }
  };
  const threads = () => o.store.threads();
  const find = (s: string) => threads().find((t) => t.topic.includes(s));

  await until("frontend and backend agree in a huddle", () => find("Booking confirmation")?.state === "resolved");
  assert.match(find("Booking confirmation")!.outcome!, /cancelUrl/);

  await until("both answer each other's questions", () => find("response shape")?.state === "resolved" && find("clinic local time")?.state === "resolved");

  await until("tester's question escalates to PM, who answers it", () => {
    const t = find("Which clinics");
    return !!t && t.escalation >= 1 && o.store.threadMessages(t.id).some((m) => m.from === "pm" && /Sydney, Leeds and Austin/.test(m.body));
  });

  await until("a head's unanswered question reaches the CEO", () => o.store.inbox().some((i) => i.kind === "escalation" && /photos/i.test(i.body)));
  assert.ok(o.store.inbox().some((i) => i.kind === "question" && i.from === "pm"));

  await until("tasks get done", () => o.store.tasks().filter((t) => t.status === "done").length >= 2);
  assert.ok(lines.some((l) => /\[tester\] ✗ Work for Creator goes through their head/.test(l)), "cross-room work was refused");
  assert.ok(lines.some((l) => /\(mid-task\)/.test(l)), "a question reached a busy agent mid-task");
});
