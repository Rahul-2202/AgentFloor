import { mkdirSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Auth } from "../core/auth.ts";
import { Office } from "../core/office.ts";
import { Store } from "../core/store.ts";
import { CATALOG } from "../core/catalog.ts";
import type { AgentDef, OfficeConfig, OfficeEvent } from "../core/types.ts";
import { IDENTITY_FILE, OfficeClient } from "../client.ts";
import { RUNTIMES } from "../runtimes/index.ts";
import { AgentHost } from "../runtimes/supervisor.ts";
import { createHttpServer } from "./http.ts";

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
}

export interface RunningOffice {
  office: Office;
  auth: Auth;
  url: string;
  hosts: AgentHost[];
  /** Environment for an agent's process: who it is and how to reach the office. */
  envFor(agentId: string): Record<string, string>;
  close(): Promise<void>;
}

/** Starts an office: store, protocol, API, escalation clock and agents. */
export async function startDaemon(opts: DaemonOptions): Promise<RunningOffice> {
  const log = opts.log ?? ((l: string) => console.log(l));
  mkdirSync(opts.dataDir, { recursive: true });
  const store = new Store(join(opts.dataDir, "office.db"));
  const auth = Auth.fromFile(join(opts.dataDir, "secret"));
  const office = new Office(opts.config, store, { now: opts.now });

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
      // CLAUDE_CODE_OAUTH_TOKEN is kept: it's the Claude login where there's no keychain (the sandbox).
      if (v === undefined || k === "ANTHROPIC_BASE_URL" || k === "CLAUDECODE" || k.startsWith("CLAUDE_AGENT_")) continue;
      if (k.startsWith("CLAUDE_CODE_") && k !== "CLAUDE_CODE_OAUTH_TOKEN") continue;
      env[k] = v;
    }
    if (process.env.AGENTFLOOR_ANTHROPIC_BASE_URL) env.ANTHROPIC_BASE_URL = process.env.AGENTFLOOR_ANTHROPIC_BASE_URL;
    env.AGENTFLOOR_URL = url;
    env.AGENTFLOOR_AGENT = agentId;
    env.AGENTFLOOR_TOKEN = auth.tokenFor(agentId);
    env.AGENTFLOOR_GATEWAY = opts.gateway === false ? "0" : "1";
    env.PATH = `${join(ROOT, "bin")}:${join(homedir(), ".local/bin")}:${process.env.PATH ?? ""}`;
    return env;
  };

  const hosts: AgentHost[] = [];
  const makeRuntime = (agent: AgentDef) => {
    const factory = RUNTIMES[agent.runtime];
    if (!factory) return null;
    const dir = resolve(opts.dataDir, "agents", agent.id);
    return factory({
      agent,
      config: opts.config,
      office: new OfficeClient(url, auth.tokenFor(agent.id)),
      home: dir,
      workdir: join(dir, "work"),
      env: envFor(agent.id),
      root: ROOT,
      log: (line) => log(`[${agent.id}] ${line}`),
      output: (kind, text) => office.output(agent.id, kind, text),
      usage: (u) => office.addUsage(agent.id, u),
    });
  };

  for (const agent of opts.config.agents) {
    const dir = resolve(opts.dataDir, "agents", agent.id);
    const workdir = join(dir, "work");
    mkdirSync(join(workdir, ".agentfloor"), { recursive: true });
    const env = envFor(agent.id);
    // Found from the working folder by CLIs that don't pass their environment on.
    writeFileSync(join(workdir, IDENTITY_FILE), JSON.stringify({ url, agent: agent.id, token: env.AGENTFLOOR_TOKEN }, null, 2), { mode: 0o600 });
    // For starting an external agent's CLI by hand: `source data/agents/<id>/env`.
    const exported = ["AGENTFLOOR_URL", "AGENTFLOOR_AGENT", "AGENTFLOOR_TOKEN", "PATH"].map((k) => `export ${k}='${env[k]}'`);
    writeFileSync(join(dir, "env"), exported.join("\n") + "\n", { mode: 0o600 });

    if (opts.startAgents === false) continue;
    const runtime = makeRuntime(agent);
    if (runtime) hosts.push(new AgentHost(office, agent, runtime));
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

  return {
    office,
    auth,
    url,
    hosts,
    envFor,
    async close() {
      clearInterval(tick);
      office.bus.off("event", onConfigured);
      await Promise.all(hosts.map((h) => h.stop()));
      server.closeAllConnections();
      await new Promise<void>((ok) => server.close(() => ok()));
      store.db.close();
    },
  };
}
