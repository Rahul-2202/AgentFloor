import type { IncomingMessage, ServerResponse } from "node:http";
import type { Auth } from "../core/auth.ts";
import type { Office } from "../core/office.ts";

/**
 * The model gateway: agents' CLIs send their model requests here instead of
 * straight to the provider, so the office sees every call. It passes requests
 * and responses through unchanged, and reads token usage and in-flight state
 * from them along the way.
 *
 *   /gw/<agent token>/anthropic/v1/messages  →  https://api.anthropic.com/v1/messages
 *
 * The agent's token in the path says who is calling; the provider credentials
 * (API key or the CLI's own login) travel in the headers as usual.
 */
function upstreamFor(provider: string): string | undefined {
  // AGENTFLOOR_ANTHROPIC_BASE_URL points the gateway at another Anthropic-compatible endpoint.
  if (provider === "anthropic") return process.env.AGENTFLOOR_ANTHROPIC_BASE_URL || "https://api.anthropic.com";
  return undefined;
}

/** Request headers not passed on: hop-by-hop, or set by fetch itself. */
const DROP_REQUEST = new Set(["host", "connection", "content-length", "accept-encoding", "transfer-encoding", "keep-alive"]);
/** Response headers not passed back: the body is re-sent decoded and chunked. */
const DROP_RESPONSE = new Set(["content-encoding", "content-length", "transfer-encoding", "connection", "keep-alive"]);

export interface ModelCall {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/** Path prefix for an agent's gateway URL. */
export function gatewayBase(url: string, token: string, provider: string): string {
  return `${url}/gw/${token}/${provider}`;
}

export async function handleGateway(req: IncomingMessage, res: ServerResponse, office: Office, auth: Auth): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const [, , token, provider, ...rest] = url.pathname.split("/");
  const agent = auth.verify(token);
  const upstream = provider ? upstreamFor(provider) : undefined;
  if (!agent || agent === "ceo" || !upstream) {
    res.writeHead(agent ? 404 : 401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { type: agent ? "not_found" : "unauthorized", message: agent ? `No provider "${provider}".` : "Bad office token in gateway path." } }));
    return;
  }

  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;

  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined || DROP_REQUEST.has(k)) continue;
    headers.set(k, Array.isArray(v) ? v.join(", ") : v);
  }
  // Ask for an uncompressed body so usage can be read as it streams.
  headers.set("accept-encoding", "identity");

  const path = `/${rest.join("/")}${url.search}`;
  const counted = req.method === "POST" && /\/v1\/messages$/.test(`/${rest.join("/")}`);
  if (counted) office.setActivity(agent, "thinking");

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(upstream + path, { method: req.method, headers, body: body as BodyInit | undefined });
  } catch (err) {
    if (counted) office.setActivity(agent, null);
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { type: "gateway_error", message: `Couldn't reach ${provider}: ${(err as Error).message}` } }));
    return;
  }

  const outHeaders: Record<string, string> = {};
  upstreamRes.headers.forEach((v, k) => {
    if (!DROP_RESPONSE.has(k)) outHeaders[k] = v;
  });
  res.writeHead(upstreamRes.status, outHeaders);

  const reader = new AnthropicUsageReader(upstreamRes.headers.get("content-type") ?? "");
  try {
    if (upstreamRes.body) {
      const decoder = new TextDecoder();
      for await (const chunk of upstreamRes.body as unknown as AsyncIterable<Uint8Array>) {
        res.write(chunk);
        if (counted) reader.push(decoder.decode(chunk, { stream: true }));
      }
    }
  } finally {
    res.end();
    if (counted) {
      office.setActivity(agent, null);
      const call = reader.finish();
      if (call && upstreamRes.ok) office.recordModelCall(agent, { provider, ...call });
    }
  }
}

/**
 * Reads usage from an Anthropic Messages response, streamed (server-sent
 * events: message_start carries input and cache tokens, message_delta the
 * running output count) or plain JSON.
 */
export class AnthropicUsageReader {
  private readonly sse: boolean;
  private buf = "";
  private model = "";
  private input = 0;
  private output = 0;
  private cacheRead = 0;
  private cacheWrite = 0;
  private seen = false;

  constructor(contentType: string) {
    this.sse = contentType.includes("text/event-stream");
  }

  push(text: string): void {
    this.buf += text;
    if (!this.sse) return;
    let i: number;
    while ((i = this.buf.indexOf("\n\n")) >= 0) {
      const event = this.buf.slice(0, i);
      this.buf = this.buf.slice(i + 2);
      for (const line of event.split("\n")) {
        if (line.startsWith("data:")) this.read(line.slice(5).trim());
      }
    }
  }

  private read(data: string): void {
    let j: any;
    try {
      j = JSON.parse(data);
    } catch {
      return;
    }
    const msg = j.type === "message_start" ? j.message : j.type === "message" ? j : null;
    if (msg) {
      this.seen = true;
      this.model = msg.model ?? this.model;
      this.take(msg.usage);
    }
    if (j.type === "message_delta" && j.usage) {
      this.seen = true;
      this.take(j.usage);
    }
  }

  private take(u: any): void {
    if (!u) return;
    if (u.input_tokens) this.input = u.input_tokens;
    if (u.output_tokens) this.output = u.output_tokens;
    if (u.cache_read_input_tokens) this.cacheRead = u.cache_read_input_tokens;
    if (u.cache_creation_input_tokens) this.cacheWrite = u.cache_creation_input_tokens;
  }

  finish(): Omit<ModelCall, "provider"> | null {
    if (!this.sse && this.buf) this.read(this.buf);
    if (!this.seen) return null;
    return { model: this.model, inputTokens: this.input, outputTokens: this.output, cacheReadTokens: this.cacheRead, cacheWriteTokens: this.cacheWrite };
  }
}
