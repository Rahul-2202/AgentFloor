import { join } from "node:path";
import { memoryFile, officeInstructions } from "./briefing.ts";
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
  capabilities: { structuredOutput: true, resume: true, mcp: true, toolHooks: true, interrupt: true, memoryFile: "CLAUDE.md" },

  prepare(ctx) {
    writeFile(join(ctx.workdir, "CLAUDE.md"), memoryFile(ctx.agent, ctx.config));
    writeFile(join(ctx.home, "mcp.json"), JSON.stringify({ mcpServers: { office: officeMcpServer(ctx) } }, null, 2));
    writeFile(
      join(ctx.home, "settings.json"),
      JSON.stringify(
        {
          // AgentFloor owns agent memory; Claude Code's own auto-memory would leak across agents.
          autoMemoryEnabled: false,
          hooks: { PostToolUse: [{ matcher: "*", hooks: [{ type: "command", command: `${join(ctx.root, "bin/office")} hook`, timeout: 10 }] }] },
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
      "--append-system-prompt", officeInstructions(ctx.agent),
      // Edits in its own folder and the office are free; anything else is refused.
      "--permission-mode", "acceptEdits",
      "--allowedTools", "mcp__office", "Read", "Write", "Edit", "Glob", "Grep", "Bash(office:*)", "Bash(ls:*)", "Bash(cat:*)", "Bash(git:*)",
    ];
    if (session) args.push("--resume", session);
    // The prompt goes on stdin so variadic flags can't swallow it.
    return { cmd: "claude", args, stdin: input, env: { CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" } };
  },

  parser: () => parseClaudeStyle,
});
