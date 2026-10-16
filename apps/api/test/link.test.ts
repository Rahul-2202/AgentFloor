// The office link end to end: a real Control API and a real office daemon
// (no agents running), talking over a WebSocket on localhost.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { checkConfig, DEFAULT_POLICY } from "@agentfloor/daemon/config";
import { startDaemon } from "@agentfloor/daemon/daemon";
import { LINK_PATH, newOfficeToken } from "@agentfloor/shared/link";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app.ts";
import type { User } from "../src/auth.ts";
import { OfficeHub } from "../src/link/hub.ts";
import { memoryLinkStore } from "../src/link/store.ts";
import type { Office, OfficeStore } from "../src/offices.ts";

const OFFICE_ID = randomUUID();
const USER: User = { id: "user-a", email: null, githubLogin: "alice", name: "Alice" };

const config = checkConfig({
  name: "Link test",
  policy: DEFAULT_POLICY,
  rooms: [{ id: "dev", name: "Development", head: "pm" }],
  agents: [
    { id: "pm", name: "PM", room: "dev", role: "head", runtime: "external", title: "Head" },
    { id: "backend", name: "Backend", room: "dev", role: "member", runtime: "external", title: "API" },
  ],
});

const office: Office = { id: OFFICE_ID, name: "Alice's office", onboardedAt: null, sandboxState: "started", daemonConnected: false };
const offices: OfficeStore = {
  officeOf: async (userId) => (userId === USER.id ? office : null),
  ensureOffice: async () => ({ office, created: false }),
};

async function api(store: ReturnType<typeof memoryLinkStore>, port = 0) {
  const hub = new OfficeHub(store);
  const app = await buildApp({ verify: async () => USER, offices, hub, webOrigins: [] });
  await app.listen({ port, host: "127.0.0.1" });
  const { port: bound } = app.server.address() as AddressInfo;
  return { app, hub, port: bound, url: `ws://127.0.0.1:${bound}${LINK_PATH}` };
}

async function until(what: string, ok: () => boolean, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

test("events stream to the API, CEO calls reach the daemon, and nothing is lost while offline", async (t) => {
  const store = memoryLinkStore();
  const { token, hash } = newOfficeToken(OFFICE_ID);
  await store.setTokenHash(OFFICE_ID, hash);

  let server = await api(store);
  const daemon = await startDaemon({
    config,
    dataDir: mkdtempSync(join(tmpdir(), "agentfloor-link-")),
    startAgents: false,
    log: () => {},
    link: { url: server.url, token },
  });
  t.after(async () => {
    await daemon.close();
    await server.app.close();
  });

  await until("the daemon to connect", () => server.hub.isConnected(OFFICE_ID));
  assert.equal(store.connected.get(OFFICE_ID), true);

  // A CEO call over HTTP → API → link → daemon, and its events back.
  const res = await server.app.inject({
    method: "POST",
    url: "/office/call",
    headers: { authorization: "Bearer x" },
    payload: { name: "ceo_message", args: { to: "backend", text: "Ship the slots API" } },
  });
  assert.equal(res.statusCode, 200, res.body);
  const stored = () => store.events.get(OFFICE_ID) ?? [];
  await until("the message event", () => stored().some((e) => e.type === "message.sent"));

  // Errors from the daemon come back as errors.
  const bad = await server.app.inject({
    method: "POST",
    url: "/office/call",
    headers: { authorization: "Bearer x" },
    payload: { name: "ceo_message", args: { to: "nobody", text: "hi" } },
  });
  assert.equal(bad.statusCode, 400);

  // The API goes away; the office keeps working and logging.
  await server.app.close();
  await until("the daemon to notice", () => daemon.link!.state !== "open");
  await until("the office to show as disconnected", () => store.connected.get(OFFICE_ID) === false);
  daemon.office.ceoMessage({ to: "pm", text: "While the API was down" });
  const latest = daemon.office.store.events(0, 10_000).at(-1)!.seq;
  assert.ok(latest > Math.max(...stored().map((e) => e.seq)));

  // The API comes back on the same address: the daemon reconnects and replays.
  server = await api(store, server.port);
  await until("the replay", () => stored().at(-1)?.seq === latest, 10_000);
  const seqs = stored().map((e) => e.seq);
  assert.deepEqual(seqs, [...new Set(seqs)], "no duplicates");
  assert.deepEqual(seqs, Array.from({ length: seqs.length }, (_, i) => i + 1), "no gaps");
  await until("the acknowledgement", () => daemon.link!.acked === latest);
});

test("a daemon with a bad office token is rejected and stops retrying", async (t) => {
  const store = memoryLinkStore();
  await store.setTokenHash(OFFICE_ID, newOfficeToken(OFFICE_ID).hash);
  const server = await api(store);
  const daemon = await startDaemon({
    config,
    dataDir: mkdtempSync(join(tmpdir(), "agentfloor-link-")),
    startAgents: false,
    log: () => {},
    link: { url: server.url, token: newOfficeToken(OFFICE_ID).token },
  });
  t.after(async () => {
    await daemon.close();
    await server.app.close();
  });
  await until("the rejection", () => daemon.link!.state === "rejected");
  assert.equal(server.hub.isConnected(OFFICE_ID), false);
});

test("calls to an office that isn't connected fail fast", async (t) => {
  const server = await api(memoryLinkStore());
  t.after(() => server.app.close());
  const res = await server.app.inject({
    method: "POST",
    url: "/office/call",
    headers: { authorization: "Bearer x" },
    payload: { name: "inbox", args: {} },
  });
  assert.equal(res.statusCode, 503);
});
