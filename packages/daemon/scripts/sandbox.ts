/**
 * Phase 6 (AGE-25): run the office in a Daytona cloud sandbox.
 *
 *   node scripts/sandbox.ts up       create (or wake) the sandbox, push this repo, start the daemon
 *   node scripts/sandbox.ts status   state, console link, last lines of the daemon log
 *   node scripts/sandbox.ts down     stop it (disk kept, no compute billed)
 *   node scripts/sandbox.ts delete   remove it for good
 *
 * Needs DAYTONA_API_KEY in .env. Claude Code agents need AGENTFLOOR_CLAUDE_TOKEN
 * (run `claude setup-token` once). The sandbox is private: the console link only
 * opens for members of your Daytona organization, and it stops itself after
 * 15 idle minutes so the credits aren't burned overnight.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Daytona, type Sandbox } from "@daytona/sdk";
import { loadEnv } from "../src/env.ts";

loadEnv();
// The monorepo root: the whole repo is uploaded, and only the daemon workspace is installed.
const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();

const NAME = "agentfloor-office";
const PORT = 4300;
const SESSION = "office";
// Passed through to the daemon in the sandbox; nothing else from .env leaves this machine.
const FORWARD = ["AGENTFLOOR_CLAUDE_TOKEN", "GEMINI_API_KEY"];

const log = (s: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${s}`);

if (!process.env.DAYTONA_API_KEY) {
  console.error("DAYTONA_API_KEY is missing from .env (app.daytona.io → Keys).");
  process.exit(1);
}
const daytona = new Daytona();

async function find(): Promise<Sandbox | null> {
  try {
    return await daytona.get(NAME);
  } catch {
    return null;
  }
}

async function run(sandbox: Sandbox, what: string, command: string, cwd?: string, timeout = 600): Promise<string> {
  log(what);
  const res = await sandbox.process.executeCommand(command, cwd, undefined, timeout);
  if (res.exitCode !== 0) throw new Error(`${what} failed (exit ${res.exitCode}):\n${res.result}`);
  return res.result;
}

async function up() {
  let sandbox = await find();
  if (!sandbox) {
    log(`creating ${NAME} (first time builds the node:24 image, a few minutes)`);
    sandbox = await daytona.create(
      {
        name: NAME,
        image: "node:24-bookworm",
        resources: { cpu: 2, memory: 4, disk: 10 },
        labels: { app: "agentfloor" },
        public: false,
        autoStopInterval: 15,
      },
      { timeout: 900, onSnapshotCreateLogs: (chunk) => process.stdout.write(chunk) },
    );
  } else if (sandbox.state !== "started") {
    log(`starting ${NAME} (was ${sandbox.state})`);
    await sandbox.start(300);
  }

  const home = (await sandbox.getUserHomeDir()) ?? "/root";
  const app = `${home}/agentfloor`;

  // Tracked and new files, minus anything git ignores (node_modules, data, .env).
  const files = execFileSync("git", ["ls-files", "-co", "--exclude-standard"], { encoding: "utf8", cwd: ROOT })
    .split("\n")
    .filter((f) => f && existsSync(join(ROOT, f)) && !f.startsWith(".claude/"));
  const env = FORWARD.filter((k) => process.env[k]).map((k) => `${k}=${process.env[k]}`).join("\n");
  log(`uploading ${files.length} files`);
  await sandbox.fs.uploadFiles([
    ...files.map((f) => ({ source: join(ROOT, f), destination: `${app}/${f}` })),
    { source: Buffer.from(`${env}\nAGENTFLOOR_PORT=${PORT}\n`), destination: `${app}/.env` },
  ]);

  await run(sandbox, "npm ci", "npm ci -w @agentfloor/daemon --no-audit --no-fund", app);
  await run(sandbox, "installing Claude Code", // The daemon puts ~/.local/bin on the agents' PATH.
    "npm install -g --prefix ~/.local --no-audit --no-fund @anthropic-ai/claude-code");
  await run(sandbox, "git identity for agent workdirs", `git config --global user.name AgentFloor && git config --global user.email agents@agentfloor.local`);

  // Restart the daemon in a session so it outlives this script.
  await sandbox.process.deleteSession(SESSION).catch(() => {});
  await sandbox.process.executeCommand("pkill -f src/daemon/main.ts || true");
  await sandbox.process.createSession(SESSION);
  await sandbox.process.executeSessionCommand(SESSION, {
    command: `cd ${app} && npm run daemon -w @agentfloor/daemon -- --host 0.0.0.0 > office.log 2>&1`,
    runAsync: true,
  });
  log("waiting for the daemon");
  const end = Date.now() + 60_000;
  for (;;) {
    const res = await sandbox.process.executeCommand(`curl -sf -o /dev/null http://127.0.0.1:${PORT}/ && echo up`);
    if (res.result.includes("up")) break;
    if (Date.now() > end) {
      const tail = await sandbox.process.executeCommand(`tail -30 ${app}/office.log`);
      throw new Error(`daemon didn't come up:\n${tail.result}`);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (!process.env.AGENTFLOOR_CLAUDE_TOKEN) log("note: no AGENTFLOOR_CLAUDE_TOKEN, so Claude Code agents can't sign in yet");
  await status(sandbox);
}

async function status(sandbox?: Sandbox | null) {
  sandbox ??= await find();
  if (!sandbox) return log(`${NAME} doesn't exist (node scripts/sandbox.ts up)`);
  log(`${NAME}: ${sandbox.state}`);
  if (sandbox.state !== "started") return;
  const link = await sandbox.getPreviewLink(PORT);
  log(`console: ${link.url}/  (sign in with your Daytona account)`);
  const home = (await sandbox.getUserHomeDir()) ?? "/root";
  const tail = await sandbox.process.executeCommand(`tail -15 ${home}/agentfloor/office.log 2>/dev/null`);
  if (tail.result.trim()) console.log(tail.result);
}

const cmd = process.argv[2];
if (cmd === "up") await up();
else if (cmd === "status") await status();
else if (cmd === "down") {
  const s = await find();
  if (s && s.state === "started") await s.stop();
  log(`${NAME} stopped`);
} else if (cmd === "delete") {
  const s = await find();
  if (s) await s.delete();
  log(`${NAME} deleted`);
} else {
  console.error("usage: node scripts/sandbox.ts up|status|down|delete");
  process.exit(1);
}
