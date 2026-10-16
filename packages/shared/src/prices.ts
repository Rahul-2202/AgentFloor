/**
 * API list prices per million tokens, by model family. Agents run on the
 * company's Claude login, so this is API-equivalent cost: what the same work
 * would cost on the API, used for spend views and budgets.
 */
const PER_MTOK: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  haiku: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  sonnet: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  opus: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
};

export interface CallTokens {
  model: string;
  /** Uncached input. */
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/** Cost of one model call in US dollars; unknown models cost as Sonnet. */
export function costOf(c: CallTokens): number {
  const family = Object.keys(PER_MTOK).find((f) => c.model.toLowerCase().includes(f)) ?? "sonnet";
  const p = PER_MTOK[family]!;
  return (c.inputTokens * p.input + c.outputTokens * p.output + c.cacheReadTokens * p.cacheRead + c.cacheWriteTokens * p.cacheWrite) / 1e6;
}
