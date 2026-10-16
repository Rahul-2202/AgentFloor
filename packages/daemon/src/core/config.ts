import { readFileSync } from "node:fs";
import { CATALOG, DEFAULT_RUNTIME } from "./catalog.ts";
import { CEO, OFFICE, type OfficeConfig } from "./types.ts";

export { DEFAULT_POLICY } from "@agentfloor/shared/setup";
import { DEFAULT_POLICY } from "@agentfloor/shared/setup";

/** Loads and checks an office config. Throws with every problem found. */
export function loadConfig(path: string): OfficeConfig {
  const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<OfficeConfig>;
  return checkConfig({ name: raw.name ?? "Office", rooms: raw.rooms ?? [], agents: raw.agents ?? [], policy: { ...DEFAULT_POLICY, ...raw.policy } });
}

export function checkConfig(c: OfficeConfig): OfficeConfig {
  const problems: string[] = [];
  // Every agent runs on Claude Code (Haiku, low effort) unless it says otherwise.
  for (const a of c.agents) {
    a.runtime ||= DEFAULT_RUNTIME;
    const info = CATALOG[a.runtime];
    if (!info) continue; // an external runtime the office doesn't start
    a.model ||= info.defaultModel;
    if (info.defaultEffort) a.effort ||= info.defaultEffort;
  }
  const ids = new Set<string>();
  for (const a of c.agents) {
    if (!/^[a-z][a-z0-9-]*$/.test(a.id)) problems.push(`agent id "${a.id}" must be lowercase letters, digits and dashes`);
    if (a.id === CEO || a.id === OFFICE || a.id === "all" || a.id.startsWith("room:")) problems.push(`agent id "${a.id}" is reserved`);
    if (ids.has(a.id)) problems.push(`agent id "${a.id}" is used twice`);
    ids.add(a.id);
    if (!c.rooms.some((r) => r.id === a.room)) problems.push(`agent "${a.id}" is in unknown room "${a.room}"`);
  }
  for (const r of c.rooms) {
    const head = c.agents.find((a) => a.id === r.head);
    if (!head) problems.push(`room "${r.id}" has unknown head "${r.head}"`);
    else if (head.room !== r.id || head.role !== "head") problems.push(`room "${r.id}"'s head "${r.head}" must be in the room with role "head"`);
  }
  if (problems.length) throw new Error(`Bad office config:\n- ${problems.join("\n- ")}`);
  return c;
}
