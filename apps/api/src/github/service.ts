import type { RepoRef } from "@agentfloor/shared/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { User } from "../auth.ts";
import type { OfficeHub } from "../link/hub.ts";
import type { GitHubApp } from "./app.ts";

export interface GitHubLink {
  installationId: string;
  account: string;
  repo: string | null;
  defaultBranch: string | null;
}

export interface GitHubStore {
  get(officeId: string): Promise<GitHubLink | null>;
  save(officeId: string, link: GitHubLink): Promise<void>;
}

export class GitHubUserError extends Error {}

/**
 * An office's GitHub: the installation it's connected through, the repo its
 * agents work on, and what the office asks of GitHub (tokens, PRs, merges).
 */
export class GitHubService {
  readonly app: GitHubApp;
  private readonly store: GitHubStore;
  private readonly hub: OfficeHub;
  private readonly cloneUrlOf: (fullName: string) => string;

  constructor(o: { app: GitHubApp; store: GitHubStore; hub: OfficeHub; cloneUrlOf?: (fullName: string) => string }) {
    this.app = o.app;
    this.store = o.store;
    this.hub = o.hub;
    this.cloneUrlOf = o.cloneUrlOf ?? ((n) => `https://github.com/${n}.git`);
  }

  async status(officeId: string, user?: User) {
    const link = await this.store.get(officeId);
    // Already installed on the CEO's own account (say, for an earlier office): GitHub won't send
    // them back after "installing" again, so offer to connect the existing installation directly.
    const existing = !link && user ? await this.ownInstallation(user).catch(() => null) : null;
    return { installUrl: this.app.installUrl(), link, existing };
  }

  /** The app's installation on the user's own GitHub account, if there is one. */
  private async ownInstallation(user: User): Promise<{ installationId: string; account: string } | null> {
    if (!user.githubLogin) return null;
    const mine = (await this.app.installations()).find((i) => i.type === "User" && i.account.toLowerCase() === user.githubLogin!.toLowerCase());
    return mine ? { installationId: mine.id, account: mine.account } : null;
  }

  /** After the CEO installs the app (GitHub sends them back with installation_id). */
  async connect(officeId: string, user: User, installationId: string): Promise<GitHubLink> {
    if (!/^\d+$/.test(installationId)) throw new GitHubUserError("That isn't a GitHub installation id.");
    const inst = await this.app.installation(installationId);
    // Someone else's installation can't be claimed: a personal one must be the CEO's own account.
    if (inst.type === "User" && inst.account.toLowerCase() !== (user.githubLogin ?? "").toLowerCase()) {
      throw new GitHubUserError(`That installation belongs to ${inst.account}, not you.`);
    }
    // An organization's: only its members (GitHub says whether this user is one).
    if (inst.type === "Organization") {
      if (!user.githubLogin) throw new GitHubUserError("Sign in with GitHub to connect an organization.");
      const member = await this.app.orgMember(installationId, inst.account, user.githubLogin);
      if (member === "not_member") throw new GitHubUserError(`You're not a member of ${inst.account} on GitHub.`);
      if (member === "unknown") {
        throw new GitHubUserError(`AgentFloor can't check who's in ${inst.account} yet: an owner of ${inst.account} needs to accept the app's "Members: read" permission on GitHub.`);
      }
    }
    const prev = await this.store.get(officeId);
    const link: GitHubLink = { installationId, account: inst.account, repo: prev?.installationId === installationId ? prev.repo : null, defaultBranch: prev?.defaultBranch ?? null };
    await this.store.save(officeId, link);
    return link;
  }

  async repos(officeId: string) {
    const link = await this.need(officeId);
    return this.app.repos(link.installationId);
  }

  /** The repo the office's agents work on. The office clones it and gives each agent a worktree. */
  async chooseRepo(officeId: string, fullName: string): Promise<GitHubLink> {
    const link = await this.need(officeId);
    const repo = (await this.app.repos(link.installationId)).find((r) => r.fullName === fullName);
    if (!repo) throw new GitHubUserError(`AgentFloor can't see ${fullName}. Add it to the app's installation on GitHub first.`);
    const next = { ...link, repo: repo.fullName, defaultBranch: repo.defaultBranch };
    await this.store.save(officeId, next);
    return next;
  }

  /** The repo, as the office daemon gets it in its setup. */
  async repoRef(officeId: string): Promise<RepoRef | null> {
    const link = await this.store.get(officeId);
    return link?.repo && link.defaultBranch ? { fullName: link.repo, defaultBranch: link.defaultBranch, cloneUrl: this.cloneUrlOf(link.repo) } : null;
  }

  /** What the office asks over the link. */
  async handle(officeId: string, name: string, args: any): Promise<unknown> {
    const link = await this.need(officeId);
    if (!link.repo) throw new GitHubUserError("No repo is connected.");
    if (name === "git_token") return { username: "x-access-token", password: await this.app.token(link.installationId, link.repo) };
    if (name === "open_pr") {
      return this.app.openPr(link.installationId, link.repo, { head: String(args.head), base: String(args.base ?? link.defaultBranch), title: String(args.title), body: String(args.body ?? ""), draft: !!args.draft });
    }
    throw new GitHubUserError(`Unknown request "${name}".`);
  }

  async pullRequest(officeId: string, n: number) {
    const link = await this.needRepo(officeId);
    return this.app.pullRequest(link.installationId, link.repo!, n);
  }

  /** The CEO approves: merge, close the approval, tell whoever asked. */
  async merge(officeId: string, n: number, inbox?: { id: string; from: string }) {
    const link = await this.needRepo(officeId);
    const { sha } = await this.app.merge(link.installationId, link.repo!, n);
    if (this.hub.isConnected(officeId)) {
      if (inbox) await this.hub.call(officeId, "resolve_inbox", { id: inbox.id }).catch(() => {});
      if (inbox?.from) await this.hub.call(officeId, "ceo_message", { to: inbox.from, text: `I merged PR #${n} (${sha.slice(0, 7)}). Thanks. Pull ${link.defaultBranch} before your next task.` }).catch(() => {});
    }
    return { merged: true, sha };
  }

  /** The CEO asks for changes: the comment goes on the PR and back to the agent as work. */
  async requestChanges(officeId: string, n: number, comment: string, inbox?: { id: string; from: string }) {
    const link = await this.needRepo(officeId);
    await this.app.comment(link.installationId, link.repo!, n, `**Changes requested by the CEO (AgentFloor):**\n\n${comment}`);
    if (this.hub.isConnected(officeId)) {
      if (inbox) await this.hub.call(officeId, "resolve_inbox", { id: inbox.id }).catch(() => {});
      if (inbox?.from) await this.hub.call(officeId, "ceo_message", { to: inbox.from, text: `Changes needed on PR #${n} before I merge:\n${comment}`, urgency: "urgent" }).catch(() => {});
    }
    return { requested: true };
  }

  private async need(officeId: string): Promise<GitHubLink> {
    const link = await this.store.get(officeId);
    if (!link) throw new GitHubUserError("GitHub isn't connected yet.");
    return link;
  }

  private async needRepo(officeId: string): Promise<GitHubLink> {
    const link = await this.need(officeId);
    if (!link.repo) throw new GitHubUserError("No repo is connected.");
    return link;
  }
}

export function supabaseGitHubStore(db: SupabaseClient): GitHubStore {
  return {
    async get(officeId) {
      const { data, error } = await db.from("integrations").select("external_id, config, status").eq("office_id", officeId).eq("provider", "github").maybeSingle();
      if (error) throw new Error(`reading GitHub link: ${error.message}`);
      if (!data || data.status !== "connected") return null;
      const c = (data.config ?? {}) as { account?: string; repo?: string; defaultBranch?: string };
      return { installationId: data.external_id, account: c.account ?? "", repo: c.repo ?? null, defaultBranch: c.defaultBranch ?? null };
    },
    async save(officeId, link) {
      const { error } = await db.from("integrations").upsert(
        {
          office_id: officeId,
          provider: "github",
          external_id: link.installationId,
          config: { account: link.account, repo: link.repo, defaultBranch: link.defaultBranch },
          status: "connected",
        },
        { onConflict: "office_id,provider" },
      );
      if (error) throw new Error(`saving GitHub link: ${error.message}`);
    },
  };
}

export function memoryGitHubStore(): GitHubStore & { rows: Map<string, GitHubLink> } {
  const rows = new Map<string, GitHubLink>();
  return {
    rows,
    async get(id) {
      return rows.get(id) ?? null;
    },
    async save(id, link) {
      rows.set(id, { ...link });
    },
  };
}
