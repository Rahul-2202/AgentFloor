import { join } from "node:path";
import { memoryFile, officeInstructions } from "./briefing.ts";
import { gatewayBase } from "../daemon/gateway.ts";
import { cliRuntime, officeMcpServer, parseClaudeStyle, writeFile } from "./cli.ts";

/**
 * Claude Code, headless (`claude -p` with stream-json). Every capability is
 * native: MCP for the office tools, a PostToolUse hook for mid-task delivery,
 * --resume for its own session, and SIGINT to interrupt.
 *
 * Model and effort come from the agent's settings (default Haiku, low).
 */
export const claudeCode = cliRuntime({
  id: "claude-code",
  capabilities: { structuredOutput: true, resume: true, mcp: true, toolHooks: true, interrupt: true, memoryFile: "CLAUDE.md", gateway: true },

  prepare(ctx) {
    // In a repo worktree, the agent's memory sits one folder up (Claude Code reads CLAUDE.md
    // from parent folders too), so it never overwrites the repo's own CLAUDE.md or lands in a PR.
    writeFile(join(ctx.inRepo ? ctx.home : ctx.workdir, "CLAUDE.md"), memoryFile(ctx.agent, ctx.config, ctx.brief?.() ?? ""));
    writeFile(join(ctx.home, "mcp.json"), JSON.stringify({ mcpServers: { office: officeMcpServer(ctx) } }, null, 2));
    writeFile(
      join(ctx.home, "settings.json"),
      JSON.stringify(
        {
          // AgentFloor owns agent memory; Claude Code's own auto-memory would leak across agents.
          autoMemoryEnabled: false,
          hooks: {
            // Before every tool call: is the agent allowed (permissions, first-use checks)?
            PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: `${join(ctx.root, "bin/office")} pretool`, timeout: 15 }] }],
            // After every tool call: questions that are due reach the agent mid-task.
            PostToolUse: [{ matcher: "*", hooks: [{ type: "command", command: `${join(ctx.root, "bin/office")} hook`, timeout: 10 }] }],
          },
        },
        null,
        2,
      ),
    );
  },

  command(ctx, input, session) {
    const args = [
      "-p",
      "--output-format", "stream-json",
      "--verbose",
      "--model", ctx.agent.model ?? "haiku",
      "--effort", ctx.agent.effort ?? "low",
      "--mcp-config", join(ctx.home, "mcp.json"),
      "--strict-mcp-config",
      "--settings", join(ctx.home, "settings.json"),
      "--append-system-prompt", officeInstructions(ctx.agent, ctx.config.repo),
      // Its tools run without prompts; the PreToolUse hook enforces the agent's permissions.
      "--permission-mode", "acceptEdits",
      "--allowedTools", "mcp__office", "Read", "Write", "Edit", "MultiEdit", "Glob", "Grep", "Bash", "WebFetch", "WebSearch",
    ];
    if (session) args.push("--resume", session);
    // The prompt goes on stdin so variadic flags can't swallow it.
    const env: Record<string, string> = { CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" };
    // Model calls go through the office's gateway, which counts tokens per agent and thread.
    if (ctx.env.AGENTFLOOR_GATEWAY === "1") env.ANTHROPIC_BASE_URL = gatewayBase(ctx.env.AGENTFLOOR_URL!, ctx.env.AGENTFLOOR_TOKEN!, "anthropic");
    return { cmd: "claude", args, stdin: input, env };
  },

  parser: () => parseClaudeStyle,
});
