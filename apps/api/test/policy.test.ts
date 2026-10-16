import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultSetup } from "@agentfloor/shared/setup";
import { diffSetups, PolicyError, propose, uniqueId } from "../src/policy/engine.ts";

const office = () => defaultSetup("Acme");

test("hiring an agent: read-back from the diff, defaults from the catalog", () => {
  const p = propose(office(), [{ op: "hire_agent", room: "dev", name: "Designer", title: "Product design" }]);
  assert.deepEqual(p.readback, ["Hire Designer into Development as Product design, on Claude Code, Claude Haiku, low effort."]);
  const a = p.next.agents.find((x) => x.id === "designer")!;
  assert.deepEqual([a.runtime, a.model, a.effort, a.role], ["claude-code", "haiku", "low", "member"]);
  assert.deepEqual(p.diff.map((c) => `${c.kind}:${c.action}:${c.id}`), ["agent:add:designer"]);
});

test("a new room comes with its head and the next free slot", () => {
  const p = propose(office(), [
    { op: "add_room", name: "Sales", purpose: "Closes deals", head: { name: "Closer", title: "Runs Sales" } },
  ]);
  assert.deepEqual(p.readback, ["Open a new room, Sales: Closes deals, headed by Closer."]);
  const room = p.next.rooms.find((r) => r.id === "sales")!;
  assert.equal(room.slot, 3);
  assert.equal(p.next.agents.find((a) => a.id === "closer")!.role, "head");
});

test("changing a model, and switching effort with it, is one line", () => {
  const p = propose(office(), [{ op: "update_agent", id: "backend", model: "sonnet", effort: "medium" }]);
  assert.deepEqual(p.readback, ["Backend runs on Claude Code, Claude Sonnet, medium effort (was haiku). Its next turn uses the new setting."]);
});

test("heads: reassigning a room's head, and the guard rails", () => {
  const p = propose(office(), [{ op: "update_room", id: "dev", head: "backend" }]);
  assert.deepEqual(p.readback, ["Backend becomes head of Development (was PM)."]);
  assert.equal(p.next.agents.find((a) => a.id === "pm")!.role, "member");

  assert.throws(() => propose(office(), [{ op: "remove_agent", id: "pm" }]), /heads Development\. Give the room a new head first/);
  assert.throws(() => propose(office(), [{ op: "update_agent", id: "pm", room: "marketing" }]), /give the room a new head before moving/);
  assert.throws(() => propose(office(), [{ op: "update_room", id: "dev", head: "creator" }]), /isn't in Development/);
  // Reassign then remove, in one change.
  const q = propose(office(), [{ op: "update_room", id: "dev", head: "backend" }, { op: "remove_agent", id: "pm" }]);
  assert.ok(q.readback.some((l) => l.startsWith("Let go PM from Development")));
});

test("closing a room lets its people go in the same line", () => {
  const p = propose(office(), [{ op: "remove_room", id: "marketing" }]);
  assert.deepEqual(p.readback, ["Close Marketing and let go Strategist and Creator. Their threads and tasks stay in the log."]);
  assert.ok(!p.next.agents.some((a) => a.room === "marketing"));
});

test("bad changes are refused with every reason, and nothing-changes is refused too", () => {
  try {
    propose(office(), [
      { op: "hire_agent", room: "nowhere", name: "X", title: "" },
      { op: "update_agent", id: "backend", runtime: "junie" },
      { op: "update_agent", id: "frontend", model: "gpt-5" },
      { op: "set_policy", policy: { maxHops: 99 } },
    ]);
    assert.fail("should throw");
  } catch (err) {
    assert.ok(err instanceof PolicyError);
    assert.equal(err.problems.length, 4);
    assert.match(err.problems.join("\n"), /no room "nowhere"[\s\S]*Claude Code[\s\S]*no model "gpt-5"[\s\S]*maxHops/);
  }
  assert.throws(() => propose(office(), [{ op: "update_agent", id: "backend", model: "haiku" }]), /already how the office is set up/);
});

test("policy and budgets read back in plain words", () => {
  const p = propose(office(), [
    { op: "set_policy", policy: { askDeadlineSec: 600, ceoReach: "anyone" } },
    { op: "set_budget", scope: "room", id: "dev", dailyUsdSoft: 2, dailyUsdHard: 8 },
  ]);
  assert.deepEqual(p.readback, [
    "Unanswered questions escalate after 10 minutes (was 5 minutes).",
    "Any agent can ask you directly (was heads only).",
    "Daily budget for Development: warn you over $2, and park the work over $8 (API-equivalent cost).",
  ]);
  assert.throws(() => propose(office(), [{ op: "set_budget", scope: "office", id: "", dailyUsdSoft: 9, dailyUsdHard: 3 }]), /below the hard limit/);
});

test("restoring an earlier setup reads back what it undoes", () => {
  const v1 = office();
  const v2 = propose(v1, [{ op: "hire_agent", room: "dev", name: "Designer", title: "Design" }]).next;
  const back = propose(v2, [{ op: "restore", setup: v1, version: 1 }]);
  assert.equal(back.summary, "Restore the setup from version 1");
  assert.ok(back.readback[0]!.startsWith("Let go Designer"));
  assert.deepEqual(diffSetups(back.next, v1), []);
});

test("ids come from names, stay unique, and avoid reserved words", () => {
  assert.equal(uniqueId("Front End Dev!", []), "front-end-dev");
  assert.equal(uniqueId("Backend", ["backend"]), "backend-2");
  assert.equal(uniqueId("CEO", []), "ceo-1");
  assert.equal(uniqueId("3D artist", []), "a-3d-artist");
});
