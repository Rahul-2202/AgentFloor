/**
 * A small made-up office, for looking at the UI in development without
 * signing in (the /preview page). Never used in production.
 */
import type { Fixture } from "@/sim/store";

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const ROOMS = [
  { id: "dev", name: "Development", head: "pm", purpose: "Builds and ships the product", whenBlocked: "park_and_switch", publish: "drafts" },
  { id: "qa", name: "Quality", head: "qa-lead", purpose: "Tests every change before it merges", whenBlocked: "stop_and_wait", publish: "drafts" },
];
const AGENTS = [
  { id: "pm", name: "Priya", room: "dev", role: "head", title: "Product manager", runtime: "claude-code", model: "haiku", effort: "low" },
  { id: "fe", name: "Felix", room: "dev", role: "member", title: "Frontend developer", runtime: "claude-code", model: "haiku", effort: "low" },
  { id: "be", name: "Bea", room: "dev", role: "member", title: "Backend developer", runtime: "claude-code", model: "sonnet", effort: "low" },
  { id: "qa-lead", name: "Quinn", room: "qa", role: "head", title: "QA lead", runtime: "claude-code", model: "haiku", effort: "low" },
  { id: "tester", name: "Theo", room: "qa", role: "member", title: "Tester", runtime: "claude-code", model: "haiku", effort: "low" },
];

const row = (a: (typeof AGENTS)[number], status: string, activity: string | null) => ({ id: a.id, room_id: a.room, name: a.name, role: a.role, title: a.title, runtime: a.runtime, model: a.model, effort: a.effort, status, activity, held_reason: null });

export const FIXTURE: Fixture = {
  version: 3,
  spend: [
    { agentId: "pm", costUsd: 0.42 },
    { agentId: "fe", costUsd: 1.1 },
    { agentId: "be", costUsd: 2.35 },
    { agentId: "tester", costUsd: 0.2 },
  ],
  setup: {
    name: "Acme Robotics",
    policy: { askDeadlineSec: 600, maxHops: 3, threadMaxMessages: 30, huddleMaxTurns: 8, ceoReach: "heads" },
    rooms: ROOMS,
    agents: AGENTS,
    budgets: [
      { scope: "office", id: "", dailyUsdSoft: 5, dailyUsdHard: 20 },
      { scope: "room", id: "dev", dailyUsdSoft: 4, dailyUsdHard: 12 },
    ],
    locks: ["merge", "budgets"],
  },
  data: {
    loaded: true,
    rooms: ROOMS.map((r, i) => ({ id: r.id, name: r.name, head_id: r.head, purpose: r.purpose, slot: i + 1 })),
    agents: [row(AGENTS[0], "working", "Planning the signup work"), row(AGENTS[1], "working", "Editing src/app/signup/page.tsx"), row(AGENTS[2], "idle", null), row(AGENTS[3], "idle", null), row(AGENTS[4], "working", "Running the test suite")],
    tasks: [
      { id: "T-1", title: "Add input validation to the signup form", details: "Email and password rules, with inline errors.", definition_of_done: "A PR with tests passing", room_id: "dev", owner_id: "fe", created_by: "pm", status: "ongoing", progress: 60, note: "Form done, writing tests", step: "Writing tests", blocker: null, checklist: [{ text: "Email rules", done: true }, { text: "Password rules", done: true }, { text: "Tests", done: false }], outputs: [], parent_id: "T-0", updated_at: ago(3) },
      { id: "T-0", title: "Make signup safer", details: "", definition_of_done: null, room_id: "dev", owner_id: "pm", created_by: "ceo", status: "ongoing", progress: 40, note: null, step: "Handing out the work", blocker: null, checklist: [], outputs: [], parent_id: null, updated_at: ago(20) },
      { id: "T-2", title: "Rate-limit the login endpoint", details: "", definition_of_done: "A PR with tests passing", room_id: "dev", owner_id: "be", created_by: "pm", status: "blocked", progress: 30, note: null, step: null, blocker: "Which limit: 5 or 10 attempts a minute?", checklist: [], outputs: [], parent_id: "T-0", updated_at: ago(8) },
      { id: "T-3", title: "Health-check endpoint", details: "", definition_of_done: null, room_id: "dev", owner_id: "be", created_by: "ceo", status: "review", progress: 100, note: null, step: "PR open", blocker: null, checklist: [], outputs: [{ kind: "pr", title: "Add /health", url: "https://github.com/acme/app/pull/12" }], parent_id: null, updated_at: ago(30) },
      { id: "T-4", title: "Test plan for signup", details: "", definition_of_done: null, room_id: "qa", owner_id: "tester", created_by: "qa-lead", status: "queued", progress: 0, note: null, step: null, blocker: null, checklist: [], outputs: [], parent_id: null, updated_at: ago(40) },
    ],
    threads: [{ id: "th-1", kind: "message", topic: "Login limits", created_by: "be", participants: ["be", "pm"], state: "open", task_id: "T-2", updated_at: ago(8) }],
    messages: [
      { id: "m-1", thread_id: "th-1", from: "be", to: "pm", type: "ask", urgency: "normal", body: "Should the login limit be 5 or 10 attempts a minute?", created_at: ago(8) },
      { id: "m-2", thread_id: "th-1", from: "pm", to: "be", type: "reply", urgency: "normal", body: "I'll check with the CEO.", created_at: ago(7) },
    ],
    inbox: [
      { id: "I-1", kind: "question", from: "pm", thread_id: "th-1", title: "Login rate limit: 5 or 10 attempts a minute?", body: "Bea needs a number to finish the rate limiting.", state: "open", created_at: ago(6), action: null, priority: 1, ada_note: "Blocks the signup work." },
      { id: "I-2", kind: "approval", from: "be", thread_id: null, title: "Merge PR #12: Add /health", body: "Tests pass.", state: "open", created_at: ago(30), action: { type: "merge", pr: 12, url: "https://github.com/acme/app/pull/12", repo: "acme/app" }, priority: 2, ada_note: null },
    ],
    memory: [
      { id: "mem-1", layer: "company", scope_id: "", type: "fact", title: "What Acme builds", body: "Robots that sort parcels. The web app is how customers manage their robots.", owner: "ada", status: "active", tags: [], confidence: 0.9, version: 1, source: { by: "ada" }, updated_at: ago(60) },
      { id: "mem-2", layer: "room", scope_id: "dev", type: "decision", title: "Every PR needs tests", body: "Agreed in the first heads sync.", owner: "pm", status: "active", tags: [], confidence: 0.8, version: 1, source: { by: "pm" }, updated_at: ago(50) },
    ],
    flags: [],
    meetings: [],
    audit: [{ id: 1, actor: "ceo", action: "setup.applied", target: "v3", detail: {}, created_at: ago(70) }],
  },
};

/** A brand-new office: nothing set up yet. */
export const EMPTY_FIXTURE: Fixture = {
  version: 1,
  spend: [],
  setup: { name: "Acme Robotics", policy: FIXTURE.setup.policy, rooms: [], agents: [], budgets: [{ scope: "office", id: "", dailyUsdSoft: 5, dailyUsdHard: 20 }], locks: ["merge"] },
  data: { loaded: true, rooms: [], agents: [], tasks: [], threads: [], messages: [], inbox: [], memory: [], flags: [], meetings: [], audit: [] },
};
