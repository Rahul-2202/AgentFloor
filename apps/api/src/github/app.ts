import { createHmac, createPrivateKey, timingSafeEqual, type KeyObject } from "node:crypto";
import { SignJWT } from "jose";

export interface GitHubAppConfig {
  appId: string;
  slug: string;
  /** The app's private key (PEM). */
  privateKey: string;
  webhookSecret: string;
  apiUrl?: string;
}

export class GitHubError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface PullRequest {
  number: number;
  url: string;
  title: string;
  state: string;
  merged: boolean;
  mergeable: boolean | null;
  head: string;
  base: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  checks: { name: string; status: string; conclusion: string | null }[];
}

/**
 * The AgentFloor GitHub App. Agents never hold a long-lived key: each push or
 * PR uses an installation token limited to the office's repo, minted here
 * and valid for an hour at most.
 */
export class GitHubApp {
  readonly slug: string;
  private readonly appId: string;
  private readonly key: KeyObject;
  private readonly secret: string;
  private readonly api: string;
  private readonly tokens = new Map<string, { token: string; expires: number }>();

  constructor(c: GitHubAppConfig) {
    this.appId = c.appId;
    this.slug = c.slug;
    this.key = createPrivateKey(c.privateKey.replace(/\\n/g, "\n"));
    this.secret = c.webhookSecret;
    this.api = (c.apiUrl ?? "https://api.github.com").replace(/\/$/, "");
  }

  installUrl(): string {
    return `https://github.com/apps/${this.slug}/installations/new`;
  }

  /** Who installed it: a user or an organization. */
  async installation(id: string): Promise<{ account: string; type: "User" | "Organization" }> {
    const r = await this.call<{ account: { login: string; type: "User" | "Organization" } }>("GET", `/app/installations/${id}`, await this.appJwt());
    return { account: r.account.login, type: r.account.type };
  }

  /**
   * Whether a GitHub user is an active member of an organization (asked with the
   * org's installation; needs the app's "Members: read" permission).
   */
  async orgMember(installationId: string, org: string, login: string): Promise<"member" | "not_member" | "unknown"> {
    const t = await this.installationToken(installationId);
    const res = await fetch(`${this.api}/orgs/${encodeURIComponent(org)}/memberships/${encodeURIComponent(login)}`, {
      headers: { accept: "application/vnd.github+json", authorization: `Bearer ${t}`, "x-github-api-version": "2022-11-28" },
    });
    if (res.status === 200) return ((await res.json()) as { state?: string }).state === "active" ? "member" : "not_member";
    if (res.status === 404) return "not_member";
    return "unknown"; // 403: the app can't read the org's members (permission not granted yet)
  }

  /** The app's installations (who has it installed). */
  async installations(): Promise<{ id: string; account: string; type: "User" | "Organization" }[]> {
    const r = await this.call<{ id: number; account: { login: string; type: "User" | "Organization" } }[]>("GET", "/app/installations?per_page=100", await this.appJwt());
    return r.map((i) => ({ id: String(i.id), account: i.account.login, type: i.account.type }));
  }

  /** A token for one repo of an installation: contents and pull requests, read and write. */
  async token(installationId: string, repo: string): Promise<string> {
    const key = `${installationId}:${repo}`;
    const cached = this.tokens.get(key);
    if (cached && cached.expires - Date.now() > 5 * 60_000) return cached.token;
    const r = await this.call<{ token: string; expires_at: string }>("POST", `/app/installations/${installationId}/access_tokens`, await this.appJwt(), {
      repositories: [repo.split("/")[1]],
      permissions: { contents: "write", pull_requests: "write", metadata: "read", checks: "read" },
    });
    this.tokens.set(key, { token: r.token, expires: Date.parse(r.expires_at) });
    return r.token;
  }

  async repos(installationId: string): Promise<{ fullName: string; defaultBranch: string; private: boolean }[]> {
    const t = await this.installationToken(installationId);
    const r = await this.call<{ repositories: { full_name: string; default_branch: string; private: boolean }[] }>("GET", "/installation/repositories?per_page=100", t);
    return r.repositories.map((x) => ({ fullName: x.full_name, defaultBranch: x.default_branch, private: x.private }));
  }

  async openPr(installationId: string, repo: string, p: { head: string; base: string; title: string; body: string; draft?: boolean }): Promise<{ number: number; url: string }> {
    const t = await this.token(installationId, repo);
    try {
      const r = await this.call<{ number: number; html_url: string }>("POST", `/repos/${repo}/pulls`, t, { ...p, draft: p.draft ?? false });
      return { number: r.number, url: r.html_url };
    } catch (err) {
      // One PR per branch: if it's already open, hand that one back.
      if (err instanceof GitHubError && err.status === 422 && /already exists/i.test(err.message)) {
        const owner = repo.split("/")[0];
        const open = await this.call<{ number: number; html_url: string }[]>("GET", `/repos/${repo}/pulls?head=${owner}:${encodeURIComponent(p.head)}&state=open`, t);
        if (open[0]) return { number: open[0].number, url: open[0].html_url };
      }
      throw err;
    }
  }

  async pullRequest(installationId: string, repo: string, n: number): Promise<PullRequest> {
    const t = await this.token(installationId, repo);
    const pr = await this.call<any>("GET", `/repos/${repo}/pulls/${n}`, t);
    const checks = await this.call<{ check_runs: { name: string; status: string; conclusion: string | null }[] }>("GET", `/repos/${repo}/commits/${pr.head.sha}/check-runs`, t).catch(
      () => ({ check_runs: [] }),
    );
    return {
      number: pr.number,
      url: pr.html_url,
      title: pr.title,
      state: pr.state,
      merged: pr.merged,
      mergeable: pr.mergeable,
      head: pr.head.ref,
      base: pr.base.ref,
      additions: pr.additions,
      deletions: pr.deletions,
      changedFiles: pr.changed_files,
      checks: checks.check_runs.map((c) => ({ name: c.name, status: c.status, conclusion: c.conclusion })),
    };
  }

  async merge(installationId: string, repo: string, n: number): Promise<{ sha: string }> {
    const t = await this.token(installationId, repo);
    const r = await this.call<{ sha: string }>("PUT", `/repos/${repo}/pulls/${n}/merge`, t, { merge_method: "squash" });
    return { sha: r.sha };
  }

  async comment(installationId: string, repo: string, n: number, body: string): Promise<void> {
    await this.call("POST", `/repos/${repo}/issues/${n}/comments`, await this.token(installationId, repo), { body });
  }

  /** Checks a webhook's X-Hub-Signature-256 against the raw body. */
  verifyWebhook(raw: Buffer, signature: string | undefined): boolean {
    if (!signature?.startsWith("sha256=")) return false;
    const want = Buffer.from(`sha256=${createHmac("sha256", this.secret).update(raw).digest("hex")}`);
    const got = Buffer.from(signature);
    return want.length === got.length && timingSafeEqual(want, got);
  }

  private async installationToken(installationId: string): Promise<string> {
    const key = `${installationId}:*`;
    const cached = this.tokens.get(key);
    if (cached && cached.expires - Date.now() > 5 * 60_000) return cached.token;
    const r = await this.call<{ token: string; expires_at: string }>("POST", `/app/installations/${installationId}/access_tokens`, await this.appJwt(), {
      permissions: { metadata: "read" },
    });
    this.tokens.set(key, { token: r.token, expires: Date.parse(r.expires_at) });
    return r.token;
  }

  private appJwt(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({}).setProtectedHeader({ alg: "RS256" }).setIssuedAt(now - 60).setExpirationTime(now + 540).setIssuer(this.appId).sign(this.key);
  }

  private async call<T>(method: string, path: string, token: string, body?: object): Promise<T> {
    const res = await fetch(`${this.api}${path}`, {
      method,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "x-github-api-version": "2022-11-28",
        "user-agent": "AgentFloor",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) {
      let message = text;
      try {
        const j = JSON.parse(text);
        message = [j.message, ...(j.errors ?? []).map((e: any) => e.message ?? e.code)].filter(Boolean).join(": ");
      } catch {}
      throw new GitHubError(res.status, `GitHub ${method} ${path.split("?")[0]}: ${res.status} ${message}`);
    }
    return (text ? JSON.parse(text) : {}) as T;
  }
}
