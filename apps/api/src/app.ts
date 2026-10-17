import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { LINK_PATH } from "@agentfloor/shared/link";
import Fastify, { type FastifyRequest } from "fastify";
import { AuthError, bearer, type User, type Verify } from "./auth.ts";
import type { Ada } from "./ada/ada.ts";
import { MeetingError, type Meetings } from "./ada/meetings.ts";
import { startOfDayUtc, type Budgets, type BudgetStore } from "./budgets.ts";
import { MemoryError, type MemoryService } from "./memory/service.ts";
import { GitHubError } from "./github/app.ts";
import { GitHubUserError, type GitHubService } from "./github/service.ts";
import { LinkError, type OfficeHub } from "./link/hub.ts";
import type { Watchers } from "./live/watchers.ts";
import type { OfficeMachines } from "./machines/lifecycle.ts";
import type { OfficeStore } from "./offices.ts";
import { PolicyError } from "./policy/engine.ts";
import type { ClientOp, SetupService } from "./setup/service.ts";
import { LinearUserError, type LinearSync } from "./linear/service.ts";
import type { Access, AdminData, ErrorLog } from "./ops/ops.ts";
import { ClaudeTokenError, type ClaudeTokens } from "./claude/tokens.ts";
import { LinearError } from "./linear/client.ts";
import { StaleSetupError } from "./setup/store.ts";

export interface Deps {
  verify: Verify;
  offices: OfficeStore;
  hub: OfficeHub;
  /** Office VMs; null when Daytona isn't configured. */
  machines?: OfficeMachines | null;
  setup?: SetupService;
  budgets?: Budgets;
  spend?: BudgetStore;
  watchers?: Watchers;
  github?: GitHubService | null;
  linear?: LinearSync | null;
  /** Each office's own Claude login. */
  claude?: ClaudeTokens | null;
  ada?: Ada | null;
  meetings?: Meetings | null;
  memory?: MemoryService | null;
  /** An inbox item's sender, for approvals (who asked for the merge). */
  inboxItem?: (officeId: string, id: string) => Promise<{ id: string; from: string; kind: string } | null>;
  /** Records something in the office's audit log (webhooks). */
  audit?: (officeId: string | null, actor: string, action: string, target: string, detail: object) => Promise<void>;
  /** Which office works on a repo (webhooks). */
  officeForRepo?: (fullName: string) => Promise<string | null>;
  /** Inbox items the API itself raised (budgets) are resolved here, not in the daemon. */
  resolveOwnInbox?: (officeId: string, id: string) => Promise<void>;
  /** Who may sign in (the allowlist); without it, anyone signed in may (tests, local). */
  access?: Access;
  errors?: ErrorLog;
  admin?: AdminData;
  /** Runs the memory backup now (admins). */
  backup?: () => Promise<object>;
  webOrigins: string[];
  logger?: boolean;
}

/** Office calls the browser can't make through /office/call: setup goes through the policy engine; holds are the API's. */
const BLOCKED_CALLS = new Set(["ceo_configure_agent", "ceo_release_agent", "ceo_start_meeting", "ceo_end_meeting"]);

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

  // Server errors are tracked (grouped by message), not just logged.
  app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    if (status >= 500) deps.errors?.record("api", err.message, { stack: err.stack, context: { method: req.method, url: req.url.split("?")[0] } });
    req.log?.error?.(err);
    void reply.code(status).send({ error: status >= 500 ? "Something went wrong on our side. It's been recorded." : err.message });
  });

  // Office daemons dial in here; they authenticate with their office token
  // in the first message (see packages/shared/src/link.ts).
  app.get(LINK_PATH, { websocket: true }, (socket) => deps.hub.accept(socket));

  // Browsers watching their office: live output and terminal take-over (signs in with its first message).
  app.get("/office/live", { websocket: true }, (socket) => {
    if (deps.watchers) deps.watchers.accept(socket);
    else socket.close(1013, "not available");
  });

  // GitHub's webhook: checked against its signature over the raw body.
  app.register(async (hooks) => {
    hooks.addContentTypeParser("application/json", { parseAs: "buffer" }, (_req, body, done) => done(null, body));
    hooks.post("/github/webhook", async (req, reply) => {
      const gh = deps.github;
      if (!gh) return reply.code(404).send({ error: "GitHub isn't set up" });
      const raw = req.body as Buffer;
      if (!gh.app.verifyWebhook(raw, req.headers["x-hub-signature-256"] as string | undefined)) return reply.code(401).send({ error: "bad signature" });
      const event = String(req.headers["x-github-event"] ?? "");
      const body = JSON.parse(raw.toString("utf8"));
      const repo = body.repository?.full_name as string | undefined;
      const officeId = repo ? await deps.officeForRepo?.(repo) ?? null : null;
      if (event === "pull_request" && officeId) {
        const pr = body.pull_request;
        await deps.audit?.(officeId, "github", `pr.${body.action}${pr?.merged ? ".merged" : ""}`, `#${pr?.number}`, { title: pr?.title, url: pr?.html_url, by: body.sender?.login });
      }
      return reply.code(202).send({ ok: true });
    });

    // Linear's webhook, one address per office, signed with that office's secret.
    hooks.post<{ Params: { office: string } }>("/linear/webhook/:office", async (req, reply) => {
      if (!deps.linear) return reply.code(404).send({ error: "Linear isn't set up" });
      const ok = await deps.linear.webhook(req.params.office, req.body as Buffer, req.headers["linear-signature"] as string | undefined);
      return ok ? reply.code(200).send({ ok: true }) : reply.code(401).send({ error: "bad signature" });
    });
  });

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
      // Internal v1: only people on the allowlist.
      if (deps.access) {
        const a = await deps.access.check(req.user);
        if (!a.allowed) {
          return reply.code(403).send({ error: `AgentFloor is invite-only for now. Ask to have ${req.user.githubLogin ?? req.user.email ?? "your account"} added.`, code: "not_allowed" });
        }
        (req as FastifyRequest & { admin?: boolean }).admin = a.admin;
      }
    });
    const isAdmin = (req: FastifyRequest) => !deps.access || !!(req as FastifyRequest & { admin?: boolean }).admin;

    /** Errors in the browser (the web app reports them here). */
    authed.post<{ Body: { message?: string; stack?: string; context?: object } }>("/errors", async (req) => {
      if (deps.errors && req.body?.message) {
        const office = await deps.offices.officeOf(req.user.id).catch(() => null);
        deps.errors.record("web", String(req.body.message).slice(0, 2000), { stack: req.body.stack?.slice(0, 8000), officeId: office?.id ?? null, context: { ...(req.body.context ?? {}), user: req.user.githubLogin } });
      }
      return { ok: true };
    });

    /** Everything the office remembers, as a file (the CEO's own backup). */
    authed.get("/office/memory/export", async (req, reply) => {
      const office = await deps.offices.officeOf(req.user.id);
      if (!office || !deps.admin) return reply.code(404).send({ error: "no office yet" });
      reply.header("content-disposition", `attachment; filename="agentfloor-memory-${new Date().toISOString().slice(0, 10)}.json"`);
      return deps.admin.memoryExport(office.id);
    });

    /* -------------------------------------------------------------- admin */

    authed.get("/admin/overview", async (req, reply) => {
      if (!isAdmin(req) || !deps.admin) return reply.code(403).send({ error: "admins only" });
      return deps.admin.overview();
    });
    authed.get<{ Querystring: { limit?: string } }>("/admin/errors", async (req, reply) => {
      if (!isAdmin(req) || !deps.admin) return reply.code(403).send({ error: "admins only" });
      return { errors: await deps.admin.errors(Math.min(500, Number(req.query.limit ?? 100) || 100)) };
    });
    authed.get("/admin/allowlist", async (req, reply) => {
      if (!isAdmin(req) || !deps.access) return reply.code(403).send({ error: "admins only" });
      return { entries: await deps.access.list() };
    });
    authed.post<{ Body: { githubLogin?: string; email?: string; note?: string; admin?: boolean } }>("/admin/allowlist", async (req, reply) => {
      if (!isAdmin(req) || !deps.access) return reply.code(403).send({ error: "admins only" });
      try {
        await deps.access.add({ githubLogin: req.body?.githubLogin?.trim(), email: req.body?.email?.trim(), note: req.body?.note, admin: req.body?.admin });
        return { entries: await deps.access.list() };
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    });
    authed.delete<{ Params: { id: string } }>("/admin/allowlist/:id", async (req, reply) => {
      if (!isAdmin(req) || !deps.access) return reply.code(403).send({ error: "admins only" });
      const entries = await deps.access.list();
      const target = entries.find((e) => e.id === Number(req.params.id));
      // Never lock the last admin out.
      if (target?.admin && entries.filter((e) => e.admin).length <= 1) return reply.code(400).send({ error: "That's the last admin." });
      await deps.access.remove(Number(req.params.id));
      return { entries: await deps.access.list() };
    });
    authed.post("/admin/backup", async (req, reply) => {
      if (!isAdmin(req) || !deps.backup) return reply.code(403).send({ error: "admins only" });
      return deps.backup();
    });

    /** Who is signed in, and their office if it exists yet. */
    authed.get("/me", async (req) => ({ user: req.user, admin: isAdmin(req) && !!deps.access, office: await deps.offices.officeOf(req.user.id) }));

    /** First sign-in: create the user's office. Safe to call again. */
    authed.post("/office", async (req, reply) => {
      try {
        const { office, created } = await deps.offices.ensureOffice(req.user);
        return reply.code(created ? 201 : 200).send({ office, created });
      } catch (err) {
        if (err instanceof AuthError) return reply.code(401).send({ error: err.message, code: "account_gone" });
        throw err;
      }
    });

    /** Starts the office VM (creates it the first time) and waits for its daemon. */
    authed.post("/office/start", async (req, reply) => {
      if (!deps.machines) return reply.code(503).send({ error: "Office computers aren't set up on this server." });
      const office = await deps.offices.officeOf(req.user.id);
      if (!office) return reply.code(404).send({ error: "no office yet" });
      try {
        return { state: await deps.machines.start(office.id) };
      } catch (err) {
        if (err instanceof ClaudeTokenError) return reply.code(400).send({ error: err.message, code: "claude_token" });
        return reply.code(502).send({ error: `Couldn't start your office: ${(err as Error).message}` });
      }
    });

    /** The office's Claude login: whether it's set, its last characters, and whether Claude still accepts it. */
    authed.get("/office/claude", async (req, reply) => {
      const office = await deps.offices.officeOf(req.user.id);
      if (!office) return reply.code(404).send({ error: "no office yet" });
      if (!deps.claude) return { set: false, last4: null, status: null, setAt: null, required: false };
      return { ...(await deps.claude.status(office.id)), required: true };
    });

    /** Saves the CEO's token (from `claude setup-token`). Checked with Anthropic first; never sent back. */
    authed.post<{ Body: { token?: string } }>("/office/claude", async (req, reply) => {
      const office = await deps.offices.officeOf(req.user.id);
      if (!office) return reply.code(404).send({ error: "no office yet" });
      if (!deps.claude) return reply.code(503).send({ error: "Claude tokens aren't set up on this server." });
      try {
        const status = await deps.claude.set(office.id, String(req.body?.token ?? ""));
        await deps.audit?.(office.id, "ceo", "claude.token.set", status.last4 ?? "", {});
        return status;
      } catch (err) {
        if (err instanceof ClaudeTokenError) return reply.code(400).send({ error: err.message });
        throw err;
      }
    });

    authed.post("/office/pause", async (req, reply) => {
      if (!deps.machines) return reply.code(503).send({ error: "Office computers aren't set up on this server." });
      const office = await deps.offices.officeOf(req.user.id);
      if (!office) return reply.code(404).send({ error: "no office yet" });
      return { state: await deps.machines.pause(office.id) };
    });

    /** The office of the signed-in user, or a 404 reply. */
    const officeOf = async (req: FastifyRequest) => (await deps.offices.officeOf(req.user.id))?.id ?? null;
    const setupError = (reply: any, err: unknown) => {
      if (err instanceof PolicyError) return reply.code(422).send({ error: err.message, problems: err.problems });
      if (err instanceof StaleSetupError) return reply.code(409).send({ error: err.message });
      throw err;
    };

    /** The office's setup: rooms, agents, policy, budgets, and its version. */
    authed.get("/office/setup", async (req, reply) => {
      const id = await officeOf(req);
      if (!id || !deps.setup) return reply.code(404).send({ error: "no office yet" });
      return deps.setup.get(id);
    });

    /** What a change would do, as a read-back. Nothing changes. */
    authed.post<{ Body: { ops?: ClientOp[] } }>("/office/setup/propose", async (req, reply) => {
      const id = await officeOf(req);
      if (!id || !deps.setup) return reply.code(404).send({ error: "no office yet" });
      if (!Array.isArray(req.body?.ops)) return reply.code(400).send({ error: "ops is required" });
      try {
        const p = await deps.setup.propose(id, req.body.ops);
        return { baseVersion: p.baseVersion, readback: p.readback, summary: p.summary, diff: p.diff };
      } catch (err) {
        return setupError(reply, err);
      }
    });

    /** Applies a change the CEO confirmed from its read-back. */
    authed.post<{ Body: { ops?: ClientOp[]; baseVersion?: number } }>("/office/setup/apply", async (req, reply) => {
      const id = await officeOf(req);
      if (!id || !deps.setup) return reply.code(404).send({ error: "no office yet" });
      if (!Array.isArray(req.body?.ops) || typeof req.body.baseVersion !== "number") return reply.code(400).send({ error: "ops and baseVersion are required" });
      try {
        const r = await deps.setup.apply(id, req.body.ops, req.body.baseVersion, "ceo");
        void deps.budgets?.check(id).catch(() => {}); // limits may have changed
        return r;
      } catch (err) {
        return setupError(reply, err);
      }
    });

    authed.get("/office/setup/versions", async (req, reply) => {
      const id = await officeOf(req);
      if (!id || !deps.setup) return reply.code(404).send({ error: "no office yet" });
      return { versions: await deps.setup.versions(id) };
    });

    /** Spend per agent and room, today or over the last days (API-equivalent dollars). */
    authed.get<{ Querystring: { days?: string } }>("/office/spend", async (req, reply) => {
      const id = await officeOf(req);
      if (!id || !deps.spend) return reply.code(404).send({ error: "no office yet" });
      const days = Math.min(31, Math.max(1, Number(req.query.days ?? 1) || 1));
      const since = startOfDayUtc(new Date(Date.now() - (days - 1) * 86_400_000));
      const rows = await deps.spend.spendSince(id, since);
      const sum = (xs: typeof rows) => ({
        calls: xs.reduce((n, r) => n + r.calls, 0),
        tokens: xs.reduce((n, r) => n + r.tokens, 0),
        costUsd: Number(xs.reduce((n, r) => n + r.costUsd, 0).toFixed(4)),
      });
      const rooms = [...new Set(rows.map((r) => r.roomId ?? ""))].map((room) => ({ roomId: room || null, ...sum(rows.filter((r) => (r.roomId ?? "") === room)) }));
      return { since: since.toISOString(), total: sum(rows), rooms, agents: rows };
    });

    /** Lets a parked agent carry on (a take-over that never handed back, or a hold the CEO lifts). */
    authed.post<{ Params: { id: string } }>("/office/agents/:id/release", async (req, reply) => {
      const id = await officeOf(req);
      if (!id) return reply.code(404).send({ error: "no office yet" });
      try {
        return { result: await deps.hub.call(id, "ceo_release_agent", { agent: req.params.id }) };
      } catch (err) {
        if (err instanceof LinkError) return reply.code(err.code === "office_offline" ? 503 : 400).send({ error: err.message });
        throw err;
      }
    });

    /** Marks an inbox item done (the daemon's, or one the API raised). */
    authed.post<{ Params: { id: string } }>("/office/inbox/:id/resolve", async (req, reply) => {
      const id = await officeOf(req);
      if (!id) return reply.code(404).send({ error: "no office yet" });
      if (req.params.id.startsWith("B-")) {
        await deps.resolveOwnInbox?.(id, req.params.id);
        return { resolved: true };
      }
      try {
        return { result: await deps.hub.call(id, "resolve_inbox", { id: req.params.id }) };
      } catch (err) {
        if (err instanceof LinkError) return reply.code(err.code === "office_offline" ? 503 : 400).send({ error: err.message });
        throw err;
      }
    });

    /* ------------------------------------------------------------- Linear */

    const linearError = (reply: any, err: unknown) => {
      if (err instanceof LinearUserError) return reply.code(400).send({ error: err.message });
      if (err instanceof LinearError) return reply.code(502).send({ error: err.message });
      throw err;
    };

    authed.get("/office/linear", async (req, reply) => {
      const id = await officeOf(req);
      if (!id) return reply.code(404).send({ error: "no office yet" });
      if (!deps.linear) return { configured: false };
      return deps.linear.status(id);
    });

    authed.get<{ Querystring: { teamId?: string } }>("/office/linear/projects", async (req, reply) => {
      const id = await officeOf(req);
      if (!id) return reply.code(404).send({ error: "no office yet" });
      if (!deps.linear || !req.query.teamId) return { projects: [] };
      try {
        return { projects: await deps.linear.client.projects(req.query.teamId) };
      } catch (err) {
        return linearError(reply, err);
      }
    });

    authed.post<{ Body: { teamId?: string; projectId?: string | null } }>("/office/linear/connect", async (req, reply) => {
      const id = await officeOf(req);
      if (!id) return reply.code(404).send({ error: "no office yet" });
      if (!deps.linear) return reply.code(503).send({ error: "Linear isn't set up on this server yet." });
      if (!req.body?.teamId) return reply.code(400).send({ error: "teamId is required" });
      try {
        return { link: await deps.linear.connect(id, req.body.teamId, req.body.projectId ?? null) };
      } catch (err) {
        return linearError(reply, err);
      }
    });

    authed.post("/office/linear/disconnect", async (req, reply) => {
      const id = await officeOf(req);
      if (!id) return reply.code(404).send({ error: "no office yet" });
      if (!deps.linear) return reply.code(503).send({ error: "Linear isn't set up on this server yet." });
      await deps.linear.disconnect(id);
      return { disconnected: true };
    });

    /* ------------------------------------------------------------- GitHub */

    const ghError = (reply: any, err: unknown) => {
      if (err instanceof GitHubUserError) return reply.code(400).send({ error: err.message });
      if (err instanceof GitHubError) return reply.code(502).send({ error: err.message });
      throw err;
    };
    const needGithub = (reply: any) => (deps.github ? null : reply.code(503).send({ error: "GitHub isn't set up on this server yet." }));

    authed.get("/office/github", async (req, reply) => {
      const id = await officeOf(req);
      if (!id) return reply.code(404).send({ error: "no office yet" });
      if (!deps.github) return { configured: false };
      return { configured: true, ...(await deps.github.status(id, req.user)) };
    });

    /** After installing the app: GitHub sent the CEO back with an installation id. */
    authed.post<{ Body: { installationId?: string | number } }>("/office/github/connect", async (req, reply) => {
      const id = await officeOf(req);
      if (!id) return reply.code(404).send({ error: "no office yet" });
      if (needGithub(reply)) return;
      try {
        return { link: await deps.github!.connect(id, req.user, String(req.body?.installationId ?? "")) };
      } catch (err) {
        return ghError(reply, err);
      }
    });

    authed.get("/office/github/repos", async (req, reply) => {
      const id = await officeOf(req);
      if (!id) return reply.code(404).send({ error: "no office yet" });
      if (needGithub(reply)) return;
      try {
        return { repos: await deps.github!.repos(id) };
      } catch (err) {
        return ghError(reply, err);
      }
    });

    /** The repo agents work on; the office clones it and moves agents into worktrees. */
    authed.post<{ Body: { repo?: string } }>("/office/github/repo", async (req, reply) => {
      const id = await officeOf(req);
      if (!id) return reply.code(404).send({ error: "no office yet" });
      if (needGithub(reply)) return;
      try {
        const link = await deps.github!.chooseRepo(id, String(req.body?.repo ?? ""));
        await deps.setup?.push(id).catch(() => {});
        await deps.audit?.(id, "ceo", "github.repo", link.repo!, {});
        return { link };
      } catch (err) {
        return ghError(reply, err);
      }
    });

    /** A PR with its checks, for the merge approval card. */
    authed.get<{ Params: { n: string } }>("/office/prs/:n", async (req, reply) => {
      const id = await officeOf(req);
      if (!id) return reply.code(404).send({ error: "no office yet" });
      if (needGithub(reply)) return;
      try {
        return { pr: await deps.github!.pullRequest(id, Number(req.params.n)) };
      } catch (err) {
        return ghError(reply, err);
      }
    });

    /** Merging is the CEO's alone (a locked rule): only this endpoint merges. */
    authed.post<{ Params: { n: string }; Body: { inboxId?: string } }>("/office/prs/:n/merge", async (req, reply) => {
      const id = await officeOf(req);
      if (!id) return reply.code(404).send({ error: "no office yet" });
      if (needGithub(reply)) return;
      try {
        const item = req.body?.inboxId ? await deps.inboxItem?.(id, req.body.inboxId) : null;
        const r = await deps.github!.merge(id, Number(req.params.n), item ?? undefined);
        await deps.audit?.(id, "ceo", "pr.merged", `#${req.params.n}`, { sha: r.sha });
        return r;
      } catch (err) {
        return ghError(reply, err);
      }
    });

    authed.post<{ Params: { n: string }; Body: { comment?: string; inboxId?: string } }>("/office/prs/:n/changes", async (req, reply) => {
      const id = await officeOf(req);
      if (!id) return reply.code(404).send({ error: "no office yet" });
      if (needGithub(reply)) return;
      if (!req.body?.comment?.trim()) return reply.code(400).send({ error: "Say what needs to change." });
      try {
        const item = req.body.inboxId ? await deps.inboxItem?.(id, req.body.inboxId) : null;
        return await deps.github!.requestChanges(id, Number(req.params.n), req.body.comment, item ?? undefined);
      } catch (err) {
        return ghError(reply, err);
      }
    });

    /* --------------------------------------------------------------- Ada */

    const userError = (reply: any, err: unknown) => {
      if (err instanceof PolicyError) return reply.code(422).send({ error: err.message, problems: err.problems });
      if (err instanceof StaleSetupError) return reply.code(409).send({ error: err.message });
      if (err instanceof MemoryError || err instanceof MeetingError) return reply.code(400).send({ error: err.message });
      if (err instanceof LinkError) return reply.code(err.code === "office_offline" ? 503 : 400).send({ error: err.message });
      throw err;
    };
    const needAda = (reply: any) => (deps.ada ? null : reply.code(503).send({ error: "Ada isn't set up on this server yet." }));

    /** Talk to Ada. Her reply streams back as server-sent events: text, cards, then done. */
    authed.post<{ Body: { message?: string } }>("/office/ada/chat", async (req, reply) => {
      const id = await officeOf(req);
      if (!id) return reply.code(404).send({ error: "no office yet" });
      if (needAda(reply)) return;
      const origin = req.headers.origin;
      reply.hijack();
      reply.raw.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-store",
        connection: "keep-alive",
        ...(origin && deps.webOrigins.includes(origin) ? { "access-control-allow-origin": origin, vary: "Origin" } : {}),
      });
      const send = (e: object) => reply.raw.write(`data: ${JSON.stringify(e)}\n\n`);
      try {
        await deps.ada!.chat(id, String(req.body?.message ?? ""), send);
      } catch (err) {
        send({ type: "error", message: (err as Error).message });
      }
      reply.raw.end();
    });

    authed.post<{ Params: { card: string } }>("/office/ada/cards/:card/confirm", async (req, reply) => {
      const id = await officeOf(req);
      if (!id) return reply.code(404).send({ error: "no office yet" });
      if (needAda(reply)) return;
      try {
        const r = await deps.ada!.confirm(id, req.params.card);
        void deps.budgets?.check(id).catch(() => {});
        return r;
      } catch (err) {
        return userError(reply, err);
      }
    });

    authed.post<{ Params: { card: string } }>("/office/ada/cards/:card/dismiss", async (req, reply) => {
      const id = await officeOf(req);
      if (!id || !deps.ada) return reply.code(404).send({ error: "no office yet" });
      await deps.ada.dismiss(id, req.params.card);
      return { dismissed: true };
    });

    /** Today's briefing, now (it also arrives every morning). */
    authed.post("/office/ada/briefing", async (req, reply) => {
      const id = await officeOf(req);
      if (!id) return reply.code(404).send({ error: "no office yet" });
      if (needAda(reply)) return;
      return { briefing: await deps.ada!.briefing(id) };
    });

    /* ------------------------------------------------------------ meetings */

    authed.get("/office/meetings", async (req, reply) => {
      const id = await officeOf(req);
      if (!id || !deps.meetings) return reply.code(404).send({ error: "no office yet" });
      return { meetings: await deps.meetings.list(id) };
    });

    authed.post<{ Body: { title?: string; attendees?: string[]; agenda?: string[]; chair?: "ada" | "ceo"; preRead?: string } }>("/office/meetings", async (req, reply) => {
      const id = await officeOf(req);
      if (!id || !deps.meetings) return reply.code(404).send({ error: "no office yet" });
      const b = req.body ?? {};
      if (!b.title?.trim() || !b.attendees?.length) return reply.code(400).send({ error: "A meeting needs a title and attendees." });
      return { meeting: await deps.meetings.schedule(id, { title: b.title, attendees: b.attendees, agenda: b.agenda ?? [], chair: b.chair, preRead: b.preRead }) };
    });

    for (const action of ["start", "end"] as const) {
      authed.post<{ Params: { m: string } }>(`/office/meetings/:m/${action}`, async (req, reply) => {
        const id = await officeOf(req);
        if (!id || !deps.meetings) return reply.code(404).send({ error: "no office yet" });
        try {
          return action === "start" ? { meeting: await deps.meetings.start(id, req.params.m) } : await deps.meetings.end(id, req.params.m);
        } catch (err) {
          return userError(reply, err);
        }
      });
    }

    authed.get<{ Params: { m: string } }>("/office/meetings/:m/minutes", async (req, reply) => {
      const id = await officeOf(req);
      if (!id || !deps.meetings) return reply.code(404).send({ error: "no office yet" });
      return { minutes: await deps.meetings.minutes(id, req.params.m) };
    });

    /* -------------------------------------------------------------- memory */

    const memoryCall = (fn: (officeId: string, setup: any) => Promise<unknown>) => async (req: FastifyRequest, reply: any) => {
      const id = await officeOf(req);
      if (!id || !deps.memory || !deps.setup) return reply.code(404).send({ error: "no office yet" });
      try {
        return { result: await fn(id, (await deps.setup.get(id)).setup) };
      } catch (err) {
        return userError(reply, err);
      }
    };

    /** The CEO writes or edits anything the company remembers. */
    authed.post<{ Body: any }>("/office/memory", (req, reply) =>
      memoryCall((o, setup) =>
        deps.memory!.write(o, setup, "ceo", {
          layer: (req.body as any)?.layer,
          scopeId: (req.body as any)?.scopeId,
          type: String((req.body as any)?.type ?? "fact"),
          title: String((req.body as any)?.title ?? ""),
          body: String((req.body as any)?.body ?? ""),
          tags: (req.body as any)?.tags,
          rooms: (req.body as any)?.rooms,
          replaces: (req.body as any)?.replaces,
        }),
      )(req, reply),
    );
    authed.patch<{ Params: { id: string }; Body: any }>("/office/memory/:id", (req, reply) =>
      memoryCall((o, setup) => deps.memory!.edit(o, setup, "ceo", req.params.id, { title: (req.body as any)?.title, body: (req.body as any)?.body, tags: (req.body as any)?.tags }))(req, reply),
    );
    authed.post<{ Params: { id: string }; Body: any }>("/office/memory/:id/flag", (req, reply) =>
      memoryCall((o, setup) => deps.memory!.flag(o, setup, "ceo", req.params.id, String((req.body as any)?.reason ?? "")))(req, reply),
    );
    authed.post<{ Params: { id: string } }>("/office/memory/:id/accept", (req, reply) =>
      memoryCall((o, setup) => deps.memory!.accept(o, setup, "ceo", req.params.id))(req, reply),
    );
    authed.post<{ Params: { id: string }; Body: any }>("/office/memory/:id/reject", (req, reply) =>
      memoryCall((o, setup) => deps.memory!.reject(o, setup, "ceo", req.params.id, String((req.body as any)?.why ?? "")))(req, reply),
    );

    /* --------------------------------------------------------- permissions */

    /** The CEO answers an agent's permission ask (once; for a first use, from now on). */
    authed.post<{ Params: { inbox: string }; Body: { allow?: boolean; note?: string } }>("/office/permissions/:inbox", async (req, reply) => {
      const id = await officeOf(req);
      if (!id) return reply.code(404).send({ error: "no office yet" });
      try {
        return { result: await deps.hub.call(id, "ceo_answer_permission", { inbox_id: req.params.inbox, allow: !!req.body?.allow, note: req.body?.note }) };
      } catch (err) {
        return userError(reply, err);
      }
    });

    /** Runs an office call (the daemon's CEO tools) in the user's office. */
    authed.post<{ Body: { name?: unknown; args?: unknown } }>("/office/call", async (req, reply) => {
      const office = await deps.offices.officeOf(req.user.id);
      if (!office) return reply.code(404).send({ error: "no office yet" });
      if (typeof req.body?.name !== "string") return reply.code(400).send({ error: "name is required" });
      if (BLOCKED_CALLS.has(req.body.name)) return reply.code(400).send({ error: `${req.body.name} isn't available here; change the setup instead.` });
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
