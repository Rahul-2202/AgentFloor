"use client";

import { useEffect, useRef, useState } from "react";
import { meetingMinutes, scheduleMeeting } from "@/lib/api";
import { useSim } from "@/sim/store";
import { Btn, Empty, Face, Section, Segmented, Window } from "../bits";
import { useUI } from "../ui";
import { nameOf } from "../who";

/** Booking a meeting: who, the agenda, and who chairs. Ada writes the pre-read. */
export function MeetingPlanner({ from }: { from: string }) {
  const { s, act } = useSim();
  const ui = useUI();
  const heads = Object.values(s.rooms).map((r) => r.head);
  const everyone = Object.values(s.rooms).flatMap((r) => [r.head, ...r.members.filter((m) => m !== r.head)]);
  const requester = from !== "ada" && from !== "you" ? from : null;
  const [title, setTitle] = useState(requester ? `Sync with ${nameOf(requester)}` : "Heads sync");
  const [who, setWho] = useState<string[]>(requester ? [requester] : heads);
  const [agenda, setAgenda] = useState("Where each room is\nWhat's blocked\nWhat we do next");
  const [chair, setChair] = useState<"ada" | "ceo">("ada");
  const [busy, setBusy] = useState(false);

  const book = async (now: boolean) => {
    if (!title.trim() || !who.length) return;
    setBusy(true);
    try {
      const r = await scheduleMeeting({ title: title.trim(), attendees: who, agenda: agenda.split("\n").map((x) => x.trim()).filter(Boolean), chair });
      if (now) {
        await act.startMeeting(r.meeting.id);
        ui.openWin({ kind: "meeting", id: r.meeting.id });
      } else {
        act.toast("Booked. I'm writing the pre-read now.");
        ui.closeWin();
      }
    } catch (e) {
      act.toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Window
      width={560}
      onClose={ui.closeWin}
      icon={<Face id="ada" size={32} />}
      title={requester ? `Meet with ${nameOf(requester)}` : "Call a meeting"}
      sub="Ada books the room, invites people and prepares the pre-read"
      footer={
        <div className="flex justify-end gap-2 border-t border-black/[0.06] px-4 py-3">
          <Btn disabled={busy || !who.length} onClick={() => void book(false)}>
            Book it
          </Btn>
          <Btn tone="dark" disabled={busy || !who.length || s.machine !== "started"} onClick={() => void book(true)}>
            {busy ? "…" : "Start now"}
          </Btn>
        </div>
      }
    >
      <div className="flex flex-col gap-4 p-4">
        {!everyone.length ? (
          <Empty>No one to meet yet. Set up a room first.</Empty>
        ) : (
          <>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="h-11 rounded-[12px] bg-[#f6f5f2] px-3.5 text-[15px] font-semibold outline-none ring-1 ring-black/[0.06]" />
            <Section title="Who">
              <div className="flex flex-wrap gap-1.5">
                {everyone.map((p) => {
                  const on = who.includes(p);
                  return (
                    <button key={p} onClick={() => setWho(on ? who.filter((x) => x !== p) : [...who, p])} className={`flex items-center gap-1.5 rounded-full py-1 pl-1 pr-2.5 text-[12px] font-semibold ring-1 ${on ? "bg-ink text-white ring-ink" : "bg-white text-ink-2 ring-black/[0.1]"}`}>
                      <Face id={p} size={20} /> {nameOf(p)}
                      {heads.includes(p) && <span className={on ? "text-white/60" : "text-faint"}>· head</span>}
                    </button>
                  );
                })}
              </div>
            </Section>
            <Section title="Chair">
              <Segmented
                size="sm"
                value={chair}
                onChange={setChair}
                options={[
                  { v: "ada", l: "Ada" },
                  { v: "ceo", l: "You" },
                ]}
              />
            </Section>
            <Section title="Agenda · one item a line">
              <textarea value={agenda} onChange={(e) => setAgenda(e.target.value)} className="h-24 w-full rounded-[12px] bg-[#f6f5f2] p-3 text-[13px] outline-none ring-1 ring-black/[0.06]" />
            </Section>
            {s.machine !== "started" && <div className="text-[12px] text-muted">The office computer is asleep: you can book now and start the meeting once it&apos;s on.</div>}
          </>
        )}
      </div>
    </Window>
  );
}

type Minutes = Awaited<ReturnType<typeof meetingMinutes>>["minutes"];

/** A meeting in the meeting room: the transcript as it happens, your say, and the minutes at the end. */
export function LiveMeeting({ id }: { id: string }) {
  const { s, act } = useSim();
  const ui = useUI();
  const m = s.data.meetings.find((x) => x.id === id);
  const convo = m?.thread_id ? s.conversations.find((c) => c.id === m.thread_id) : undefined;
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [minutes, setMinutes] = useState<Minutes>(null);
  const box = useRef<HTMLDivElement>(null);
  const lines = convo?.messages ?? [];

  useEffect(() => {
    if (m?.state === "ended") void meetingMinutes(m.id).then((r) => setMinutes(r.minutes), () => {});
  }, [m?.id, m?.state]);
  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight, behavior: "smooth" });
  }, [lines.length]);

  if (!m) return null;
  const say = () => {
    if (!text.trim() || !m.thread_id) return;
    void act.reply(m.thread_id, text.trim());
    setText("");
  };

  return (
    <div className="pointer-events-auto">
      <Window
        width={440}
        onClose={ui.closeWin}
        icon={<span className="grid h-8 w-8 place-items-center rounded-[10px] bg-[#f1eefd] text-[#4a3fa8]">◷</span>}
        title={
          <span className="flex items-center gap-1.5">
            {m.state === "live" && <span className="h-2 w-2 rounded-full bg-bad" style={{ animation: "led 1.4s steps(2) infinite" }} />}
            {m.title}
          </span>
        }
        sub={m.state === "live" ? `Chaired by ${m.chair === "ada" ? "Ada" : "you"} · ${m.attendees.length + 1} people` : m.state === "ended" ? "Meeting ended" : "Booked"}
        footer={
          <div className="border-t border-black/[0.06] px-3 py-3">
            {m.state === "live" && (
              <form
                className="mb-2 flex gap-1.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  say();
                }}
              >
                <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Say something to the room" className="h-9 min-w-0 flex-1 rounded-full bg-[#f6f5f2] px-3.5 text-[13px] outline-none ring-1 ring-black/[0.06]" />
                <Btn tone="dark">Say</Btn>
              </form>
            )}
            <div className="flex justify-end gap-2">
              {m.state === "scheduled" && (
                <Btn tone="dark" disabled={busy || s.machine !== "started"} onClick={() => (setBusy(true), void act.startMeeting(m.id).finally(() => setBusy(false)))}>
                  Start the meeting
                </Btn>
              )}
              {m.state === "live" && (
                <Btn tone="dark" disabled={busy} onClick={() => (setBusy(true), void act.endMeeting(m.id).finally(() => setBusy(false)))}>
                  {busy ? "Ada is writing the minutes…" : "End the meeting"}
                </Btn>
              )}
              {m.state === "ended" && <Btn onClick={ui.closeWin}>Close</Btn>}
            </div>
          </div>
        }
      >
        <div className="flex flex-col gap-3 p-3">
          <div className="flex -space-x-1.5">
            {["you", ...m.attendees, ...(m.chair === "ada" ? ["ada"] : [])].map((a) => (
              <span key={a} className="rounded-[10px] ring-2 ring-white" title={nameOf(a)}>
                <Face id={a} size={28} />
              </span>
            ))}
          </div>
          {m.agenda.length > 0 && (
            <ol className="list-decimal rounded-[12px] bg-[#f6f5f2] py-2 pl-7 pr-3 text-[12.5px] text-ink-2">
              {m.agenda.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ol>
          )}
          {m.pre_read && (
            <details className="rounded-[12px] bg-[#f6f5f2] p-3 text-[12.5px] text-ink-2">
              <summary className="cursor-pointer font-semibold text-ink">Pre-read</summary>
              <div className="mt-1.5 whitespace-pre-wrap">{m.pre_read}</div>
            </details>
          )}
          <div ref={box} className="flex h-[min(300px,36vh)] flex-col gap-2.5 overflow-y-auto rounded-[14px] bg-white p-3 ring-1 ring-black/[0.06]">
            {!lines.length && <div className="m-auto text-[12.5px] text-faint">{m.state === "scheduled" ? "Starts when you start it." : "Waiting for the first word…"}</div>}
            {lines.map((l, i) => (
              <div key={i} className="flex gap-2">
                <Face id={l.who} size={22} />
                <div className="min-w-0">
                  <div className="text-[11.5px]">
                    <span className="font-semibold text-ink">{nameOf(l.who)}</span> <span className="text-faint">{l.t}</span>
                  </div>
                  <div className="whitespace-pre-wrap text-[12.5px] leading-snug text-ink-2">{l.text}</div>
                </div>
              </div>
            ))}
          </div>
          {minutes && (
            <div className="rounded-[14px] bg-white p-3 ring-1 ring-black/[0.08]">
              <div className="text-[10.5px] font-bold uppercase tracking-wide text-faint">Minutes</div>
              <div className="mt-1 text-[12.5px] text-ink-2">{minutes.summary}</div>
              {minutes.decisions.map((x, i) => (
                <div key={i} className="mt-1.5 text-[13px] font-semibold text-ink">
                  {x.text}
                </div>
              ))}
              <div className="mt-2 flex flex-col gap-1">
                {minutes.actionItems.map((a, i) => (
                  <div key={i} className="flex items-center gap-2 text-[12px] text-ink-2">
                    <Face id={a.owner} size={16} /> {a.text}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Window>
    </div>
  );
}
