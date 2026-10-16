/**
 * Ada's model: a run is a system prompt, a prompt, and tools she can call.
 * In production that's the Claude Agent SDK (Claude Code underneath, on the
 * company's Claude login) with no built-in tools, only hers. Tests use a
 * scripted brain.
 */
import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

export interface AdaTool {
  name: string;
  description: string;
  shape: z.ZodRawShape;
  run(args: any): Promise<unknown>;
}

export interface BrainRun {
  system: string;
  prompt: string;
  tools: AdaTool[];
  maxTurns?: number;
  /** Text as it's written, for streaming replies. */
  onText?: (delta: string) => void;
}

export interface AdaBrain {
  run(r: BrainRun): Promise<{ text: string; costUsd: number }>;
}

/** Runs a tool and turns its result (or error) into text for the model. */
export async function callTool(t: AdaTool, args: unknown): Promise<{ text: string; isError: boolean }> {
  try {
    const parsed = z.object(t.shape).parse(args ?? {});
    const out = await t.run(parsed);
    return { text: typeof out === "string" ? out : JSON.stringify(out, null, 1), isError: false };
  } catch (err) {
    return { text: `Error: ${(err as Error).message}`, isError: true };
  }
}

export function agentSdkBrain(o: { token: string; model?: string; effort?: "low" | "medium" | "high" }): AdaBrain {
  return {
    async run(r) {
      const server = createSdkMcpServer({
        name: "ada",
        version: "1.0.0",
        tools: r.tools.map((t) =>
          tool(t.name, t.description, t.shape, async (args) => {
            const res = await callTool(t, args);
            return { content: [{ type: "text" as const, text: res.text }], isError: res.isError };
          }),
        ),
      });
      let text = "";
      let costUsd = 0;
      const q = query({
        prompt: r.prompt,
        options: {
          systemPrompt: r.system,
          model: o.model ?? "haiku",
          effort: o.effort ?? "low",
          tools: [], // none of Claude Code's own tools: no files, no shell
          mcpServers: { ada: server },
          allowedTools: r.tools.map((t) => `mcp__ada__${t.name}`),
          maxTurns: r.maxTurns ?? 12,
          persistSession: false,
          settingSources: [],
          includePartialMessages: !!r.onText,
          cwd: process.env.TMPDIR ?? "/tmp",
          env: { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: o.token, CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" } as Record<string, string>,
        },
      });
      for await (const m of q as AsyncIterable<any>) {
        if (m.type === "stream_event" && m.event?.type === "content_block_delta" && m.event.delta?.type === "text_delta") r.onText?.(m.event.delta.text);
        if (m.type === "assistant") {
          for (const block of m.message?.content ?? []) if (block.type === "text") text += (text ? "\n" : "") + block.text;
        }
        if (m.type === "result") {
          costUsd = m.total_cost_usd ?? 0;
          if (m.subtype !== "success" && !text) throw new Error(`Ada couldn't finish: ${m.subtype}`);
          if (m.subtype === "success" && typeof m.result === "string" && m.result) text = m.result;
        }
      }
      return { text: text.trim(), costUsd };
    },
  };
}

/**
 * For tests: a function decides what Ada does, given the prompt and her
 * tools (calling them for real), and returns her reply.
 */
export function scriptedBrain(script: (r: BrainRun, call: (name: string, args: unknown) => Promise<string>) => Promise<string>): AdaBrain & { runs: BrainRun[] } {
  const runs: BrainRun[] = [];
  return {
    runs,
    async run(r) {
      runs.push(r);
      const call = async (name: string, args: unknown) => {
        const t = r.tools.find((x) => x.name === name);
        if (!t) throw new Error(`Ada has no tool ${name}`);
        return (await callTool(t, args)).text;
      };
      const text = await script(r, call);
      r.onText?.(text);
      return { text, costUsd: 0 };
    },
  };
}
