import { z } from "zod";
import type { Office } from "./office.ts";
import { CEO, OfficeError } from "./types.ts";

/**
 * Every office call, defined once. The HTTP API runs them, the MCP server
 * registers them as tools, and the `office` CLI maps subcommands onto them.
 */
export interface ToolSpec {
  name: string;
  description: string;
  shape: z.ZodRawShape;
  /** "agent": called by agents (MCP/CLI). "ceo": the console. "runtime": adapters and hooks. */
  who: "agent" | "ceo" | "runtime";
  run(office: Office, actor: string, args: any): unknown | Promise<unknown>;
}

const urgency = z.enum(["normal", "urgent"]).optional().describe("normal (default): delivered after your recipient's next step. urgent: same, but flagged.");
const refs = z.array(z.string()).optional().describe("Files, branches, PRs or tasks the recipient should look at.");

const MAX_WAIT_SEC = 300;

export const TOOLS: ToolSpec[] = [
  {
    name: "whoami",
    who: "agent",
    description: "Who you are in the office: your name, room, role and head.",
    shape: {},
    run: (o, me) => {
      const { id, name, room, role, title } = o.agent(me);
      return { id, name, room, role, title, head: o.headOf(room) };
    },
  },
  {
    name: "directory",
    who: "agent",
    description: "Everyone in the office: id, name, room, role and what they do. Use ids when messaging.",
    shape: {},
    run: (o) => o.directory(),
  },
  {
    name: "ask",
    who: "agent",
    description:
      "Ask another agent a question. Doesn't block: you get a thread id and the answer arrives as an office message. Keep working, or call wait if you can't continue without it. Questions can go to anyone; work for another room goes through its head (request_work).",
    shape: {
      to: z.string().describe("Agent id to ask."),
      question: z.string().describe("The question, with enough context to answer without a follow-up."),
      urgency,
      refs,
      task_id: z.string().optional().describe("The task this is about, if any."),
    },
    run: (o, me, a) => o.ask(me, { to: a.to, question: a.question, urgency: a.urgency, refs: a.refs, taskId: a.task_id }),
  },
  {
    name: "reply",
    who: "agent",
    description: "Reply in a thread: answer a question, continue a huddle, or add information. Set resolves=true when your answer settles it.",
    shape: {
      thread_id: z.string(),
      text: z.string(),
      resolves: z.boolean().optional().describe("True if this settles the question and the thread can close."),
      refs,
    },
    run: (o, me, a) => o.reply(me, { threadId: a.thread_id, text: a.text, resolves: a.resolves, refs: a.refs }),
  },
  {
    name: "inform",
    who: "agent",
    description: "Tell someone something; no reply expected. `to` is an agent id, room:<id> for a whole room, or all.",
    shape: { to: z.string(), text: z.string(), urgency, refs },
    run: (o, me, a) => o.inform(me, { to: a.to, text: a.text, urgency: a.urgency, refs: a.refs }),
  },
  {
    name: "request_work",
    who: "agent",
    description: "Ask for work to be done. Creates a task for the recipient. Work for another room must go to that room's head.",
    shape: { to: z.string(), title: z.string(), details: z.string().optional(), urgency },
    run: (o, me, a) => o.requestWork(me, { to: a.to, title: a.title, details: a.details, urgency: a.urgency }),
  },
  {
    name: "huddle",
    who: "agent",
    description:
      "Start a live back-and-forth with one agent, for things that need several exchanges (like agreeing an API contract). Messages are delivered quickly. End it with end_huddle and the agreed outcome.",
    shape: { with: z.string(), topic: z.string(), opening: z.string().describe("Your first message.") },
    run: (o, me, a) => o.huddle(me, { with: a.with, topic: a.topic, opening: a.opening }),
  },
  {
    name: "end_huddle",
    who: "agent",
    description: "End a huddle with the outcome you agreed. Write the outcome so both sides can act on it alone.",
    shape: { thread_id: z.string(), outcome: z.string() },
    run: (o, me, a) => o.endHuddle(me, { threadId: a.thread_id, outcome: a.outcome }),
  },
  {
    name: "ask_ceo",
    who: "agent",
    description: "Ask the CEO a question that's above your authority. Lands in the CEO's inbox; the answer comes back as an office message. Don't wait for it unless you must.",
    shape: { question: z.string(), options: z.array(z.string()).optional().describe("Choices the CEO can pick from, with your recommendation first.") },
    run: (o, me, a) => o.askCeo(me, { question: a.question, options: a.options }),
  },
  {
    name: "stop",
    who: "agent",
    description: "Heads only: halt an agent in your room immediately.",
    shape: { to: z.string(), reason: z.string() },
    run: (o, me, a) => o.stop(me, { to: a.to, reason: a.reason }),
  },
  {
    name: "create_task",
    who: "agent",
    description: "Heads only: assign a task to an agent in your room. To plan a bigger task, split it into subtasks with parent_task.",
    shape: {
      owner: z.string(),
      title: z.string(),
      details: z.string().optional(),
      done_means: z.string().optional().describe("What done looks like, so the owner knows when to stop."),
      parent_task: z.string().optional().describe("The task this is part of."),
    },
    run: (o, me, a) => o.createTask(me, { owner: a.owner, title: a.title, details: a.details, dod: a.done_means, parentId: a.parent_task }),
  },
  {
    name: "update_task",
    who: "agent",
    description:
      "Update a task you own: status, progress (0-100), a short note, the step you're on, what's blocking you, its checklist, or an output (a PR, file or link). The office and the CEO see this.",
    shape: {
      task_id: z.string(),
      status: z.enum(["queued", "ongoing", "blocked", "review", "done"]).optional(),
      progress: z.number().optional(),
      note: z.string().optional(),
      step: z.string().optional().describe("What you're doing now, in a few words."),
      blocker: z.string().optional().describe("What's in the way (with status blocked)."),
      checklist: z.array(z.object({ text: z.string(), done: z.boolean() })).optional().describe("Replaces the task's checklist."),
      output: z
        .object({ kind: z.enum(["pr", "file", "link"]), title: z.string(), url: z.string().optional() })
        .optional()
        .describe("Something the task produced."),
    },
    run: (o, me, a) =>
      o.updateTask(me, {
        taskId: a.task_id,
        status: a.status,
        progress: a.progress,
        note: a.note,
        step: a.step,
        blocker: a.blocker,
        checklist: a.checklist,
        output: a.output,
      }),
  },
  {
    name: "inbox",
    who: "agent",
    description: "Read any office messages waiting for you (and mark them read).",
    shape: {},
    run: (o, me) => {
      const msgs = o.take(me, "turn_end");
      return { count: msgs.length, text: o.render(msgs) || "No messages." };
    },
  },
  {
    name: "wait",
    who: "agent",
    description: `Block until a message arrives (in one thread, or any), up to timeout_sec (max ${MAX_WAIT_SEC}). Use only when you can't continue without an answer.`,
    shape: { thread_id: z.string().optional(), timeout_sec: z.number().optional().describe("Default 60.") },
    run: async (o, me, a) => {
      const timeoutMs = Math.min(MAX_WAIT_SEC, Math.max(1, a.timeout_sec ?? 60)) * 1000;
      const msgs = await o.wait(me, { threadId: a.thread_id, timeoutMs });
      return { count: msgs.length, text: o.render(msgs) || "Nothing yet. Carry on with other work and check later." };
    },
  },

  {
    name: "open_pr",
    who: "agent",
    description:
      "Push your current branch and open a pull request for it on the office's GitHub repo. Commit first. Link it to your task so it shows as an output. You can't merge: your head asks the CEO with request_merge.",
    shape: {
      title: z.string(),
      body: z.string().optional().describe("What changed and how you checked it."),
      task_id: z.string().optional(),
      draft: z.boolean().optional(),
    },
    run: (o, me, a) => o.openPr(me, { title: a.title, body: a.body, taskId: a.task_id, draft: a.draft }),
  },
  {
    name: "request_merge",
    who: "agent",
    description: "Heads only: ask the CEO to merge a PR from your room. Only the CEO merges.",
    shape: { pr: z.number().describe("The PR number."), summary: z.string().describe("What it does and why it's ready."), task_id: z.string().optional() },
    run: (o, me, a) => o.requestMerge(me, { pr: a.pr, summary: a.summary, taskId: a.task_id }),
  },

  /* Runtime adapters and hooks: pull what's due at a delivery point. */
  {
    name: "git_credential",
    who: "runtime",
    description: "A short-lived token for git to reach the office's repo (used by the git credential helper).",
    shape: {},
    run: (o) => o.gitToken(),
  },
  {
    name: "delivery",
    who: "runtime",
    description: "Messages due for this agent at a delivery point, rendered as turn text.",
    shape: { point: z.enum(["now", "tool", "turn_end"]) },
    run: (o, me, a) => {
      const msgs = o.take(me, a.point);
      return { count: msgs.length, ids: msgs.map((m) => m.id), text: o.render(msgs) };
    },
  },

  /* The CEO, from the console. */
  {
    name: "ceo_message",
    who: "ceo",
    description: "Message any agent. Their head is copied.",
    shape: { to: z.string(), text: z.string(), urgency: z.enum(["normal", "urgent", "stop"]).optional() },
    run: (o, _me, a) => o.ceoMessage({ to: a.to, text: a.text, urgency: a.urgency }),
  },
  {
    name: "ceo_reply",
    who: "ceo",
    description: "Reply in a thread as the CEO.",
    shape: { thread_id: z.string(), text: z.string(), resolves: z.boolean().optional() },
    run: (o, _me, a) => o.reply(CEO, { threadId: a.thread_id, text: a.text, resolves: a.resolves }),
  },
  {
    name: "ceo_assign",
    who: "ceo",
    description: "Give an agent a task.",
    shape: { to: z.string(), title: z.string(), details: z.string().optional(), done_means: z.string().optional() },
    run: (o, _me, a) => o.requestWork(CEO, { to: a.to, title: a.title, details: a.details, dod: a.done_means }),
  },
  {
    name: "ceo_configure_agent",
    who: "ceo",
    description: "Change an agent's runtime, model or effort. Without confirm it returns the read-back; with confirm it applies it.",
    shape: {
      agent: z.string(),
      runtime: z.string().optional(),
      model: z.string().optional(),
      effort: z.string().optional(),
      confirm: z.boolean().optional(),
    },
    run: (o, _me, a) => o.configureAgent(CEO, a),
  },
  {
    name: "resolve_inbox",
    who: "ceo",
    description: "Mark an inbox item done.",
    shape: { id: z.string() },
    run: (o, _me, a) => o.resolveInbox(a.id),
  },
  {
    name: "ceo_hold_agent",
    who: "ceo",
    description: "Park an agent: its current turn stops and no new one starts until released (budget reached, terminal taken over).",
    shape: { agent: z.string(), reason: z.string() },
    run: (o, _me, a) => o.hold(a.agent, a.reason),
  },
  {
    name: "ceo_release_agent",
    who: "ceo",
    description: "Let a parked agent carry on.",
    shape: { agent: z.string() },
    run: (o, _me, a) => o.release(a.agent),
  },
  {
    name: "agent_output",
    who: "ceo",
    description: "An agent's recent live session lines, for opening its terminal.",
    shape: { agent: z.string() },
    run: (o, _me, a) => o.outputOf(a.agent),
  },
];

export const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

/** Validates and runs a call. Throws OfficeError for bad input or broken rules. */
export async function runTool(office: Office, actor: string, name: string, args: unknown): Promise<unknown> {
  const spec = TOOL_BY_NAME.get(name);
  if (!spec) throw new OfficeError("unknown_tool", `No office call "${name}".`);
  const isCeo = actor === CEO;
  if (spec.who === "ceo" && !isCeo) throw new OfficeError("not_allowed", `${name} is for the CEO.`);
  if (spec.who !== "ceo" && isCeo) throw new OfficeError("not_allowed", `${name} is for agents.`);
  const parsed = z.object(spec.shape).safeParse(args ?? {});
  if (!parsed.success) {
    throw new OfficeError("bad_input", parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; "));
  }
  return spec.run(office, actor, parsed.data);
}
