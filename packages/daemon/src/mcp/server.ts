import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { OfficeClient } from "../client.ts";
import { TOOLS } from "../core/tools.ts";
import { OfficeError } from "../core/types.ts";

/**
 * The office as an MCP server (stdio). Each agent's runtime starts its own copy
 * with that agent's AGENTFLOOR_URL and AGENTFLOOR_TOKEN, so every call is made
 * as that agent. It only forwards to the daemon; the rules live there.
 */
const client = OfficeClient.fromEnv();
const server = new McpServer(
  { name: "office", version: "0.1.0" },
  {
    instructions:
      "You work in an office with other agents. Use these tools to talk to them: ask questions, reply, inform, request work, huddle, and ask the CEO. Messages to you arrive as 'Office message' blocks; answer them with reply.",
  },
);

for (const tool of TOOLS.filter((t) => t.who === "agent")) {
  server.registerTool(tool.name, { description: tool.description, inputSchema: tool.shape }, async (args: Record<string, unknown>) => {
    try {
      const result = await client.call(tool.name, args);
      const text =
        result && typeof result === "object" && "text" in result && typeof (result as { text: unknown }).text === "string"
          ? (result as { text: string }).text
          : JSON.stringify(result, null, 2);
      return { content: [{ type: "text" as const, text }] };
    } catch (err) {
      const e = err as OfficeError;
      return { isError: true, content: [{ type: "text" as const, text: `${e.code ?? "error"}: ${e.message}` }] };
    }
  });
}

await server.connect(new StdioServerTransport());
