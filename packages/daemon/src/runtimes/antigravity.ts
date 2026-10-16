import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { memoryFile, officeInstructions } from "./briefing.ts";
import { cliRuntime, officeMcpServer, short, writeFile, type CliEvent } from "./cli.ts";

/**
 * Google's Antigravity CLI (`agy`), in print mode with stream-json, signed in
 * with your Google account. Its MCP config is global, so the office server is
 * registered once without an identity; each agent's server finds its identity
 * from the agent's environment, or the .agentfloor/identity.json in its folder.
 *
 * Model and effort come from the agent's settings.
 */
let registered = false;

const OFFICE_TOOLS = ["whoami", "directory", "ask", "reply", "inform", "request_work", "huddle", "end_huddle", "ask_ceo", "stop", "create_task", "update_task", "inbox", "wait"];

/**
 * agy denies MCP calls in print mode unless they're allowed in its settings.
 * Allow the office's own tools, and nothing else.
 */
function allowOfficeTools(): void {
  const path = join(homedir(), ".gemini/antigravity-cli/settings.json");
  const settings = existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as { permissions?: { allow?: string[] } }) : {};
  const allow = new Set(settings.permissions?.allow ?? []);
  const before = allow.size;
  for (const t of OFFICE_TOOLS) allow.add(`mcp(agentfloor-office/${t})`);
  if (allow.size === before) return;
  settings.permissions = { ...settings.permissions, allow: [...allow] };
  writeFileSync(path, JSON.stringify(settings, null, 2) + "\n");
}

export const antigravity = cliRuntime({
  id: "antigravity",
  capabilities: { structuredOutput: true, resume: true, mcp: true, toolHooks: false, interrupt: true, memoryFile: "AGENTS.md" },

  prepare(ctx) {
    const memory = memoryFile(ctx.agent, ctx.config);
    writeFile(join(ctx.workdir, "AGENTS.md"), memory);
    writeFile(join(ctx.workdir, "GEMINI.md"), memory);
    if (!registered) {
      const server = officeMcpServer(ctx);
      try {
        execFileSync("agy", ["mcp", "add", "agentfloor-office", "--", server.command, ...server.args], { env: ctx.env, stdio: "pipe" });
        allowOfficeTools();
        registered = true;
      } catch (err) {
        ctx.output("error", `Couldn't register the office MCP server with agy: ${(err as Error).message}`);
      }
    }
  },

  command(ctx, input, session) {
    const args = ["--output-format", "stream-json", "--effort", ctx.agent.effort ?? "low", "--mode", "accept-edits"];
    if (ctx.agent.model) args.push("--model", ctx.agent.model);
    if (session) args.push("--conversation", session);
    // agy has no separate system prompt flag, so the office instructions lead the turn.
    args.push("-p", `${officeInstructions(ctx.agent)}\n\n${input}`);
    return { cmd: "agy", args };
  },

  /**
   * agy stream-json: {event:"init", conversation_id}, {event:"step_update",
   * step_update:{step_type, state, tool_name, tool_info, text_delta, usage}}, and
   * {event:"result", result:{response, status, usage}}. Text arrives as deltas,
   * joined here per step.
   */
  parser() {
    const text = new Map<number, string>();
    return (line): CliEvent | null => {
      if (!line.startsWith("{")) return line.includes("logging before google.Init") ? null : { lines: [{ kind: "info", text: line }] };
      const j = JSON.parse(line) as any;
      if (j.event === "init") return { session: j.conversation_id, lines: [{ kind: "info", text: `Conversation ${j.conversation_id}` }] };
      if (j.event === "step_update") {
        const s = j.step_update ?? {};
        if (s.step_type === "tool" && s.state === "DONE") {
          const params = s.tool_info?.parameters ?? {};
          return { session: s.conversation_id, lines: [{ kind: "tool", text: `${s.tool_name} ${short(JSON.stringify(params), 400)}` }] };
        }
        if (s.step_type === "agent_response") {
          if (s.text_delta) text.set(s.step_index, (text.get(s.step_index) ?? "") + s.text_delta);
          if (s.state === "DONE") {
            const said = text.get(s.step_index)?.trim();
            text.delete(s.step_index);
            if (said) return { lines: [{ kind: "text", text: said }] };
          }
        }
        if (s.state === "ERROR" || s.error) return { lines: [{ kind: "error", text: short(JSON.stringify(s.error ?? s), 400) }] };
        return null;
      }
      if (j.event === "result") {
        const r = j.result ?? {};
        const ev: CliEvent = {
          session: r.conversation_id,
          usage: { inputTokens: (r.usage?.input_tokens ?? 0) + (r.usage?.cache_read_tokens ?? 0), outputTokens: (r.usage?.output_tokens ?? 0) + (r.usage?.thinking_tokens ?? 0) },
          lines: [],
        };
        if (r.status && r.status !== "SUCCESS") ev.lines!.push({ kind: "error", text: `${r.status}: ${short(String(r.error ?? r.response ?? ""), 400)}` });
        return ev;
      }
      return { lines: [{ kind: "info", text: short(line, 300) }] };
    };
  },
});
