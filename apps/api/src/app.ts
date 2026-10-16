import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { LINK_PATH } from "@agentfloor/shared/link";
import Fastify, { type FastifyRequest } from "fastify";
import { AuthError, bearer, type User, type Verify } from "./auth.ts";
import { LinkError, type OfficeHub } from "./link/hub.ts";
import type { OfficeStore } from "./offices.ts";

export interface Deps {
  verify: Verify;
  offices: OfficeStore;
  hub: OfficeHub;
  webOrigins: string[];
  logger?: boolean;
}

declare module "fastify" {
  interface FastifyRequest {
    user: User;
  }
}

export async function buildApp(deps: Deps) {
  const app = Fastify({ logger: deps.logger ?? false });
  await app.register(cors, { origin: deps.webOrigins, credentials: false });

  await app.register(websocket, { options: { maxPayload: 4 * 1024 * 1024 } });

  app.get("/health", async () => ({ ok: true }));

  // Office daemons dial in here; they authenticate with their office token
  // in the first message (see packages/shared/src/link.ts).
  app.get(LINK_PATH, { websocket: true }, (socket) => deps.hub.accept(socket));

  // Everything below needs a signed-in user (a Supabase access token).
  app.register(async (authed) => {
    authed.decorateRequest("user", null as unknown as User);
    authed.addHook("onRequest", async (req: FastifyRequest, reply) => {
      const token = bearer(req.headers.authorization);
      if (!token) return reply.code(401).send({ error: "sign in first" });
      try {
        req.user = await deps.verify(token);
      } catch (err) {
        if (err instanceof AuthError) return reply.code(401).send({ error: "session expired or invalid" });
        throw err;
      }
    });

    /** Who is signed in, and their office if it exists yet. */
    authed.get("/me", async (req) => ({ user: req.user, office: await deps.offices.officeOf(req.user.id) }));

    /** First sign-in: create the user's office. Safe to call again. */
    authed.post("/office", async (req, reply) => {
      const { office, created } = await deps.offices.ensureOffice(req.user);
      return reply.code(created ? 201 : 200).send({ office, created });
    });

    /** Runs an office call (the daemon's CEO tools) in the user's office. */
    authed.post<{ Body: { name?: unknown; args?: unknown } }>("/office/call", async (req, reply) => {
      const office = await deps.offices.officeOf(req.user.id);
      if (!office) return reply.code(404).send({ error: "no office yet" });
      if (typeof req.body?.name !== "string") return reply.code(400).send({ error: "name is required" });
      try {
        return { result: await deps.hub.call(office.id, req.body.name, req.body.args ?? {}) };
      } catch (err) {
        if (!(err instanceof LinkError)) throw err;
        const status = err.code === "office_offline" ? 503 : err.code === "timeout" ? 504 : 400;
        return reply.code(status).send({ error: err.message, code: err.code });
      }
    });
  });

  return app;
}
