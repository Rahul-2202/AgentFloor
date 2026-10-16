import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { OutputLine, Usage } from "../core/office.ts";
import type { AgentContext, AgentRuntime, Capabilities, RuntimeFactory } from "./types.ts";

/** What one line of a CLI's JSON output tells us. */
export interface CliEvent {
  session?: string;
  lines?: { kind: OutputLine["kind"]; text: string }[];
  usage?: Partial<Usage>;
}

/**
 * A coding-agent CLI driven headless: one process per turn, resuming the same
 * session each time so the agent keeps its context. Each runtime only says how
 * to set itself up, how to build the command, and how to read its output.
 */
export interface CliSpec {
  /** The runtime's id; each runtime keeps its own session per agent. */
  id: string;
  capabilities: Capabilities;
  /** Writes the memory file, MCP config and hooks into the agent's folders. Runs once at start. */
  prepare(ctx: AgentContext): void;
  command(ctx: AgentContext, input: string, session: string | null): { cmd: string; args: string[]; env?: Record<string, string>; stdin?: string };
  /** A line reader for one agent (it may keep state, e.g. to join streamed text). */
  parser(): (line: string) => CliEvent | null;
}

const TURN_TIMEOUT_MS = 15 * 60 * 1000;

export function cliRuntime(spec: CliSpec): RuntimeFactory {
  return (ctx) => new CliRuntime(spec, ctx);
}

class CliRuntime implements AgentRuntime {
  readonly capabilities: Capabilities;
  private readonly spec: CliSpec;
  private readonly ctx: AgentContext;
  private readonly sessionFile: string;
  private child: ChildProcess | null = null;
  private interrupted = false;
  /** Error text seen during the current turn, to tell a bad session from a passing failure. */
  private errors = "";
  private readonly parse: (line: string) => CliEvent | null;

  constructor(spec: CliSpec, ctx: AgentContext) {
    this.spec = spec;
    this.ctx = ctx;
    this.capabilities = spec.capabilities;
    this.sessionFile = join(ctx.home, `session-${spec.id}.json`);
    this.parse = spec.parser();
  }

  async start(): Promise<void> {
    mkdirSync(this.ctx.workdir, { recursive: true });
    // Its own repo, so CLIs treat each agent as a separate project (sessions, memory, trust)
    // rather than as part of whatever repo the office lives in.
    if (!existsSync(join(this.ctx.workdir, ".git"))) {
      spawnSync("git", ["init", "-q"], { cwd: this.ctx.workdir });
      writeFileSync(join(this.ctx.workdir, ".gitignore"), ".agentfloor/\n");
    }
    this.spec.prepare(this.ctx);
    const s = this.session();
    this.ctx.output("info", s ? `Resuming session ${s}` : "New session");
  }

  private session(): string | null {
    if (!existsSync(this.sessionFile)) return null;
    return (JSON.parse(readFileSync(this.sessionFile, "utf8")) as { session: string | null }).session;
  }

  private saveSession(session: string | null): void {
    writeFileSync(this.sessionFile, JSON.stringify({ session }, null, 2));
  }

  async turn(input: string): Promise<void> {
    const resumed = this.session();
    if (await this.run(input, resumed)) return;
    if (this.interrupted) return;
    if (resumed && /(session|conversation)[^\n]*(not found|invalid|unknown|no such|expired)/i.test(this.errors)) {
      // A session the CLI can't resume: start fresh rather than stall.
      this.ctx.output("error", `Couldn't resume session ${resumed}; starting a new one.`);
      this.saveSession(null);
      await this.run(input, null);
      return;
    }
    // Most failures are temporary (a busy model, a network blip): retry once, same session.
    this.ctx.output("info", "Turn failed; retrying once in 20 s with the same session.");
    await new Promise((r) => setTimeout(r, 20_000));
    if (!this.interrupted) await this.run(input, this.session());
  }

  /** Runs one turn. Resolves true if the CLI exited cleanly. */
  private run(input: string, session: string | null): Promise<boolean> {
    this.interrupted = false;
    this.errors = "";
    const { cmd, args, env, stdin } = this.spec.command(this.ctx, input, session);
    this.ctx.output("input", input);
    return new Promise((resolve) => {
      const child = spawn(cmd, args, { cwd: this.ctx.workdir, env: { ...this.ctx.env, ...env }, stdio: ["pipe", "pipe", "pipe"] });
      this.child = child;
      const timer = setTimeout(() => {
        this.ctx.output("error", "Turn timed out; stopping it.");
        child.kill("SIGKILL");
      }, TURN_TIMEOUT_MS);

      if (stdin !== undefined) child.stdin!.end(stdin);
      else child.stdin!.end();

      createInterface({ input: child.stdout! }).on("line", (line) => this.onLine(line));
      createInterface({ input: child.stderr! }).on("line", (line) => {
        if (!line.trim()) return;
        this.errors += line + "\n";
        this.ctx.output("info", line);
      });
      child.on("error", (err) => {
        this.ctx.output("error", `Couldn't start ${cmd}: ${err.message}`);
      });
      child.on("close", (code, signal) => {
        clearTimeout(timer);
        this.child = null;
        if (code !== 0) this.ctx.output(this.interrupted ? "info" : "error", `${cmd} exited with ${signal ?? `code ${code}`}`);
        this.ctx.usage({ turns: 1 });
        resolve(code === 0);
      });
    });
  }

  private onLine(line: string): void {
    if (!line.trim()) return;
    let ev: CliEvent | null;
    try {
      ev = this.parse(line);
    } catch {
      ev = { lines: [{ kind: "text", text: line }] };
    }
    if (!ev) return;
    if (ev.session && ev.session !== this.session()) this.saveSession(ev.session);
    for (const l of ev.lines ?? []) {
      if (l.kind === "error") this.errors += l.text + "\n";
      this.ctx.output(l.kind, l.text);
    }
    if (ev.usage) {
      // Behind the model gateway, tokens are counted there; the CLI only adds its cost.
      this.ctx.usage(this.ctx.env.AGENTFLOOR_GATEWAY === "1" && this.spec.capabilities.gateway ? { costUsd: ev.usage.costUsd } : ev.usage);
    }
  }

  async interrupt(): Promise<void> {
    const child = this.child;
    if (!child) return;
    this.interrupted = true;
    // Stop the turn; the next turn resumes the session, so nothing is lost.
    child.kill("SIGINT");
    setTimeout(() => {
      if (this.child === child) child.kill("SIGKILL");
    }, 3000);
  }

  async stop(): Promise<void> {
    await this.interrupt();
  }
}

/* ------------------------------------------------------------------ helpers */

export function writeFile(path: string, content: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
}

/** The office MCP server as a stdio command, with this agent's identity. */
export function officeMcpServer(ctx: AgentContext) {
  return {
    command: process.execPath,
    args: ["--disable-warning=ExperimentalWarning", join(ctx.root, "src/mcp/server.ts")],
    env: { AGENTFLOOR_URL: ctx.env.AGENTFLOOR_URL!, AGENTFLOOR_AGENT: ctx.env.AGENTFLOOR_AGENT!, AGENTFLOOR_TOKEN: ctx.env.AGENTFLOOR_TOKEN! },
  };
}

export function short(s: string, n = 300): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n)}…` : one;
}

/**
 * Reads the stream-json format Claude Code uses (Antigravity's print mode is
 * modelled on it): init with the session id, assistant text and tool calls,
 * tool results, and a final result with cost and tokens.
 */
export function parseClaudeStyle(line: string): CliEvent | null {
  const j = JSON.parse(line) as any;
  const session: string | undefined = j.session_id ?? j.sessionId ?? j.conversation_id ?? j.conversationId;
  const lines: CliEvent["lines"] = [];
  let usage: CliEvent["usage"];

  if (j.type === "assistant" && Array.isArray(j.message?.content)) {
    for (const c of j.message.content) {
      if (c.type === "text" && c.text?.trim()) lines.push({ kind: "text", text: c.text });
      if (c.type === "tool_use") lines.push({ kind: "tool", text: `${c.name} ${short(JSON.stringify(c.input ?? {}), 400)}` });
    }
  } else if (j.type === "user" && Array.isArray(j.message?.content)) {
    for (const c of j.message.content) {
      if (c.type === "tool_result") {
        const body = Array.isArray(c.content) ? c.content.map((x: any) => x.text ?? "").join(" ") : String(c.content ?? "");
        lines.push({ kind: "result", text: short(body, 600) });
      }
    }
  } else if (j.type === "result") {
    if (j.is_error) lines.push({ kind: "error", text: short(String(j.result ?? j.error ?? "error"), 600) });
    usage = {
      costUsd: j.total_cost_usd ?? j.cost_usd ?? 0,
      inputTokens: j.usage?.input_tokens ?? j.usage?.inputTokens ?? 0,
      outputTokens: j.usage?.output_tokens ?? j.usage?.outputTokens ?? 0,
    };
  } else if (j.type === "system") {
    if (j.subtype === "init") lines.push({ kind: "info", text: `Session ${session ?? "?"} · ${j.model ?? ""}` });
  } else if (j.type === "rate_limit_event") {
    const r = j.rate_limit_info ?? {};
    if (r.status && r.status !== "allowed") lines.push({ kind: "error", text: `Rate limited (${r.rateLimitType ?? "limit"}) until ${new Date((r.resetsAt ?? 0) * 1000).toLocaleTimeString()}` });
  } else {
    return { session, lines: [{ kind: "info", text: short(line, 300) }] };
  }
  return { session, lines, usage };
}
