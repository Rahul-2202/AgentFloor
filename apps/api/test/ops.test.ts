import assert from "node:assert/strict";
import { test } from "node:test";
import { buildApp } from "../src/app.ts";
import type { User } from "../src/auth.ts";
import { OfficeHub } from "../src/link/hub.ts";
import { memoryLinkStore } from "../src/link/store.ts";
import type { OfficeStore } from "../src/offices.ts";
import { fingerprint, type Access, type AllowEntry } from "../src/ops/ops.ts";

const users: Record<string, User> = {
  boss: { id: "u1", email: null, githubLogin: "Boss", name: "Boss" },
  teammate: { id: "u2", email: "t@acme.dev", githubLogin: "teammate", name: "T" },
  stranger: { id: "u3", email: null, githubLogin: "stranger", name: "S" },
};

function memoryAccess(): Access {
  let rows: AllowEntry[] = [{ id: 1, githubLogin: "boss", email: null, note: null, admin: true }];
  let next = 2;
  return {
    check: async (u) => {
      const hit = rows.find((r) => r.githubLogin?.toLowerCase() === u.githubLogin?.toLowerCase() || (r.email && r.email === u.email));
      return { allowed: !!hit, admin: !!hit?.admin };
    },
    list: async () => rows,
    add: async (e) => void rows.push({ id: next++, githubLogin: e.githubLogin ?? null, email: e.email ?? null, note: e.note ?? null, admin: !!e.admin }),
    remove: async (id) => void (rows = rows.filter((r) => r.id !== id)),
  };
}

test("only people on the allowlist get in; only admins run the place", async () => {
  const offices: OfficeStore = { officeOf: async () => null, ensureOffice: async () => ({ office: { id: "o", name: "O", onboardedAt: null, sandboxState: "none", daemonConnected: false }, created: true }) };
  const recorded: string[] = [];
  const app = await buildApp({
    verify: async (token) => users[token]!,
    offices,
    hub: new OfficeHub(memoryLinkStore()),
    access: memoryAccess(),
    errors: { record: (src, msg) => void recorded.push(`${src}:${msg}`) },
    admin: { overview: async () => ({ offices: [] }), errors: async () => [], memoryExport: async () => ({}) },
    webOrigins: [],
  });
  const as = (who: string, method: "GET" | "POST" | "DELETE", url: string, payload?: object) => app.inject({ method, url, payload, headers: { authorization: `Bearer ${who}` } });

  const out = await as("stranger", "POST", "/office");
  assert.equal(out.statusCode, 403);
  assert.equal(out.json().code, "not_allowed");
  assert.match(out.json().error, /invite-only.*stranger/);

  assert.equal((await as("boss", "GET", "/me")).json().admin, true);
  assert.equal((await as("boss", "GET", "/admin/overview")).statusCode, 200);

  // The boss lets a teammate in (by email); they're in, but not an admin.
  assert.equal((await as("teammate", "GET", "/me")).statusCode, 403);
  assert.equal((await as("boss", "POST", "/admin/allowlist", { email: "t@acme.dev" })).statusCode, 200);
  assert.equal((await as("teammate", "GET", "/me")).json().admin, false);
  assert.equal((await as("teammate", "GET", "/admin/overview")).statusCode, 403);

  // The last admin can't be removed.
  assert.equal((await as("boss", "DELETE", "/admin/allowlist/1")).statusCode, 400);

  // Browser errors are tracked.
  await as("teammate", "POST", "/errors", { message: "TypeError: x is undefined" });
  assert.deepEqual(recorded, ["web:TypeError: x is undefined"]);
});

test("errors group by their message, not their ids", () => {
  assert.equal(fingerprint("api", 'office 6f1c2a3b-1111-2222-3333-444455556666: task T-12 failed after 3 tries "x"'), fingerprint("api", 'office 0a0b0c0d-aaaa-bbbb-cccc-ddddeeeeffff: task T-9 failed after 5 tries "y"'));
  assert.notEqual(fingerprint("api", "boom"), fingerprint("web", "boom"));
});

test("the browser may PATCH and DELETE (memory edits, removing someone from the allowlist)", async () => {
  const app = await buildApp({
    verify: async () => users.boss!,
    offices: { officeOf: async () => null, ensureOffice: async () => ({ office: { id: "o", name: "O", onboardedAt: null, sandboxState: "none", daemonConnected: false }, created: true }) },
    hub: new OfficeHub(memoryLinkStore()),
    webOrigins: ["https://web.example"],
  });
  for (const method of ["DELETE", "PATCH"]) {
    const res = await app.inject({ method: "OPTIONS", url: "/admin/allowlist/2", headers: { origin: "https://web.example", "access-control-request-method": method, "access-control-request-headers": "authorization" } });
    assert.match(String(res.headers["access-control-allow-methods"]), new RegExp(method));
  }
});
