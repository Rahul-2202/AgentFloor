import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { TAKEOVER_HOLD, Watchers } from "../src/live/watchers.ts";

/** A browser socket stand-in: what the API sends, and a way to send it messages. */
function fakeSocket() {
  const ev = new EventEmitter();
  const sent: any[] = [];
  const ws = Object.assign(ev, { OPEN: 1, readyState: 1, send: (s: string) => sent.push(JSON.parse(s)), close: () => ev.emit("close") });
  return { ws: ws as any, sent, say: (m: object) => ev.emit("message", Buffer.from(JSON.stringify(m))) };
}

const until = async (ok: () => boolean) => {
  for (let i = 0; i < 200 && !ok(); i++) await new Promise((r) => setTimeout(r, 5));
};

function setup(openTerminal: () => Promise<any>) {
  const calls: [string, any][] = [];
  const hub = { call: async (_o: string, name: string, args: any) => void calls.push([name, args]), isConnected: () => true } as any;
  const w = new Watchers({
    verify: async () => ({ id: "u", email: null, githubLogin: "u", name: null }),
    offices: { officeOf: async () => ({ id: "o1" }) } as any,
    hub,
    machines: { cloud: { openTerminal } as any, store: { get: async () => ({ sandboxId: "sb", state: "started" }), set: async () => {} } },
  });
  return { w, calls };
}

test("a take-over whose terminal won't open releases the agent and says why", async () => {
  const { w, calls } = setup(async () => {
    throw new Error("PTY unavailable");
  });
  const s = fakeSocket();
  w.accept(s.ws);
  s.say({ t: "auth", token: "x" });
  await until(() => s.sent.some((m) => m.t === "ready"));
  s.say({ t: "takeover", agent: "pm" });
  await until(() => s.sent.some((m) => m.t === "error"));
  assert.deepEqual(calls.map(([n, a]) => `${n}:${a.agent}`), ["ceo_hold_agent:pm", "ceo_release_agent:pm"]);
  assert.equal(calls[0]![1].reason, TAKEOVER_HOLD);
  assert.match(s.sent.find((m) => m.t === "error").message, /Couldn't open a terminal: PTY unavailable/);
});

test("a working take-over starts in the agent's folder and hands back when the page closes", async () => {
  const typed: string[] = [];
  let opened: any;
  const { w, calls } = setup(async (_id?: any, o?: any) => {
    opened = o;
    return { input: async (d: string) => void typed.push(d), resize: async () => {}, close: async () => {} };
  });
  const s = fakeSocket();
  w.accept(s.ws);
  s.say({ t: "auth", token: "x" });
  await until(() => s.sent.some((m) => m.t === "ready"));
  s.say({ t: "takeover", agent: "pm" });
  await until(() => typed.length > 0);
  assert.equal(opened.cwd, "~/office-data/agents/pm");
  assert.match(typed[0]!, /cd repo 2>\/dev\/null \|\| cd work/);
  s.ws.close();
  await until(() => calls.some(([n]) => n === "ceo_release_agent"));
  assert.deepEqual(calls.map(([n]) => n), ["ceo_hold_agent", "ceo_release_agent"]);
});
