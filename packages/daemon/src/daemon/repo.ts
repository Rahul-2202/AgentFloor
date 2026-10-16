import { execFile } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import type { RepoRef } from "../core/types.ts";

const run = promisify(execFile);

/**
 * The office's GitHub repo: one clone, and a worktree per agent on its own
 * branch, so agents never step on each other's files. Git asks the office for
 * credentials (bin/office git-credential), and the office asks the Control
 * API, which mints a short-lived token for this repo only.
 */
export class OfficeRepo {
  readonly path: string;
  private readonly dataDir: string;
  private readonly root: string;
  /** Environment for git commands the daemon runs itself (identity for the credential helper). */
  private readonly env: Record<string, string>;
  private current: RepoRef | null = null;

  constructor(o: { dataDir: string; root: string; env: Record<string, string> }) {
    this.dataDir = o.dataDir;
    this.root = o.root;
    this.env = o.env;
    this.path = join(o.dataDir, "repo");
  }

  get repo(): RepoRef | null {
    return this.current;
  }

  /** Clones the repo (or points the clone at it and fetches). */
  async ensure(repo: RepoRef): Promise<void> {
    const helper = `!${join(this.root, "bin/office")} git-credential`;
    if (!existsSync(join(this.path, ".git"))) {
      mkdirSync(this.dataDir, { recursive: true });
      await this.git(this.dataDir, ["-c", `credential.helper=${helper}`, "clone", "--quiet", repo.cloneUrl, this.path]);
    } else {
      await this.git(this.path, ["remote", "set-url", "origin", repo.cloneUrl]);
      await this.git(this.path, ["-c", `credential.helper=${helper}`, "fetch", "--quiet", "--prune", "origin"]);
    }
    // Shared by every worktree: credentials from the office, and the office's own files never committed.
    await this.git(this.path, ["config", "credential.helper", helper]);
    await this.git(this.path, ["config", "push.autoSetupRemote", "true"]);
    const exclude = join(this.path, ".git/info/exclude");
    if (!existsSync(exclude) || !readFileSync(exclude, "utf8").includes(".agentfloor/")) appendFileSync(exclude, "\n.agentfloor/\n");
    this.current = repo;
  }

  worktreeOf(agent: string): string {
    return join(this.dataDir, "agents", agent, "repo");
  }

  /** The agent's worktree, on its branch af/<agent>/start, made from the default branch the first time. */
  async ensureWorktree(agent: string): Promise<string> {
    const wt = this.worktreeOf(agent);
    if (existsSync(join(wt, ".git"))) return wt;
    if (!this.current) throw new Error("no repo connected");
    mkdirSync(join(this.dataDir, "agents", agent), { recursive: true });
    await this.git(this.path, ["worktree", "prune"]);
    await this.git(this.path, ["worktree", "add", "--quiet", "-B", `af/${agent}/start`, wt, `origin/${this.current.defaultBranch}`]);
    return wt;
  }

  /** Pushes the agent's current branch; returns its name. */
  async push(agent: string): Promise<string> {
    const wt = this.worktreeOf(agent);
    const branch = (await this.git(wt, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
    if (branch === "HEAD") throw new Error("You're not on a branch. Create one: git checkout -b af/<you>/<task>.");
    const ahead = (await this.git(wt, ["rev-list", "--count", `origin/${this.current!.defaultBranch}..HEAD`])).trim();
    if (ahead === "0") throw new Error(`Branch ${branch} has no commits beyond ${this.current!.defaultBranch}. Commit your work first.`);
    await this.git(wt, ["push", "--quiet", "-u", "origin", `HEAD:refs/heads/${branch}`]);
    return branch;
  }

  private async git(cwd: string, args: string[]): Promise<string> {
    try {
      const { stdout } = await run("git", args, { cwd, env: { ...process.env, ...this.env, GIT_TERMINAL_PROMPT: "0" }, maxBuffer: 16 * 1024 * 1024 });
      return stdout;
    } catch (err) {
      const e = err as { stderr?: string; message: string };
      throw new Error(`git ${args.find((a) => !a.startsWith("-") && !a.includes("=")) ?? ""}: ${(e.stderr || e.message).trim().split("\n").slice(-3).join(" ")}`);
    }
  }
}
