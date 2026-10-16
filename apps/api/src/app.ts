import cors from "@fastify/cors";
import Fastify, { type FastifyRequest } from "fastify";
import { AuthError, bearer, type User, type Verify } from "./auth.ts";
import type { OfficeStore } from "./offices.ts";

export interface Deps {
  verify: Verify;
  offices: OfficeStore;
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

  app.get("/health", async () => ({ ok: true }));

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
  });

  return app;
}
