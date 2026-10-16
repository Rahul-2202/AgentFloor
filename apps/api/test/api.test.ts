import assert from "node:assert/strict";
import { test } from "node:test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { buildApp } from "../src/app.ts";
import { OfficeHub } from "../src/link/hub.ts";
import { memoryLinkStore } from "../src/link/store.ts";
import { makeVerifier, type User } from "../src/auth.ts";
import { loadConfig } from "../src/config.ts";
import { defaultOfficeName, type Office, type OfficeStore } from "../src/offices.ts";

const ISSUER = "https://example.supabase.co/auth/v1";

async function keys() {
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "ES256" };
  const sign = (claims: Record<string, unknown>, opts: { exp?: string; iss?: string; aud?: string } = {}) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: "ES256", kid: "k1" })
      .setIssuer(opts.iss ?? ISSUER)
      .setAudience(opts.aud ?? "authenticated")
      .setIssuedAt()
      .setExpirationTime(opts.exp ?? "1h")
      .sign(privateKey);
  return { jwks: createLocalJWKSet({ keys: [jwk] }), sign };
}

function memoryStore(): OfficeStore & { offices: Map<string, Office> } {
  const offices = new Map<string, Office>();
  return {
    offices,
    async officeOf(userId) {
      return offices.get(userId) ?? null;
    },
    async ensureOffice(user: User) {
      const have = offices.get(user.id);
      if (have) return { office: have, created: false };
      const office = { id: `o-${offices.size + 1}`, name: defaultOfficeName(user), onboardedAt: null, sandboxState: "none", daemonConnected: false };
      offices.set(user.id, office);
      return { office, created: true };
    },
  };
}

async function setup() {
  const k = await keys();
  const store = memoryStore();
  const app = await buildApp({
    verify: makeVerifier({ jwksUrl: "unused", issuer: ISSUER, keys: k.jwks }),
    offices: store,
    hub: new OfficeHub(memoryLinkStore()),
    webOrigins: ["http://localhost:3000"],
  });
  return { app, store, sign: k.sign };
}

const ALICE = { sub: "user-a", email: "a@x.test", user_metadata: { user_name: "alice", full_name: "Alice Smith" } };

test("health needs no sign-in", async () => {
  const { app } = await setup();
  const res = await app.inject({ method: "GET", url: "/health" });
  assert.equal(res.statusCode, 200);
});

test("signed-out and bad tokens are refused", async () => {
  const { app, sign } = await setup();
  assert.equal((await app.inject({ method: "GET", url: "/me" })).statusCode, 401);
  const bad = async (token: string) =>
    (await app.inject({ method: "GET", url: "/me", headers: { authorization: `Bearer ${token}` } })).statusCode;
  assert.equal(await bad("not-a-jwt"), 401);
  assert.equal(await bad(await sign(ALICE, { exp: "-1m" })), 401, "expired");
  assert.equal(await bad(await sign(ALICE, { iss: "https://evil.test/auth/v1" })), 401, "other issuer");
  assert.equal(await bad(await sign(ALICE, { aud: "anon" })), 401, "wrong audience");
  const other = await keys();
  assert.equal(await bad(await other.sign(ALICE)), 401, "signed by another key");
});

test("first sign-in creates the office once", async () => {
  const { app, store, sign } = await setup();
  const headers = { authorization: `Bearer ${await sign(ALICE)}` };

  const me = (await app.inject({ method: "GET", url: "/me", headers })).json();
  assert.equal(me.user.githubLogin, "alice");
  assert.equal(me.office, null);

  const first = await app.inject({ method: "POST", url: "/office", headers });
  assert.equal(first.statusCode, 201);
  assert.equal(first.json().office.name, "Alice's office");

  const again = await app.inject({ method: "POST", url: "/office", headers });
  assert.equal(again.statusCode, 200);
  assert.equal(again.json().office.id, first.json().office.id);
  assert.equal(store.offices.size, 1);
});

test("config names every missing variable", () => {
  assert.throws(() => loadConfig({}), (err: Error) => /SUPABASE_URL/.test(err.message) && /SUPABASE_SECRET_KEY/.test(err.message));
  const c = loadConfig({ SUPABASE_URL: "https://p.supabase.co/", SUPABASE_SECRET_KEY: "s", WEB_ORIGINS: "http://a, http://b" });
  assert.equal(c.issuer, "https://p.supabase.co/auth/v1");
  assert.deepEqual(c.webOrigins, ["http://a", "http://b"]);
});

test("a deleted account's leftover sign-in gets a 401, so the page signs out", async () => {
  const { AuthError } = await import("../src/auth.ts");
  const k = await keys();
  const app = await buildApp({
    verify: makeVerifier({ jwksUrl: "unused", issuer: ISSUER, keys: k.jwks }),
    offices: { officeOf: async () => null, ensureOffice: async () => { throw new AuthError("Your account no longer exists. Sign in again."); } },
    hub: new OfficeHub(memoryLinkStore()),
    webOrigins: [],
  });
  const res = await app.inject({ method: "POST", url: "/office", headers: { authorization: `Bearer ${await k.sign(ALICE)}` } });
  assert.equal(res.statusCode, 401);
  assert.equal(res.json().code, "account_gone");
});
