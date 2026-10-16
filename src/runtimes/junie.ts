import { join } from "node:path";
import { memoryFile, officeInstructions } from "./briefing.ts";
import { cliRuntime, officeMcpServer, short, writeFile, type CliEvent } from "./cli.ts";

/**
 * JetBrains Junie, headless with your own Gemini key (no JetBrains login).
 * MCP comes from the project's .junie/mcp/mcp.json; the memory file is
 * .junie/guidelines.md. Hooks aren't wired yet, so questions reach a busy Junie
 * agent when it calls inbox/wait or when its turn ends.
 *
 * Model and effort come from the agent's settings (default gemini-3.5-flash-lite:
 * heavier Gemini models hit the free quota).
 * Needs GEMINI_API_KEY in .env.
 */
export const junie = cliRuntime({
  id: "junie",
  capabilities: { structuredOutput: true, resume: true, mcp: true, toolHooks: false, interrupt: true, memoryFile: ".junie/guidelines.md" },

  prepare(ctx) {
    if (!ctx.env.GEMINI_API_KEY) ctx.output("error", "GEMINI_API_KEY isn't set in .env; Junie can't reach Gemini.");
    writeFile(join(ctx.workdir, ".junie/guidelines.md"), memoryFile(ctx.agent, ctx.config));
    writeFile(join(ctx.workdir, ".junie/mcp/mcp.json"), JSON.stringify({ mcpServers: { office: officeMcpServer(ctx) } }, null, 2));
  },

  command(ctx, input, session) {
    const args = [
      "--skip-update-check",
      "--output-format=json-stream",
      "--provider=google",
      `--model=${ctx.agent.model ?? "gemini-3.5-flash-lite"}`,
      `--effort=${ctx.agent.effort ?? "low"}`,
      `--project=${ctx.workdir}`,
      `--system-prompt=${officeInstructions(ctx.agent)}`,
      "--share-anonymous-statistics=false",
    ];
    if (session) args.push(`--session-id=${session}`);
    args.push(`--task=${input}`);
    return { cmd: "junie", args, env: { JUNIE_GOOGLE_API_KEY: ctx.env.GEMINI_API_KEY ?? "" } };
  },

  /**
   * Junie's json-stream: {type:"session", sessionId}, {type:"step", name, details}
   * for each action, and {type:"result", result, ...} with token usage per model
   * (in a field named errorCode in Junie 26.10; llmUsage in other builds).
   */
  parser: () => (line): CliEvent | null => {
    if (!line.startsWith("{")) return line.includes("log file:") ? null : { lines: [{ kind: "info", text: line }] };
    const j = JSON.parse(line) as any;
    if (j.type === "session") return { session: j.sessionId, lines: [{ kind: "info", text: `Session ${j.sessionId}` }] };
    if (j.type === "step") {
      if (j.name === "TASK RESULT") return null; // repeated in the result
      if (/not available right now|429/.test(j.name ?? "")) return { lines: [{ kind: "error", text: j.name }] };
      return { lines: [{ kind: "tool", text: `${j.name}${j.details ? `: ${short(j.details, 400)}` : ""}` }] };
    }
    if (j.type === "result") {
      const ev: CliEvent = { session: j.sessionId, lines: [] };
      if (typeof j.result === "string" && j.result.trim()) ev.lines!.push({ kind: "text", text: j.result });
      for (const e of j.errors ?? []) ev.lines!.push({ kind: "error", text: String(e) });
      const usage = [j.llmUsage, j.errorCode].find((x) => Array.isArray(x) && x.some((u: any) => u && "inputTokens" in u));
      if (usage) {
        ev.usage = usage.reduce(
          (u: { inputTokens: number; outputTokens: number; costUsd: number }, x: any) => ({
            inputTokens: u.inputTokens + (x.inputTokens ?? 0) + (x.cacheInputTokens ?? 0),
            outputTokens: u.outputTokens + (x.outputTokens ?? 0),
            costUsd: u.costUsd + (x.cost ?? 0),
          }),
          { inputTokens: 0, outputTokens: 0, costUsd: 0 },
        );
      }
      return ev;
    }
    if (Array.isArray(j.errors)) return { session: j.sessionId, lines: j.errors.map((e: unknown) => ({ kind: "error" as const, text: String(e) })) };
    return { lines: [{ kind: "info", text: short(line, 300) }] };
  },
});
