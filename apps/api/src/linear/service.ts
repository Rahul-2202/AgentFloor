/**
 * An office's Linear: each task mirrors an issue in the office's team (and its
 * own project), synced both ways.
 *
 * Office → Linear: title, status, a label per agent, the brief, blockers and
 * notes as comments, PRs and links as attachments. Agents create and move
 * other tickets through office tools (closing one is a permission).
 * Linear → office (webhook): a status change made in Linear moves the task and
 * tells its owner; comments reach the owner; an issue labelled "AgentFloor"
 * becomes a task for a room's head. Last write wins, with an audit entry.
 */
import { createHmac } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { OfficeHub } from "../link/hub.ts";
import { LinearClient, LinearError, verifyLinearSignature, type LinearState, type StateType } from "./client.ts";

export interface LinearLink {
  teamId: string;
  teamKey: string;
  teamName: string;
  projectId: string | null;
  projectUrl: string | null;
  webhookId: string | null;
  /** Label ids by name ("AgentFloor", "agent: Bea"). */
  labels: Record<string, string>;
}

interface Synced {
  title?: string;
  stateId?: string;
  labelIds?: string[];
  description?: string;
  note?: string | null;
  blocker?: string | null;
  links?: string[];
  /** For an agent's own ticket: who made it (comments go to them). */
  agent?: string;
}
export interface Mapped {
  issueId: string;
  identifier: string;
  url: string;
  taskId: string | null;
  synced: Synced;
}

export interface LinearStore {
  link(officeId: string): Promise<LinearLink | null>;
  saveLink(officeId: string, link: LinearLink | null): Promise<void>;
  byTask(officeId: string, taskId: string): Promise<Mapped | null>;
  byIssue(officeId: string, issueId: string): Promise<Mapped | null>;
  save(officeId: string, m: Mapped): Promise<void>;
}

/** A task, as the office's task.updated events carry it. */
export interface TaskLike {
  id: string;
  title: string;
  details?: string;
  dod?: string | null;
  room?: string | null;
  owner: string;
  createdBy?: string;
  status: "queued" | "ongoing" | "blocked" | "review" | "done";
  progress?: number;
  note?: string | null;
  step?: string | null;
  blocker?: string | null;
  outputs?: { kind: string; title: string; url?: string }[];
}

export type TicketRequest =
  | { op: "create"; agent: string; agentName: string; title: string; description?: string; taskId?: string }
  | { op: "update"; agent: string; agentName: string; ticket: string; status?: "todo" | "in_progress" | "in_review" | "done" | "canceled"; comment?: string };

export class LinearUserError extends Error {}

/** Our comments end with this line, so the webhook can tell them from people's. */
const MARK = "\n\n— via AgentFloor";
const LABEL = "AgentFloor";
const FROM_LINEAR = /^From Linear ([A-Z][A-Z0-9]*-\d+)/;

export class LinearSync {
  readonly client: LinearClient;
  private readonly store: LinearStore;
  private readonly hub: OfficeHub;
  private readonly o: {
    secret: string;
    publicUrl: string | null;
    officeName: (officeId: string) => Promise<string>;
    agents: (officeId: string) => Promise<{ id: string; name: string; room: string }[]>;
    rooms: (officeId: string) => Promise<{ id: string; name: string; head: string }[]>;
    openTasks: (officeId: string) => Promise<TaskLike[]>;
    taskOf: (officeId: string, taskId: string) => Promise<TaskLike | null>;
    audit?: (officeId: string, action: string, target: string, detail: object) => Promise<void>;
    log?: (msg: string) => void;
  };
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly states = new Map<string, LinearState[]>();

  constructor(o: { client: LinearClient; store: LinearStore; hub: OfficeHub } & LinearSync["o"]) {
    this.client = o.client;
    this.store = o.store;
    this.hub = o.hub;
    this.o = o;
  }

  /** The webhook's signing secret for an office (derived, so it's never stored). */
  secretFor(officeId: string): string {
    return createHmac("sha256", this.o.secret).update(`linear-webhook:${officeId}`).digest("hex");
  }

  async status(officeId: string) {
    const link = await this.store.link(officeId);
    if (link) return { configured: true, link };
    const teams = await this.client.teams().catch(() => []);
    return { configured: true, link: null, teams };
  }

  /** Connects a team: a project for the office, labels, the webhook, then every open task gets an issue. */
  async connect(officeId: string, teamId: string): Promise<LinearLink & { warning?: string }> {
    const team = await this.client.team(teamId).catch((err: Error) => {
      throw new LinearUserError(`Can't use that team: ${err.message}`);
    });
    const labels: Record<string, string> = {};
    for (const l of team.labels) labels[l.name] = l.id;
    if (!labels[LABEL]) labels[LABEL] = await this.client.createLabel(team.id, LABEL, "#e8743b");
    const project = await this.client.createProject(team.id, `${await this.o.officeName(officeId)} (AgentFloor)`).catch(() => null);
    let webhookId: string | null = null;
    let warning: string | undefined;
    if (this.o.publicUrl) {
      try {
        webhookId = await this.client.createWebhook({ url: `${this.o.publicUrl}/linear/webhook/${officeId}`, teamId: team.id, secret: this.secretFor(officeId), label: "AgentFloor office" });
      } catch (err) {
        warning = `Changes made in Linear won't reach the office: ${(err as Error).message}`;
      }
    } else warning = "This server has no public address, so changes made in Linear won't reach the office.";
    const link: LinearLink = { teamId: team.id, teamKey: team.key, teamName: team.name, projectId: project?.id ?? null, projectUrl: project?.url ?? null, webhookId, labels };
    this.states.set(team.id, team.states);
    await this.store.saveLink(officeId, link);
    await this.o.audit?.(officeId, "linear.connected", team.key, { project: project?.url ?? null });
    void this.serial(officeId, async () => {
      for (const t of await this.o.openTasks(officeId)) await this.push(officeId, link, t).catch((err) => this.o.log?.(`linear: task ${t.id}: ${(err as Error).message}`));
    });
    return { ...link, warning };
  }

  async disconnect(officeId: string): Promise<void> {
    const link = await this.store.link(officeId);
    if (!link) return;
    if (link.webhookId) await this.client.deleteWebhook(link.webhookId).catch(() => {});
    await this.store.saveLink(officeId, null);
    await this.o.audit?.(officeId, "linear.disconnected", link.teamKey, {});
  }

  /** Tasks changed in the office: mirror them (one office at a time, in order). */
  onTasks(officeId: string, tasks: TaskLike[]): Promise<unknown> {
    if (!tasks.length) return Promise.resolve();
    return this.serial(officeId, async () => {
      const link = await this.store.link(officeId);
      if (!link) return;
      for (const t of tasks) await this.push(officeId, link, t).catch((err) => this.o.log?.(`linear: task ${t.id}: ${(err as Error).message}`));
    });
  }

  /** What an agent asks for over the office link (ticket_create, ticket_update). */
  async handle(officeId: string, req: TicketRequest): Promise<{ identifier: string; url: string; status?: string }> {
    const link = await this.store.link(officeId);
    if (!link) throw new LinearUserError("Linear isn't connected to this office. Tell your head; the CEO connects it in Rules & settings.");
    if (req.op === "create") {
      const label = await this.agentLabel(link, req.agentName, officeId);
      const states = await this.statesOf(link.teamId);
      const issue = await this.client.createIssue({
        teamId: link.teamId,
        projectId: link.projectId,
        title: req.title,
        description: `${req.description ?? ""}${req.taskId ? `\n\nRelated office task: ${req.taskId}.` : ""}\n\nCreated by ${req.agentName} (AgentFloor agent).`.trim(),
        labelIds: [link.labels[LABEL]!, label],
        stateId: pick(states, "unstarted")?.id,
      });
      await this.store.save(officeId, { issueId: issue.id, identifier: issue.identifier, url: issue.url, taskId: null, synced: { title: issue.title, stateId: issue.state.id, agent: req.agent } });
      await this.o.audit?.(officeId, "linear.ticket.created", issue.identifier, { by: req.agent, title: req.title });
      return { identifier: issue.identifier, url: issue.url };
    }
    const issue = await this.client.issue(req.ticket).catch(() => null);
    if (!issue || issue.teamId !== link.teamId) throw new LinearUserError(`There's no ticket ${req.ticket} in ${link.teamName}.`);
    const mapped = await this.store.byIssue(officeId, issue.id);
    let stateId: string | undefined;
    if (req.status) {
      const states = await this.statesOf(link.teamId);
      const want: Record<string, StateType> = { todo: "unstarted", in_progress: "started", in_review: "started", done: "completed", canceled: "canceled" };
      const st = req.status === "in_review" ? (states.find((s) => /review/i.test(s.name)) ?? pick(states, "started")) : pick(states, want[req.status]!);
      if (!st) throw new LinearUserError(`${link.teamName} has no "${req.status}" state.`);
      stateId = st.id;
      await this.client.updateIssue(issue.id, { stateId });
    }
    if (req.comment) await this.client.comment(issue.id, `**${req.agentName}:** ${req.comment}${MARK}`);
    if (mapped && stateId) await this.store.save(officeId, { ...mapped, synced: { ...mapped.synced, stateId } });
    await this.o.audit?.(officeId, "linear.ticket.updated", issue.identifier, { by: req.agent, status: req.status ?? null, comment: !!req.comment });
    return { identifier: issue.identifier, url: issue.url, status: req.status };
  }

  /** A change from Linear. Returns false when the signature doesn't check out. */
  async webhook(officeId: string, raw: Buffer, signature: string | undefined): Promise<boolean> {
    if (!verifyLinearSignature(raw, signature, this.secretFor(officeId))) return false;
    const ev = JSON.parse(raw.toString("utf8")) as LinearEvent;
    await this.serial(officeId, () => this.apply(officeId, ev)).catch((err) => this.o.log?.(`linear webhook: ${(err as Error).message}`));
    return true;
  }

  /* -------------------------------------------------------------- inside */

  private async apply(officeId: string, ev: LinearEvent) {
    const link = await this.store.link(officeId);
    if (!link) return;
    const who = ev.actor?.name ?? "someone";
    if (ev.type === "Comment" && ev.action === "create") {
      const body = String(ev.data.body ?? "");
      if (body.endsWith(MARK.trim()) || body.includes(MARK.trim())) return; // ours
      const mapped = ev.data.issueId ? await this.store.byIssue(officeId, ev.data.issueId) : null;
      if (!mapped) return;
      const owner = mapped.taskId ? (await this.o.taskOf(officeId, mapped.taskId))?.owner : mapped.synced.agent;
      if (!owner) return;
      await this.hub.call(officeId, "ceo_message", { to: owner, text: `Comment on Linear ${mapped.identifier} from ${who}:\n\n${body}` });
      await this.o.audit?.(officeId, "linear.comment", mapped.identifier, { by: who });
      return;
    }
    if (ev.type !== "Issue") return;
    const d = ev.data;
    if (d.teamId && d.teamId !== link.teamId) return;
    const mapped = d.id ? await this.store.byIssue(officeId, d.id) : null;

    if (ev.action === "create" && !mapped) {
      // Someone filed an issue for the office: labelled AgentFloor (or in the office's project).
      const labelled = (d.labelIds ?? []).includes(link.labels[LABEL] ?? "-") || (!!link.projectId && d.projectId === link.projectId);
      if (!labelled) return;
      // Give issues we're creating right now a moment to be recorded.
      await new Promise((r) => setTimeout(r, 1500));
      if (await this.store.byIssue(officeId, d.id!)) return;
      const rooms = await this.o.rooms(officeId);
      const names = new Set((d.labels ?? []).map((l) => l.name.toLowerCase()));
      const room = rooms.find((r) => names.has(r.name.toLowerCase())) ?? rooms[0];
      if (!room) return;
      const r = (await this.hub.call(officeId, "ceo_assign", {
        to: room.head,
        title: String(d.title),
        details: `From Linear ${d.identifier}: ${d.url}\n\n${d.description ?? ""}`.trim(),
      })) as { taskId?: string };
      await this.store.save(officeId, { issueId: d.id!, identifier: String(d.identifier), url: String(d.url), taskId: r.taskId ?? null, synced: { title: d.title, stateId: d.stateId } });
      await this.o.audit?.(officeId, "linear.issue.assigned", String(d.identifier), { by: who, to: room.head });
      return;
    }

    if (ev.action !== "update" || !mapped?.taskId) return;
    const task = await this.o.taskOf(officeId, mapped.taskId);
    if (!task) return;
    const synced = { ...mapped.synced };
    // A status someone set in Linear (not one we pushed): the task follows; last write wins.
    if (d.stateId && d.stateId !== mapped.synced.stateId) {
      const st = (await this.statesOf(link.teamId)).find((s) => s.id === d.stateId) ?? d.state;
      const status = st ? toStatus(st) : null;
      synced.stateId = d.stateId;
      if (status && status !== task.status) {
        await this.hub.call(officeId, "ceo_update_task", { task_id: task.id, status, note: `Moved to "${st!.name}" in Linear by ${who}.` });
        await this.hub
          .call(officeId, "ceo_message", { to: task.owner, text: `In Linear, ${who} moved ${mapped.identifier} ("${task.title}") to ${st!.name}. The task is now ${status}. If that's not right, tell me why.` })
          .catch(() => {});
        await this.o.audit?.(officeId, "linear.issue.moved", mapped.identifier, { by: who, to: st!.name, task: task.id });
      }
    }
    if (d.title && d.title !== mapped.synced.title) {
      synced.title = d.title;
      await this.o.audit?.(officeId, "linear.issue.renamed", mapped.identifier, { by: who, title: d.title });
    }
    await this.store.save(officeId, { ...mapped, synced });
  }

  /** Brings a task's issue up to date (creating it the first time). */
  private async push(officeId: string, link: LinearLink, t: TaskLike) {
    const states = await this.statesOf(link.teamId);
    const agents = await this.o.agents(officeId);
    const ownerName = agents.find((a) => a.id === t.owner)?.name ?? t.owner;
    const want = {
      title: t.title,
      stateId: toState(states, t.status)?.id,
      labelIds: [link.labels[LABEL]!, await this.agentLabel(link, ownerName, officeId)].filter(Boolean) as string[],
      description: describe(t, ownerName),
    };
    let m = await this.store.byTask(officeId, t.id);
    if (!m) {
      // A task made from a Linear issue: link it instead of filing a duplicate.
      const from = FROM_LINEAR.exec(t.details ?? "")?.[1];
      const existing = from ? await this.client.issue(from).catch(() => null) : null;
      if (existing && existing.teamId === link.teamId) {
        const prev = await this.store.byIssue(officeId, existing.id);
        m = { issueId: existing.id, identifier: existing.identifier, url: existing.url, taskId: t.id, synced: { ...(prev?.synced ?? {}), title: existing.title, stateId: existing.state.id } };
      } else {
        if (t.status === "done") return; // finished before Linear was connected
        const issue = await this.client.createIssue({ teamId: link.teamId, projectId: link.projectId, ...want });
        await this.store.save(officeId, { issueId: issue.id, identifier: issue.identifier, url: issue.url, taskId: t.id, synced: { title: want.title, description: want.description, labelIds: want.labelIds, stateId: issue.state.id, links: [] } });
        await this.extras(officeId, issue.id, t, { links: [] });
        return;
      }
    }
    const patch: { title?: string; stateId?: string; labelIds?: string[]; description?: string } = {};
    if (want.title !== m.synced.title) patch.title = want.title;
    if (want.stateId && want.stateId !== m.synced.stateId) patch.stateId = want.stateId;
    if (want.description !== m.synced.description) patch.description = want.description;
    if (want.labelIds.join() !== (m.synced.labelIds ?? []).join()) patch.labelIds = want.labelIds;
    // Saved before Linear echoes it back through the webhook, so the echo is recognised as ours.
    const synced: Synced = { ...m.synced, title: want.title, description: want.description, labelIds: want.labelIds, ...(want.stateId ? { stateId: want.stateId } : {}) };
    await this.store.save(officeId, { ...m, taskId: t.id, synced });
    if (Object.keys(patch).length) await this.client.updateIssue(m.issueId, patch);
    await this.extras(officeId, m.issueId, t, m.synced, { ...m, taskId: t.id, synced });
  }

  /** Blockers and notes as comments, PRs and links as attachments (each once). */
  private async extras(officeId: string, issueId: string, t: TaskLike, before: Synced, saved?: Mapped) {
    const next: Synced = { ...before };
    if (t.status === "blocked" && t.blocker && t.blocker !== before.blocker) await this.client.comment(issueId, `**Blocked:** ${t.blocker}${MARK}`);
    if (t.note && t.note !== before.note) await this.client.comment(issueId, `${t.note}${MARK}`);
    next.blocker = t.blocker ?? null;
    next.note = t.note ?? null;
    const links = new Set(before.links ?? []);
    for (const o of t.outputs ?? []) {
      if (!o.url || !/^https?:\/\//.test(o.url) || links.has(o.url)) continue;
      await this.client.attachLink(issueId, o.url, o.title).catch(() => {});
      links.add(o.url);
    }
    next.links = [...links];
    const m = saved ?? (await this.store.byTask(officeId, t.id));
    if (m) await this.store.save(officeId, { ...m, synced: { ...m.synced, blocker: next.blocker, note: next.note, links: next.links } });
  }

  private async agentLabel(link: LinearLink, name: string, officeId: string): Promise<string> {
    const key = `agent: ${name}`;
    if (link.labels[key]) return link.labels[key]!;
    const id = await this.client.createLabel(link.teamId, key, "#5b6cc9").catch(async () => (await this.client.team(link.teamId)).labels.find((l) => l.name === key)?.id ?? "");
    if (id) {
      link.labels[key] = id;
      await this.store.saveLink(officeId, link);
    }
    return id;
  }

  private async statesOf(teamId: string): Promise<LinearState[]> {
    if (!this.states.has(teamId)) this.states.set(teamId, (await this.client.team(teamId)).states);
    return this.states.get(teamId)!;
  }

  private serial<T>(officeId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(officeId) ?? Promise.resolve();
    const next = prev.catch(() => {}).then(fn);
    this.queues.set(officeId, next.catch(() => {}));
    return next;
  }
}

interface LinearEvent {
  action: "create" | "update" | "remove";
  type: "Issue" | "Comment" | string;
  actor?: { id?: string; name?: string };
  data: {
    id?: string;
    identifier?: string;
    url?: string;
    title?: string;
    description?: string;
    stateId?: string;
    state?: LinearState;
    teamId?: string;
    projectId?: string;
    labelIds?: string[];
    labels?: { id: string; name: string }[];
    body?: string;
    issueId?: string;
  };
}

const pick = (states: LinearState[], type: StateType) => states.find((s) => s.type === type);

function toState(states: LinearState[], status: TaskLike["status"]): LinearState | undefined {
  if (status === "queued") return pick(states, "unstarted") ?? pick(states, "backlog");
  if (status === "review") return states.find((s) => s.type === "started" && /review/i.test(s.name)) ?? pick(states, "started");
  if (status === "done") return pick(states, "completed");
  return states.find((s) => s.type === "started" && !/review/i.test(s.name)) ?? pick(states, "started");
}

function toStatus(s: LinearState): TaskLike["status"] | null {
  if (s.type === "completed" || s.type === "canceled") return "done";
  if (s.type === "started") return /review/i.test(s.name) ? "review" : "ongoing";
  if (s.type === "unstarted" || s.type === "backlog" || s.type === "triage") return "queued";
  return null;
}

function describe(t: TaskLike, owner: string): string {
  return [
    t.details?.trim(),
    t.dod ? `**Done means:** ${t.dod}` : "",
    `Owner: ${owner} (AgentFloor agent) · office task ${t.id}`,
    "_Mirrored from AgentFloor. Moving this issue moves the task; comments reach the agent._",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/* ------------------------------------------------------------------ stores */

export function supabaseLinearStore(db: SupabaseClient): LinearStore {
  const row = (r: { issue_id: string; identifier: string; url: string; task_id: string | null; synced: Synced }): Mapped => ({
    issueId: r.issue_id,
    identifier: r.identifier,
    url: r.url,
    taskId: r.task_id,
    synced: r.synced ?? {},
  });
  const ok = <T>(r: { data: T; error: { message: string } | null }, what: string): T => {
    if (r.error) throw new Error(`${what}: ${r.error.message}`);
    return r.data;
  };
  return {
    async link(officeId) {
      const r = ok(await db.from("integrations").select("config, status").eq("office_id", officeId).eq("provider", "linear").maybeSingle(), "reading Linear link");
      return r && r.status === "connected" ? (r.config as LinearLink) : null;
    },
    async saveLink(officeId, link) {
      if (!link) {
        ok(await db.from("integrations").update({ status: "disconnected" }).eq("office_id", officeId).eq("provider", "linear"), "disconnecting Linear");
        return;
      }
      ok(
        await db.from("integrations").upsert({ office_id: officeId, provider: "linear", external_id: link.teamId, config: link, status: "connected", updated_at: new Date().toISOString() }, { onConflict: "office_id,provider" }),
        "saving Linear link",
      );
    },
    async byTask(officeId, taskId) {
      const r = ok(await db.from("linear_issues").select("*").eq("office_id", officeId).eq("task_id", taskId).maybeSingle(), "reading Linear issue");
      return r ? row(r) : null;
    },
    async byIssue(officeId, issueId) {
      const r = ok(await db.from("linear_issues").select("*").eq("office_id", officeId).eq("issue_id", issueId).maybeSingle(), "reading Linear issue");
      return r ? row(r) : null;
    },
    async save(officeId, m) {
      ok(
        await db.from("linear_issues").upsert(
          { office_id: officeId, issue_id: m.issueId, identifier: m.identifier, url: m.url, task_id: m.taskId, synced: m.synced, updated_at: new Date().toISOString() },
          { onConflict: "office_id,issue_id" },
        ),
        "saving Linear issue",
      );
    },
  };
}

export function memoryLinearStore(): LinearStore & { issues: Map<string, Mapped> } {
  const links = new Map<string, LinearLink>();
  const issues = new Map<string, Mapped>();
  return {
    issues,
    link: async (o) => links.get(o) ?? null,
    saveLink: async (o, l) => void (l ? links.set(o, structuredClone(l)) : links.delete(o)),
    byTask: async (_o, t) => [...issues.values()].find((m) => m.taskId === t) ?? null,
    byIssue: async (_o, i) => issues.get(i) ?? null,
    save: async (_o, m) => void issues.set(m.issueId, structuredClone(m)),
  };
}

/** Office tasks, as the projection stored them. */
export function supabaseTaskSource(db: SupabaseClient) {
  const toTask = (r: any): TaskLike => ({
    id: r.id,
    title: r.title,
    details: r.details,
    dod: r.definition_of_done,
    room: r.room_id,
    owner: r.owner_id,
    createdBy: r.created_by,
    status: r.status,
    progress: r.progress,
    note: r.note,
    step: r.step,
    blocker: r.blocker,
    outputs: r.outputs ?? [],
  });
  return {
    async open(officeId: string): Promise<TaskLike[]> {
      const { data, error } = await db.from("tasks").select("*").eq("office_id", officeId).neq("status", "done").order("created_at");
      if (error) throw new Error(`reading tasks: ${error.message}`);
      return (data ?? []).map(toTask);
    },
    async one(officeId: string, id: string): Promise<TaskLike | null> {
      const { data, error } = await db.from("tasks").select("*").eq("office_id", officeId).eq("id", id).maybeSingle();
      if (error) throw new Error(`reading task: ${error.message}`);
      return data ? toTask(data) : null;
    },
  };
}

export { LinearError };
