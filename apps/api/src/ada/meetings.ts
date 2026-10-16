/**
 * Meetings: heads and the CEO, in the meeting room, as a thread in the office
 * (text only in v1). Ada books them (with a pre-read), the CEO starts them,
 * and when they end Ada writes the minutes: decisions go to the rooms'
 * decision logs, the summary to conversation memory, and each action item
 * becomes a task for its owner, tracked until it's done.
 */
import type { OfficeHub } from "../link/hub.ts";
import type { MemoryService } from "../memory/service.ts";
import type { SetupService } from "../setup/service.ts";
import type { Ada } from "./ada.ts";
import type { Meeting, Minutes, OfficeData } from "./data.ts";

export class MeetingError extends Error {}

export class Meetings {
  private readonly o: { ada: Ada; data: OfficeData; hub: OfficeHub; memory: MemoryService; setup: SetupService };

  constructor(o: { ada: Ada; data: OfficeData; hub: OfficeHub; memory: MemoryService; setup: SetupService }) {
    this.o = o;
  }

  list(officeId: string) {
    return this.o.data.meetings(officeId);
  }

  /** The CEO books one directly (Ada books the ones heads ask for). */
  schedule(officeId: string, m: { title: string; attendees: string[]; agenda: string[]; chair?: "ada" | "ceo"; preRead?: string }) {
    return this.o.data.saveMeeting(officeId, { title: m.title, attendees: m.attendees, agenda: m.agenda, chair: m.chair ?? "ceo", preRead: m.preRead ?? null, requestedBy: "ceo", state: "scheduled" });
  }

  /** Opens the meeting in the office: the heads get the agenda and the format. */
  async start(officeId: string, id: string): Promise<Meeting> {
    const m = await this.need(officeId, id);
    if (m.state !== "scheduled") throw new MeetingError(`That meeting is ${m.state}.`);
    const { threadId } = (await this.o.hub.call(officeId, "ceo_start_meeting", { topic: m.title, attendees: m.attendees, agenda: m.agenda, chair: m.chair, meeting_id: m.id })) as { threadId: string };
    if (m.requestInboxId) await this.o.hub.call(officeId, "resolve_inbox", { id: m.requestInboxId }).catch(() => {});
    return this.o.data.saveMeeting(officeId, { id: m.id, threadId, state: "live", startsAt: new Date().toISOString() });
  }

  /** Ends it, and Ada writes the minutes; decisions and action items follow. */
  async end(officeId: string, id: string): Promise<{ meeting: Meeting; minutes: Minutes }> {
    const m = await this.need(officeId, id);
    if (m.state !== "live" || !m.threadId) throw new MeetingError("That meeting isn't running.");
    const thread = await this.o.data.thread(officeId, m.threadId);
    const { setup } = await this.o.setup.get(officeId);
    const who = (id: string) => (id === "ceo" ? "CEO" : setup.agents.find((a) => a.id === id)?.name ?? id);
    const transcript = (thread?.messages ?? []).map((x) => `${who(x.from)}: ${x.body}`).join("\n\n");
    const minutes = await this.o.ada.minutes(officeId, m, transcript);

    // Each action item is a task for its owner (tracked through the task).
    for (const a of minutes.actionItems) {
      if (!setup.agents.some((x) => x.id === a.owner)) continue;
      const r = (await this.o.hub.call(officeId, "ceo_assign", { to: a.owner, title: a.text, details: `From the meeting "${m.title}".${a.due ? ` Due: ${a.due}.` : ""}` }).catch(() => null)) as { taskId: string } | null;
      if (r) a.taskId = r.taskId;
    }
    const outcome = [minutes.summary, ...minutes.decisions.map((d) => `Decided: ${d.text}`)].join(" ");
    await this.o.hub.call(officeId, "ceo_end_meeting", { thread_id: m.threadId, outcome: outcome.slice(0, 1500) }).catch(() => {});

    // Memory: the minutes for the attendees, decisions in each room's decision log.
    const ids: string[] = [];
    const rooms = [...new Set(m.attendees.map((a) => setup.agents.find((x) => x.id === a)?.room).filter(Boolean))] as string[];
    ids.push(
      (
        await this.o.memory.write(officeId, setup, "system", {
          layer: "conversation",
          scopeId: m.threadId,
          type: "minutes",
          title: `Minutes: ${m.title}`,
          body: [minutes.summary, ...minutes.decisions.map((d) => `Decision: ${d.text}${d.rationale ? ` (${d.rationale})` : ""}`), ...minutes.actionItems.map((a) => `Action: ${a.text} (${who(a.owner)})`)].join("\n"),
          source: { threadId: m.threadId, meetingId: m.id, participants: ["ceo", ...m.attendees], rooms },
          tags: ["minutes", ...rooms],
        })
      ).item.id,
    );
    for (const d of minutes.decisions) {
      const room = d.room && setup.rooms.some((r) => r.id === d.room) ? d.room : rooms[0];
      if (!room) continue;
      ids.push((await this.o.memory.write(officeId, setup, "system", { layer: "room", scopeId: room, type: "decision", title: `Decision: ${d.text.slice(0, 100)}`, body: `${d.text}${d.rationale ? `\nWhy: ${d.rationale}` : ""}\nFrom the meeting "${m.title}".`, source: { meetingId: m.id, threadId: m.threadId }, tags: ["decision", "meeting"] })).item.id);
    }
    await this.o.data.saveMinutes(officeId, minutes, ids);
    return { meeting: await this.o.data.saveMeeting(officeId, { id: m.id, state: "ended" }), minutes };
  }

  /** Minutes with each action item's task status (Ada tracks them until done). */
  async minutes(officeId: string, id: string) {
    const min = await this.o.data.minutes(officeId, id);
    if (!min) return null;
    const tasks = new Map((await this.o.data.tasks(officeId)).map((t) => [t.id, t]));
    return { ...min, actionItems: min.actionItems.map((a) => ({ ...a, status: a.taskId ? tasks.get(a.taskId)?.status ?? "unknown" : "not assigned" })) };
  }

  private async need(officeId: string, id: string): Promise<Meeting> {
    const m = await this.o.data.meeting(officeId, id);
    if (!m) throw new MeetingError("No such meeting.");
    return m;
  }
}
