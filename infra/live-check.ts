/**
 * The live check: is everything AgentFloor runs on actually working right now?
 * One block per milestone. Read-only and free: it creates no machines and
 * spends no tokens. Run on demand (not in CI):
 *
 *   npm run live-check -w @agentfloor/infra                      # staging, keys from .env
 *   API_URL=https://api… WEB_URL=https://web… npm run live-check -w @agentfloor/infra
 */
import { createPrivateKey, createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { Daytona } from "@daytona/sdk";
import { loadEnv } from "@agentfloor/shared/env";

loadEnv();
const env = process.env;
const API = (env.API_URL ?? "https://api-staging-81cc.up.railway.app").replace(/\/$/, "");
const WEB = (env.WEB_URL ?? "https://web-staging-4faf.up.railway.app").replace(/\/$/, "");

type Result = { ok: boolean | null; detail: string };
const results: { milestone: string; check: string; r: Result }[] = [];
async function check(milestone: string, name: string, fn: () => Promise<Result | string>) {
  let r: Result;
  try {
    const out = await fn();
    r = typeof out === "string" ? { ok: true, detail: out } : out;
  } catch (err) {
    r = { ok: false, detail: (err as Error).message };
  }
  results.push({ milestone, check: name, r });
  console.log(`${r.ok === null ? "–" : r.ok ? "✓" : "✗"} ${milestone.padEnd(3)} ${name}: ${r.detail}`);
}
const skip = (why: string): Result => ({ ok: null, detail: `skipped (${why})` });
const db = async (path: string) => {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) throw new Error("SUPABASE_URL / SUPABASE_SECRET_KEY not set");
  const res = await fetch(`${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/${path}`, { headers: { apikey: env.SUPABASE_SECRET_KEY, authorization: `Bearer ${env.SUPABASE_SECRET_KEY}` } });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<any[]>;
};

// M0: the services and the database.
await check("M0", "API health", async () => {
  const res = await fetch(`${API}/health`);
  return { ok: res.ok, detail: `${API} → ${res.status}` };
});
await check("M0", "web app", async () => {
  const res = await fetch(WEB);
  return { ok: res.ok, detail: `${WEB} → ${res.status}` };
});
await check("M0", "database", async () => `${(await db("offices?select=id")).length} offices`);
await check("M0", "sign-in protection", async () => {
  const res = await fetch(`${API}/me`);
  return { ok: res.status === 401, detail: `unauthenticated /me → ${res.status}` };
});

// M1: office machines.
await check("M1", "Daytona key and machines", async () => {
  if (!env.DAYTONA_API_KEY) return skip("no DAYTONA_API_KEY");
  const d = new Daytona();
  const running: string[] = [];
  let n = 0;
  for await (const s of d.list()) {
    n++;
    if (s.state === "started") running.push(String(s.labels?.office ?? s.id).slice(0, 8));
  }
  return `${n} machines, ${running.length} running${running.length ? ` (${running.join(", ")})` : ""}`;
});
await check("M1", "office snapshot", async () => {
  if (!env.DAYTONA_API_KEY || !env.OFFICE_SNAPSHOT) return skip("no DAYTONA_API_KEY / OFFICE_SNAPSHOT");
  const s = await new Daytona().snapshot.get(env.OFFICE_SNAPSHOT);
  return { ok: s.state === "active" || s.state === "inactive", detail: `${s.name}: ${s.state}${s.state === "inactive" ? " (woken on the next office start)" : ""}` };
});

// M2: GitHub.
await check("M2", "GitHub App", async () => {
  const key = env.GITHUB_APP_PRIVATE_KEY ?? (env.GITHUB_APP_PRIVATE_KEY_PATH ? readFileSync(env.GITHUB_APP_PRIVATE_KEY_PATH, "utf8") : null);
  if (!env.GITHUB_APP_ID || !key) return skip("no GitHub App key");
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iat: now - 60, exp: now + 540, iss: env.GITHUB_APP_ID })}`;
  const sig = createSign("RSA-SHA256").update(unsigned).sign(createPrivateKey(key.replace(/\\n/g, "\n")), "base64url");
  const res = await fetch("https://api.github.com/app/installations", { headers: { authorization: `Bearer ${unsigned}.${sig}`, accept: "application/vnd.github+json" } });
  if (!res.ok) return { ok: false, detail: `GitHub → ${res.status}` };
  return `${((await res.json()) as unknown[]).length} installations`;
});

// M3: Ada (a model call costs tokens: only checks the credential is there).
// M3: Claude. Each office runs on its CEO's own token (in Vault): how many have one, and how many Claude refused.
await check("M3", "offices' Claude tokens", async () => {
  const rows = await db("integrations?provider=eq.claude&select=office_id,config");
  const offices = (await db("offices?select=id")).length;
  const invalid = rows.filter((r) => r.config?.status === "invalid").length;
  return { ok: invalid === 0, detail: `${rows.length} of ${offices} offices have one${invalid ? `, ${invalid} refused by Claude` : ""}` };
});

// M7: Linear.
await check("M7", "Linear key", async () => {
  if (!env.LINEAR_API_KEY) return skip("no LINEAR_API_KEY");
  const res = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: { authorization: env.LINEAR_API_KEY, "content-type": "application/json" },
    body: JSON.stringify({ query: "{ organization { name } teams { nodes { key } } }" }),
  });
  const body = (await res.json()) as { data?: { organization: { name: string }; teams: { nodes: { key: string }[] } } };
  if (!body.data) return { ok: false, detail: `Linear → ${res.status}` };
  return `${body.data.organization.name}: teams ${body.data.teams.nodes.map((t) => t.key).join(", ")}`;
});
await check("M7", "offices on Linear", async () => `${(await db("integrations?provider=eq.linear&status=eq.connected&select=office_id")).length} connected`);

// M8: running it.
await check("M8", "allowlist", async () => {
  const rows = await db("allowlist?select=github_login,email,admin");
  const admins = rows.filter((r) => r.admin).length;
  return { ok: admins > 0, detail: `${rows.length} people, ${admins} admin${admins === 1 ? "" : "s"}` };
});
await check("M8", "errors, last 24 h", async () => {
  const rows = await db(`errors?select=source,count,message&last_seen=gte.${new Date(Date.now() - 86_400_000).toISOString()}&order=count.desc`);
  const total = rows.reduce((n, r) => n + r.count, 0);
  return { ok: total < 50, detail: total ? `${total} (top: ${rows[0].source}: ${String(rows[0].message).slice(0, 80)})` : "none" };
});
await check("M8", "memory backups", async () => {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) return skip("no Supabase key");
  const res = await fetch(`${env.SUPABASE_URL.replace(/\/$/, "")}/storage/v1/bucket/backups`, { headers: { apikey: env.SUPABASE_SECRET_KEY, authorization: `Bearer ${env.SUPABASE_SECRET_KEY}` } });
  return { ok: res.ok, detail: res.ok ? "bucket ready (nightly at 03:00 UTC)" : `bucket missing (${res.status})` };
});

const failed = results.filter((x) => x.r.ok === false);
console.log(failed.length ? `\n${failed.length} check(s) failed.` : "\nAll good.");
process.exit(failed.length ? 1 : 0);

