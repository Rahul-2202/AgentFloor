import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import type { Auth } from "../core/auth.ts";
import type { Office } from "../core/office.ts";
import { runTool } from "../core/tools.ts";
import { handleGateway } from "./gateway.ts";
import { CEO, OfficeError, type OfficeEvent } from "../core/types.ts";

export interface HttpOptions {
  office: Office;
  auth: Auth;
  consoleHtml: string;
}

/**
 * The daemon's API.
 *   POST /rpc/<call>      an office call, as the token's owner (agents, adapters, the console)
 *   GET  /api/state       everything, for the console (CEO token)
 *   GET  /api/events      server-sent events from ?after=<seq> (CEO token, ?token= since EventSource can't set headers)
 *   GET  /                the console
 */
export function createHttpServer({ office, auth, consoleHtml }: HttpOptions): Server {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const token = bearer(req) ?? url.searchParams.get("token") ?? undefined;

      if (req.method === "GET" && url.pathname === "/health") return json(res, 200, { ok: true });

      // The model gateway authenticates by the agent token in its path.
      if (url.pathname.startsWith("/gw/")) return await handleGateway(req, res, office, auth);

      if (req.method === "GET" && url.pathname === "/") {
        const html = readFileSync(consoleHtml, "utf8").replace("__CEO_TOKEN__", auth.tokenFor(CEO));
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        return res.end(html);
      }

      const actor = auth.verify(token);
      if (!actor) return json(res, 401, { ok: false, error: { code: "unauthorized", message: "Missing or bad office token." } });

      if (req.method === "POST" && url.pathname.startsWith("/rpc/")) {
        const args = await readJson(req);
        const result = await runTool(office, actor, url.pathname.slice(5), args);
        return json(res, 200, { ok: true, result });
      }

      if (actor !== CEO) return json(res, 403, { ok: false, error: { code: "not_allowed", message: "CEO only." } });

      if (req.method === "GET" && url.pathname === "/api/state") return json(res, 200, office.snapshot());

      if (req.method === "GET" && url.pathname === "/api/events") {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
        const send = (ev: OfficeEvent) => res.write(`id: ${ev.seq}\ndata: ${JSON.stringify(ev)}\n\n`);
        const after = Number(url.searchParams.get("after") ?? req.headers["last-event-id"] ?? 0);
        for (const ev of office.store.events(after)) send(ev);
        office.bus.on("event", send);
        const ping = setInterval(() => res.write(": ping\n\n"), 15000);
        req.on("close", () => {
          clearInterval(ping);
          office.bus.off("event", send);
        });
        return;
      }

      json(res, 404, { ok: false, error: { code: "not_found", message: `No route ${req.method} ${url.pathname}` } });
    } catch (err) {
      if (err instanceof OfficeError) return json(res, 400, { ok: false, error: { code: err.code, message: err.message } });
      console.error(err);
      json(res, 500, { ok: false, error: { code: "internal", message: String((err as Error).message ?? err) } });
    }
  });
}

function bearer(req: IncomingMessage): string | undefined {
  const h = req.headers.authorization;
  return h?.startsWith("Bearer ") ? h.slice(7) : undefined;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) return;
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 1_000_000) throw new OfficeError("too_large", "Request body over 1 MB.");
    chunks.push(c as Buffer);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new OfficeError("bad_input", "Body is not valid JSON.");
  }
}
