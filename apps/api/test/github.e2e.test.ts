// GitHub end to end: a real Control API and a real office daemon, a fake
// GitHub API, and a local bare repo standing in for the GitHub one.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHmac, generateKeyPairSync, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { checkConfig, DEFAULT_POLICY } from "@agentfloor/daemon/config";
import { startDaemon } from "@agentfloor/daemon/daemon";
import { LINK_PATH, newOfficeToken } from "@agentfloor/shared/link";
import { buildApp } from "../src/app.ts";
import type { User } from "../src/auth.ts";
import { GitHubApp } from "../src/github/app.ts";
import { memoryGitHubStore } from "../src/github/service.ts";
import { memoryLinkStore } from "../src/link/store.ts";
import type { OfficeStore } from "../src/offices.ts";
import { memoryProjectionStore } from "../src/projection/writer.ts";
import { createServices } from "../src/services.ts";
import { memorySetupStore } from "../src/setup/store.ts";

const OFFICE = randomUUID();
const USER: User = { id: "u1", email: null, githubLogin: "ceo-login", name: "CEO" };
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).trim();

async function until(what: string, ok: () => boolean | Promise<boolean>, ms = 8000) {
  const end = Date.now() + ms;
  while (!(await ok())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** A bare "GitHub" repo with one commit on main. */
function bareRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "agentfloor-gh-"));
  const bare = join(dir, "web.git");
  git(dir, "init", "--quiet", "--bare", "-b", "main", bare);
  const seed = join(dir, "seed");
  git(dir, "clone", "--quiet", bare, seed);
  writeFileSync(join(seed, "README.md"), "# Acme web\n");
  git(seed, "add", ".");
  git(seed, "commit", "--quiet", "-m", "first");
  git(seed, "push", "--quiet", "origin", "HEAD:main");
  return bare;
}

/** Just enough of GitHub's REST API, recording what was asked. */
async function fakeGitHub() {
  const calls: { method: string; path: string; body: any; auth: string }[] = [];
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    const body = raw ? JSON.parse(raw) : null;
    const path = req.url!.split("?")[0]!;
    calls.push({ method: req.method!, path, body, auth: String(req.headers.authorization) });
    const json = (status: number, o: object) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(o));
    };
    if (path === "/app/installations/42") return json(200, { account: { login: "ceo-login", type: "User" } });
    if (path === "/app/installations/99") return json(200, { account: { login: "someone-else", type: "User" } });
    if (path.endsWith("/access_tokens")) return json(201, { token: `ghs_${body?.repositories?.[0] ?? "meta"}`, expires_at: new Date(Date.now() + 3600_000).toISOString() });
    if (path === "/installation/repositories") return json(200, { repositories: [{ full_name: "acme/web", default_branch: "main", private: true }] });
    if (req.method === "POST" && path === "/repos/acme/web/pulls") return json(201, { number: 7, html_url: "https://github.com/acme/web/pull/7" });
    if (req.method === "PUT" && path === "/repos/acme/web/pulls/7/merge") return json(200, { sha: "abc1234def", merged: true });
    if (req.method === "POST" && path === "/repos/acme/web/issues/7/comments") return json(201, { id: 1 });
    json(404, { message: "Not Found" });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, calls, close: () => new Promise((ok) => server.close(ok)) };
}

test("connect GitHub, pick a repo, agents work in worktrees, open a PR, the CEO merges", async (t) => {
  const bare = bareRepo();
  const gh = await fakeGitHub();
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs1", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
  const app = new GitHubApp({ appId: "123", slug: "agentfloor-test", privateKey, webhookSecret: "whsec", apiUrl: gh.url });

  const link = memoryLinkStore();
  const { token, hash } = newOfficeToken(OFFICE);
  await link.setTokenHash(OFFICE, hash);
  const proj = memoryProjectionStore(() => link.events.get(OFFICE) ?? []);
  const offices: OfficeStore = {
    officeOf: async () => ({ id: OFFICE, name: "Acme", onboardedAt: null, sandboxState: "started", daemonConnected: true }),
    ensureOffice: async () => ({ office: (await offices.officeOf("u1"))!, created: false }),
  };
  const s = createServices({
    verify: async () => USER,
    stores: {
      offices,
      link,
      setups: memorySetupStore(),
      projections: proj.store,
      budgets: { spendSince: async () => [], held: async () => new Map(), alert: async () => {} },
      machines: { get: async () => ({ sandboxId: null, state: "none" }), set: async () => {} },
      github: memoryGitHubStore(),
    },
    machine: null,
    github: { app, cloneUrlOf: () => bare },
  });
  const audits: string[] = [];
  const api = await buildApp({
    verify: async () => USER,
    offices,
    hub: s.hub,
    setup: s.setup,
    github: s.github,
    inboxItem: async (_o, id) => {
      const row = proj.tables.inbox.get(id);
      return row ? { id, from: row.from, kind: row.kind } : null;
    },
    audit: async (_o, actor, action) => void audits.push(`${actor}:${action}`),
    officeForRepo: async (n) => (n === "acme/web" ? OFFICE : null),
    webOrigins: [],
  });
  await api.listen({ port: 0, host: "127.0.0.1" });
  const port = (api.server.address() as AddressInfo).port;
  const dataDir = mkdtempSync(join(tmpdir(), "agentfloor-ghoffice-"));
  const daemon = await startDaemon({
    config: checkConfig({ name: "L", policy: { ...DEFAULT_POLICY }, rooms: [{ id: "x", name: "X", head: "solo" }], agents: [{ id: "solo", name: "Solo", room: "x", role: "head", runtime: "external", title: "" }] }),
    dataDir,
    startAgents: false,
    log: () => {},
    link: { url: `ws://127.0.0.1:${port}${LINK_PATH}`, token },
  });
  t.after(async () => {
    await daemon.close();
    await api.close();
    await gh.close();
  });
  const call = (method: "GET" | "POST", url: string, payload?: object) => api.inject({ method, url, payload, headers: { authorization: "Bearer x" } });
  await until("setup", () => daemon.office.config.agents.some((a) => a.id === "pm"));

  // Someone else's installation can't be claimed; the CEO's own can.
  assert.equal((await call("POST", "/office/github/connect", { installationId: "99" })).statusCode, 400);
  const connected = await call("POST", "/office/github/connect", { installationId: "42" });
  assert.equal(connected.statusCode, 200, connected.body);
  assert.deepEqual((await call("GET", "/office/github/repos")).json().repos.map((r: any) => r.fullName), ["acme/web"]);
  assert.equal((await call("POST", "/office/github/repo", { repo: "acme/other" })).statusCode, 400);
  const chosen = await call("POST", "/office/github/repo", { repo: "acme/web" });
  assert.equal(chosen.statusCode, 200, chosen.body);

  // The office clones the repo and gives every agent its own worktree and branch.
  const wt = join(dataDir, "agents", "backend", "repo");
  await until("worktrees", () => existsSync(join(wt, "README.md")) && existsSync(join(dataDir, "agents", "pm", "repo", "README.md")));
  assert.equal(git(wt, "rev-parse", "--abbrev-ref", "HEAD"), "af/backend/start");
  assert.equal(daemon.office.config.repo?.fullName, "acme/web");

  // Git credentials come from the API: a token for this repo only.
  assert.deepEqual(await daemon.office.gitToken(), { username: "x-access-token", password: "ghs_web" });

  // Backend does the work on a task branch and opens a PR.
  const { taskId } = daemon.office.requestWork("ceo", { to: "pm", title: "Slots API" });
  const sub = daemon.office.createTask("pm", { owner: "backend", title: "GET /slots", parentId: taskId });
  await assert.rejects(daemon.office.openPr("backend", { title: "Nothing yet" }), /no commits beyond main/);
  git(wt, "checkout", "--quiet", "-b", `af/backend/${sub.taskId}`);
  writeFileSync(join(wt, "slots.ts"), "export const slots = [];\n");
  git(wt, "add", ".");
  git(wt, "commit", "--quiet", "-m", "Slots endpoint");
  assert.equal(git(wt, "status", "--porcelain"), "", ".agentfloor/ is never committed");
  const pr = await daemon.office.openPr("backend", { title: "GET /slots", body: "Adds the endpoint.", taskId: sub.taskId });
  assert.deepEqual([pr.number, pr.url, pr.branch], [7, "https://github.com/acme/web/pull/7", `af/backend/${sub.taskId}`]);
  assert.ok(git(bare, "branch", "--list", `af/backend/${sub.taskId}`), "branch pushed");
  const opened = gh.calls.find((c) => c.method === "POST" && c.path === "/repos/acme/web/pulls")!;
  assert.deepEqual([opened.body.head, opened.body.base, opened.body.title], [`af/backend/${sub.taskId}`, "main", "GET /slots"]);
  assert.match(opened.body.body, /Office task K-2: GET \/slots[\s\S]*Opened by Backend/);
  assert.equal(opened.auth, "Bearer ghs_web");
  assert.equal(daemon.office.store.getTask(sub.taskId)!.outputs![0]!.url, "https://github.com/acme/web/pull/7");

  // Only heads ask for merges, and only the CEO merges.
  assert.throws(() => daemon.office.requestMerge("backend", { pr: 7, summary: "ready" }), /Merges go through your head/);
  const { inboxId } = daemon.office.requestMerge("pm", { pr: 7, summary: "Slots API is ready; tests pass." });
  await until("the approval in the inbox", () => proj.tables.inbox.get(inboxId)?.kind === "approval");
  const merged = await call("POST", "/office/prs/7/merge", { inboxId });
  assert.equal(merged.statusCode, 200, merged.body);
  assert.equal(merged.json().sha, "abc1234def");
  await until("the approval closed", () => daemon.office.store.getInbox(inboxId)?.state === "resolved");
  assert.ok(daemon.office.store.queuedFor("pm").some((m) => m.body.includes("I merged PR #7")), "the head hears about it");
  assert.ok(audits.includes("ceo:pr.merged"));

  // Webhooks are checked against the secret.
  const payload = JSON.stringify({ action: "closed", repository: { full_name: "acme/web" }, pull_request: { number: 7, merged: true, title: "GET /slots" }, sender: { login: "x" } });
  const sig = `sha256=${createHmac("sha256", "whsec").update(payload).digest("hex")}`;
  const hook = (signature: string) => api.inject({ method: "POST", url: "/github/webhook", payload, headers: { "content-type": "application/json", "x-github-event": "pull_request", "x-hub-signature-256": signature } });
  assert.equal((await hook("sha256=bad")).statusCode, 401);
  assert.equal((await hook(sig)).statusCode, 202);
  assert.ok(audits.includes("github:pr.closed.merged"));
});
