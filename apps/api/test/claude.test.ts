import assert from "node:assert/strict";
import { test } from "node:test";
import { buildApp } from "../src/app.ts";
import type { User } from "../src/auth.ts";
import { ClaudeTokenError, ClaudeTokens, looksLikeAuthFailure, memoryClaudeTokens, secretNameFor } from "../src/claude/tokens.ts";
import { OfficeHub } from "../src/link/hub.ts";
import { memoryLinkStore } from "../src/link/store.ts";
import type { Cloud } from "../src/machines/cloud.ts";
import { OfficeMachines, type MachineStore } from "../src/machines/lifecycle.ts";
import type { OfficeStore } from "../src/offices.ts";

const USER: User = { id: "u1", email: null, githubLogin: "ceo", name: "CEO" };
const GOOD = "sk-ant-oat01-" + "a".repeat(40);

test("each office keeps its own Claude token: checked, stored, never sent back, synced to its machine", async () => {
  const store = memoryClaudeTokens();
  const synced: [string, string][] = [];
  const claude = new ClaudeTokens(store, {
    syncSecret: async (name, token) => void synced.push([name, token]),
    verify: async (t) => (t.endsWith("bad".padEnd(40, "b")) ? "invalid" : "ok"),
  });
  const offices: OfficeStore = {
    officeOf: async () => ({ id: "office-1", name: "O", onboardedAt: null, sandboxState: "none", daemonConnected: false }),
    ensureOffice: async () => ({ office: (await offices.officeOf("u1"))!, created: false }),
  };
  const app = await buildApp({ verify: async () => USER, offices, hub: new OfficeHub(memoryLinkStore()), claude, webOrigins: [] });
  const call = (method: "GET" | "POST", url: string, payload?: object) => app.inject({ method, url, payload, headers: { authorization: "Bearer x" } });

  assert.deepEqual((await call("GET", "/office/claude")).json(), { set: false, last4: null, status: null, setAt: null, problem: null, required: true });
  assert.match((await call("POST", "/office/claude", { token: "my-api-key" })).json().error, /doesn't look like a Claude token/);
  assert.match((await call("POST", "/office/claude", { token: "sk-ant-oat01-" + "bad".padEnd(40, "b") })).json().error, /didn't accept/);

  const saved = await call("POST", "/office/claude", { token: `  ${GOOD}\n` });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.json().last4, "aaaa");
  assert.ok(!saved.body.includes(GOOD) && !(await call("GET", "/office/claude")).body.includes(GOOD), "the token never goes back to the browser");
  assert.deepEqual(synced, [[secretNameFor("office-1"), GOOD]]);

  // Claude refuses it later (an agent's 401): the office asks for a new one.
  assert.ok(looksLikeAuthFailure("API Error: 401 Invalid bearer token"));
  await claude.refused("office-1", "API Error: 401 Invalid bearer token");
  assert.equal((await call("GET", "/office/claude")).json().status, "invalid");
});

test("an office without a Claude token doesn't start (and nothing is created)", async () => {
  const calls: string[] = [];
  const cloud = new Proxy({}, { get: (_t, name) => async () => void calls.push(String(name)) }) as unknown as Cloud;
  const rows = new Map<string, { sandboxId: string | null; state: string }>();
  const machines: MachineStore = { get: async (id) => rows.get(id) ?? { sandboxId: null, state: "none" }, set: async (id, p) => void rows.set(id, { sandboxId: p.sandboxId ?? null, state: p.state }) };
  const m = new OfficeMachines({
    cloud,
    machines,
    link: memoryLinkStore(),
    connectedSince: () => null,
    snapshot: "snap",
    linkUrl: "wss://api/office-link",
    claudeSecret: async () => {
      throw new ClaudeTokenError("Add your Claude token first");
    },
  });
  await assert.rejects(m.start("o1"), /Add your Claude token first/);
  assert.deepEqual(calls, []);
  assert.equal((await machines.get("o1")).state, "none", "not marked as an error");
});
