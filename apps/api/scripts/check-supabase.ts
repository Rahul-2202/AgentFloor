// Checks the office store against the real Supabase project: creates a
// throwaway user, bootstraps their office twice, then deletes the user (the
// office goes with it). Run on demand: npm run check:supabase -w @agentfloor/api
import { loadEnv } from "@agentfloor/shared/env";
import { createClient } from "@supabase/supabase-js";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.ts";
import { newOfficeToken, parseOfficeToken, secretMatches } from "@agentfloor/shared/link";
import { supabaseLinkStore } from "../src/link/store.ts";
import { serviceClient, supabaseOfficeStore } from "../src/offices.ts";

loadEnv();
const config = loadConfig();
const admin = createClient(config.supabaseUrl, config.supabaseSecretKey, { auth: { persistSession: false } });

const { data, error } = await admin.auth.admin.createUser({
  email: `check-${Date.now()}@agentfloor.test`,
  email_confirm: true,
  user_metadata: { user_name: "check-bot", full_name: "Check Bot" },
});
if (error) throw error;
const id = data.user.id;
try {
  const store = supabaseOfficeStore(serviceClient(config.supabaseUrl, config.supabaseSecretKey));
  assert.equal(await store.officeOf(id), null);
  const first = await store.ensureOffice({ id, email: null, githubLogin: "check-bot", name: "Check Bot" });
  assert.equal(first.created, true);
  assert.equal(first.office.name, "Check's office");
  const [a, b] = await Promise.all([store.ensureOffice({ id, email: null, githubLogin: null, name: null }), store.ensureOffice({ id, email: null, githubLogin: null, name: null })]);
  assert.equal(a.office.id, first.office.id);
  assert.equal(b.office.id, first.office.id);
  const { data: profile } = await admin.from("profiles").select("github_login").eq("id", id).single();
  assert.equal(profile?.github_login, "check-bot");
  console.log("office store against Supabase: ok");

  // The office link's storage: token hash, event ingest (re-sends ignored), health.
  const link = supabaseLinkStore(serviceClient(config.supabaseUrl, config.supabaseSecretKey));
  const officeId = first.office.id;
  const { token, hash } = newOfficeToken(officeId);
  await link.setTokenHash(officeId, hash);
  assert.ok(secretMatches(parseOfficeToken(token)!.secret, (await link.tokenHash(officeId))!));
  const ev = (seq: number) => ({ seq, at: Date.now(), type: "test", data: { n: seq } });
  assert.equal(await link.ingest(officeId, [ev(1), ev(2)]), 2);
  assert.equal(await link.ingest(officeId, [ev(2), ev(3)]), 3);
  assert.equal(await link.lastSeq(officeId), 3);
  const { count } = await admin.from("office_events").select("seq", { count: "exact", head: true }).eq("office_id", officeId);
  assert.equal(count, 3);
  await link.setConnected(officeId, true);
  assert.equal((await store.officeOf(id))?.daemonConnected, true);
  // Browsers can't call the token functions.
  const anon = createClient(config.supabaseUrl, process.env.SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  assert.ok((await anon.rpc("office_token_hash", { oid: officeId })).error, "anon can't read token hashes");
  console.log("office link store against Supabase: ok");
} finally {
  await admin.auth.admin.deleteUser(id);
  const { count } = await admin.from("offices").select("id", { count: "exact", head: true }).eq("owner_id", id);
  assert.equal(count, 0, "office removed with its user");
}
