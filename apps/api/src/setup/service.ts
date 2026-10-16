import { toDaemonConfig, type OfficeSetup } from "@agentfloor/shared/setup";
import type { OfficeConfig } from "@agentfloor/shared/types";
import type { OfficeHub } from "../link/hub.ts";
import { PolicyError, propose, type SetupOp } from "../policy/engine.ts";
import { StaleSetupError, type SetupStore } from "./store.ts";

/** What the CEO's client (or Ada) sends: the engine's operations, plus restoring a saved version. */
export type ClientOp = SetupOp | { op: "restore_version"; version: number };

/**
 * Office setup changes: propose (read-back, nothing changes), apply (only if
 * the setup is still the one the read-back was made from), roll back, and
 * keep the office's daemon running the latest version.
 */
export class SetupService {
  private readonly store: SetupStore;
  private readonly hub: OfficeHub;
  /** Parts of the daemon's config that don't come from the setup (the GitHub repo). */
  extras: (officeId: string) => Promise<Partial<OfficeConfig>> = async () => ({});

  constructor(store: SetupStore, hub: OfficeHub) {
    this.store = store;
    this.hub = hub;
  }

  /** The daemon confirmed (or refused) a setup version. */
  async confirmed(officeId: string, version: number, ok: boolean): Promise<void> {
    if (ok) await this.store.markPushed(officeId, version);
  }

  get(officeId: string) {
    return this.store.load(officeId);
  }

  versions(officeId: string) {
    return this.store.versions(officeId);
  }

  async propose(officeId: string, ops: ClientOp[]) {
    const { setup, version } = await this.store.load(officeId);
    const p = propose(setup, await this.expand(officeId, ops));
    return { baseVersion: version, readback: p.readback, summary: p.summary, diff: p.diff, next: p.next };
  }

  /** Applies operations the CEO confirmed from a read-back made at baseVersion. */
  async apply(officeId: string, ops: ClientOp[], baseVersion: number, by: string) {
    const { setup, version } = await this.store.load(officeId);
    if (version !== baseVersion) throw new StaleSetupError(`The setup changed since that read-back (now version ${version}). Review it again.`);
    const p = propose(setup, await this.expand(officeId, ops));
    const v = await this.store.apply(officeId, baseVersion, p.next, by, p.summary, p.readback, p.diff);
    await this.push(officeId, p.next, v).catch(() => {});
    return { version: v, readback: p.readback, summary: p.summary };
  }

  /** Sends the office's daemon its setup, if it's connected. */
  async push(officeId: string, setup?: OfficeSetup, version?: number): Promise<void> {
    if (!this.hub.isConnected(officeId)) return;
    if (!setup || version === undefined) ({ setup, version } = await this.store.load(officeId));
    this.hub.sendConfig(officeId, { ...toDaemonConfig(setup), ...(await this.extras(officeId)) }, version);
  }

  private async expand(officeId: string, ops: ClientOp[]): Promise<SetupOp[]> {
    return Promise.all(
      ops.map(async (op) => {
        if (op.op !== "restore_version") return op;
        const setup = await this.store.setupAt(officeId, op.version);
        if (!setup) throw new PolicyError([`There's no version ${op.version}.`]);
        return { op: "restore", setup, version: op.version } as SetupOp;
      }),
    );
  }
}
