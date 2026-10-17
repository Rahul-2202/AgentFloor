import { execFile } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
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

  /** Asks AgentFloor to give an empty repo its first commit (the office can't write to the default branch itself). */
  private readonly startEmpty?: () => Promise<void>;
  private readonly log: (line: string) => void;

  constructor(o: { dataDir: string; root: string; env: Record<string, string>; startEmpty?: () => Promise<void>; log?: (line: string) => void }) {
    this.dataDir = o.dataDir;
    this.root = o.root;
    this.env = o.env;
    this.startEmpty = o.startEmpty;
    this.log = o.log ?? (() => {});
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
    // A brand-new repo has no default branch to start from: AgentFloor gives it a first commit.
    if (!(await this.has(`origin/${repo.defaultBranch}`))) {
      if (this.startEmpty) {
        await this.startEmpty();
        await this.git(this.path, ["fetch", "--quiet", "--prune", "origin"]);
      }
      if (!(await this.has(`origin/${repo.defaultBranch}`))) throw new Error(`${repo.fullName} has no ${repo.defaultBranch} branch yet: it needs a first commit.`);
    }
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
    const dotGit = join(wt, ".git");
    // A worktree's .git is a file; a folder means a stand-alone repo (no remote, no credentials).
    if (existsSync(dotGit) && !statSync(dotGit).isDirectory()) return wt;
    if (!this.current) throw new Error("no repo connected");
    let stray: string | null = null;
    if (existsSync(wt)) {
      stray = `${wt}.local-${Date.now()}`;
      renameSync(wt, stray);
    }
    mkdirSync(join(this.dataDir, "agents", agent), { recursive: true });
    await this.git(this.path, ["worktree", "prune"]);
    await this.git(this.path, ["worktree", "add", "--quiet", "-B", `af/${agent}/start`, wt, `origin/${this.current.defaultBranch}`]);
    if (stray) await this.recover(agent, wt, stray);
    return wt;
  }

  /**
   * Work an agent did in a stand-alone folder (before the repo was ready) moves
   * onto a branch of the real repo: its commits are replayed on the default
   * branch, uncommitted changes committed first. Anything that can't be moved
   * cleanly stays in the old folder, beside the worktree.
   */
  private async recover(agent: string, wt: string, stray: string) {
    if (!existsSync(join(stray, ".git"))) {
      rmSync(stray, { recursive: true, force: true });
      return;
    }
    try {
      if ((await this.git(stray, ["status", "--porcelain"])).trim()) {
        await this.git(stray, ["add", "-A"]);
        await this.git(stray, ["-c", "user.name=AgentFloor", "-c", "user.email=office@agentfloor.dev", "commit", "--quiet", "-m", "Work in progress (saved by AgentFloor)"]);
      }
      const head = (await this.git(stray, ["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => "")).trim();
      if (!head || !(await this.git(stray, ["rev-list", "--count", "HEAD"]).catch(() => "0")).trim().match(/^[1-9]/)) {
        rmSync(stray, { recursive: true, force: true }); // nothing was committed there
        return;
      }
      const branch = head.startsWith("af/") ? head : `af/${agent}/recovered`;
      await this.git(wt, ["fetch", "--quiet", stray, `HEAD:refs/heads/${branch}-local`]);
      await this.git(wt, ["checkout", "--quiet", "-B", branch, `${branch}-local`]);
      await this.git(wt, ["rebase", "--quiet", "--root", "--onto", `af/${agent}/start`]);
      await this.git(wt, ["branch", "-D", `${branch}-local`]);
      rmSync(stray, { recursive: true, force: true });
      this.log(`[repo] ${agent}: moved its earlier work onto ${branch}`);
    } catch (err) {
      await this.git(wt, ["rebase", "--abort"]).catch(() => {});
      await this.git(wt, ["checkout", "--quiet", `af/${agent}/start`]).catch(() => {});
      this.log(`[repo] ${agent}: couldn't move its earlier work (kept in ${stray}): ${(err as Error).message}`);
    }
  }

  private async has(ref: string): Promise<boolean> {
    return this.git(this.path, ["rev-parse", "--verify", "--quiet", ref]).then(
      () => true,
      () => false,
    );
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
