/**
 * Live check of what real Claude Code agents hadn't shown yet (AGE-24):
 * a huddle to an agreed outcome, stop mid-turn, and continuing after a daemon
 * restart. Uses real model calls (Haiku). Run: node scripts/check-claude.ts
 */
import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../src/core/config.ts";
import { CEO } from "../src/core/types.ts";
import { startDaemon, type RunningOffice } from "../src/daemon/daemon.ts";

const DATA = "data-check";
const config = () => loadConfig("config/live-check.json");
const results: [string, boolean, string][] = [];
const log = (s: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${s}`);

async function until(what: string, ok: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) {
      log(`timed out: ${what}`);
      return false;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return true;
}

/** The CEO messages an agent and waits for its reply on that thread. */
async function askAsCeo(run: RunningOffice, to: string, text: string): Promise<string | null> {
  const { threadId } = run.office.ceoMessage({ to, text });
  const got = () => run.office.store.threadMessages(threadId).find((m) => m.from === to && m.to === CEO);
  await until(`${to} replies to the CEO`, () => !!got(), 180_000);
  return got()?.body ?? null;
}

rmSync(DATA, { recursive: true, force: true });
let run = await startDaemon({ config: config(), dataDir: DATA, log: () => {} });
log(`office at ${run.url}`);

// 1. Huddle: Backend's kickoff opens one with Frontend.
const huddle = () => run.office.store.threads().find((t) => t.kind === "huddle");
const agreed = await until("the huddle ends with an outcome", () => huddle()?.state === "resolved" && !!huddle()?.outcome, 300_000);
const h = huddle();
if (h) {
  const turns = run.office.store.threadMessages(h.id).filter((m) => m.from !== "office").length;
  log(`huddle ${h.id}: ${turns} messages, outcome: ${h.outcome}`);
}
results.push(["Huddle reaches an agreed outcome", agreed, h?.outcome ?? "no outcome"]);
await until("agents go idle", () => Object.values(run.office.snapshot().statuses).every((s: any) => s.status !== "working"), 120_000);

// 2. Stop: give Frontend a long task, stop it after its first files.
const notes = join(DATA, "agents/frontend/work/notes");
const count = () => (existsSync(notes) ? readdirSync(notes).length : 0);
run.office.requestWork(CEO, {
  to: "frontend",
  title: "Write UI notes",
  details: "Write notes/1.md through notes/10.md, one file per Write call, each with a heading and three bullets about a different part of the booking UI. Don't stop until all ten are written.",
});
await until("Frontend writes its first two files", () => count() >= 2, 180_000);
const atStop = count();
run.office.ceoMessage({ to: "frontend", text: "Stop: that's enough notes for now.", urgency: "stop" });
const stopped = await until("Frontend shows as stopped", () => (run.office.snapshot().statuses as any).frontend.status === "stopped", 30_000);
await new Promise((r) => setTimeout(r, 5000));
const after = count();
log(`files when stopped: ${atStop}, five seconds later: ${after}`);
results.push(["Stop halts a busy agent mid-turn", stopped && after < 10, `${after} of 10 files written, status stopped: ${stopped}`]);

const recall = await askAsCeo(run, "frontend", "Reply on this thread in one or two sentences: what were you doing when I stopped you, and how many notes had you written?");
log(`Frontend after stop: ${recall}`);
results.push(["Continues with context after a stop", !!recall && /\d|note/i.test(recall), recall ?? "no reply"]);

// 3. Restart the office; Backend resumes its own session.
const usageBefore = (run.office.snapshot().usage as any).backend;
await run.close();
log("office stopped; restarting");
run = await startDaemon({ config: config(), dataDir: DATA, log: () => {} });
const usageAfter = (run.office.snapshot().usage as any).backend;
results.push(["Usage totals survive a restart", usageAfter?.calls === usageBefore?.calls && usageAfter?.calls > 0, `${usageAfter?.calls} calls kept`]);
const kickoffs = run.office.store.threads().filter((t) => t.kind === "huddle").length;
results.push(["Kickoff doesn't rerun after a restart", kickoffs === 1, `${kickoffs} huddle(s)`]);

const remembered = await askAsCeo(run, "backend", "Reply on this thread from memory, without looking anything up: what confirmation payload did you and Frontend agree in your huddle?");
log(`Backend after restart: ${remembered}`);
// It should recall the fields actually agreed in the huddle (whatever they were this run).
const agreedFields = (h?.outcome?.match(/[a-z]+[A-Z][A-Za-z]+/g) ?? []).filter((f, i, all) => all.indexOf(f) === i);
const recalled = agreedFields.filter((f) => remembered?.includes(f));
results.push([
  "Remembers its conversation after a restart",
  !!remembered && agreedFields.length > 0 && recalled.length === agreedFields.length,
  `recalled ${recalled.length} of ${agreedFields.length} agreed fields (${agreedFields.join(", ")}): ${remembered ?? "no reply"}`,
]);

const usage = run.office.snapshot().usage as Record<string, any>;
await run.close();

console.log("\n=== Results");
for (const [name, ok, detail] of results) console.log(`${ok ? "PASS" : "FAIL"}  ${name}\n      ${detail.replace(/\n/g, " ").slice(0, 300)}`);
console.log("\n=== Usage");
for (const [a, u] of Object.entries(usage)) if (u) console.log(`${a}: ${u.calls} calls, ${u.inputTokens} in (${u.cacheReadTokens} cached), ${u.outputTokens} out, $${u.costUsd.toFixed(3)}`);
process.exit(0);
