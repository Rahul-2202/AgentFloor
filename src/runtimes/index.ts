import { antigravity } from "./antigravity.ts";
import { claudeCode } from "./claude-code.ts";
import { junie } from "./junie.ts";
import { createScriptedRuntime } from "./scripted.ts";
import type { RuntimeFactory } from "./types.ts";

/**
 * Runtimes the office can start. An agent whose runtime isn't listed here is
 * "external": the office gives it an identity (see data/agents/<id>/env) and you
 * start its CLI yourself, which is handy for trying a new CLI by hand.
 */
export const RUNTIMES: Record<string, RuntimeFactory> = {
  scripted: createScriptedRuntime,
  "claude-code": claudeCode,
  junie,
  antigravity,
};
