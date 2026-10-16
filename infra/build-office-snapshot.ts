/**
 * Builds the office VM snapshot (AGE-44): a Linux VM with Node 24, git,
 * Claude Code and the office daemon, ready for the Control API to start
 * offices from. VM snapshots can't come from a Dockerfile, so this boots a
 * VM, installs everything, stops it and snapshots its disk.
 *
 *   npm run snapshot -w @agentfloor/infra             build agentfloor-office-<version>
 *   npm run snapshot -w @agentfloor/infra -- --secret  also create/update the Claude secret
 *
 * Costs Daytona credit while it runs (one medium VM for ~10 minutes); the
 * build VM is deleted at the end, even on failure. Set OFFICE_SNAPSHOT on the
 * api service to the name it prints.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { Daytona, type Sandbox } from "@daytona/sdk";
import { loadEnv } from "@agentfloor/shared/env";

loadEnv();
const { values } = parseArgs({ options: { secret: { type: "boolean", default: false }, keep: { type: "boolean", default: false } } });

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const NODE = "24.11.1";
const CLAUDE_SECRET = "agentfloor-claude-token";
const BASE = "daytona-vm-medium"; // 2 vCPU, 4 GB, 8 GB disk

if (!process.env.DAYTONA_API_KEY) throw new Error("DAYTONA_API_KEY is missing from .env");
const daytona = new Daytona();
const log = (s: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${s}`);

/** The Claude credential as a Daytona secret: the VM only sees a placeholder, swapped for the real value on requests to api.anthropic.com. */
async function ensureSecret() {
  const value = process.env.AGENTFLOOR_CLAUDE_TOKEN;
  if (!value) throw new Error("AGENTFLOOR_CLAUDE_TOKEN is missing from .env (claude setup-token)");
  const existing = (await daytona.secret.list({ name: CLAUDE_SECRET })).items.find((s) => s.name === CLAUDE_SECRET);
  const params = { value, hosts: ["api.anthropic.com"], description: "Claude credential for AgentFloor office VMs" };
  if (existing) await daytona.secret.update(existing.id, params);
  else await daytona.secret.create({ name: CLAUDE_SECRET, ...params });
  log(`secret ${CLAUDE_SECRET} ${existing ? "updated" : "created"} (allowed host: api.anthropic.com)`);
}

async function run(sandbox: Sandbox, what: string, command: string, timeout = 900): Promise<string> {
  log(what);
  const res = await sandbox.process.executeCommand(command, undefined, undefined, timeout);
  if (res.exitCode !== 0) throw new Error(`${what} failed (exit ${res.exitCode}):\n${res.result.slice(-3000)}`);
  return res.result;
}

/** Only what the daemon needs: the root manifests, packages/shared and packages/daemon. */
function daemonFiles(): string[] {
  return execFileSync("git", ["ls-files", "package.json", "package-lock.json", "tsconfig.base.json", ".node-version", "packages/shared", "packages/daemon"], {
    encoding: "utf8",
    cwd: ROOT,
  })
    .split("\n")
    .filter(Boolean);
}

async function build() {
  const version = JSON.parse(readFileSync(join(ROOT, "packages/daemon/package.json"), "utf8")).version as string;
  const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8", cwd: ROOT }).trim();
  const name = `agentfloor-office-${version}-${sha}`;

  log(`building ${name} from ${BASE}`);
  const sandbox = await daytona.create(
    { snapshot: BASE, name: `${name}-build`, labels: { app: "agentfloor", role: "snapshot-build" }, autoPauseInterval: 30 },
    { timeout: 300 },
  );
  try {
    const home = (await sandbox.getUserHomeDir()) ?? "/root";
    await run(sandbox, "system info", "uname -m && cat /etc/os-release | head -2 && df -h ~ | tail -1");
    await run(sandbox, "git", "command -v git || (sudo apt-get update -qq && sudo apt-get install -y -qq git curl xz-utils)");
    await run(
      sandbox,
      `Node ${NODE}`,
      `node -v 2>/dev/null | grep -q '^v24' || (mkdir -p ~/.local && curl -fsSL https://nodejs.org/dist/v${NODE}/node-v${NODE}-linux-x64.tar.xz | tar -xJ -C ~/.local --strip-components=1)`,
    );
    // Login shells (and the daemon's session) find node and the agents' CLIs in ~/.local/bin.
    await run(sandbox, "PATH", `grep -q '.local/bin' ~/.bashrc || echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc; grep -q '.local/bin' ~/.profile || echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.profile`);
    const sh = (cmd: string) => `bash -lc ${JSON.stringify(`export PATH="$HOME/.local/bin:$PATH"; ${cmd}`)}`;
    await run(sandbox, "node check", sh("node -v && npm -v"));

    const files = daemonFiles();
    log(`uploading ${files.length} files`);
    await sandbox.fs.uploadFiles(files.map((f) => ({ source: join(ROOT, f), destination: `${home}/agentfloor/${f}` })));
    await run(sandbox, "npm ci (daemon only)", sh("cd ~/agentfloor && npm ci -w @agentfloor/daemon --omit=dev --no-audit --no-fund"));
    await run(sandbox, "Claude Code", sh("npm install -g --prefix ~/.local --no-audit --no-fund @anthropic-ai/claude-code && claude --version"));
    await run(sandbox, "git identity for agents", "git config --global user.name 'AgentFloor' && git config --global user.email agents@agentfloor.local");
    await run(sandbox, "daemon smoke test", sh("cd ~/agentfloor && timeout 20 npm run daemon -w @agentfloor/daemon -- --data /tmp/smoke --port 4399 & sleep 12; curl -sf http://127.0.0.1:4399/health; kill %1 2>/dev/null; rm -rf /tmp/smoke; echo"));
    await run(sandbox, "disk used", "du -sh ~/agentfloor ~/.local 2>/dev/null; df -h ~ | tail -1");

    log("stopping the build VM");
    await sandbox.stop(300);
    log(`snapshotting as ${name} (a few minutes)`);
    await sandbox.createSnapshot(name, 1800);
    log(`done: set OFFICE_SNAPSHOT=${name} on the api service`);
  } finally {
    if (values.keep) log(`kept build VM ${sandbox.id}`);
    else {
      await sandbox.delete().catch((err) => log(`couldn't delete build VM ${sandbox.id}: ${err.message}`));
      log("build VM deleted");
    }
  }
}

if (values.secret) await ensureSecret();
await build();
