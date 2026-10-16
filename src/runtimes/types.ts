import type { OfficeClient } from "../client.ts";
import type { OutputLine, Usage } from "../core/office.ts";
import type { AgentDef, OfficeConfig } from "../core/types.ts";

/**
 * What a runtime can do natively. Anything it can't do falls back to a layer
 * the office owns (the `office` CLI, wait, turn-end delivery, kill and resume).
 */
export interface Capabilities {
  /** Emits structured events (tool calls, turns, cost) rather than only terminal text. */
  structuredOutput: boolean;
  /** Can resume a previous session by id, keeping its context. */
  resume: boolean;
  /** Can use the office MCP server. Without it, agents use the `office` shell command. */
  mcp: boolean;
  /** Runs a hook after each tool call, so questions reach it mid-task. Without it, at turn end. */
  toolHooks: boolean;
  /** Can stop a turn cleanly. Without it, the process is killed and resumed. */
  interrupt: boolean;
  /** The memory file the runtime reads on start (CLAUDE.md, AGENTS.md, GEMINI.md, ...). */
  memoryFile: string;
}

export interface AgentContext {
  agent: AgentDef;
  config: OfficeConfig;
  /** The office, called as this agent. */
  office: OfficeClient;
  /** The agent's own folder (session ids and runtime config live here). */
  home: string;
  /** The agent's working directory, where its CLI runs (its worktree, later). */
  workdir: string;
  /** Environment for the agent's process: office URL and token, PATH with `office`, keys. */
  env: Record<string, string>;
  /** The repo root, for paths to the MCP server and the `office` command. */
  root: string;
  log(line: string): void;
  /** A line of the agent's live session, for the console's terminal view. */
  output(kind: OutputLine["kind"], text: string): void;
  usage(u: Partial<Usage>): void;
}

export interface AgentRuntime {
  readonly capabilities: Capabilities;
  start(): Promise<void>;
  /** Runs one turn with this input; resolves when the turn ends. */
  turn(input: string): Promise<void>;
  /** Stops the current turn (natively, or by killing and resuming). */
  interrupt(): Promise<void>;
  stop(): Promise<void>;
}

export type RuntimeFactory = (ctx: AgentContext) => AgentRuntime;
