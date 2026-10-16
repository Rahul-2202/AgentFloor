"use client";

import { useEffect, useMemo, useState } from "react";
import { endMeeting, meetingMinutes, officeCall, scheduleMeeting, startMeeting } from "@/lib/api";
import type { MeetingRow, OfficeData } from "@/lib/office-data";

/** Meetings with heads: booked (by Ada or the CEO), run as a conversation, closed with minutes. */
export function Meetings({ data, onDone }: { data: OfficeData; onDone: (m: string) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [f, setF] = useState({ title: "", attendees: [] as string[], agenda: "" });
  const heads = data.agents.filter((a) => a.role === "head");
  const name = (id: string) => (id === "ceo" ? "You" : data.agents.find((a) => a.id === id)?.name ?? id);
  const meeting = data.meetings.find((m) => m.id === open);

  return (
    <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
      <section className="space-y-3">
        {data.meetings.map((m) => (
          <button key={m.id} onClick={() => setOpen(m.id)} className={`w-full rounded-xl p-3 text-left ${open === m.id ? "bg-surface shadow-[var(--shadow-card)]" : "hover:bg-surface-2"}`}>
            <span className="block font-medium">{m.title}</span>
            <span className="text-xs text-muted">
              {m.state} · {m.attendees.map(name).join(", ")} · chair {m.chair === "ada" ? "Ada" : "you"}
            </span>
          </button>
        ))}
        {!data.meetings.length && <p className="text-faint">No meetings yet. Heads ask for them; Ada books them.</p>}
        <div className="rounded-2xl bg-surface p-4 shadow-[var(--shadow-card)]">
          <h3 className="font-display font-semibold">Book a meeting</h3>
          <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Topic" className="mt-3 w-full rounded-lg bg-surface-2 px-3 py-2 text-sm" />
          <div className="mt-2 flex flex-wrap gap-2 text-sm">
            {heads.map((h) => (
              <label key={h.id} className="flex items-center gap-1">
                <input type="checkbox" checked={f.attendees.includes(h.id)} onChange={(e) => setF({ ...f, attendees: e.target.checked ? [...f.attendees, h.id] : f.attendees.filter((x) => x !== h.id) })} />
                {h.name}
              </label>
            ))}
          </div>
          <textarea value={f.agenda} onChange={(e) => setF({ ...f, agenda: e.target.value })} placeholder="Agenda, one item a line" rows={3} className="mt-2 w-full rounded-lg bg-surface-2 px-3 py-2 text-sm" />
          <button
            onClick={() =>
              scheduleMeeting({ title: f.title, attendees: f.attendees, agenda: f.agenda.split("\n").filter(Boolean), chair: "ceo" }).then(
                () => (setF({ title: "", attendees: [], agenda: "" }), onDone("Booked.")),
                (e) => onDone(e.message),
              )
            }
            className="mt-2 rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-white"
          >
            Book
          </button>
        </div>
      </section>
      {meeting && <MeetingRoom m={meeting} data={data} name={name} onDone={onDone} />}
    </div>
  );
}

function MeetingRoom({ m, data, name, onDone }: { m: MeetingRow; data: OfficeData; name: (id: string) => string; onDone: (msg: string) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [minutes, setMinutes] = useState<Awaited<ReturnType<typeof meetingMinutes>>["minutes"]>(null);
  const transcript = useMemo(() => {
    const seen = new Set<string>();
    return data.messages
      .filter((x) => x.thread_id === m.thread_id)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .filter((x) => (seen.has(`${x.from}|${x.body}`) ? false : (seen.add(`${x.from}|${x.body}`), true)));
  }, [data.messages, m.thread_id]);
  useEffect(() => {
    if (m.state === "ended") void meetingMinutes(m.id).then((r) => setMinutes(r.minutes));
  }, [m.id, m.state, data.tasks]);
  const act = async (p: Promise<unknown>, msg: string) => {
    setBusy(true);
    await p.then(() => onDone(msg), (e) => onDone(e.message));
    setBusy(false);
  };
  return (
    <section className="rounded-2xl bg-surface p-4 shadow-[var(--shadow-card)]">
      <h3 className="font-display text-lg font-semibold">{m.title}</h3>
      <p className="text-sm text-muted">
        {m.attendees.map(name).join(", ")} · {m.state}
      </p>
      {m.agenda.length > 0 && (
        <ol className="mt-3 list-decimal pl-5 text-sm">
          {m.agenda.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ol>
      )}
      {m.pre_read && <p className="mt-3 whitespace-pre-wrap rounded-lg bg-surface-2 p-3 text-sm">Pre-read: {m.pre_read}</p>}
      {m.state === "scheduled" && (
        <button disabled={busy} onClick={() => act(startMeeting(m.id), "The heads are in the meeting.")} className="mt-4 rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-white">
          Start the meeting
        </button>
      )}
      {(m.state === "live" || m.state === "ended") && (
        <ul className="mt-4 space-y-3">
          {transcript.map((x) => (
            <li key={x.id}>
              <p className="text-xs text-muted">{name(x.from)}</p>
              <p className="whitespace-pre-wrap text-sm">{x.body}</p>
            </li>
          ))}
        </ul>
      )}
      {m.state === "live" && (
        <>
          <form
            className="mt-4 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!text.trim()) return;
              void act(officeCall("ceo_reply", { thread_id: m.thread_id, text }), "Said.");
              setText("");
            }}
          >
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Say something to the room" className="min-w-0 flex-1 rounded-lg bg-surface-2 px-3 py-2 text-sm" />
            <button className="rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-white">Send</button>
          </form>
          <button disabled={busy} onClick={() => act(endMeeting(m.id), "Ended. Ada wrote the minutes.")} className="mt-3 text-sm text-accent">
            {busy ? "Ada is writing the minutes…" : "End the meeting (Ada writes the minutes)"}
          </button>
        </>
      )}
      {minutes && (
        <div className="mt-4 rounded-xl bg-surface-2 p-3 text-sm">
          <p className="font-medium">Minutes</p>
          <p className="mt-1">{minutes.summary}</p>
          {minutes.decisions.map((d) => (
            <p key={d.text} className="mt-1">
              Decided: {d.text}
              {d.rationale ? ` (${d.rationale})` : ""}
            </p>
          ))}
          {minutes.actionItems.map((a) => (
            <p key={a.text} className="mt-1">
              {a.status === "done" ? "☑" : "☐"} {a.text} · {name(a.owner)} · {a.status}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}
