import { setTimeout as sleep } from "node:timers/promises";
import type { AgentContext, AgentRuntime, Capabilities } from "./types.ts";

/**
 * A fake runtime that follows a script instead of a model, for testing the
 * protocol end to end for free. It reads office messages as text, exactly as a
 * real agent would, and answers through the office API.
 */

type Action =
  | { ask: { to: string; question: string; wait?: boolean } }
  | { huddle: { with: string; topic: string; opening: string } }
  | { inform: { to: string; text: string } }
  | { request_work: { to: string; title: string; details?: string } }
  | { ask_ceo: string }
  | { work: number };

export interface Script {
  /** How long one simulated step (a tool call) takes. */
  stepMs?: number;
  /** Simulate a runtime with tool hooks (questions arrive mid-task) or without (turn end only). */
  hooks?: boolean;
  /** Answers to questions, matched as case-insensitive regexes. */
  answers?: { when: string; say: string; resolve?: boolean }[];
  /** Said when no answer matches. Omit to stay silent (to test escalation). */
  fallback?: string;
  /** Actions run on the kickoff turn. */
  onStart?: Action[];
  /** Steps of work for each task it's given. */
  taskSteps?: number;
  /** Huddle turns: replies in order, then end with the outcome. */
  huddle?: { replies?: string[]; outcome?: string };
}

export interface ParsedMessage {
  from: string;
  kind: string;
  urgency: string;
  threadId: string;
  taskId?: string;
  body: string;
}

/** Splits rendered office messages back into their parts. */
export function parseOfficeMessages(text: string): ParsedMessage[] {
  const out: ParsedMessage[] = [];
  for (const block of text.split(/^── Office message.*$/m).slice(1)) {
    const lines = block.split("\n");
    const head = lines.findIndex((l) => l.startsWith("From: "));
    if (head < 0) continue;
    const m = /^From: (.+?) · (\w+) · (\w+) · thread (T-\d+)(?: · task (K-\d+))?/.exec(lines[head]!);
    if (!m) continue;
    const fromId = /\(([a-z0-9-]+)\)$/.exec(m[1]!)?.[1] ?? m[1]!.toLowerCase();
    const body: string[] = [];
    for (const l of lines.slice(head + 1)) {
      if (/^─+$/.test(l) || l.startsWith("Refs: ") || l.startsWith("Answer with ") || l.startsWith("This is new work") || l.startsWith("Stop what"))
        break;
      body.push(l);
    }
    out.push({ from: fromId, kind: m[2]!, urgency: m[3]!, threadId: m[4]!, taskId: m[5], body: body.join("\n").trim() });
  }
  return out;
}

export function createScriptedRuntime(ctx: AgentContext): AgentRuntime {
  const script = (ctx.agent.options?.script ?? {}) as Script;
  const stepMs = script.stepMs ?? 600;
  const hooks = script.hooks ?? true;
  const office = ctx.office;
  let halted = false;
  let huddleTurn = 0;

  const capabilities: Capabilities = {
    structuredOutput: true,
    resume: true,
    mcp: true,
    toolHooks: hooks,
    interrupt: true,
    memoryFile: "SCRIPT.md",
  };

  async function step(): Promise<void> {
    await sleep(stepMs);
    // A runtime with tool hooks gets questions between steps, like Claude Code's PostToolUse.
    if (hooks && !halted) {
      const due = await office.call<{ text: string }>("delivery", { point: "tool" });
      if (due.text) {
        ctx.log(`(mid-task) ${due.text.split("\n")[1] ?? ""}`);
        await handle(due.text);
      }
    }
  }

  async function work(steps: number, taskId?: string): Promise<void> {
    for (let i = 1; i <= steps && !halted; i++) {
      await step();
      if (taskId) await office.call("update_task", { task_id: taskId, status: "ongoing", progress: Math.round((i / steps) * 100) });
    }
  }

  async function run(action: Action): Promise<void> {
    if (halted) return;
    try {
      await act(action);
    } catch (err) {
      // A real agent sees the office's error text and adjusts; here we log it.
      ctx.log(`✗ ${(err as Error).message}`);
    }
  }

  async function act(action: Action): Promise<void> {
    if ("ask" in action) {
      const r = await office.call<{ threadId: string }>("ask", { to: action.ask.to, question: action.ask.question });
      ctx.log(`asked ${action.ask.to} (${r.threadId})`);
      if (action.ask.wait) {
        // wait also returns questions for us; answer them and keep waiting for ours.
        const until = Date.now() + 120_000;
        while (!halted && Date.now() < until) {
          const got = await office.call<{ text: string; count: number }>("wait", { thread_id: r.threadId, timeout_sec: 60 });
          if (!got.count) continue;
          await handle(got.text);
          if (parseOfficeMessages(got.text).some((m) => m.threadId === r.threadId)) break;
        }
      }
    } else if ("huddle" in action) {
      await office.call("huddle", action.huddle);
    } else if ("inform" in action) {
      await office.call("inform", action.inform);
    } else if ("request_work" in action) {
      await office.call("request_work", action.request_work);
    } else if ("ask_ceo" in action) {
      await office.call("ask_ceo", { question: action.ask_ceo });
    } else if ("work" in action) {
      await work(action.work);
    }
  }

  async function handle(text: string): Promise<void> {
    const msgs = parseOfficeMessages(text);
    if (!msgs.length) {
      for (const a of script.onStart ?? []) await run(a);
      return;
    }
    for (const m of msgs) {
      if (halted && m.kind !== "stop") continue;
      ctx.log(`← ${m.kind} from ${m.from} (${m.threadId}): ${m.body.split("\n")[0]}`);
      if (m.kind === "stop") {
        halted = true;
        continue;
      }
      if (m.kind === "ask") {
        await step(); // think: read its own files before answering
        const hit = (script.answers ?? []).find((a) => new RegExp(a.when, "i").test(m.body));
        const say = hit?.say ?? script.fallback;
        if (say) await office.call("reply", { thread_id: m.threadId, text: say, resolves: hit?.resolve ?? true });
      } else if (m.kind === "huddle") {
        const replies = script.huddle?.replies ?? [];
        if (huddleTurn < replies.length) {
          await office.call("reply", { thread_id: m.threadId, text: replies[huddleTurn++] });
        } else if (script.huddle?.outcome) {
          await office.call("end_huddle", { thread_id: m.threadId, outcome: script.huddle.outcome });
        }
      } else if (m.kind === "request_work" && m.taskId) {
        await office.call("update_task", { task_id: m.taskId, status: "ongoing", progress: 0 });
        await work(script.taskSteps ?? 4, m.taskId);
        if (!halted) {
          await office.call("update_task", { task_id: m.taskId, status: "done", note: "Done (scripted)." });
          await office.call("reply", { thread_id: m.threadId, text: `Done with ${m.taskId}.`, resolves: true });
        }
      }
    }
  }

  return {
    capabilities,
    async start() {},
    async turn(input) {
      if (parseOfficeMessages(input).some((m) => m.kind !== "stop")) halted = false;
      await handle(input);
    },
    async interrupt() {
      halted = true;
    },
    async stop() {
      halted = true;
    },
  };
}
