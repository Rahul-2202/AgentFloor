"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { DAYS } from "@/sim/catalog";
import { useSim } from "@/sim/store";
import type { CalEvent } from "@/sim/types";
import { Btn, Face, Section } from "../bits";
import { useUI } from "../ui";
import { nameOf } from "../who";

const H0 = 9;
const H1 = 17;
const PX = 46; // per hour

const KIND: Record<CalEvent["kind"], string> = {
  standup: "bg-[#eef0e8] text-[#4a5a3c] ring-[#d6dccb]",
  review: "bg-[#e8eefb] text-[#2c56b0] ring-[#c9d8f6]",
  ceo: "bg-[#f1eefd] text-[#4a3fa8] ring-[#d8d1f7]",
  request: "bg-[#fdf3e0] text-[#8a5a10] ring-[#f1d9a6] border border-dashed border-[#d99a2b]",
  external: "bg-[repeating-linear-gradient(135deg,#f0efed,#f0efed_6px,#e9e7e3_6px,#e9e7e3_12px)] text-muted ring-black/[0.06]",
  focus: "bg-[#fff4ec] text-[#a24d1f] ring-[#f3cfb6]",
  meeting: "bg-[#eaf6ee] text-[#24603a] ring-[#bfe2cb]",
};

const RULES = [
  "Every meeting has an agenda and a pre-read",
  "Heads attend; members keep working",
  "Requests from heads come to your inbox: book, make it async, or decline",
  "Minutes record decisions and action items, and Ada tracks the actions",
  "Text only for now: no voice",
];

const toMin = (t: string) => Number(t.split(":")[0]) * 60 + Number(t.split(":")[1]);

function EventDetail({ e, onClose }: { e: CalEvent; onClose: () => void }) {
  const { s, act } = useSim();
  const ui = useUI();
  const state = s.data.meetings.find((m) => m.id === e.id)?.state;
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} className="rounded-[18px] bg-white p-4 shadow-[var(--shadow-float)] ring-1 ring-black/[0.08]">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[15px] font-semibold text-ink">{e.title}</div>
          <div className="text-[12px] text-muted">
            {DAYS[e.day]} {e.start} · {state} · chaired by {e.organizer === "ada" ? "Ada" : "you"}
          </div>
        </div>
        <button onClick={onClose} className="text-muted hover:text-ink">
          ✕
        </button>
      </div>
      <div className="mt-3 flex -space-x-1.5">
        {e.attendees.map((a) => (
          <span key={a} className="rounded-[10px] ring-2 ring-white" title={nameOf(a)}>
            <Face id={a} size={26} />
          </span>
        ))}
      </div>
      {e.agenda && (
        <div className="mt-3">
          <div className="text-[10.5px] font-bold uppercase tracking-wide text-faint">Agenda</div>
          <ol className="mt-1 list-decimal pl-4 text-[12.5px] text-ink-2">
            {e.agenda.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ol>
        </div>
      )}
      {e.preread && (
        <div className="mt-3 rounded-[12px] bg-[#f6f5f2] p-3 text-[12.5px] text-ink-2">
          <span className="font-semibold text-ink">Pre-read: </span>
          {e.preread}
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {state === "scheduled" && (
          <Btn tone="dark" onClick={() => void act.startMeeting(e.id).then(() => (ui.closePanel(), ui.openWin({ kind: "meeting", id: e.id })))}>
            Start it in the meeting room
          </Btn>
        )}
        {(state === "live" || state === "ended") && (
          <Btn
            tone="dark"
            onClick={() => {
              ui.closePanel();
              ui.openWin({ kind: "meeting", id: e.id });
            }}
          >
            {state === "live" ? "Join" : "Transcript and minutes"}
          </Btn>
        )}
      </div>
    </motion.div>
  );
}

export function CalendarPanel({ initial }: { initial?: string }) {
  const { s } = useSim();
  const ui = useUI();
  const [open, setOpen] = useState<string | null>(initial && s.calendar.some((e) => e.id === initial) ? initial : null);
  // This week, Monday to Friday.
  const monday = new Date(s.now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const TODAY = (new Date(s.now).getDay() + 6) % 7;
  const meetingOf = (id: string) => s.data.meetings.find((m) => m.id === id);
  const events = s.calendar.filter((e) => new Date(meetingOf(e.id)?.created_at ?? 0) >= monday && toMin(e.start) >= H0 * 60 - 60);
  const requests = s.inbox.filter((i) => i.kind === "meeting" && !i.resolved);
  const live = s.calendar.filter((e) => meetingOf(e.id)?.state === "live");
  const upcoming = s.calendar.filter((e) => meetingOf(e.id)?.state === "scheduled");
  const past = s.calendar.filter((e) => meetingOf(e.id)?.state === "ended").slice(0, 8);
  const now = new Date(s.now);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const openEv = s.calendar.find((e) => e.id === open);
  const row = (e: CalEvent, tone: string, label: string) => (
    <button key={e.id} onClick={() => setOpen(e.id)} className={`flex w-full items-center gap-2.5 rounded-[14px] p-3 text-left ring-1 ${tone}`}>
      <Face id={e.organizer === "ada" ? "ada" : "you"} size={28} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold text-ink">{e.title}</span>
        <span className="block truncate text-[11.5px] text-muted">{e.attendees.filter((a) => a !== "you").map(nameOf).join(", ")}</span>
      </span>
      <span className="text-[12px] font-semibold text-ink">{label}</span>
    </button>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2.5 rounded-[16px] bg-[#fff4ec] p-3 ring-1 ring-[#f3cfb6]">
        <Face id="ada" size={30} />
        <div className="flex-1 text-[12.5px] leading-snug text-[#8a4a24]">I book meetings with the heads, write a pre-read for each, and turn the discussion into minutes and tracked actions.</div>
        <Btn tone="dark" className="!py-1 !text-[12px]" onClick={() => ui.openWin({ kind: "meeting", id: "new:ada" })}>
          Call a meeting
        </Btn>
      </div>

      {requests.length > 0 && (
        <Section title={`Meeting requests · ${requests.length}`}>
          <button onClick={() => ui.openPanel("inbox", "meeting")} className="flex w-full items-center justify-between rounded-[14px] bg-[#fdf3e0] p-3 text-left ring-1 ring-[#f1d9a6]">
            <span className="text-[13px] font-semibold text-ink">{requests.map((r) => r.title).join(" · ")}</span>
            <span className="text-[12px] font-semibold text-ink">Review in inbox</span>
          </button>
        </Section>
      )}
      {live.length > 0 && <Section title="Happening now">{live.map((e) => row(e, "bg-[#eaf6ee] ring-[#bfe2cb]", "Join"))}</Section>}
      {upcoming.length > 0 && <Section title={`Booked · ${upcoming.length}`}>{upcoming.map((e) => row(e, "bg-white ring-black/[0.06]", "Open"))}</Section>}

      <AnimatePresence>{openEv && <EventDetail key={openEv.id} e={openEv} onClose={() => setOpen(null)} />}</AnimatePresence>

      <div className="overflow-hidden rounded-[18px] bg-white ring-1 ring-black/[0.06]">
        <div className="grid grid-cols-[34px_repeat(5,1fr)] border-b border-black/[0.06]">
          <div />
          {DAYS.map((x, i) => (
            <div key={x} className={`py-2 text-center text-[11.5px] font-semibold ${i === TODAY ? "text-accent" : "text-muted"}`}>
              {x}
              {i === TODAY && <span className="ml-1 rounded-full bg-accent px-1.5 text-[9.5px] text-white">today</span>}
            </div>
          ))}
        </div>
        <div className="relative grid grid-cols-[34px_repeat(5,1fr)]" style={{ height: (H1 - H0) * PX }}>
          <div className="relative">
            {Array.from({ length: H1 - H0 }, (_, i) => (
              <div key={i} className="absolute right-1 text-[10px] text-faint" style={{ top: i * PX - 6 }}>
                {H0 + i}
              </div>
            ))}
          </div>
          {DAYS.map((_, day) => (
            <div key={day} className={`relative border-l border-black/[0.05] ${day === TODAY ? "bg-[#fffaf6]" : ""}`}>
              {Array.from({ length: H1 - H0 }, (_, i) => (
                <div key={i} className="absolute inset-x-0 border-t border-black/[0.04]" style={{ top: i * PX }} />
              ))}
              {events
                .filter((e) => e.day === day)
                .map((e) => {
                  const top = ((toMin(e.start) - H0 * 60) / 60) * PX;
                  const h = Math.max(16, ((toMin(e.end) - toMin(e.start)) / 60) * PX - 2);
                  return (
                    <button
                      key={e.id}
                      onClick={() => setOpen(e.id)}
                      className={`absolute inset-x-0.5 overflow-hidden rounded-[6px] px-1 text-left text-[9.5px] font-semibold leading-tight ring-1 ${KIND[e.kind]}`}
                      style={{ top: Math.max(0, top), height: h }}
                      title={e.title}
                    >
                      {e.start} {e.title}
                    </button>
                  );
                })}
              {day === TODAY && nowMin < H1 * 60 && (
                <div className="absolute inset-x-0 z-10 h-0.5 bg-accent" style={{ top: ((nowMin - H0 * 60) / 60) * PX }}>
                  <span className="absolute -left-1 -top-[3px] h-2 w-2 rounded-full bg-accent" />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {past.length > 0 && <Section title="Earlier">{past.map((e) => row(e, "bg-white ring-black/[0.06]", "Minutes"))}</Section>}

      <Section title="Ada's meeting rules">
        <div className="flex flex-col gap-1.5 text-[12.5px] text-ink-2">
          {RULES.map((r) => (
            <div key={r} className="flex gap-2 rounded-[10px] bg-white px-3 py-2 ring-1 ring-black/[0.05]">
              <span className="text-accent">•</span>
              {r}
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
