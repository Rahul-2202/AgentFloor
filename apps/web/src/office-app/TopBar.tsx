"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { LogoMark } from "@/components/Logo";
import { CAST, ROOMS } from "@/office/layout";
import { getMe } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { clockLabel, useSim } from "@/sim/store";
import type { RoomId } from "@/office/types";
import type { PanelKey } from "@/sim/types";
import { Dot, Face } from "./bits";
import { Icon } from "./icons";
import { useUI } from "./ui";
import { ROOM_LABEL } from "./who";

const TOOLS: { k: PanelKey; l: string; icon: React.ReactNode }[] = [
  { k: "dashboard", l: "Dashboard", icon: Icon.dashboard },
  { k: "team", l: "Agents & teams", icon: Icon.team },
  { k: "calendar", l: "Calendar", icon: Icon.calendar },
  { k: "outputs", l: "Outputs", icon: Icon.outputs },
  { k: "conversations", l: "Transcripts & chats", icon: Icon.convo },
  { k: "memory", l: "Company memory", icon: Icon.memory },
  { k: "inbox", l: "Needs your attention", icon: Icon.inbox },
  { k: "governance", l: "Rules & settings", icon: Icon.settings },
];

function Jump() {
  const { s } = useSim();
  const ui = useUI();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const agents = Object.keys(s.live).filter((id) => id !== "you").filter((id) => (CAST[id]?.name ?? id).toLowerCase().includes(q.toLowerCase()) || (CAST[id]?.role ?? "").toLowerCase().includes(q.toLowerCase()));
  const rooms = (["ceo", ...Object.keys(s.rooms), "meeting"] as RoomId[]).filter((r) => ROOM_LABEL[r].toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="relative" data-tour="jump">
      <button onClick={() => setOpen((v) => !v)} className="flex h-9 items-center gap-2 rounded-full bg-[#f2f0ec] px-3 text-[12.5px] font-medium text-muted hover:bg-[#e9e6df]">
        {Icon.search} Jump to a room or agent
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="absolute left-0 top-11 z-50 w-[300px] overflow-hidden rounded-[18px] bg-white p-2 shadow-[var(--shadow-float)] ring-1 ring-black/[0.06]"
          >
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
              placeholder="Search…"
              className="mb-1 w-full rounded-[12px] bg-[#f6f5f2] px-3 py-2 text-[13px] outline-none"
            />
            <div className="max-h-[320px] overflow-y-auto">
              {rooms.map((r) => (
                <button
                  key={r}
                  onClick={() => {
                    const rr = ROOMS[r];
                    ui.walkTo(rr.x + rr.w / 2, rr.y + rr.h - 2.5);
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-2 rounded-[10px] px-2 py-1.5 text-left text-[13px] hover:bg-[#f6f5f2]"
                >
                  <span className="grid h-6 w-6 place-items-center rounded-[7px] bg-[#f2f0ec] text-[11px]">⌂</span>
                  {ROOM_LABEL[r]}
                </button>
              ))}
              {agents.map((id) => (
                <div key={id} className="flex items-center gap-2 rounded-[10px] px-2 py-1.5 hover:bg-[#f6f5f2]">
                  <Face id={id} size={24} />
                  <span className="flex-1 text-[13px]">
                    {CAST[id]?.name} <span className="text-muted">· {CAST[id]?.role}</span>
                  </span>
                  <Dot status={s.live[id].status} />
                  <button
                    onClick={() => {
                      ui.summon(id);
                      setOpen(false);
                    }}
                    className="rounded-full bg-ink px-2 py-0.5 text-[11px] font-semibold text-white"
                  >
                    Call
                  </button>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const MACHINE: Record<string, { label: string; tone: string }> = {
  none: { label: "Office computer off", tone: "bg-faint" },
  creating: { label: "Setting up the office computer", tone: "bg-warn" },
  starting: { label: "Starting", tone: "bg-warn" },
  started: { label: "Live", tone: "bg-ok" },
  pausing: { label: "Pausing", tone: "bg-warn" },
  paused: { label: "Asleep", tone: "bg-faint" },
  stopped: { label: "Asleep", tone: "bg-faint" },
  archived: { label: "Asleep", tone: "bg-faint" },
  error: { label: "Needs attention", tone: "bg-bad" },
};

/** The office computer: on, asleep, or starting; and the button to wake it. */
function Machine() {
  const { s, act } = useSim();
  const m = MACHINE[s.machine] ?? { label: s.machine, tone: "bg-faint" };
  const busy = ["creating", "starting", "pausing"].includes(s.machine);
  return (
    <div data-tour="machine" className="flex items-center gap-1.5 text-[11px] text-muted">
      <span className={`h-1.5 w-1.5 rounded-full ${m.tone}`} style={s.machine === "started" ? { animation: "led 1.6s steps(2) infinite" } : undefined} />
      {m.label} · {clockLabel(s.now)}
      {s.machine === "started" ? (
        <button onClick={() => void act.pause()} className="ml-1 rounded-full px-1.5 font-semibold text-faint hover:bg-black/5 hover:text-ink" title="Agents stop until you start it again">
          Pause
        </button>
      ) : (
        <button disabled={busy} onClick={() => void act.start()} className="ml-1 rounded-full bg-ink px-2 py-[1px] font-semibold text-white disabled:opacity-40">
          {busy ? "…" : "Start"}
        </button>
      )}
    </div>
  );
}

export function TopBar() {
  const { s } = useSim();
  const ui = useUI();
  const [admin, setAdmin] = useState(false);
  useEffect(() => {
    void getMe().then((m) => setAdmin(m.admin), () => {});
  }, []);
  const open = s.inbox.filter((i) => !i.resolved);
  const badge: Partial<Record<PanelKey, number>> = {
    inbox: open.filter((i) => !i.batched).length,
    outputs: s.outputs.filter((o) => o.status === "review").length,
    dashboard: s.tasks.filter((t) => t.state === "question" || t.state === "blocked").length,
    calendar: s.calendar.filter((e) => e.status === "pending").length,
  };
  return (
    <div className="absolute inset-x-3 top-3 z-50 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 rounded-full bg-white/95 py-1.5 pl-1.5 pr-2 shadow-[var(--shadow-card)] ring-1 ring-black/[0.06] backdrop-blur">
        <Link href="/" className="flex items-center gap-2 pl-1 pr-1">
          <LogoMark size={26} />
        </Link>
        <div className="pr-1 leading-tight">
          <div className="text-[13.5px] font-semibold text-ink">{s.setup?.name ?? s.office.name}</div>
          <Machine />
        </div>
        <div className="hidden 2xl:block">
          <Jump />
        </div>
        {admin && (
          <Link href="/admin" className="hidden rounded-full px-2.5 py-1.5 text-[11.5px] font-medium text-faint hover:bg-black/5 hover:text-ink xl:block">
            Admin
          </Link>
        )}
        <button onClick={() => void supabase.auth.signOut()} className="hidden rounded-full px-2.5 py-1.5 text-[11.5px] font-medium text-faint hover:bg-black/5 hover:text-ink xl:block">
          Sign out
        </button>
      </div>

      <div className="flex items-center gap-1.5 rounded-full bg-white/95 p-1.5 shadow-[var(--shadow-card)] ring-1 ring-black/[0.06] backdrop-blur">
        <button
          data-tour="assign"
          disabled={!Object.keys(s.rooms).length}
          title={!Object.keys(s.rooms).length ? "Set up a room with Ada first" : undefined}
          onClick={() => ui.openWin({ kind: "assign" })}
          className="flex h-9 items-center gap-1.5 rounded-full bg-ink px-3.5 text-[13px] font-semibold text-white hover:bg-black disabled:opacity-35"
        >
          {Icon.plus} Assign task
        </button>
        {TOOLS.map((t) => (
          <button
            key={t.k}
            data-tour={t.k}
            onClick={() => (ui.panel === t.k ? ui.closePanel() : ui.openPanel(t.k))}
            title={t.l}
            className={`group relative grid h-9 w-9 place-items-center rounded-full transition-colors ${ui.panel === t.k ? "bg-ink text-white" : "text-ink-2 hover:bg-black/5"}`}
          >
            {t.icon}
            {!!badge[t.k] && (
              <span className="absolute -right-0.5 -top-0.5 grid h-[17px] min-w-[17px] place-items-center rounded-full bg-bad px-1 text-[10px] font-bold text-white ring-2 ring-white">{badge[t.k]}</span>
            )}
            <span className="pointer-events-none absolute right-0 top-11 whitespace-nowrap rounded-[8px] bg-ink px-2 py-1 text-[11px] font-semibold text-white opacity-0 transition-opacity group-hover:opacity-100">
              {t.l}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
