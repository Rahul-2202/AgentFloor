import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { OfficeRepo } from "../src/daemon/repo.ts";

const ENV = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, ...ENV } }).trim();

test("an empty repo gets its first commit, and work done in a stand-alone folder moves onto a branch", async () => {
  const dir = mkdtempSync(join(tmpdir(), "agentfloor-repo-"));
  // An empty "GitHub" repo.
  const bare = join(dir, "web.git");
  git(dir, "init", "--quiet", "--bare", "-b", "main", bare);
  // What AgentFloor does for an empty repo: a README on main.
  let started = 0;
  const startEmpty = async () => {
    started++;
    const seed = join(dir, "seed");
    git(dir, "clone", "--quiet", bare, seed);
    writeFileSync(join(seed, "README.md"), "# web\n");
    git(seed, "add", ".");
    git(seed, "commit", "--quiet", "-m", "Start the repo (AgentFloor)");
    git(seed, "push", "--quiet", "origin", "HEAD:main");
  };
  const data = join(dir, "office");
  const lines: string[] = [];
  const repo = new OfficeRepo({ dataDir: data, root: dir, env: ENV, startEmpty, log: (l) => lines.push(l) });

  // Before the fix, the agent's runtime made its own repo here and committed into it.
  const wt = repo.worktreeOf("pm");
  mkdirSync(wt, { recursive: true });
  git(wt, "init", "--quiet", "-b", "af/pm/prd");
  writeFileSync(join(wt, "PRD.md"), "# PRD\n");
  git(wt, "add", ".");
  git(wt, "commit", "--quiet", "-m", "PRD draft");
  writeFileSync(join(wt, "DESIGN.md"), "# Design\n"); // committed
  git(wt, "add", ".");
  git(wt, "commit", "--quiet", "-m", "Design notes");
  writeFileSync(join(wt, "NOTES.md"), "not committed yet\n");

  await repo.ensure({ fullName: "acme/web", defaultBranch: "main", cloneUrl: bare });
  assert.equal(started, 1, "AgentFloor was asked for a first commit");
  await repo.ensureWorktree("pm");

  // Now a real worktree of the repo, on the agent's branch, with its work on top of main.
  assert.ok(!readFileSync(join(wt, ".git"), "utf8").includes("[core]"), "a worktree (its .git is a file)");
  assert.equal(git(wt, "rev-parse", "--abbrev-ref", "HEAD"), "af/pm/prd");
  assert.deepEqual(git(wt, "log", "--format=%s").split("\n"), ["Work in progress (saved by AgentFloor)", "Design notes", "PRD draft", "Start the repo (AgentFloor)"]);
  assert.ok(existsSync(join(wt, "README.md")) && existsSync(join(wt, "PRD.md")) && existsSync(join(wt, "NOTES.md")));
  assert.match(git(wt, "remote", "get-url", "origin"), /web\.git$/, "it has the remote now");
  assert.ok(lines.some((l) => /moved its earlier work onto af\/pm\/prd/.test(l)));

  // Pushing works from here.
  assert.equal(await repo.push("pm"), "af/pm/prd");
  assert.equal(git(bare, "log", "--format=%s", "-1", "af/pm/prd"), "Work in progress (saved by AgentFloor)");
  // Nothing stray is left behind.
  assert.deepEqual(execFileSync("ls", [join(data, "agents", "pm")], { encoding: "utf8" }).trim().split("\n"), ["repo"]);
});
