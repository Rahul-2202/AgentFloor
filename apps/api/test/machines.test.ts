// Office VM lifecycle against a fake cloud whose "VMs" run a real office
// daemon in this process, dialing into a real Control API on localhost.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { checkConfig, DEFAULT_POLICY } from "@agentfloor/daemon/config";
import { startDaemon, type RunningOffice } from "@agentfloor/daemon/daemon";
import { LINK_PATH } from "@agentfloor/shared/link";
import { buildApp } from "../src/app.ts";
import { OfficeHub } from "../src/link/hub.ts";
import { memoryLinkStore } from "../src/link/store.ts";
import type { Cloud } from "../src/machines/cloud.ts";
import { OfficeMachines, type MachineStore } from "../src/machines/lifecycle.ts";
import type { OfficeStore } from "../src/offices.ts";

const config = checkConfig({
  name: "VM test",
  policy: DEFAULT_POLICY,
  rooms: [{ id: "dev", name: "Development", head: "pm" }],
  agents: [{ id: "pm", name: "PM", room: "dev", role: "head", runtime: "external", title: "Head" }],
});

interface FakeVm {
  state: string;
  env: Record<string, string>;
  secrets: Record<string, string>;
  daemon: RunningOffice | null;
  dataDir: string;
}

/** VMs whose daemon is a real one in this process. Pause keeps it (link down), stop kills it. */
function fakeCloud() {
  const vms = new Map<string, FakeVm>();
  const calls: string[] = [];
  const vm = (id: string) => vms.get(id)!;
  const cloud: Cloud = {
    async create(o) {
      calls.push("create");
      const id = `vm-${vms.size + 1}`; // reused after a delete: fine for a fake
      vms.set(id, { state: "started", env: o.env, secrets: o.secrets, daemon: null, dataDir: mkdtempSync(join(tmpdir(), "agentfloor-vm-")) });
      return { id };
    },
    async state(id) {
      if (!vms.has(id)) throw new Error(`Sandbox with ID or name ${id} not found`);
      return vm(id).state;
    },
    async start(id) {
      calls.push("start");
      const v = vm(id);
      if (v.state === "paused") v.daemon?.link?.start(); // processes carry on
      v.state = "started";
    },
    async pause(id) {
      calls.push("pause");
      const v = vm(id);
      await v.daemon?.link?.stop();
      v.state = "paused";
    },
    async stop(id) {
      calls.push("stop");
      await stop(id);
    },
    async touch() {
      calls.push("touch");
    },
    async runInBackground(id) {
      calls.push("daemon");
      const v = vm(id);
      if (v.daemon) await v.daemon.close();
      v.daemon = await startDaemon({
        config,
        dataDir: v.dataDir,
        startAgents: false,
        log: () => {},
        link: { url: v.env.AGENTFLOOR_LINK_URL, token: v.env.AGENTFLOOR_OFFICE_TOKEN },
      });
    },
    async exec() {
      return { exitCode: 0, output: "" };
    },
    async openTerminal(_id, o) {
      calls.push("terminal");
      setImmediate(() => o.onData("$ "));
      return {
        input: async (d) => o.onData(d),
        resize: async () => {},
        close: async () => void calls.push("terminal-closed"),
      };
    },
  };
  /** A full stop: the daemon dies with the VM. */
  async function stop(id: string) {
    const v = vm(id);
    await v.daemon?.close();
    v.daemon = null;
    v.state = "stopped";
  }
  return { cloud, vms, calls, stop };
}

function memoryMachines(): MachineStore & { rows: Map<string, { sandboxId: string | null; state: string; error?: string | null }> } {
  const rows = new Map<string, { sandboxId: string | null; state: string; error?: string | null }>();
  return {
    rows,
    async get(id) {
      const r = rows.get(id) ?? { sandboxId: null, state: "none" };
      return { sandboxId: r.sandboxId, state: r.state };
    },
    async set(id, p) {
      const r = rows.get(id) ?? { sandboxId: null, state: "none" };
      rows.set(id, { sandboxId: p.sandboxId !== undefined ? p.sandboxId : r.sandboxId, state: p.state, error: p.error });
    },
  };
}

async function setup(t: any, opts: { linkUrl?: string; kind?: "vm" | "container" } = {}) {
  const officeId = randomUUID();
  const link = memoryLinkStore();
  const hub = new OfficeHub(link);
  const fake = fakeCloud();
  const store = memoryMachines();
  const offices: OfficeStore = {
    officeOf: async () => ({ id: officeId, name: "O", onboardedAt: null, sandboxState: "none", daemonConnected: false }),
    ensureOffice: async () => ({ office: (await offices.officeOf("u"))!, created: false }),
  };
  let machines: OfficeMachines;
  const app = await buildApp({
    verify: async () => ({ id: "u", email: null, githubLogin: "u", name: null }),
    offices,
    hub,
    get machines() {
      return machines;
    },
    webOrigins: [],
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const { port } = app.server.address() as AddressInfo;
  machines = new OfficeMachines({
    cloud: fake.cloud,
    machines: store,
    link,
    connectedSince: (id) => hub.connectedSince(id),
    snapshot: "agentfloor-office-test",
    linkUrl: opts.linkUrl ?? `ws://127.0.0.1:${port}${LINK_PATH}`,
    claudeSecret: "agentfloor-claude-token",
    kind: opts.kind ?? "vm",
    connectTimeoutMs: 3000,
    resumeGraceMs: 500,
    touchEveryMs: 60_000,
  });
  hub.onActivity = (id) => void machines.activity(id);
  t.after(async () => {
    for (const v of fake.vms.values()) await v.daemon?.close();
    await app.close();
  });
  const post = (url: string) => app.inject({ method: "POST", url, headers: { authorization: "Bearer x" } });
  return { officeId, hub, fake, store, machines: () => machines, post };
}

test("the first start creates the office VM, which connects back; later starts reuse it", async (t) => {
  const s = await setup(t);
  const res = await s.post("/office/start");
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().state, "started");
  assert.ok(s.hub.isConnected(s.officeId));
  const vm = [...s.fake.vms.values()][0];
  // The VM gets its link and token as env; the Claude credential only as a secret reference.
  assert.match(vm.env.AGENTFLOOR_OFFICE_TOKEN, /^afo_/);
  assert.deepEqual(vm.secrets, { AGENTFLOOR_CLAUDE_TOKEN: "agentfloor-claude-token" });
  assert.equal(s.store.rows.get(s.officeId)?.state, "started");

  assert.equal((await s.post("/office/start")).json().state, "started");
  assert.deepEqual(s.fake.calls, ["create", "daemon"], "no second VM, no restart");
});

test("two starts at once create one VM", async (t) => {
  const s = await setup(t);
  const [a, b] = await Promise.all([s.post("/office/start"), s.post("/office/start")]);
  assert.equal(a.statusCode, 200);
  assert.equal(b.statusCode, 200);
  assert.equal(s.fake.calls.filter((c) => c === "create").length, 1);
});

test("pause keeps the daemon; resuming reconnects it without a restart", async (t) => {
  const s = await setup(t);
  await s.post("/office/start");
  const res = await s.post("/office/pause");
  assert.equal(res.json().state, "paused");
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(s.hub.isConnected(s.officeId), false);

  assert.equal((await s.post("/office/start")).json().state, "started");
  assert.deepEqual(s.fake.calls, ["create", "daemon", "pause", "start"], "resumed, not restarted");
});

test("containers stop instead of pausing, and starting restarts the daemon right away", async (t) => {
  const s = await setup(t, { kind: "container" });
  await s.post("/office/start");
  assert.equal((await s.post("/office/pause")).json().state, "stopped");
  const t0 = Date.now();
  assert.equal((await s.post("/office/start")).json().state, "started");
  assert.ok(Date.now() - t0 < 2000, "no waiting for a daemon that can't come back");
  assert.deepEqual(s.fake.calls, ["create", "daemon", "stop", "start", "daemon"]);
  assert.ok(s.hub.isConnected(s.officeId));
});

test("a machine deleted outside AgentFloor is replaced on the next start", async (t) => {
  const s = await setup(t);
  await s.post("/office/start");
  const old = s.fake.vms.get("vm-1")!;
  await old.daemon?.close();
  s.fake.vms.delete("vm-1");
  const res = await s.post("/office/start");
  assert.equal(res.json().state, "started", res.body);
  assert.equal(s.store.rows.get(s.officeId)?.sandboxId, "vm-1", "the fake reuses the name; a new machine was created");
  assert.equal(s.fake.calls.filter((c) => c === "create").length, 2);
});

test("after a full stop, starting brings the daemon back up", async (t) => {
  const s = await setup(t);
  await s.post("/office/start");
  await s.fake.stop("vm-1");
  assert.equal(await s.machines().refresh(s.officeId), "stopped");
  assert.equal((await s.post("/office/start")).json().state, "started");
  assert.deepEqual(s.fake.calls, ["create", "daemon", "start", "daemon"]);
  assert.ok(s.hub.isConnected(s.officeId));
});

test("a daemon that never connects puts the office in error, with the reason", async (t) => {
  const s = await setup(t, { linkUrl: "ws://127.0.0.1:9/office-link" });
  const res = await s.post("/office/start");
  assert.equal(res.statusCode, 502);
  const row = s.store.rows.get(s.officeId)!;
  assert.equal(row.state, "error");
  assert.match(row.error ?? "", /didn't connect/);
});

test("office activity keeps the VM awake, at most once per interval", async (t) => {
  const s = await setup(t);
  await s.post("/office/start");
  await s.machines().activity(s.officeId);
  await s.machines().activity(s.officeId);
  assert.equal(s.fake.calls.filter((c) => c === "touch").length, 1);
});

test("without Daytona configured, starting says so", async (t) => {
  const officeId = randomUUID();
  const app = await buildApp({
    verify: async () => ({ id: "u", email: null, githubLogin: "u", name: null }),
    offices: {
      officeOf: async () => ({ id: officeId, name: "O", onboardedAt: null, sandboxState: "none", daemonConnected: false }),
      ensureOffice: async () => {
        throw new Error("unused");
      },
    },
    hub: new OfficeHub(memoryLinkStore()),
    machines: null,
    webOrigins: [],
  });
  t.after(() => app.close());
  const res = await app.inject({ method: "POST", url: "/office/start", headers: { authorization: "Bearer x" } });
  assert.equal(res.statusCode, 503);
});
