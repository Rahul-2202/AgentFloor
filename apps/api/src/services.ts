/**
 * Builds the office services and wires them to the office link. Used by the
 * server (with Supabase and Daytona) and by tests (with memory stores).
 */
import type { Verify } from "./auth.ts";
import { Ada } from "./ada/ada.ts";
import type { AdaBrain } from "./ada/brain.ts";
import type { OfficeData } from "./ada/data.ts";
import { Meetings } from "./ada/meetings.ts";
import { Budgets, type BudgetStore } from "./budgets.ts";
import { OfficeMemory, type ConversationSource } from "./memory/office.ts";
import { MemoryService } from "./memory/service.ts";
import type { MemoryStore } from "./memory/store.ts";
import type { GitHubApp } from "./github/app.ts";
import { GitHubService, type GitHubStore } from "./github/service.ts";
import type { LinearClient } from "./linear/client.ts";
import { LinearSync, type LinearStore, type TaskLike, type TicketRequest } from "./linear/service.ts";
import type { ErrorLog } from "./ops/ops.ts";
import { looksLikeAuthFailure, type ClaudeTokens } from "./claude/tokens.ts";
import { OfficeHub } from "./link/hub.ts";
import type { LinkStore } from "./link/store.ts";
import { Watchers } from "./live/watchers.ts";
import type { Cloud } from "./machines/cloud.ts";
import { OfficeMachines, type MachineOptions, type MachineStore } from "./machines/lifecycle.ts";
import type { OfficeStore } from "./offices.ts";
import { Projector, type ProjectionStore } from "./projection/writer.ts";
import { SetupService } from "./setup/service.ts";
import type { SetupStore } from "./setup/store.ts";

export interface ServiceStores {
  offices: OfficeStore;
  link: LinkStore;
  setups: SetupStore;
  projections: ProjectionStore;
  budgets: BudgetStore;
  machines: MachineStore;
  github?: GitHubStore;
  memory?: MemoryStore;
  conversations?: ConversationSource;
  data?: OfficeData;
  linear?: LinearStore;
  /** Office tasks as stored (for Linear). */
  tasks?: { open(officeId: string): Promise<TaskLike[]>; one(officeId: string, id: string): Promise<TaskLike | null> };
  audit?: (officeId: string, actor: string, action: string, target: string | null, detail: object) => Promise<void>;
}

export interface MachineConfig extends Omit<MachineOptions, "cloud" | "machines" | "link" | "connectedSince"> {
  cloud: Cloud;
}

export function createServices(o: {
  stores: ServiceStores;
  verify: Verify;
  machine: MachineConfig | null;
  /** The GitHub App; null until it's configured. */
  github?: { app: GitHubApp; cloneUrlOf?: (fullName: string) => string } | null;
  /** Each office's own Claude login (Ada and the office machine run on it). */
  claude?: ClaudeTokens | null;
  /** Where problems are tracked (errors table). */
  errors?: ErrorLog;
  /** Linear; null until a key is configured. */
  linear?: { client: LinearClient; publicUrl: string | null; secret: string } | null;
  /** Ada's model; null when no Claude credential is configured. */
  ada?: { brain: AdaBrain; triageDelayMs?: number } | null;
  log?: (msg: string) => void;
}) {
  const log = o.log ?? (() => {});
  const hub = new OfficeHub(o.stores.link, log);
  const setup = new SetupService(o.stores.setups, hub);
  const projector = new Projector(o.stores.projections);
  const budgets = new Budgets(o.stores.setups, o.stores.budgets, hub);
  const machines = o.machine
    ? new OfficeMachines({ ...o.machine, machines: o.stores.machines, link: o.stores.link, connectedSince: (id) => hub.connectedSince(id) })
    : null;
  const watchers = new Watchers({
    verify: o.verify,
    offices: o.stores.offices,
    hub,
    machines: o.machine ? { cloud: o.machine.cloud, store: o.stores.machines } : null,
  });

  const github =
    o.github && o.stores.github ? new GitHubService({ app: o.github.app, store: o.stores.github, hub, cloneUrlOf: o.github.cloneUrlOf }) : null;
  if (github) setup.extras = async (id) => ({ repo: await github.repoRef(id) });

  const linear =
    o.linear && o.stores.linear && o.stores.tasks
      ? new LinearSync({
          client: o.linear.client,
          store: o.stores.linear,
          hub,
          secret: o.linear.secret,
          publicUrl: o.linear.publicUrl,
          officeName: async (id) => (await setup.get(id)).setup.name,
          agents: async (id) => (await setup.get(id)).setup.agents.map((a) => ({ id: a.id, name: a.name, room: a.room })),
          rooms: async (id) => (await setup.get(id)).setup.rooms.map((r) => ({ id: r.id, name: r.name, head: r.head })),
          openTasks: (id) => o.stores.tasks!.open(id),
          taskOf: (id, t) => o.stores.tasks!.one(id, t),
          audit: o.stores.audit ? (id, action, target, detail) => o.stores.audit!(id, "linear", action, target, detail) : undefined,
          log,
        })
      : null;

  const memory = o.stores.memory ? new MemoryService(o.stores.memory) : null;
  const officeMemory =
    memory && o.stores.conversations ? new OfficeMemory({ memory, setups: o.stores.setups, hub, source: o.stores.conversations }) : null;

  const ada =
    o.ada && memory && o.stores.data ? new Ada({
          brain: o.ada.brain,
          setup,
          memory,
          hub,
          data: o.stores.data,
          spend: o.stores.budgets,
          token: o.claude ? (id) => o.claude!.need(id) : undefined,
          onAuthFailure: o.claude ? (id, why) => o.claude!.refused(id, why) : undefined,
        }) : null;
  const meetings = ada && memory && o.stores.data ? new Meetings({ ada, data: o.stores.data, hub, memory, setup, log }) : null;
  // New inbox items get Ada's triage, a little after they arrive (they come in bursts).
  const triageTimers = new Map<string, NodeJS.Timeout>();
  const triageSoon = (id: string) => {
    if (!ada) return;
    clearTimeout(triageTimers.get(id));
    triageTimers.set(
      id,
      setTimeout(() => {
        triageTimers.delete(id);
        void ada.triage(id).catch((err) => log(`triage: ${(err as Error).message}`));
      }, o.ada?.triageDelayMs ?? 20_000),
    );
  };

  // What the office asks the API for: memory, or GitHub (tokens, PRs).
  hub.onRequest = async (id, name, args) => {
    if (name === "memory") {
      if (!officeMemory) throw new Error("Office memory isn't available on this server.");
      return officeMemory.handle(id, args as { agent: string; op: string; args: Record<string, unknown> });
    }
    if (name === "linear") {
      if (!linear) throw new Error("Linear isn't set up on this server.");
      return linear.handle(id, args as TicketRequest);
    }
    if (!github) throw new Error("GitHub isn't set up on this server yet.");
    return github.handle(id, name, args);
  };

  const warn = (what: string) => (err: Error) => {
    log(`${what}: ${err.message}`);
    o.errors?.record("api", `${what}: ${err.message}`, { stack: err.stack });
  };
  hub.onLog = (id, _level, message) => {
    o.errors?.record("office", message, { officeId: id });
    // An agent's Claude login was refused: the office asks its CEO for a new token.
    if (o.claude && looksLikeAuthFailure(message)) void o.claude.refused(id, message).catch(() => {});
  };
  // A daemon (re)connects: give it its setup, catch the tables up, re-check budgets.
  hub.onConnect = (id) => {
    void setup.push(id).catch(warn("pushing setup"));
    void projector.catchUp(id).catch(warn("projecting"));
    void officeMemory?.pushBriefs(id).catch(warn("briefs"));
  };
  hub.onConfigApplied = (id, v, ok) => void setup.confirmed(id, v, ok).catch(warn("setup confirm"));
  // Events stored: project them before acknowledging, so the UI is never behind the ack.
  hub.onEvents = async (id, events) => {
    await projector.catchUp(id);
    // Memory reads the projected tables, so it runs after them.
    await officeMemory?.onEvents(id, events).catch(warn("memory"));
    // Linear in the background: its API is slow next to the office's events.
    if (linear) {
      const tasks = new Map<string, TaskLike>();
      for (const e of events) if (e.type === "task.updated" && (e.data as { task?: TaskLike }).task) tasks.set((e.data as { task: TaskLike }).task.id, (e.data as { task: TaskLike }).task);
      if (tasks.size) void linear.onTasks(id, [...tasks.values()]).catch(warn("linear"));
    }
    if (events.some((e) => e.type === "inbox.added")) triageSoon(id);
  };
  projector.onUsage = (id) => void budgets.check(id).catch(warn("budgets"));
  hub.onLive = (id, ev) => watchers.broadcast(id, ev);
  if (machines) hub.onActivity = (id) => void machines.activity(id).catch(warn("keep-awake"));

  return { hub, setup, projector, budgets, machines, watchers, github, linear, claude: o.claude ?? null, memory, officeMemory, ada, meetings, triageSoon, stores: o.stores };
}

export type Services = ReturnType<typeof createServices>;
