/**
 * Office events → rows for the tables the UI reads (threads, messages, tasks,
 * inbox, agent status, usage). Pure: the same events always give the same
 * rows, and every write is an upsert, so projecting twice is harmless.
 */
import { costOf, type CallTokens } from "@agentfloor/shared/prices";
import type { InboxItem, Message, OfficeEvent, Task, Thread } from "@agentfloor/shared/types";

export type Row = Record<string, unknown>;

export interface Projection {
  threads: Map<string, Row>;
  messages: Map<string, Row>;
  /** Messages marked delivered: id → when. */
  delivered: Map<string, string>;
  tasks: Map<string, Row>;
  inbox: Map<string, Row>;
  /** Agent id → columns to update (status, activity, held_reason). */
  agents: Map<string, Row>;
  usage: Row[];
}

const iso = (ms: number | null | undefined) => (ms ? new Date(ms).toISOString() : null);

export function project(officeId: string, events: OfficeEvent[], roomOf: (agent: string) => string | null): Projection {
  const p: Projection = { threads: new Map(), messages: new Map(), delivered: new Map(), tasks: new Map(), inbox: new Map(), agents: new Map(), usage: [] };
  const agentRow = (id: string) => p.agents.get(id) ?? (p.agents.set(id, {}), p.agents.get(id)!);

  for (const ev of events) {
    const d = ev.data as Record<string, any>;
    switch (ev.type) {
      case "thread.opened":
      case "thread.updated": {
        const t = d.thread as Thread;
        p.threads.set(t.id, {
          office_id: officeId,
          id: t.id,
          kind: t.kind,
          topic: t.topic,
          created_by: t.createdBy,
          participants: t.participants,
          state: t.state,
          parent_id: t.parentId,
          depth: t.depth,
          task_id: t.taskId,
          escalation: t.escalation,
          sent: t.sent,
          tokens: t.tokens ?? 0,
          outcome: t.outcome,
          awaiting: t.awaiting,
          created_at: iso(t.createdAt),
          updated_at: iso(t.updatedAt),
        });
        break;
      }
      case "message.sent": {
        const m = d.message as Message;
        p.messages.set(m.id, {
          office_id: officeId,
          id: m.id,
          thread_id: m.threadId,
          from: m.from,
          to: m.to,
          type: m.type,
          urgency: m.urgency,
          body: m.body,
          refs: m.refs,
          state: m.state,
          created_at: iso(m.createdAt),
          delivered_at: iso(m.deliveredAt),
        });
        break;
      }
      case "message.delivered":
        for (const id of d.ids as string[]) {
          const row = p.messages.get(id);
          if (row) Object.assign(row, { state: "delivered", delivered_at: iso(ev.at) });
          else p.delivered.set(id, iso(ev.at)!);
        }
        break;
      case "task.updated": {
        const t = d.task as Task;
        p.tasks.set(t.id, {
          office_id: officeId,
          id: t.id,
          title: t.title,
          details: t.details,
          definition_of_done: t.dod ?? null,
          room_id: t.room,
          owner_id: t.owner,
          created_by: t.createdBy,
          status: t.status,
          progress: t.progress,
          note: t.note,
          step: t.step ?? null,
          blocker: t.blocker ?? null,
          checklist: t.checklist ?? [],
          outputs: t.outputs ?? [],
          parent_id: t.parentId ?? null,
          created_at: iso(t.createdAt ?? t.updatedAt),
          updated_at: iso(t.updatedAt),
        });
        break;
      }
      case "inbox.added":
      case "inbox.resolved": {
        const i = d.item as InboxItem;
        p.inbox.set(i.id, {
          office_id: officeId,
          id: i.id,
          kind: i.kind,
          from: i.from,
          thread_id: i.threadId,
          title: i.title,
          body: i.body,
          state: i.state,
          action: i.action ?? null,
          created_at: iso(i.createdAt),
          resolved_at: i.state === "resolved" ? iso(ev.at) : null,
        });
        break;
      }
      case "agent.status":
        Object.assign(agentRow(d.agent), { status: d.status, activity: d.detail || null });
        break;
      case "agent.held":
        Object.assign(agentRow(d.agent), { held_reason: d.reason });
        break;
      case "agent.released":
        Object.assign(agentRow(d.agent), { held_reason: null });
        break;
      case "model.call":
        p.usage.push({
          office_id: officeId,
          seq: ev.seq,
          agent_id: d.agent,
          room_id: roomOf(d.agent),
          thread_id: d.threadId ?? null,
          model: d.model,
          input_tokens: d.inputTokens,
          output_tokens: d.outputTokens,
          cache_read_tokens: d.cacheReadTokens,
          cache_write_tokens: d.cacheWriteTokens,
          cost_usd: Number(costOf(d as CallTokens).toFixed(6)),
          created_at: iso(ev.at),
        });
        break;
    }
  }
  return p;
}
