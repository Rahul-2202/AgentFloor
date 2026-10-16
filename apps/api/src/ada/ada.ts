/**
 * Ada, the office manager: the CEO's chief of staff. She reads the office,
 * proposes changes (as read-back cards only the CEO confirms), keeps company
 * memory and the CEO's preferences, triages the inbox, runs meetings and
 * writes their minutes, and briefs the CEO every day.
 *
 * She acts with the CEO's permissions, minus anything locked; she never
 * applies a setup change herself and never merges.
 */
import { randomUUID } from "node:crypto";
import { LOCK_TARGETS, PERMISSIONS, WHEN_BLOCKED } from "@agentfloor/shared/governance";
import type { OfficeSetup } from "@agentfloor/shared/setup";
import { z } from "zod";
import type { BudgetStore } from "../budgets.ts";
import { startOfDayUtc } from "../budgets.ts";
import type { OfficeHub } from "../link/hub.ts";
import type { MemoryService } from "../memory/service.ts";
import { PolicyError } from "../policy/engine.ts";
import type { ClientOp, SetupService } from "../setup/service.ts";
import type { AdaBrain, AdaTool } from "./brain.ts";
import type { Card, ChatMessage, Meeting, Minutes, OfficeData } from "./data.ts";

export type AdaEvent = { type: "text"; delta: string } | { type: "card"; card: Card } | { type: "done"; message: ChatMessage };

export interface AdaDeps {
  brain: AdaBrain;
  setup: SetupService;
  memory: MemoryService;
  hub: OfficeHub;
  data: OfficeData;
  spend?: BudgetStore;
}

const PERSONA = `You are Ada, the office manager of an AI company run from AgentFloor. The CEO is a person; everyone else in the office is an AI agent, organised in rooms, each with a head.

You are the CEO's chief of staff. You:
- keep the office running: read what's happening (tasks, inbox, conversations, spend, memory) before you answer;
- change the office's setup only by proposing it with propose_change. That makes a read-back card the CEO confirms; nothing changes until they do. Never say something is done until it's applied;
- keep company memory and the CEO's preferences (remember). When the CEO corrects you or states a preference, remember it so they never have to repeat it;
- message agents on the CEO's behalf with message_agent, only when asked or clearly needed;
- never merge PRs, never unlock locked rules (only the CEO does, in Rules and settings), never invent facts about the office.

How you talk: plain, warm, brief. Lead with the answer. Use the names of rooms and agents, not ids. Ask one question at a time. No jargon, no emoji.`;

const ONBOARDING = `This office is new: run the onboarding interview, one step at a time, and keep each message short.
1. Ask about the company: what it does, who it's for, its goals for the next months, and any rules that must never break.
2. Propose rooms and agents for those goals (a head per room; 2 to 4 agents a room; at most 6 rooms). Say what each does. Adjust as the CEO answers.
3. Ask for each room: when an agent is blocked, should it park the task and switch, make its best guess and flag it, or stop and wait? Should PRs open as drafts (the default) or ready for review?
4. Ask for a daily budget (API-equivalent dollars): a warning level and a hard stop.
5. Suggest connecting a GitHub repo in Setup → GitHub (you can't do it for them), so agents can work on code.
6. Then propose the whole office in one propose_change with a single replace_setup operation, and call finish_onboarding with what you learned about the company. The CEO confirms the card; the office builds itself.
Agents run on Claude Code with Claude Haiku at low effort unless the CEO wants otherwise.`;

const OPS_HELP = `propose_change operations (JSON objects in "ops"):
- {op:"hire_agent", room, name, title, model?:"haiku"|"sonnet"|"opus", effort?:"low"|"medium"|"high"}
- {op:"update_agent", id, name?, title?, model?, effort?, room?}  {op:"remove_agent", id}
- {op:"add_room", name, purpose?, responsibilities?, dod?, head:{name, title}}  {op:"update_room", id, name?, purpose?, responsibilities?, dod?, head?: agentId}  {op:"remove_room", id}
- {op:"set_permission", scope:"room"|"agent", id, permission: ${PERMISSIONS.map((p) => `"${p.id}"`).join("|")}, level:"free"|"ask"|"never"|null}
- {op:"set_when_blocked", room, policy: ${Object.keys(WHEN_BLOCKED).map((k) => `"${k}"`).join("|")}}  {op:"set_publish", room, mode:"drafts"|"direct"}
- {op:"set_budget", scope:"office"|"room"|"agent", id ("" for office), dailyUsdSoft, dailyUsdHard}
- {op:"set_policy", policy:{askDeadlineSec?, maxHops?, threadMaxMessages?, huddleMaxTurns?, ceoReach?:"anyone"|"heads"}}
- {op:"lock", target: ${Object.keys(LOCK_TARGETS).map((k) => `"${k}"`).join("|")}}
- {op:"replace_setup", setup:{name, rooms:[{id, name, head, purpose?, whenBlocked?, publish?}], agents:[{id, name, room, role:"head"|"member", title, runtime:"claude-code", model?, effort?}], budgets:[{scope, id, dailyUsdSoft, dailyUsdHard}]}} (onboarding: the whole office at once)
- {op:"restore_version", version}`;

export class Ada {
  private readonly d: AdaDeps;

  constructor(d: AdaDeps) {
    this.d = d;
  }

  /* ---------------------------------------------------------------- chat */

  private readonly greeting = new Map<string, Promise<ChatMessage>>();

  /** The CEO says something to Ada; her reply streams through onEvent and is saved. */
  async chat(officeId: string, message: string, onEvent: (e: AdaEvent) => void = () => {}): Promise<ChatMessage> {
    if (message.trim()) return this.reply(officeId, message, onEvent);
    // Opening the chat (no message): one greeting, however many times the page asks.
    const last = (await this.d.data.history(officeId, 1)).at(-1);
    if (last?.role === "ada") {
      onEvent({ type: "done", message: last });
      return last;
    }
    let p = this.greeting.get(officeId);
    if (!p) {
      p = this.reply(officeId, "", onEvent).finally(() => this.greeting.delete(officeId));
      this.greeting.set(officeId, p);
      return p;
    }
    const m = await p;
    onEvent({ type: "done", message: m });
    return m;
  }

  private async reply(officeId: string, message: string, onEvent: (e: AdaEvent) => void): Promise<ChatMessage> {
    const onboarding = !(await this.d.data.onboarded(officeId));
    const mode = onboarding ? "onboarding" : "chat";
    const history = await this.d.data.history(officeId, 24);
    if (message.trim()) await this.d.data.say(officeId, { role: "ceo", content: message.trim(), cards: [], mode });

    const cards: Card[] = [];
    const tools = this.tools(officeId, { cards, onCard: (c) => onEvent({ type: "card", card: c }), mode });
    const transcript = history
      .map((m) => `${m.role === "ceo" ? "CEO" : "Ada"}: ${m.content}${m.cards.map((c) => `\n  [read-back card "${c.summary}": ${c.state}${c.version ? `, now version ${c.version}` : ""}]`).join("")}`)
      .join("\n");
    const prompt = [
      `The office now:\n${await this.overview(officeId)}`,
      transcript ? `Your conversation so far:\n${transcript}` : "",
      message.trim() ? `The CEO says: ${message.trim()}` : onboarding ? "The CEO just arrived. Greet them and start the interview." : "The CEO opened your chat. Say what needs them, briefly.",
    ]
      .filter(Boolean)
      .join("\n\n");

    const { text } = await this.d.brain.run({
      system: [PERSONA, onboarding ? ONBOARDING : "", OPS_HELP].filter(Boolean).join("\n\n"),
      prompt,
      tools,
      onText: (delta) => onEvent({ type: "text", delta }),
    });
    const reply = await this.d.data.say(officeId, { role: "ada", content: text || "Done.", cards, mode });
    onEvent({ type: "done", message: reply });
    return reply;
  }

  /** The CEO confirms a read-back card from Ada: it's applied as the CEO. */
  async confirm(officeId: string, cardId: string): Promise<{ version: number; readback: string[] }> {
    const card = await this.d.data.findCard(officeId, cardId);
    if (!card) throw new PolicyError(["That read-back isn't there any more."]);
    if (card.state !== "pending") throw new PolicyError([`That read-back was already ${card.state}.`]);
    try {
      const r = await this.d.setup.apply(officeId, card.ops as ClientOp[], card.baseVersion, "ceo");
      await this.d.data.updateCard(officeId, cardId, { state: "applied", version: r.version });
      // The onboarding read-back builds the office: onboarding is done.
      if (card.ops.some((o: any) => o.op === "replace_setup") && !(await this.d.data.onboarded(officeId))) {
        await this.d.data.markOnboarded(officeId, (card as Card & { company?: object }).company ?? {});
      }
      await this.d.data.say(officeId, { role: "ada", content: `Done: that's version ${r.version} of the office.`, cards: [], mode: "chat" });
      return r;
    } catch (err) {
      if (/changed since/.test((err as Error).message)) await this.d.data.updateCard(officeId, cardId, { state: "stale" });
      throw err;
    }
  }

  async dismiss(officeId: string, cardId: string): Promise<void> {
    await this.d.data.updateCard(officeId, cardId, { state: "dismissed" });
  }

  /* ---------------------------------------------------------------- jobs */

  /** New inbox items: Ada sets priorities with a note on each, and handles meeting requests. */
  async triage(officeId: string): Promise<number> {
    const items = (await this.d.data.inbox(officeId)).filter((i) => !i.adaNote);
    if (!items.length) return 0;
    const tools = this.tools(officeId, { cards: [], mode: "job" }).filter((t) =>
      ["triage_inbox", "schedule_meeting", "decline_meeting", "read_thread", "list_tasks", "memory_search"].includes(t.name),
    );
    const list = items.map((i) => `- ${i.id} [${i.kind}] from ${i.from}: ${i.title}${i.body ? ` — ${i.body.slice(0, 400)}` : ""}${i.action ? ` (action: ${JSON.stringify(i.action)})` : ""}`).join("\n");
    await this.d.brain.run({
      system: PERSONA,
      prompt: `New items in the CEO's inbox:\n${list}\n\nTriage every one with triage_inbox: priority 1 (needs the CEO first: decisions blocking work, merges, permission asks), 2 (today), 3 (FYI), and a one-line note from you on top of each (what it is and what you recommend). Meeting requests: if a decision needs the CEO and heads together, schedule_meeting with an agenda and a pre-read (the question, the options, each side's position); otherwise decline_meeting with a reply that gets them unblocked.\n\nThe office now:\n${await this.overview(officeId)}`,
      tools,
      maxTurns: 8,
    });
    return items.length;
  }

  /** The daily briefing: what shipped, what's blocked, what needs the CEO. An inbox item. */
  async briefing(officeId: string, day = new Date()): Promise<string> {
    const { text } = await this.d.brain.run({
      system: PERSONA,
      prompt: `Write the CEO's daily briefing for ${day.toISOString().slice(0, 10)}, in three short parts: Shipped (done since yesterday), Blocked (and what unblocks it), Needs you (in priority order). Plain sentences, names not ids, under 200 words. Use the tools if you need detail.\n\nThe office now:\n${await this.overview(officeId)}`,
      tools: this.tools(officeId, { cards: [], mode: "job" }).filter((t) => ["list_tasks", "read_thread", "memory_search", "spend"].includes(t.name)),
      maxTurns: 6,
    });
    await this.d.data.raise(officeId, { id: `A-briefing-${day.toISOString().slice(0, 10)}`, kind: "briefing", from: "ada", title: `Daily briefing, ${day.toDateString()}`, body: text, priority: 2 });
    return text;
  }

  /** Minutes from a meeting's transcript: summary, decisions, action items with owners. */
  async minutes(officeId: string, meeting: Meeting, transcript: string): Promise<Minutes> {
    let out: Minutes = { meetingId: meeting.id, summary: "", decisions: [], actionItems: [] };
    const record: AdaTool = {
      name: "record_minutes",
      description: "Record the meeting's minutes.",
      shape: {
        summary: z.string(),
        decisions: z.array(z.object({ text: z.string(), rationale: z.string().optional(), room: z.string().optional().describe("The room it concerns (id).") })),
        action_items: z.array(z.object({ text: z.string(), owner: z.string().describe("Agent id."), due: z.string().optional() })),
      },
      run: async (a) => {
        out = { meetingId: meeting.id, summary: a.summary, decisions: a.decisions, actionItems: a.action_items };
        return "Recorded.";
      },
    };
    await this.d.brain.run({
      system: PERSONA,
      prompt: `Write the minutes of the meeting "${meeting.title}" (attendees: ${meeting.attendees.join(", ")}). Call record_minutes once: a short summary; each decision with its rationale and the room it concerns; each action item with an owner (an attendee's agent id). Only what was actually decided or agreed; deferrals are action items with an owner.\n\nTranscript:\n${transcript}`,
      tools: [record],
      maxTurns: 3,
    });
    if (!out.summary) throw new Error("Ada didn't record the minutes.");
    return out;
  }

  /* --------------------------------------------------------------- tools */

  private tools(officeId: string, ctx: { cards: Card[]; onCard?: (c: Card) => void; mode: "chat" | "onboarding" | "job" }): AdaTool[] {
    const d = this.d;
    const setupOf = async () => (await d.setup.get(officeId)).setup;
    const name = (setup: OfficeSetup, id: string) => (id === "ceo" ? "CEO" : id === "ada" ? "Ada" : setup.agents.find((a) => a.id === id)?.name ?? id);
    return [
      {
        name: "office_overview",
        description: "The office right now: rooms and agents with what they're doing, open work, the inbox, meetings, spend, locked rules.",
        shape: {},
        run: () => this.overview(officeId),
      },
      {
        name: "list_tasks",
        description: "Tasks, newest first, with owner, status, progress, step and blocker.",
        shape: { status: z.enum(["queued", "ongoing", "blocked", "review", "done"]).optional() },
        run: async (a) => (await d.data.tasks(officeId)).filter((t) => !a.status || t.status === a.status).slice(0, 60),
      },
      {
        name: "read_thread",
        description: "A conversation's messages, by thread id (T-…).",
        shape: { id: z.string() },
        run: async (a) => (await d.data.thread(officeId, a.id)) ?? `No thread ${a.id}.`,
      },
      {
        name: "memory_search",
        description: "Search everything the office remembers (all layers).",
        shape: { query: z.string() },
        run: async (a) => (await d.memory.search(officeId, await setupOf(), "ada", a.query, 10)).map((i) => ({ id: i.id, layer: i.layer, type: i.type, title: i.title, status: i.status, body: i.body.slice(0, 400) })),
      },
      {
        name: "memory_read",
        description: "A memory item in full.",
        shape: { id: z.string() },
        run: async (a) => d.memory.read(officeId, await setupOf(), "ada", (await d.memory.mustGet(officeId, a.id)).id),
      },
      {
        name: "spend",
        description: "API-equivalent spend per agent over the last days.",
        shape: { days: z.number().int().min(1).max(31).optional() },
        run: async (a) => (d.spend ? d.spend.spendSince(officeId, startOfDayUtc(new Date(Date.now() - ((a.days ?? 1) - 1) * 86_400_000))) : "Spend isn't available."),
      },
      {
        name: "propose_change",
        description: "Propose a change to the office's setup. The CEO gets a read-back card to confirm; nothing changes until they do. Returns the read-back, or why it can't be done.",
        shape: { ops: z.array(z.record(z.string(), z.unknown())).describe("Setup operations (see the list in your instructions)."), why: z.string().describe("One line for the CEO.") },
        run: async (a) => {
          try {
            const p = await d.setup.propose(officeId, a.ops as ClientOp[], "ada");
            const card: Card = { id: randomUUID(), type: "proposal", ops: a.ops, baseVersion: p.baseVersion, readback: p.readback, summary: a.why || p.summary, state: "pending" };
            ctx.cards.push(card);
            ctx.onCard?.(card);
            return `Read-back card shown to the CEO (they confirm it):\n- ${p.readback.join("\n- ")}`;
          } catch (err) {
            if (err instanceof PolicyError) return `Can't propose that: ${err.problems.join(" ")}`;
            throw err;
          }
        },
      },
      {
        name: "message_agent",
        description: "Message an agent on the CEO's behalf (their head is copied).",
        shape: { to: z.string().describe("Agent id."), text: z.string() },
        run: async (a) => {
          await d.hub.call(officeId, "ceo_message", { to: a.to, text: `From Ada, for the CEO: ${a.text}` });
          return "Sent.";
        },
      },
      {
        name: "remember",
        description: "Save to company memory, or a CEO preference (filtered to rooms if given). Use replaces to update an item; corrections become preferences.",
        shape: {
          layer: z.enum(["company", "ceo"]),
          type: z.string().describe("fact, decision, preference, goal, rule, charter..."),
          title: z.string(),
          body: z.string(),
          tags: z.array(z.string()).optional(),
          rooms: z.array(z.string()).optional(),
          replaces: z.string().optional(),
        },
        run: async (a) => {
          const replaces = a.replaces ? (await d.memory.mustGet(officeId, a.replaces)).id : undefined;
          const r = await d.memory.write(officeId, await setupOf(), "ada", { layer: a.layer, type: a.type, title: a.title, body: a.body, tags: a.tags, rooms: a.rooms ?? null, replaces });
          return r.note;
        },
      },
      {
        name: "suggest_room_memory",
        description: "Suggest an item for a room's memory; its head accepts or rejects it.",
        shape: { room: z.string(), type: z.string(), title: z.string(), body: z.string() },
        run: async (a) => (await d.memory.write(officeId, await setupOf(), "ada", { layer: "room", scopeId: a.room, type: a.type, title: a.title, body: a.body })).note,
      },
      {
        name: "triage_inbox",
        description: "Set inbox priorities (1 needs the CEO first, 2 today, 3 FYI) with a one-line note on each.",
        shape: { items: z.array(z.object({ id: z.string(), priority: z.number().int().min(1).max(3), note: z.string() })) },
        run: async (a) => {
          for (const i of a.items) await d.data.triage(officeId, i.id, i.priority, i.note);
          return `Triaged ${a.items.length}.`;
        },
      },
      {
        name: "schedule_meeting",
        description: "Book a meeting of the CEO with heads, with an agenda and a pre-read (the question, the options, each side's position).",
        shape: {
          topic: z.string(),
          attendees: z.array(z.string()).describe("Agent ids of the heads attending."),
          agenda: z.array(z.string()),
          pre_read: z.string(),
          chair: z.enum(["ada", "ceo"]).optional(),
          request_inbox_id: z.string().optional().describe("The meeting request this answers."),
        },
        run: async (a) => {
          const setup = await setupOf();
          const heads = a.attendees.filter((id: string) => setup.agents.some((x) => x.id === id));
          if (!heads.length) return "Name at least one attendee by agent id.";
          const m = await d.data.saveMeeting(officeId, {
            title: a.topic,
            requestedBy: a.request_inbox_id ? (await d.data.inbox(officeId)).find((i) => i.id === a.request_inbox_id)?.from ?? "ada" : "ada",
            chair: a.chair ?? "ada",
            attendees: heads,
            agenda: a.agenda,
            preRead: a.pre_read,
            state: "scheduled",
            requestInboxId: a.request_inbox_id ?? null,
          });
          if (a.request_inbox_id) await d.data.triage(officeId, a.request_inbox_id, 1, `Booked as a meeting: "${a.topic}". Open it from Meetings when you're ready.`);
          return `Booked "${m.title}" with ${heads.map((h: string) => name(setup, h)).join(", ")}. The CEO starts it from Meetings.`;
        },
      },
      {
        name: "decline_meeting",
        description: "Answer a meeting request without a meeting: your reply goes to the head, and the request is closed.",
        shape: { request_inbox_id: z.string(), reply: z.string() },
        run: async (a) => {
          const item = (await d.data.inbox(officeId)).find((i) => i.id === a.request_inbox_id);
          if (!item) return `No open request ${a.request_inbox_id}.`;
          await d.hub.call(officeId, "ceo_message", { to: item.from, text: `From Ada, about your meeting request "${item.title}": ${a.reply}` });
          await d.hub.call(officeId, "resolve_inbox", { id: item.id }).catch(() => {});
          return "Replied and closed.";
        },
      },
      ...(ctx.mode === "onboarding"
        ? [
            {
              name: "finish_onboarding",
              description: "Record what you learned about the company (company memory) once you've proposed the office.",
              shape: { company_name: z.string(), what_it_does: z.string(), goals: z.array(z.string()), rules: z.array(z.string()).describe("Rules that must never break."), preferences: z.array(z.string()).optional() },
              run: async (a: any) => {
                const setup = await setupOf();
                await d.memory.write(officeId, setup, "ada", { layer: "company", type: "charter", title: `${a.company_name}: what we do`, body: a.what_it_does, tags: ["charter"] });
                if (a.goals.length) await d.memory.write(officeId, setup, "ada", { layer: "company", type: "goal", title: "Goals", body: a.goals.map((g: string) => `- ${g}`).join("\n"), tags: ["goals"] });
                if (a.rules.length) await d.memory.write(officeId, setup, "ada", { layer: "company", type: "rule", title: "Rules that must never break", body: a.rules.map((g: string) => `- ${g}`).join("\n"), tags: ["rules"] });
                for (const p of a.preferences ?? []) await d.memory.write(officeId, setup, "ada", { layer: "ceo", type: "preference", title: p.slice(0, 80), body: p });
                // The office is onboarded when the CEO confirms the setup card; keep the company with it.
                for (const c of ctx.cards) Object.assign(c, { company: { name: a.company_name, does: a.what_it_does, goals: a.goals, rules: a.rules } });
                return "Company memory saved.";
              },
            } satisfies AdaTool,
          ]
        : []),
    ];
  }

  /** A compact picture of the office, for every run. */
  async overview(officeId: string): Promise<string> {
    const [{ setup, version }, agents, tasks, inbox, meetings] = await Promise.all([
      this.d.setup.get(officeId),
      this.d.data.agents(officeId),
      this.d.data.tasks(officeId),
      this.d.data.inbox(officeId),
      this.d.data.meetings(officeId),
    ]);
    const state = new Map(agents.map((a) => [a.id, a]));
    const name = (id: string) => setup.agents.find((a) => a.id === id)?.name ?? id;
    const lines: string[] = [`${setup.name} (setup version ${version}).`];
    for (const r of setup.rooms) {
      lines.push(`Room ${r.name} (${r.id})${r.purpose ? `: ${r.purpose}` : ""}. When blocked: ${(r.whenBlocked ?? "park_and_switch").replaceAll("_", " ")}; PRs: ${r.publish ?? "drafts"}.`);
      for (const a of setup.agents.filter((x) => x.room === r.id)) {
        const s = state.get(a.id);
        lines.push(`  - ${a.name} (${a.id})${a.id === r.head ? ", head" : ""}: ${a.title}. ${a.model}/${a.effort}. ${s?.heldReason ? `On hold: ${s.heldReason}` : `${s?.status ?? "offline"}${s?.activity ? `: ${s.activity}` : ""}`}`);
      }
    }
    const open = tasks.filter((t) => t.status !== "done");
    lines.push(`Open tasks (${open.length}): ${open.slice(0, 12).map((t) => `${t.id} "${t.title}" ${name(t.owner)} ${t.status} ${t.progress}%${t.blocker ? ` blocked: ${t.blocker}` : ""}`).join("; ") || "none"}.`);
    lines.push(`Inbox (${inbox.length} open): ${inbox.slice(0, 12).map((i) => `${i.id} [${i.kind}, p${i.priority}] ${i.title}`).join("; ") || "empty"}.`);
    const upcoming = meetings.filter((m) => m.state === "scheduled" || m.state === "live");
    if (upcoming.length) lines.push(`Meetings: ${upcoming.map((m) => `"${m.title}" (${m.state})`).join("; ")}.`);
    if (this.d.spend) {
      const spent = (await this.d.spend.spendSince(officeId, startOfDayUtc(new Date()))).reduce((n, r) => n + r.costUsd, 0);
      const b = setup.budgets.find((x) => x.scope === "office");
      lines.push(`Spend today: $${spent.toFixed(2)} (API-equivalent)${b?.dailyUsdHard ? ` of a $${b.dailyUsdHard} daily limit` : ""}.`);
    }
    lines.push(`Locked (only the CEO changes these, in Rules and settings): ${setup.locks.map((l) => LOCK_TARGETS[l]).join("; ")}.`);
    return lines.join("\n");
  }
}
