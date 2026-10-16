import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Auth } from "../core/auth.ts";
import { Office } from "../core/office.ts";
import { Store } from "../core/store.ts";
import { CATALOG } from "../core/catalog.ts";
import { loadConfig } from "../core/config.ts";
import { OFFICE, type AgentDef, type OfficeConfig, type OfficeEvent } from "../core/types.ts";
import { IDENTITY_FILE, OfficeClient } from "../client.ts";
import { RUNTIMES } from "../runtimes/index.ts";
import { AgentHost } from "../runtimes/supervisor.ts";
import { createHttpServer } from "./http.ts";
import { OfficeLink } from "./link.ts";
import { OfficeRepo } from "./repo.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export interface DaemonOptions {
  config: OfficeConfig;
  /** Where the database, secret and per-agent folders live. */
  dataDir: string;
  port?: number;
  host?: string;
  /** Start the agents' runtimes (off in tests that drive agents by hand). */
  startAgents?: boolean;
  /** Route agents' model calls through the office's model gateway (default on). */
  gateway?: boolean;
  now?: () => number;
  tickMs?: number;
  log?: (line: string) => void;
  /** Connect to the Control API (in the office VM): its link URL and this office's token. */
  link?: { url: string; token: string };
}

export interface RunningOffice {
  office: Office;
  auth: Auth;
  url: string;
  hosts: AgentHost[];
  link: OfficeLink | null;
  /** Environment for an agent's process: who it is and how to reach the office. */
  envFor(agentId: string): Record<string, string>;
  close(): Promise<void>;
}

/** Starts an office: store, protocol, API, escalation clock and agents. */
export async function startDaemon(opts: DaemonOptions): Promise<RunningOffice> {
  const log = opts.log ?? ((l: string) => console.log(l));
  mkdirSync(opts.dataDir, { recursive: true });
  // The setup the Control API last pushed wins over the starting config.
  const savedConfig = join(opts.dataDir, "office-config.json");
  const config = opts.link && existsSync(savedConfig) ? loadConfig(savedConfig) : opts.config;
  const store = new Store(join(opts.dataDir, "office.db"));
  const auth = Auth.fromFile(join(opts.dataDir, "secret"));
  const office = new Office(config, store, { now: opts.now });

  const server = createHttpServer({ office, auth, consoleHtml: join(ROOT, "console/index.html") });
  await new Promise<void>((ok) => server.listen(opts.port ?? 0, opts.host ?? "127.0.0.1", ok));
  const { port } = server.address() as AddressInfo;
  const url = `http://${opts.host ?? "127.0.0.1"}:${port}`;

  const tick = setInterval(() => office.tick(), opts.tickMs ?? 1000);

  const envFor = (agentId: string): Record<string, string> => {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      // The shell's ANTHROPIC_BASE_URL is ignored; agents use the office's choice.
      // Variables from a Claude Code session the daemon was started from would
      // make the agents' own Claude Code think it's nested, so they're dropped too.
      if (v === undefined || k === "ANTHROPIC_BASE_URL" || k === "CLAUDECODE" || k.startsWith("CLAUDE_CODE_") || k.startsWith("CLAUDE_AGENT_")) continue;
      env[k] = v;
    }
    // Where there's no keychain (the cloud sandbox), the Claude login comes from `claude setup-token`.
    if (process.env.AGENTFLOOR_CLAUDE_TOKEN) env.CLAUDE_CODE_OAUTH_TOKEN = process.env.AGENTFLOOR_CLAUDE_TOKEN;
    if (process.env.AGENTFLOOR_ANTHROPIC_BASE_URL) env.ANTHROPIC_BASE_URL = process.env.AGENTFLOOR_ANTHROPIC_BASE_URL;
    env.AGENTFLOOR_URL = url;
    env.AGENTFLOOR_AGENT = agentId;
    env.AGENTFLOOR_TOKEN = auth.tokenFor(agentId);
    env.AGENTFLOOR_GATEWAY = opts.gateway === false ? "0" : "1";
    env.PATH = `${join(ROOT, "bin")}:${join(homedir(), ".local/bin")}:${process.env.PATH ?? ""}`;
    // Commits show which agent made them.
    const name = config.agents.find((a) => a.id === agentId)?.name ?? agentId;
    env.GIT_AUTHOR_NAME = env.GIT_COMMITTER_NAME = `${name} (AgentFloor)`;
    env.GIT_AUTHOR_EMAIL = env.GIT_COMMITTER_EMAIL = `${agentId}@agents.agentfloor.dev`;
    return env;
  };

  // The office's GitHub repo, once connected: a clone plus a worktree per agent.
  const repo = new OfficeRepo({
    dataDir: opts.dataDir,
    root: ROOT,
    env: { AGENTFLOOR_URL: url, AGENTFLOOR_TOKEN: auth.tokenFor(OFFICE), PATH: `${join(ROOT, "bin")}:${process.env.PATH ?? ""}` },
  });
  office.hooks.push = (agent) => repo.push(agent);
  const useRepo = async (): Promise<boolean> => {
    if (!config.repo) return false;
    try {
      await repo.ensure(config.repo);
      return true;
    } catch (err) {
      log(`[repo] couldn't get ${config.repo.fullName}: ${(err as Error).message}`);
      return false;
    }
  };
  let inRepo = await useRepo();

  const hosts: AgentHost[] = [];
  const makeRuntime = (agent: AgentDef) => {
    const factory = RUNTIMES[agent.runtime];
    if (!factory) return null;
    const dir = resolve(opts.dataDir, "agents", agent.id);
    return factory({
      agent,
      config,
      office: new OfficeClient(url, auth.tokenFor(agent.id)),
      home: dir,
      workdir: inRepo ? repo.worktreeOf(agent.id) : join(dir, "work"),
      inRepo,
      env: envFor(agent.id),
      root: ROOT,
      log: (line) => log(`[${agent.id}] ${line}`),
      output: (kind, text) => office.output(agent.id, kind, text),
      usage: (u) => office.addUsage(agent.id, u),
    });
  };

  /** The agent's folders and identity files; its host, if the office runs its runtime. */
  const prepare = async (agent: AgentDef): Promise<AgentHost | null> => {
    const dir = resolve(opts.dataDir, "agents", agent.id);
    const workdir = join(dir, "work");
    mkdirSync(join(workdir, ".agentfloor"), { recursive: true });
    if (inRepo) await repo.ensureWorktree(agent.id).catch((err) => log(`[repo] worktree for ${agent.id}: ${err.message}`));
    const env = envFor(agent.id);
    // Found from the working folder (or a folder above it) by CLIs that don't pass their environment on.
    const identity = JSON.stringify({ url, agent: agent.id, token: env.AGENTFLOOR_TOKEN }, null, 2);
    writeFileSync(join(workdir, IDENTITY_FILE), identity, { mode: 0o600 });
    mkdirSync(join(dir, ".agentfloor"), { recursive: true });
    writeFileSync(join(dir, IDENTITY_FILE), identity, { mode: 0o600 });
    // For starting an external agent's CLI by hand: `source data/agents/<id>/env`.
    const exported = ["AGENTFLOOR_URL", "AGENTFLOOR_AGENT", "AGENTFLOOR_TOKEN", "PATH"].map((k) => `export ${k}='${env[k]}'`);
    writeFileSync(join(dir, "env"), exported.join("\n") + "\n", { mode: 0o600 });
    if (opts.startAgents === false) return null;
    const runtime = makeRuntime(agent);
    return runtime ? new AgentHost(office, agent, runtime) : null;
  };

  for (const agent of config.agents) {
    const host = await prepare(agent);
    if (host) hosts.push(host);
  }
  await Promise.all(hosts.map((h) => h.start()));

  // The CEO changed an agent's runtime, model or effort in the console.
  const onConfigured = (ev: OfficeEvent) => {
    if (ev.type !== "agent.configured" || opts.startAgents === false) return;
    const agent = office.agent(String(ev.data.agent));
    const runtime = makeRuntime(agent);
    const detail = `${CATALOG[agent.runtime]?.label ?? agent.runtime}, ${agent.model}`;
    const host = hosts.find((h) => h.agent.id === agent.id);
    if (!runtime) return;
    if (host) void host.swap(runtime, detail);
    else {
      const h = new AgentHost(office, agent, runtime);
      hosts.push(h);
      void h.start();
    }
  };
  office.bus.on("event", onConfigured);

  // The Control API pushed a new setup: start, stop or restart the agents it touched.
  const onSetup = async (ev: OfficeEvent) => {
    if (ev.type !== "config.applied") return;
    writeFileSync(savedConfig, JSON.stringify(config, null, 2));
    const { added, removed, changed, repoChanged } = ev.data as { added: string[]; removed: string[]; changed: string[]; repoChanged?: boolean };
    if (repoChanged) {
      inRepo = await useRepo();
      if (inRepo) for (const a of config.agents) await repo.ensureWorktree(a.id).catch((err) => log(`[repo] worktree for ${a.id}: ${err.message}`));
    }
    for (const id of removed) {
      const i = hosts.findIndex((h) => h.agent.id === id);
      if (i >= 0) void hosts.splice(i, 1)[0]!.stop();
    }
    for (const id of added) {
      const host = await prepare(office.agent(id));
      if (host) {
        hosts.push(host);
        void host.start();
      }
    }
    if (opts.startAgents === false) return;
    for (const id of changed) {
      const agent = office.agent(id);
      const runtime = makeRuntime(agent);
      const host = hosts.find((h) => h.agent.id === id);
      // The new runtime rewrites the agent's memory file from its new settings.
      if (runtime && host) void host.swap(runtime, `${CATALOG[agent.runtime]?.label ?? agent.runtime}, ${agent.model}`);
    }
  };
  const onSetupEvent = (ev: OfficeEvent) => void onSetup(ev).catch((err) => log(`[setup] ${(err as Error).message}`));
  office.bus.on("event", onSetupEvent);

  const link = opts.link ? new OfficeLink({ office, ...opts.link, log: (l) => log(`[link] ${l}`) }) : null;
  if (link) office.hooks.api = (name, args) => link.request(name, args);
  link?.start();

  return {
    office,
    auth,
    url,
    hosts,
    link,
    envFor,
    async close() {
      clearInterval(tick);
      await link?.stop();
      office.bus.off("event", onConfigured);
      office.bus.off("event", onSetupEvent);
      await Promise.all(hosts.map((h) => h.stop()));
      server.closeAllConnections();
      await new Promise<void>((ok) => server.close(() => ok()));
      store.db.close();
    },
  };
}
