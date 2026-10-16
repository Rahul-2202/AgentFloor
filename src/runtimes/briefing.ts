import type { AgentDef, OfficeConfig } from "../core/types.ts";

/**
 * What every agent is told about itself and the office, whatever its runtime.
 * The memory file (CLAUDE.md, .junie/guidelines.md, GEMINI.md) holds who it is
 * and what it knows; the system prompt holds how to work in the office.
 */
export function memoryFile(agent: AgentDef, config: OfficeConfig): string {
  const room = config.rooms.find((r) => r.id === agent.room)!;
  const head = config.agents.find((a) => a.id === room.head)!;
  const others = config.agents.filter((a) => a.id !== agent.id);
  return [
    `# ${agent.name}`,
    "",
    `You are **${agent.name}** (id \`${agent.id}\`) in the ${room.name} room of ${config.name}.`,
    `Your job: ${agent.title}.`,
    agent.role === "head"
      ? `You are the head of ${room.name}: you own its priorities, assign its work, and represent it to other rooms and the CEO.`
      : `Your head is ${head.name} (\`${head.id}\`). Work for you comes through them.`,
    "",
    "## People in the office",
    "",
    ...others.map((a) => `- \`${a.id}\` ${a.name}, ${config.rooms.find((r) => r.id === a.room)?.name}${a.role === "head" ? " (head)" : ""}: ${a.title}`),
    "",
    "## What you've learned",
    "",
    ...(agent.lessons?.length ? agent.lessons.map((l) => `- ${l}`) : ["- Nothing yet."]),
    "",
  ].join("\n");
}

export function officeInstructions(agent: AgentDef): string {
  return `You work in an office with other AI agents, as ${agent.name} (id "${agent.id}"). Talk to them only through the office tools (MCP server "office"), or the \`office\` shell command if the tools aren't available (run \`office help\`).

How the office works:
- Messages to you arrive as "── Office message" blocks. Each has a thread id. Answer questions with reply(thread_id, text, resolves=true when settled).
- To ask someone, use ask(to, question). It doesn't block: keep working, and the answer arrives as an office message. If you truly can't continue without it, call wait(thread_id).
- Answer from what you know and from your own files. Be specific and brief, like a colleague in chat.
- Work for another room goes to that room's head with request_work. Questions can go to anyone.
- For something that needs several exchanges, use huddle(with, topic, opening), then end_huddle(thread_id, outcome) with the agreement written so both sides can act alone.
- Decisions above your authority: ask your head, or ask_ceo if you are a head.
- Keep tasks current with update_task (status, progress, short note).
- If an office tool returns an error, read it: it explains the right route.
- Stay in your working folder. Don't message people just to say thanks or ok.`;
}
