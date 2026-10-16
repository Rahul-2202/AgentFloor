// Live check of Ada's brain: the Claude Agent SDK on the company's Claude login,
// calling one of her tools. One small Haiku run. npm run check:ada -w @agentfloor/api
import assert from "node:assert/strict";
import { loadEnv } from "@agentfloor/shared/env";
import { z } from "zod";
import { agentSdkBrain } from "../src/ada/brain.ts";

loadEnv();
const token = process.env.AGENTFLOOR_CLAUDE_TOKEN;
if (!token) throw new Error("AGENTFLOOR_CLAUDE_TOKEN is missing from .env");
let called: unknown = null;
let streamed = "";
const t0 = Date.now();
const { text, costUsd } = await agentSdkBrain({ token, model: "haiku" }).run({
  system: "You are Ada, a test. Use your tools when asked.",
  prompt: "Use the office_overview tool, then tell me in one short sentence how many rooms the office has.",
  tools: [{ name: "office_overview", description: "The office right now.", shape: { detail: z.boolean().optional() }, run: async (a) => ((called = a), "Acme: 2 rooms (Development, Marketing), 6 agents.") }],
  onText: (d) => (streamed += d),
  maxTurns: 4,
});
assert.ok(called !== null, "Ada called her tool");
assert.match(text, /\b(2|two)\b/i, `reply: ${text}`);
console.log(`Ada's brain: ok (${((Date.now() - t0) / 1000).toFixed(1)} s, $${costUsd.toFixed(4)} API-equivalent, streamed ${streamed.length} chars)\nReply: ${text}`);
