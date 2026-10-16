import { OfficeClient } from "../client.ts";
import { OfficeError } from "../core/types.ts";

/**
 * `office`: the office tools as a shell command. Works with any agent that can
 * run shell commands, whether or not its runtime supports MCP.
 */
const HELP = `office: talk to the other agents in your office.

  office whoami                              who you are, your room and head
  office directory                           everyone in the office (use their ids)
  office ask <to> <question>                 ask a question; the answer arrives as an office message
        [--urgent] [--ref <file>]... [--task <id>]
  office reply <thread> <text> [--resolve]   reply in a thread (--resolve if it settles it)
  office inform <to|room:<id>|all> <text>    tell someone something, no reply expected
  office request-work <to> <title> [--details <text>]
  office huddle <with> <topic> <opening>     start a live back-and-forth
  office end-huddle <thread> <outcome>       end a huddle with what you agreed
  office ask-ceo <question> [--option <text>]...
  office stop <to> <reason>                  heads only
  office create-task <owner> <title> [--details <text>]   heads only
  office update-task <task> [--status queued|ongoing|blocked|review|done] [--progress 0-100] [--note <text>]
  office inbox                               read messages waiting for you
  office wait [thread] [--timeout <sec>]     block until a message arrives (default 60s)
`;

interface Parsed {
  pos: string[];
  flags: Map<string, string[]>;
}

const BOOLEAN = new Set(["urgent", "resolve", "help"]);

function parse(argv: string[]): Parsed {
  const pos: string[] = [];
  const flags = new Map<string, string[]>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const name = a.slice(2);
      const value = BOOLEAN.has(name) ? "true" : (argv[++i] ?? "");
      flags.set(name, [...(flags.get(name) ?? []), value]);
    } else pos.push(a);
  }
  return { pos, flags };
}

function need(p: Parsed, n: number, usage: string): void {
  if (p.pos.length < n) throw new OfficeError("usage", `Usage: office ${usage}`);
}

const one = (p: Parsed, f: string) => p.flags.get(f)?.[0];
const rest = (p: Parsed, from: number) => p.pos.slice(from).join(" ");

async function main(argv: string[]): Promise<void> {
  const [cmd, ...args] = argv;
  if (!cmd || cmd === "help" || cmd === "--help") {
    process.stdout.write(HELP);
    return;
  }
  const p = parse(args);
  const office = OfficeClient.fromEnv();
  const urgency = p.flags.has("urgent") ? "urgent" : undefined;
  let result: unknown;

  switch (cmd) {
    case "whoami":
    case "directory":
    case "inbox":
      result = await office.call(cmd);
      break;
    case "ask":
      need(p, 2, "ask <to> <question>");
      result = await office.call("ask", { to: p.pos[0], question: rest(p, 1), urgency, refs: p.flags.get("ref"), task_id: one(p, "task") });
      break;
    case "reply":
      need(p, 2, "reply <thread> <text>");
      result = await office.call("reply", { thread_id: p.pos[0], text: rest(p, 1), resolves: p.flags.has("resolve") || undefined, refs: p.flags.get("ref") });
      break;
    case "inform":
      need(p, 2, "inform <to> <text>");
      result = await office.call("inform", { to: p.pos[0], text: rest(p, 1), urgency, refs: p.flags.get("ref") });
      break;
    case "request-work":
      need(p, 2, "request-work <to> <title>");
      result = await office.call("request_work", { to: p.pos[0], title: rest(p, 1), details: one(p, "details"), urgency });
      break;
    case "huddle":
      need(p, 3, "huddle <with> <topic> <opening>");
      result = await office.call("huddle", { with: p.pos[0], topic: p.pos[1], opening: rest(p, 2) });
      break;
    case "end-huddle":
      need(p, 2, "end-huddle <thread> <outcome>");
      result = await office.call("end_huddle", { thread_id: p.pos[0], outcome: rest(p, 1) });
      break;
    case "ask-ceo":
      need(p, 1, "ask-ceo <question>");
      result = await office.call("ask_ceo", { question: rest(p, 0), options: p.flags.get("option") });
      break;
    case "stop":
      need(p, 2, "stop <to> <reason>");
      result = await office.call("stop", { to: p.pos[0], reason: rest(p, 1) });
      break;
    case "create-task":
      need(p, 2, "create-task <owner> <title>");
      result = await office.call("create_task", { owner: p.pos[0], title: rest(p, 1), details: one(p, "details") });
      break;
    case "update-task": {
      need(p, 1, "update-task <task>");
      const progress = one(p, "progress");
      result = await office.call("update_task", {
        task_id: p.pos[0],
        status: one(p, "status"),
        progress: progress === undefined ? undefined : Number(progress),
        note: one(p, "note"),
      });
      break;
    }
    case "wait": {
      const timeout = one(p, "timeout");
      result = await office.call("wait", { thread_id: p.pos[0], timeout_sec: timeout === undefined ? undefined : Number(timeout) });
      break;
    }
    case "delivery":
      need(p, 1, "delivery <now|tool|turn_end>");
      result = await office.call("delivery", { point: p.pos[0] });
      break;
    case "hook": {
      // Claude Code PostToolUse hook: hand the agent any questions due mid-task.
      // A hook must never break the agent's tool call, so failures stay silent.
      try {
        const due = await office.call<{ text: string }>("delivery", { point: "tool" });
        if (due.text) {
          process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: due.text } }) + "\n");
        }
      } catch {}
      return;
    }
    default:
      throw new OfficeError("usage", `Unknown command "${cmd}". Run: office help`);
  }

  const text = result && typeof result === "object" && "text" in result ? String((result as { text: unknown }).text) : JSON.stringify(result, null, 2);
  process.stdout.write(text + "\n");
}

main(process.argv.slice(2)).catch((err: OfficeError) => {
  process.stderr.write(`office: ${err.code ? `${err.code}: ` : ""}${err.message}\n`);
  process.exit(1);
});
