import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultSetup } from "@agentfloor/shared/setup";
import { MemoryService } from "../src/memory/service.ts";
import { memoryMemoryStore } from "../src/memory/store.ts";

const O = "office";
const setup = defaultSetup("Acme"); // dev: pm (head), backend, frontend, tester; marketing: strategist (head), creator

function svc() {
  const store = memoryMemoryStore();
  return { m: new MemoryService(store), store };
}

test("who reads what follows the layer table", async () => {
  const { m } = svc();
  const company = (await m.write(O, setup, "ada", { layer: "company", type: "fact", title: "Mission", body: "Online booking for clinics" })).item;
  const pref = (await m.write(O, setup, "ada", { layer: "ceo", type: "preference", title: "Ship small", body: "Prefer small PRs", rooms: ["dev"] })).item;
  const room = (await m.write(O, setup, "pm", { layer: "room", type: "charter", title: "Dev charter", body: "We build the booking app" })).item;
  const lesson = (await m.write(O, setup, "backend", { type: "lesson", title: "Times in UTC", body: "Store times in UTC", confidence: 0.9 })).item;
  const scratch = (await m.write(O, setup, "backend", { layer: "short_term", type: "note", title: "todo", body: "check pagination" })).item;

  const can = (who: string, i: typeof company) => m.canRead(setup, who, i);
  // Members: their own notes and their room; not company or the CEO's preferences.
  assert.deepEqual([can("backend", lesson), can("backend", scratch), can("backend", room), can("backend", company), can("backend", pref)], [true, true, true, false, false]);
  // Other members don't see each other's notes; the head sees members' lessons, not scratchpads.
  assert.deepEqual([can("frontend", lesson), can("pm", lesson), can("pm", scratch)], [false, true, false]);
  // Heads see company memory and the CEO's preferences for their room only.
  assert.deepEqual([can("pm", company), can("pm", pref), can("strategist", pref), can("strategist", room)], [true, true, false, false]);
  assert.ok(can("ceo", scratch) && can("ada", room));
});

test("writes go to their owner: suggestions, and doubtful or conflicting lessons, wait", async () => {
  const { m } = svc();
  assert.equal((await m.write(O, setup, "backend", { type: "lesson", title: "Paginate slots", body: "50 per page", confidence: 0.9 })).item.status, "active");
  const low = await m.write(O, setup, "backend", { type: "lesson", title: "Clinic hours", body: "Maybe 8 to 6?", confidence: 0.3 });
  assert.equal(low.item.status, "proposed");
  assert.match(low.note, /confidence is low/);
  const clash = await m.write(O, setup, "backend", { type: "lesson", title: "Paginate slots", body: "100 per page", confidence: 0.9 });
  assert.equal(clash.item.status, "proposed");
  assert.match(clash.note, /conflicts with "Paginate slots"/);

  // A member's room note is a suggestion for the head; Ada's too.
  assert.equal((await m.write(O, setup, "tester", { layer: "room", type: "note", title: "Flaky test", body: "booking.spec flakes" })).item.status, "proposed");
  const ada = await m.write(O, setup, "ada", { layer: "room", scopeId: "dev", type: "fact", title: "Launch date", body: "March 1" });
  assert.equal(ada.item.status, "proposed");
  assert.match(ada.note, /Suggested to PM/);

  // Off-limits writes are refused.
  await assert.rejects(m.write(O, setup, "backend", { layer: "company", type: "fact", title: "x", body: "y" }), /Ada's/);
  await assert.rejects(m.write(O, setup, "backend", { layer: "room", scopeId: "marketing", type: "fact", title: "x", body: "y" }), /your own room/);
  await assert.rejects(m.write(O, setup, "ada", { layer: "agent", scopeId: "backend", type: "lesson", title: "x", body: "y" }), /agents keep their own/);

  // The head reviews: accept the doubtful one, reject another.
  await m.accept(O, setup, "pm", low.item.id);
  await assert.rejects(m.accept(O, setup, "strategist", clash.item.id), /PM|Backend|review/);
  const rejected = await m.reject(O, setup, "pm", clash.item.id, "We agreed 50");
  assert.equal(rejected.status, "superseded");
  assert.match(rejected.body, /Rejected by PM: We agreed 50/);
});

test("superseding, derived items flagged for refresh, stale flags that merge", async () => {
  const { m, store } = svc();
  const v1 = (await m.write(O, setup, "ada", { layer: "company", type: "fact", title: "Launch date", body: "March 1" })).item;
  const derived = (await m.write(O, setup, "pm", { layer: "room", type: "plan", title: "Dev launch plan", body: "Code freeze Feb 20", derivedFrom: [v1.id] })).item;
  const v2 = (await m.write(O, setup, "ada", { layer: "company", type: "fact", title: "Launch date", body: "April 1", replaces: v1.id })).item;
  assert.equal((await store.get(O, v1.id))!.status, "superseded");
  const read = await m.read(O, setup, "pm", derived.id);
  assert.ok(read.warnings.some((w) => /derived from has changed/.test(w)));
  assert.equal(store.measures.get("stale_reads"), 1);
  assert.ok((await m.brief(O, setup, "pm")).includes("Dev launch plan** (its source changed: refresh it)"));

  // Two readers flag the same item: one flag, both reasons.
  await m.flag(O, setup, "pm", v2.id, "Board moved it again");
  await m.flag(O, setup, "strategist", v2.id, "Marketing heard May");
  const flags = await store.openFlags(O);
  assert.equal(flags.length, 1);
  assert.deepEqual(flags[0]!.flaggedBy, ["pm", "strategist"]);
  assert.equal((await store.get(O, v2.id))!.status, "stale");
  // The owner fixes it: flags resolve, the item is active again, versioned.
  const fixed = await m.edit(O, setup, "ada", v2.id, { body: "May 15" });
  assert.equal(fixed.status, "active");
  assert.equal(fixed.version, 3, "created, flagged stale, fixed: each change is a version");
  assert.equal((await store.openFlags(O)).length, 0);
  await assert.rejects(m.edit(O, setup, "pm", v2.id, { body: "June" }), /Only Ada/);
});

test("a member's brief: own lessons, room, relevant items; never company memory", async () => {
  const { m } = svc();
  await m.write(O, setup, "ada", { layer: "company", type: "fact", title: "Secret pricing", body: "Enterprise is $99" });
  await m.write(O, setup, "pm", { layer: "room", type: "charter", title: "Dev charter", body: "Booking app, React and Postgres" });
  await m.write(O, setup, "backend", { type: "lesson", title: "Times in UTC", body: "Store times in UTC; show clinic local time", confidence: 0.9 });
  await m.write(O, setup, "pm", { layer: "room", type: "decision", title: "Slots pagination", body: "Cursor pagination, 50 per page, for the slots endpoint" });
  const brief = await m.brief(O, setup, "backend", ["Build the slots endpoint with pagination"]);
  assert.match(brief, /### Your notes and lessons\n- \[[0-9a-f]{8}\] \*\*Times in UTC\*\*/);
  assert.match(brief, /### Development room[\s\S]*Dev charter/);
  assert.match(brief, /Slots pagination/);
  assert.doesNotMatch(brief, /Secret pricing/);
  const head = await m.brief(O, setup, "pm");
  assert.match(head, /### Company[\s\S]*Secret pricing/);
});

test("heads get a digest of their members' new lessons", async () => {
  const { m } = svc();
  await m.write(O, setup, "backend", { type: "lesson", title: "A", body: "a", confidence: 0.9 });
  await m.write(O, setup, "frontend", { type: "lesson", title: "B", body: "b", confidence: 0.2 });
  await m.write(O, setup, "creator", { type: "lesson", title: "C", body: "c", confidence: 0.9 });
  const d = await m.digest(O, setup, "pm", "2000-01-01");
  assert.deepEqual(d.map((i) => i.title).sort(), ["A", "B"]);
  await assert.rejects(m.digest(O, setup, "backend", "2000-01-01"), /Only heads/);
});
