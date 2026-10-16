/**
 * Builds the office services and wires them to the office link. Used by the
 * server (with Supabase and Daytona) and by tests (with memory stores).
 */
import type { Verify } from "./auth.ts";
import { Budgets, type BudgetStore } from "./budgets.ts";
import type { GitHubApp } from "./github/app.ts";
import { GitHubService, type GitHubStore } from "./github/service.ts";
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
  if (github) {
    setup.extras = async (id) => ({ repo: await github.repoRef(id) });
    hub.onRequest = (id, name, args) => github.handle(id, name, args);
  }

  const warn = (what: string) => (err: Error) => log(`${what}: ${err.message}`);
  // A daemon (re)connects: give it its setup, catch the tables up, re-check budgets.
  hub.onConnect = (id) => {
    void setup.push(id).catch(warn("pushing setup"));
    void projector.catchUp(id).catch(warn("projecting"));
  };
  hub.onConfigApplied = (id, v, ok) => void setup.confirmed(id, v, ok).catch(warn("setup confirm"));
  // Events stored: project them before acknowledging, so the UI is never behind the ack.
  hub.onEvents = async (id) => void (await projector.catchUp(id));
  projector.onUsage = (id) => void budgets.check(id).catch(warn("budgets"));
  hub.onLive = (id, ev) => watchers.broadcast(id, ev);
  if (machines) hub.onActivity = (id) => void machines.activity(id).catch(warn("keep-awake"));

  return { hub, setup, projector, budgets, machines, watchers, github, stores: o.stores };
}

export type Services = ReturnType<typeof createServices>;
