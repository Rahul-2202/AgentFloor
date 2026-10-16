import { EventEmitter } from "node:events";
import { CATALOG } from "./catalog.ts";
import { Store } from "./store.ts";
import {
  CEO,
  OFFICE,
  OfficeError,
  type AgentDef,
  type AgentSettings,
  type AgentStatus,
  type DeliveryPoint,
  type InboxItem,
  type Message,
  type MsgType,
  type OfficeConfig,
  type OfficeEvent,
  type Task,
  type TaskStatus,
  type Thread,
  type ThreadKind,
  type Urgency,
} from "./types.ts";

export interface OfficeOptions {
  now?: () => number;
}

export interface OutputLine {
  at: number;
  kind: "text" | "tool" | "result" | "error" | "info" | "input";
  text: string;
}

export interface Usage {
  costUsd: number;
  /** All input the model read, including cached input. */
  inputTokens: number;
  outputTokens: number;
  /** The part of input served from the prompt cache. */
  cacheReadTokens: number;
  /** Model calls, as seen by the gateway. */
  calls: number;
  turns: number;
}

/** Which messages reach an agent at each delivery point. */
function deliverableAt(m: Message, point: DeliveryPoint): boolean {
  if (point === "turn_end") return true;
  if (point === "now") return m.urgency === "stop";
  return m.urgency !== "normal" || m.type === "ask" || m.type === "answer" || m.type === "huddle";
}

/**
 * The office protocol. Agents never talk to each other directly: every message
 * goes through here, where reach rules, budgets, hop limits, delivery timing and
 * escalation are enforced, and everything is logged.
 */
export class Office {
  readonly bus = new EventEmitter();
  readonly config: OfficeConfig;
  readonly store: Store;
  private readonly now: () => number;
  private readonly agents: Map<string, AgentDef>;

  constructor(config: OfficeConfig, store: Store, opts: OfficeOptions = {}) {
    this.config = config;
    this.store = store;
    this.now = opts.now ?? Date.now;
    this.agents = new Map(config.agents.map((a) => [a.id, a]));
    this.bus.setMaxListeners(0);
    for (const [id, u] of Object.entries(store.usage())) this.usage.set(id, u as Usage);
    // Settings the CEO changed in the console win over the config file.
    for (const [id, saved] of Object.entries(store.agentSettings())) {
      const a = this.agents.get(id);
      if (a) Object.assign(a, { runtime: saved.runtime, model: saved.model, effort: saved.effort ?? undefined });
    }
  }

  /* ------------------------------------------------------------ directory */

  agent(id: string): AgentDef {
    const a = this.agents.get(id);
    if (!a) throw new OfficeError("unknown_agent", `No agent called "${id}". Use the directory to see who's in the office.`);
    return a;
  }

  headOf(room: string): string {
    const r = this.config.rooms.find((x) => x.id === room);
    if (!r) throw new OfficeError("unknown_room", `No room called "${room}".`);
    return r.head;
  }

  directory(): { id: string; name: string; room: string; role: string; title: string }[] {
    return this.config.agents.map(({ id, name, room, role, title }) => ({ id, name, room, role, title }));
  }

  private nameOf(id: string): string {
    if (id === CEO) return "CEO";
    if (id === OFFICE) return "Office";
    return this.agents.get(id)?.name ?? id;
  }

  /* --------------------------------------------------------------- events */

  private emit(type: string, data: Record<string, unknown>): OfficeEvent {
    const ev = this.store.addEvent(this.now(), type, data);
    this.bus.emit("event", ev);
    return ev;
  }

  /* -------------------------------------------------------------- threads */

  private newThread(kind: ThreadKind, createdBy: string, participants: string[], topic: string, extra: Partial<Thread> = {}): Thread {
    const t: Thread = {
      id: this.store.nextId("T"),
      kind,
      topic,
      createdBy,
      participants: [...new Set(participants)],
      state: "open",
      parentId: null,
      depth: 0,
      taskId: null,
      awaiting: null,
      escalation: 0,
      sent: 0,
      outcome: null,
      createdAt: this.now(),
      updatedAt: this.now(),
      ...extra,
    };
    this.store.putThread(t);
    this.emit("thread.opened", { thread: t });
    return t;
  }

  thread(id: string): Thread {
    const t = this.store.getThread(id);
    if (!t) throw new OfficeError("unknown_thread", `No thread "${id}".`);
    return t;
  }

  private saveThread(t: Thread, change: string): void {
    t.updatedAt = this.now();
    this.store.putThread(t);
    this.emit("thread.updated", { thread: t, change });
  }

  /** Posts one message to each recipient. Enforces the thread's budget for agents. */
  private post(t: Thread, from: string, to: string[], type: MsgType, body: string, urgency: Urgency, refs: string[] = []): Message[] {
    const limit = this.limitOf(t);
    if (from !== CEO && from !== OFFICE && t.sent >= limit) {
      throw new OfficeError("budget_exceeded", `Thread ${t.id} has used its ${limit}-message budget and is with the CEO now.`);
    }
    const out: Message[] = [];
    for (const recipient of to) {
      if (recipient === from) continue;
      const m: Message = {
        id: this.store.nextId("M"),
        threadId: t.id,
        from,
        to: recipient,
        type,
        urgency,
        body,
        refs,
        // The CEO reads messages in the console; they're never "delivered" to a session.
        state: recipient === CEO ? "delivered" : "queued",
        createdAt: this.now(),
        deliveredAt: recipient === CEO ? this.now() : null,
      };
      this.store.putMessage(m);
      out.push(m);
      this.emit("message.sent", { message: m });
      if (recipient !== CEO) this.bus.emit("queued", recipient, m);
    }
    t.sent += 1;
    if (from !== CEO && from !== OFFICE && t.sent >= limit) this.overBudget(t);
    else this.saveThread(t, "message");
    return out;
  }

  private limitOf(t: Thread): number {
    return t.kind === "huddle" ? this.config.policy.huddleMaxTurns : this.config.policy.threadMaxMessages;
  }

  private overBudget(t: Thread): void {
    const huddle = t.kind === "huddle";
    t.state = "escalated";
    t.awaiting = null;
    this.saveThread(t, "budget");
    this.addInbox({
      kind: "budget",
      from: OFFICE,
      threadId: t.id,
      title: huddle ? `Huddle ${t.id} ended without agreement` : `Thread ${t.id} hit its message budget`,
      body: `"${t.topic}" between ${t.participants.map((p) => this.nameOf(p)).join(", ")} used all its messages. Read it and decide, or reply to unblock them.`,
    });
    const notice = `${huddle ? "Huddle" : "Thread"} ${t.id} used its message budget, so it's with the CEO now. Carry on with other work; the CEO's answer will come to you here.`;
    for (const p of t.participants) {
      if (p === CEO) continue;
      this.queueNotice(t, p, notice);
    }
  }

  /** A notice from the office that doesn't count against the thread's budget. */
  private queueNotice(t: Thread, to: string, body: string, urgency: Urgency = "normal", type: MsgType = "inform"): void {
    const m: Message = {
      id: this.store.nextId("M"),
      threadId: t.id,
      from: OFFICE,
      to,
      type,
      urgency,
      body,
      refs: [],
      state: "queued",
      createdAt: this.now(),
      deliveredAt: null,
    };
    this.store.putMessage(m);
    this.emit("message.sent", { message: m });
    this.bus.emit("queued", to, m);
  }

  private addInbox(i: Omit<InboxItem, "id" | "state" | "createdAt">): InboxItem {
    const item: InboxItem = { ...i, id: this.store.nextId("I"), state: "open", createdAt: this.now() };
    this.store.putInbox(item);
    this.emit("inbox.added", { item });
    return item;
  }

  /* ---------------------------------------------------------------- rules */

  /**
   * The question an agent is working on answering, if any: someone is waiting on
   * it and the question has reached it. An ask it sends now is a follow-up.
   */
  private handling(agent: string): Thread | undefined {
    const open = this.store
      .threads()
      .filter(
        (t) =>
          t.state !== "resolved" &&
          t.awaiting?.from === agent &&
          t.awaiting.by !== agent &&
          this.store.threadMessages(t.id).some((m) => m.to === agent && m.state === "delivered"),
      );
    return open.at(-1);
  }

  /** Agents waiting, directly or up the chain, on the thread `start`. */
  private waitingChain(start: Thread | undefined): { ids: Set<string>; path: string[] } {
    const ids = new Set<string>();
    const path: string[] = [];
    let t = start;
    while (t) {
      path.unshift(t.id);
      if (t.awaiting) ids.add(t.awaiting.by);
      t = t.parentId ? this.store.getThread(t.parentId) : undefined;
    }
    return { ids, path };
  }

  private checkWorkRoute(from: string, to: string): void {
    const sender = from === CEO ? undefined : this.agent(from);
    const target = this.agent(to);
    if (sender && sender.room !== target.room && target.role !== "head") {
      const head = this.headOf(target.room);
      throw new OfficeError(
        "route",
        `Work for ${target.name} goes through their head. Send it to ${this.nameOf(head)} (${head}) with request_work; questions can still go to ${target.name} directly with ask.`,
      );
    }
  }

  /* ---------------------------------------------------------- agent calls */

  ask(from: string, a: { to: string; question: string; urgency?: Urgency; refs?: string[]; taskId?: string; because?: string }) {
    this.agent(from);
    if (a.to === CEO) throw new OfficeError("route", "To ask the CEO, use ask_ceo.");
    if (a.to === from) throw new OfficeError("route", "You can't ask yourself.");
    this.agent(a.to);
    if (a.urgency === "stop") throw new OfficeError("not_allowed", "Use stop to halt an agent; ask can be normal or urgent.");

    const parent = a.because ? this.thread(a.because) : this.handling(from);
    const chain = this.waitingChain(parent);
    if (chain.ids.has(a.to)) {
      throw new OfficeError(
        "cycle",
        `${this.nameOf(a.to)} is already waiting on you (${chain.path.join(" → ")}). Answer them with what you know instead of asking back, or use ask_ceo.`,
      );
    }
    const depth = parent ? parent.depth + 1 : 0;
    if (depth > this.config.policy.maxHops) {
      throw new OfficeError(
        "hop_limit",
        `This question is ${depth} hops down a chain (${chain.path.join(" → ")}). Answer with what you know, or use ask_ceo.`,
      );
    }

    const t = this.newThread("message", from, [from, a.to], a.question.slice(0, 120), {
      parentId: parent?.id ?? null,
      depth,
      taskId: a.taskId ?? null,
      awaiting: { by: from, from: a.to, deadlineAt: this.now() + this.config.policy.askDeadlineSec * 1000 },
    });
    const [m] = this.post(t, from, [a.to], "ask", a.question, a.urgency ?? "normal", a.refs);
    return { threadId: t.id, messageId: m!.id };
  }

  reply(from: string, a: { threadId: string; text: string; resolves?: boolean; refs?: string[] }) {
    const t = this.thread(a.threadId);
    if (from !== CEO) this.agent(from);
    if (!t.participants.includes(from)) {
      if (from !== CEO) throw new OfficeError("not_allowed", `You're not in thread ${t.id}.`);
      t.participants.push(CEO);
    }
    if (t.state === "resolved") throw new OfficeError("thread_closed", `Thread ${t.id} is resolved. Start a new one with ask or inform.`);

    const huddle = t.kind === "huddle";
    if (from === CEO && t.state === "escalated") {
      // The CEO unblocks it: the thread reopens with a fresh budget.
      t.state = "open";
      t.sent = 0;
    }
    if (t.awaiting && t.awaiting.by !== from) t.awaiting = null;
    const to = t.participants.filter((p) => p !== from && p !== OFFICE);
    const msgs = this.post(t, from, to, huddle ? "huddle" : "answer", a.text, huddle ? "urgent" : "normal", a.refs);
    if (huddle && t.state === "open") {
      // Each huddle turn waits on the others; the deadline keeps it moving.
      const next = to.find((p) => p !== CEO);
      if (next) t.awaiting = { by: from, from: next, deadlineAt: this.now() + this.config.policy.askDeadlineSec * 1000 };
    }
    if (a.resolves && !huddle) t.state = "resolved";
    else if (t.state === "escalated" && !t.awaiting && t.sent < this.limitOf(t)) t.state = "open";
    this.saveThread(t, a.resolves ? "resolved" : "reply");
    if (!t.awaiting) this.resolveInboxFor(t.id);
    return { threadId: t.id, messageIds: msgs.map((m) => m.id), state: t.state };
  }

  inform(from: string, a: { to: string; text: string; urgency?: Urgency; refs?: string[] }) {
    if (from !== CEO) this.agent(from);
    let to: string[];
    let topic: string;
    if (a.to === "all") {
      to = this.config.agents.map((x) => x.id);
      topic = "To everyone";
    } else if (a.to.startsWith("room:")) {
      const room = a.to.slice(5);
      this.headOf(room);
      to = this.config.agents.filter((x) => x.room === room).map((x) => x.id);
      topic = `To room ${room}`;
    } else {
      if (a.to !== CEO) this.agent(a.to);
      to = [a.to];
      topic = a.text.slice(0, 120);
    }
    if (a.urgency === "stop") throw new OfficeError("not_allowed", "Use stop to halt an agent.");
    const t = this.newThread("message", from, [from, ...to], topic);
    const msgs = this.post(t, from, to, "inform", a.text, a.urgency ?? "normal", a.refs);
    t.state = "resolved";
    this.saveThread(t, "resolved");
    return { threadId: t.id, messageIds: msgs.map((m) => m.id) };
  }

  requestWork(from: string, a: { to: string; title: string; details?: string; urgency?: Urgency }) {
    if (from !== CEO) this.agent(from);
    this.checkWorkRoute(from, a.to);
    const owner = this.agent(a.to);
    const task = this.saveTask({
      id: this.store.nextId("K"),
      title: a.title,
      details: a.details ?? "",
      room: owner.room,
      owner: owner.id,
      createdBy: from,
      status: "queued",
      progress: 0,
      note: null,
      updatedAt: this.now(),
    });
    const t = this.newThread("message", from, [from, owner.id], a.title, { taskId: task.id });
    this.post(t, from, [owner.id], "request_work", `New task ${task.id}: ${a.title}${a.details ? `\n\n${a.details}` : ""}`, a.urgency ?? "normal");
    return { taskId: task.id, threadId: t.id };
  }

  huddle(from: string, a: { with: string; topic: string; opening: string }) {
    this.agent(from);
    this.agent(a.with);
    if (a.with === from) throw new OfficeError("route", "You can't huddle with yourself.");
    const t = this.newThread("huddle", from, [from, a.with], a.topic, {
      awaiting: { by: from, from: a.with, deadlineAt: this.now() + this.config.policy.askDeadlineSec * 1000 },
    });
    this.post(t, from, [a.with], "huddle", a.opening, "urgent");
    return { threadId: t.id };
  }

  endHuddle(from: string, a: { threadId: string; outcome: string }) {
    const t = this.thread(a.threadId);
    if (t.kind !== "huddle") throw new OfficeError("not_huddle", `${t.id} is not a huddle.`);
    if (!t.participants.includes(from)) throw new OfficeError("not_allowed", `You're not in huddle ${t.id}.`);
    if (t.state === "resolved") throw new OfficeError("thread_closed", `Huddle ${t.id} already ended.`);
    t.state = "resolved";
    t.awaiting = null;
    t.outcome = a.outcome;
    this.saveThread(t, "huddle_ended");
    for (const p of t.participants) {
      if (p === from || p === CEO) continue;
      this.queueNotice(t, p, `${this.nameOf(from)} ended huddle ${t.id} ("${t.topic}"). Outcome: ${a.outcome}`, "urgent");
    }
    this.emit("huddle.ended", { threadId: t.id, outcome: a.outcome, by: from });
    return { threadId: t.id, outcome: a.outcome };
  }

  askCeo(from: string, a: { question: string; options?: string[] }) {
    const me = this.agent(from);
    if (this.config.policy.ceoReach === "heads" && me.role !== "head") {
      const head = this.headOf(me.room);
      throw new OfficeError("route", `Members ask the CEO through their head. Ask ${this.nameOf(head)} (${head}) instead.`);
    }
    const body = a.options?.length ? `${a.question}\n\nOptions:\n${a.options.map((o, i) => `${i + 1}. ${o}`).join("\n")}` : a.question;
    const t = this.newThread("message", from, [from, CEO], a.question.slice(0, 120), {
      awaiting: { by: from, from: CEO, deadlineAt: 0 },
    });
    this.post(t, from, [CEO], "ask", body, "normal");
    const item = this.addInbox({ kind: "question", from, threadId: t.id, title: a.question.slice(0, 120), body });
    return { threadId: t.id, inboxId: item.id };
  }

  stop(from: string, a: { to: string; reason: string }) {
    const target = this.agent(a.to);
    if (from !== CEO) {
      const me = this.agent(from);
      if (!(me.role === "head" && me.room === target.room)) {
        throw new OfficeError(
          "not_allowed",
          `Only ${target.name}'s head or the CEO can stop them. Raise it with ask (urgent) to ${this.nameOf(this.headOf(target.room))}.`,
        );
      }
    }
    const t = this.newThread("message", from, [from, a.to], `Stop: ${a.reason.slice(0, 100)}`);
    this.post(t, from, [a.to], "stop", a.reason, "stop");
    t.state = "resolved";
    this.saveThread(t, "resolved");
    return { threadId: t.id };
  }

  createTask(from: string, a: { owner: string; title: string; details?: string }) {
    const me = this.agent(from);
    const owner = this.agent(a.owner);
    if (me.role !== "head" || owner.room !== me.room) {
      throw new OfficeError("not_allowed", "Only a room's head can create tasks for its members. Use request_work to ask for work.");
    }
    return this.requestWork(from, { to: a.owner, title: a.title, details: a.details });
  }

  updateTask(from: string, a: { taskId: string; status?: TaskStatus; progress?: number; note?: string }) {
    const task = this.store.getTask(a.taskId);
    if (!task) throw new OfficeError("unknown_task", `No task "${a.taskId}".`);
    if (from !== CEO && from !== task.owner && from !== this.headOf(task.room)) {
      throw new OfficeError("not_allowed", `Only ${this.nameOf(task.owner)} or their head can update ${task.id}.`);
    }
    if (a.status) task.status = a.status;
    if (a.progress !== undefined) task.progress = Math.max(0, Math.min(100, Math.round(a.progress)));
    if (a.note !== undefined) task.note = a.note;
    if (task.status === "done") task.progress = 100;
    task.updatedAt = this.now();
    return this.saveTask(task);
  }

  private saveTask(t: Task): Task {
    this.store.putTask(t);
    this.emit("task.updated", { task: t });
    return t;
  }

  /* ------------------------------------------------------------ CEO calls */

  /** The CEO can reach anyone; a member's head is copied so instructions don't conflict. */
  ceoMessage(a: { to: string; text: string; urgency?: Urgency }) {
    const target = this.agent(a.to);
    if (a.urgency === "stop") return this.stop(CEO, { to: a.to, reason: a.text });
    const head = this.headOf(target.room);
    const participants = target.id === head ? [CEO, target.id] : [CEO, target.id, head];
    const t = this.newThread("message", CEO, participants, a.text.slice(0, 120));
    this.post(t, CEO, [target.id], "inform", a.text, a.urgency ?? "normal");
    if (head !== target.id) {
      this.queueNotice(t, head, `FYI, the CEO messaged ${target.name} directly: "${a.text}"`);
    }
    return { threadId: t.id };
  }

  resolveInbox(id: string) {
    const item = this.store.getInbox(id);
    if (!item) throw new OfficeError("unknown_inbox", `No inbox item "${id}".`);
    item.state = "resolved";
    this.store.putInbox(item);
    this.emit("inbox.resolved", { item });
    return item;
  }

  private resolveInboxFor(threadId: string): void {
    for (const item of this.store.inbox()) {
      if (item.threadId === threadId && item.state === "open") this.resolveInbox(item.id);
    }
  }

  /* ------------------------------------------------------------- delivery */

  pending(agent: string, point: DeliveryPoint): Message[] {
    return this.store.queuedFor(agent).filter((m) => deliverableAt(m, point));
  }

  /** Hands an agent the messages due at this point and marks them delivered. */
  take(agent: string, point: DeliveryPoint): Message[] {
    return this.markDelivered(agent, point, this.store.queuedFor(agent).filter((m) => deliverableAt(m, point)));
  }

  private markDelivered(agent: string, point: string, due: Message[]): Message[] {
    for (const m of due) {
      m.state = "delivered";
      m.deliveredAt = this.now();
      this.store.putMessage(m);
    }
    if (due.length) this.emit("message.delivered", { agent, point, ids: due.map((m) => m.id) });
    return due;
  }

  /** What `wait` hands back: the awaited thread, plus questions and stops, so a waiting agent can't deadlock. */
  private takeForWait(agent: string, threadId?: string): Message[] {
    const due = this.store.queuedFor(agent).filter((m) => !threadId || m.threadId === threadId || deliverableAt(m, "tool"));
    return this.markDelivered(agent, "wait", due);
  }

  /**
   * Blocks until a message arrives for the agent (in one thread, or any), or the
   * timeout passes. The universal fallback for runtimes that can't be reached
   * mid-task. Questions to the waiting agent also end the wait, so two agents
   * waiting on each other still get to answer.
   */
  wait(agent: string, a: { threadId?: string; timeoutMs: number }): Promise<Message[]> {
    this.agent(agent);
    if (a.threadId) this.thread(a.threadId);
    const ready = this.takeForWait(agent, a.threadId);
    if (ready.length) return Promise.resolve(ready);
    return new Promise((resolve) => {
      const onQueued = (to: string, m: Message) => {
        if (to !== agent || (a.threadId && m.threadId !== a.threadId && !deliverableAt(m, "tool"))) return;
        // Let anything sent in the same tick land too.
        setImmediate(() => finish(this.takeForWait(agent, a.threadId)));
      };
      const timer = setTimeout(() => finish([]), a.timeoutMs);
      let done = false;
      const finish = (msgs: Message[]) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this.bus.off("queued", onQueued);
        resolve(msgs);
      };
      this.bus.on("queued", onQueued);
    });
  }

  /** Formats delivered messages as the turn text an agent reads. */
  render(msgs: Message[]): string {
    if (!msgs.length) return "";
    return msgs
      .map((m) => {
        const t = this.store.getThread(m.threadId);
        const from = m.from === OFFICE ? "Office" : m.from === CEO ? "CEO" : `${this.nameOf(m.from)} (${m.from})`;
        const kind = t?.kind === "huddle" ? "huddle" : m.type;
        const how =
          m.type === "ask" || (t?.kind === "huddle" && t.state === "open")
            ? `Answer with reply(thread_id="${m.threadId}", ...).`
            : m.type === "request_work"
              ? `This is new work for you${t?.taskId ? ` (task ${t.taskId})` : ""}; update it with update_task.`
              : m.type === "stop"
                ? "Stop what you're doing now and wait for instructions."
                : "";
        const extra = t?.kind === "huddle" && t.state === "open" ? " When you agree, end it with end_huddle(thread_id, outcome)." : "";
        return [
          `── Office message ${"─".repeat(30)}`,
          `From: ${from} · ${kind} · ${m.urgency} · thread ${m.threadId}${t?.taskId ? ` · task ${t.taskId}` : ""}`,
          m.body,
          m.refs.length ? `Refs: ${m.refs.join(", ")}` : "",
          how + extra,
          "─".repeat(48),
        ]
          .filter(Boolean)
          .join("\n");
      })
      .join("\n\n");
  }

  /* ----------------------------------------------------------------- time */

  /** Escalates unanswered questions: first to the asker's head, then to the CEO. */
  tick(): void {
    const now = this.now();
    for (const t of this.store.threads()) {
      if (t.state === "resolved" || !t.awaiting || !t.awaiting.deadlineAt || now < t.awaiting.deadlineAt) continue;
      const { by: asker, from: waitingOn } = t.awaiting;
      const question = [...this.store.threadMessages(t.id)].reverse().find((m) => m.from === asker)?.body ?? t.topic;
      const askerDef = this.agents.get(asker);
      const head = askerDef ? this.headOf(askerDef.room) : undefined;
      const sec = this.config.policy.askDeadlineSec;
      const waited = sec < 60 ? `${sec} s` : `${Math.round(sec / 6) / 10} min`;

      if (t.escalation === 0 && head && head !== asker && head !== waitingOn) {
        t.escalation = 1;
        if (!t.participants.includes(head)) t.participants.push(head);
        t.awaiting = { by: asker, from: head, deadlineAt: now + this.config.policy.askDeadlineSec * 1000 };
        this.saveThread(t, "escalated_head");
        this.queueNotice(
          t,
          head,
          `Escalated to you: ${this.nameOf(asker)} asked ${this.nameOf(waitingOn)} and got no answer in ${waited}.\n"${question}"\nAnswer on this thread if you can, or chase ${this.nameOf(waitingOn)}.`,
          "urgent",
          "ask",
        );
        this.emit("escalated", { threadId: t.id, to: head, level: 1 });
      } else {
        t.escalation = 2;
        t.state = "escalated";
        t.awaiting = { by: asker, from: CEO, deadlineAt: 0 };
        if (!t.participants.includes(CEO)) t.participants.push(CEO);
        this.saveThread(t, "escalated_ceo");
        this.addInbox({
          kind: "escalation",
          from: asker,
          threadId: t.id,
          title: `Unanswered: ${t.topic}`,
          body: `${this.nameOf(asker)} asked ${this.nameOf(waitingOn)}: "${question}" — no answer after escalation.`,
        });
        this.queueNotice(t, asker, `Your question in ${t.id} had no answer, so it's with the CEO now. Follow your room's when-blocked policy meanwhile.`);
        this.emit("escalated", { threadId: t.id, to: CEO, level: 2 });
      }
    }
  }

  /* ------------------------------------------------------- agent settings */

  settingsOf(id: string): AgentSettings {
    const a = this.agent(id);
    return { runtime: a.runtime, model: a.model ?? "", effort: a.effort ?? null };
  }

  /**
   * Changes an agent's runtime, model or effort. Without `confirm` it only
   * returns the read-back; with it, it applies the change and records a version.
   * Switching runtime gives the agent a new session on the new runtime; its
   * memory file carries over.
   */
  configureAgent(by: string, a: { agent: string; runtime?: string; model?: string; effort?: string; confirm?: boolean }) {
    const def = this.agent(a.agent);
    const before = this.settingsOf(def.id);
    const runtime = a.runtime ?? before.runtime;
    const info = CATALOG[runtime];
    if (!info) throw new OfficeError("bad_input", `Unknown runtime "${runtime}". Choose one of: ${Object.keys(CATALOG).join(", ")}.`);
    const switching = runtime !== before.runtime;
    const model = a.model ?? (switching ? info.defaultModel : before.model);
    if (!info.models.some((m) => m.id === model)) {
      throw new OfficeError("bad_input", `${info.label} has no model "${model}". Choose one of: ${info.models.map((m) => m.id).join(", ")}.`);
    }
    let effort = a.effort ?? (switching ? info.defaultEffort : before.effort);
    if (!info.efforts.length) effort = null;
    else if (!effort || !info.efforts.includes(effort)) {
      throw new OfficeError("bad_input", `${info.label} effort must be one of: ${info.efforts.join(", ")}.`);
    }
    const after: AgentSettings = { runtime, model, effort };

    const label = (r: string) => CATALOG[r]?.label ?? r;
    const modelLabel = (r: string, m: string) => CATALOG[r]?.models.find((x) => x.id === m)?.label ?? m;
    const changes: string[] = [];
    if (switching) {
      changes.push(`${def.name} will run on ${label(runtime)} instead of ${label(before.runtime)}.`);
      changes.push(`It starts a new ${label(runtime)} session. Its memory file and office threads carry over; its conversation history on ${label(before.runtime)} does not.`);
    }
    if (model !== before.model) changes.push(`Model: ${modelLabel(runtime, model)}${switching ? "" : ` (was ${modelLabel(runtime, before.model)})`}.`);
    if (effort !== before.effort && effort) changes.push(`Effort: ${effort}${before.effort && !switching ? ` (was ${before.effort})` : ""}.`);
    if (!changes.length) return { applied: false, unchanged: true, changes: [`No change: ${def.name} already runs ${label(runtime)}, ${modelLabel(runtime, model)}${effort ? `, ${effort} effort` : ""}.`], after };
    changes.push(info.note);
    if (!a.confirm) return { applied: false, changes, after };

    Object.assign(def, { runtime, model, effort: effort ?? undefined });
    this.store.putAgentSettings(def.id, after);
    const version = this.store.addVersion({
      at: this.now(),
      by,
      agent: def.id,
      summary: `${def.name}: ${label(runtime)}, ${modelLabel(runtime, model)}${effort ? `, ${effort}` : ""}`,
      changes,
      before,
      after,
    });
    this.emit("agent.configured", { agent: def.id, before, after, version: version.v });
    return { applied: true, changes, after, version: version.v };
  }

  /** True the first time it's called for a key, ever (it's stored): e.g. an agent's kickoff. */
  firstTime(key: string): boolean {
    return this.store.nextId(`once:${key}`) === `once:${key}-1`;
  }

  /* --------------------------------------------------------------- status */

  private readonly statuses = new Map<string, { status: AgentStatus; detail: string; at: number }>();

  /** Set by the supervisor from what the runtime is doing; drives the office view. */
  setStatus(agent: string, status: AgentStatus, detail = ""): void {
    const prev = this.statuses.get(agent);
    if (prev && prev.status === status && prev.detail === detail) return;
    this.statuses.set(agent, { status, detail, at: this.now() });
    this.emit("agent.status", { agent, status, detail });
  }

  /* ------------------------------------------------------- live output, cost */

  private readonly outputs = new Map<string, OutputLine[]>();
  private readonly usage = new Map<string, Usage>();

  /**
   * One line of an agent's live session (text, tool call, result). Kept in a
   * short buffer and streamed to the console, but not stored: the runtime's own
   * transcript is the record.
   */
  output(agent: string, kind: OutputLine["kind"], text: string): void {
    const line: OutputLine = { at: this.now(), kind, text: text.length > 4000 ? `${text.slice(0, 4000)}…` : text };
    const buf = this.outputs.get(agent) ?? [];
    buf.push(line);
    if (buf.length > 400) buf.splice(0, buf.length - 400);
    this.outputs.set(agent, buf);
    this.bus.emit("event", { seq: 0, at: line.at, type: "agent.output", data: { agent, ...line } } satisfies OfficeEvent);
  }

  addUsage(agent: string, u: Partial<Usage>): void {
    const cur = this.usage.get(agent) ?? { costUsd: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, calls: 0, turns: 0 };
    cur.costUsd += u.costUsd ?? 0;
    cur.inputTokens += u.inputTokens ?? 0;
    cur.outputTokens += u.outputTokens ?? 0;
    cur.cacheReadTokens += u.cacheReadTokens ?? 0;
    cur.calls += u.calls ?? 0;
    cur.turns += u.turns ?? 0;
    this.usage.set(agent, cur);
    this.store.putUsage(agent, cur);
    this.emit("agent.usage", { agent, usage: cur });
  }

  /* -------------------------------------------- model gateway: activity */

  private readonly activity = new Map<string, string>();
  private readonly workingOn = new Map<string, string[]>();

  /** What the agent is doing inside a turn ("thinking" while a model call is in flight). */
  setActivity(agent: string, what: string | null): void {
    if ((this.activity.get(agent) ?? null) === what) return;
    if (what) this.activity.set(agent, what);
    else this.activity.delete(agent);
    this.bus.emit("event", { seq: 0, at: this.now(), type: "agent.activity", data: { agent, activity: what } } satisfies OfficeEvent);
  }

  /** The threads behind the agent's current turn, so model spend can be put against them. */
  setWorkingOn(agent: string, threadIds: string[]): void {
    this.workingOn.set(agent, [...new Set(threadIds)]);
  }

  /** One model call seen by the gateway: counts toward the agent and the thread it's working on. */
  recordModelCall(agent: string, c: { provider: string; model: string; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }): void {
    const input = c.inputTokens + c.cacheReadTokens + c.cacheWriteTokens;
    this.addUsage(agent, { inputTokens: input, outputTokens: c.outputTokens, cacheReadTokens: c.cacheReadTokens, calls: 1 });
    const threadId = this.workingOn.get(agent)?.[0];
    const t = threadId ? this.store.getThread(threadId) : undefined;
    if (t) {
      t.tokens = (t.tokens ?? 0) + input + c.outputTokens;
      this.store.putThread(t);
    }
    this.bus.emit("event", { seq: 0, at: this.now(), type: "model.call", data: { agent, threadId: threadId ?? null, ...c } } satisfies OfficeEvent);
  }

  /* ------------------------------------------------------------- snapshot */

  snapshot() {
    return {
      outputs: Object.fromEntries(this.config.agents.map((a) => [a.id, this.outputs.get(a.id) ?? []])),
      activity: Object.fromEntries(this.activity),
      usage: Object.fromEntries(this.config.agents.map((a) => [a.id, this.usage.get(a.id) ?? null])),
      statuses: Object.fromEntries(
        this.config.agents.map((a) => [a.id, this.statuses.get(a.id) ?? { status: "offline", detail: "", at: 0 }]),
      ),
      office: { name: this.config.name, rooms: this.config.rooms, agents: this.config.agents, policy: this.config.policy },
      catalog: CATALOG,
      versions: this.store.versions(),
      threads: this.store.threads(),
      messages: this.store.messages(),
      tasks: this.store.tasks(),
      inbox: this.store.inbox(),
      queued: Object.fromEntries(this.config.agents.map((a) => [a.id, this.store.queuedFor(a.id).length])),
    };
  }
}
