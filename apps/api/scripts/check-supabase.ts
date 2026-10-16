// Checks the office store against the real Supabase project: creates a
// throwaway user, bootstraps their office twice, then deletes the user (the
// office goes with it). Run on demand: npm run check:supabase -w @agentfloor/api
import { loadEnv } from "@agentfloor/shared/env";
import { createClient } from "@supabase/supabase-js";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.ts";
import { newOfficeToken, parseOfficeToken, secretMatches } from "@agentfloor/shared/link";
import { supabaseOfficeData } from "../src/ada/data.ts";
import { supabaseBudgetStore } from "../src/budgets.ts";
import { MemoryService } from "../src/memory/service.ts";
import { supabaseMemoryStore } from "../src/memory/store.ts";
import { supabaseLinkStore } from "../src/link/store.ts";
import { propose } from "../src/policy/engine.ts";
import { Projector, supabaseProjectionStore } from "../src/projection/writer.ts";
import { StaleSetupError, supabaseSetupStore } from "../src/setup/store.ts";
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
  const ev = (seq: number, type = "test", data: Record<string, unknown> = { n: seq }) => ({ seq, at: Date.now(), type, data });
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

  // Setup: seeded on first load, versioned, stale writes refused, any version restorable.
  const db = serviceClient(config.supabaseUrl, config.supabaseSecretKey);
  const setups = supabaseSetupStore(db);
  const v1 = await setups.load(officeId);
  assert.equal(v1.version, 1);
  assert.equal(v1.setup.agents.length, 6);
  assert.equal(v1.setup.rooms[0]!.purpose, "Builds and ships the product");
  const p = propose(v1.setup, [{ op: "hire_agent", room: "dev", name: "Designer", title: "Design" }, { op: "update_room", id: "dev", responsibilities: "The booking product" }]);
  assert.equal(await setups.apply(officeId, 1, p.next, "ceo", p.summary, p.readback, p.diff), 2);
  await assert.rejects(setups.apply(officeId, 1, p.next, "ceo", p.summary, p.readback, p.diff), StaleSetupError);
  const v2 = await setups.load(officeId);
  assert.equal(v2.setup.agents.length, 7);
  assert.equal(v2.setup.rooms.find((r) => r.id === "dev")!.responsibilities, "The booking product");
  assert.deepEqual((await setups.versions(officeId)).map((v) => v.v), [2, 1]);
  assert.equal((await setups.setupAt(officeId, 1))!.agents.length, 6);
  console.log("setup store against Supabase: ok");

  // Projection: daemon events become rows; usage gets its cost; spend sums it.
  const at = Date.now();
  const thread = { id: "T-1", kind: "message", topic: "Ship it", createdBy: "ceo", participants: ["ceo", "pm"], state: "open", parentId: null, depth: 0, taskId: "K-1", awaiting: null, escalation: 0, sent: 1, outcome: null, createdAt: at, updatedAt: at };
  await link.ingest(officeId, [
    ev(4, "thread.opened", { thread }),
    ev(5, "message.sent", { message: { id: "M-1", threadId: "T-1", from: "ceo", to: "pm", type: "request_work", urgency: "normal", body: "Ship it", refs: [], state: "queued", createdAt: at, deliveredAt: null } }),
    ev(6, "task.updated", { task: { id: "K-1", title: "Ship it", details: "", room: "dev", owner: "pm", createdBy: "ceo", status: "queued", progress: 0, note: null, dod: "Live", checklist: [], outputs: [], parentId: null, updatedAt: at } }),
    ev(7, "message.delivered", { agent: "pm", point: "turn_end", ids: ["M-1"] }),
    ev(8, "agent.status", { agent: "pm", status: "working", detail: "on a new task" }),
    ev(9, "model.call", { agent: "pm", threadId: "T-1", provider: "anthropic", model: "claude-haiku-4-5", inputTokens: 1000, outputTokens: 1000, cacheReadTokens: 10000, cacheWriteTokens: 0 }),
  ]);
  const projector = new Projector(supabaseProjectionStore(db));
  assert.equal(await projector.catchUp(officeId), 9);
  assert.equal(await projector.catchUp(officeId), 0, "nothing left");
  const msg = (await admin.from("messages").select("state").eq("office_id", officeId).eq("id", "M-1").single()).data!;
  assert.equal(msg.state, "delivered");
  const task = (await admin.from("tasks").select("definition_of_done").eq("office_id", officeId).eq("id", "K-1").single()).data!;
  assert.equal(task.definition_of_done, "Live");
  const pm = (await admin.from("agents").select("status, activity").eq("office_id", officeId).eq("id", "pm").single()).data!;
  assert.deepEqual([pm.status, pm.activity], ["working", "on a new task"]);
  const spend = await supabaseBudgetStore(db).spendSince(officeId, new Date(at - 60_000));
  assert.equal(spend.length, 1);
  assert.equal(spend[0]!.roomId, "dev");
  assert.ok(Math.abs(spend[0]!.costUsd - 0.007) < 1e-9, `cost ${spend[0]!.costUsd}`);
  await supabaseBudgetStore(db).alert(officeId, { id: "B-test-soft", title: "t", body: "b" });
  await supabaseBudgetStore(db).alert(officeId, { id: "B-test-soft", title: "t2", body: "b2" });
  const alerts = (await admin.from("inbox_items").select("title").eq("office_id", officeId).like("id", "B-%")).data!;
  assert.deepEqual(alerts.map((a) => a.title), ["t"], "a second alert with the same id is ignored");
  console.log("projection, spend and budget alerts against Supabase: ok");

  // Memory: write, search, versions on edit, merged flags, links.
  const setupNow = (await setups.load(officeId)).setup;
  const memStore = supabaseMemoryStore(db);
  const mem = new MemoryService(memStore);
  const company = (await mem.write(officeId, setupNow, "ada", { layer: "company", type: "fact", title: "Launch date", body: "March 1" })).item;
  const derived = (await mem.write(officeId, setupNow, "pm", { layer: "room", type: "plan", title: "Dev launch plan", body: "Freeze Feb 20", derivedFrom: [company.id] })).item;
  assert.equal((await mem.search(officeId, setupNow, "pm", "launch plan"))[0]?.id, derived.id);
  assert.ok(!(await mem.search(officeId, setupNow, "backend", "launch date")).some((i) => i.id === company.id), "members don't see company memory");
  await mem.flag(officeId, setupNow, "pm", company.id, "moved");
  await mem.flag(officeId, setupNow, "strategist", company.id, "heard May");
  const flags = await memStore.openFlags(officeId);
  assert.equal(flags.length, 1);
  assert.deepEqual(flags[0]!.flaggedBy.sort(), ["pm", "strategist"]);
  const edited = await mem.edit(officeId, setupNow, "ada", company.id, { body: "May 15" });
  assert.equal(edited.version, 3);
  const versions = (await admin.from("memory_versions").select("v, body").eq("item_id", company.id).order("v")).data!;
  assert.deepEqual(versions.map((v) => v.body), ["March 1", "March 1"], "versions keep what came before");
  assert.ok((await mem.read(officeId, setupNow, "pm", derived.id)).warnings.some((w) => /derived from has changed/.test(w)));
  console.log("memory against Supabase: ok");

  // Ada's chat with a card, meetings and minutes.
  const data = supabaseOfficeData(db);
  const card = { id: crypto.randomUUID(), type: "proposal" as const, ops: [{ op: "hire_agent" }], baseVersion: 2, readback: ["x"], summary: "Hire", state: "pending" as const };
  await data.say(officeId, { role: "ada", content: "Here's the card", cards: [card], mode: "chat" });
  assert.equal((await data.findCard(officeId, card.id))?.state, "pending");
  await data.updateCard(officeId, card.id, { state: "applied", version: 3 });
  assert.equal((await data.findCard(officeId, card.id))?.version, 3);
  assert.equal((await data.history(officeId, 10)).length, 1);
  const meeting = await data.saveMeeting(officeId, { title: "Scope", requestedBy: "pm", chair: "ada", attendees: ["pm"], agenda: ["a"], preRead: "p", state: "scheduled" });
  await data.saveMeeting(officeId, { id: meeting.id, state: "live", threadId: "T-9" });
  await data.saveMinutes(officeId, { meetingId: meeting.id, summary: "s", decisions: [], actionItems: [{ text: "t", owner: "pm", taskId: "K-1" }] }, [company.id]);
  assert.equal((await data.minutes(officeId, meeting.id))?.actionItems[0]?.taskId, "K-1");
  await data.raise(officeId, { id: "A-briefing-test", kind: "briefing", from: "ada", title: "Brief", body: "b" });
  await data.triage(officeId, "A-briefing-test", 3, "FYI");
  assert.equal((await data.inbox(officeId)).find((i) => i.id === "A-briefing-test")?.adaNote, "FYI");
  console.log("Ada's data against Supabase: ok");
} finally {
  await admin.auth.admin.deleteUser(id);
  const { count } = await admin.from("offices").select("id", { count: "exact", head: true }).eq("owner_id", id);
  assert.equal(count, 0, "office removed with its user");
}
