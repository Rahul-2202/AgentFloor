"use client";

import { AnimatePresence, motion } from "motion/react";
import { useSim } from "@/sim/store";
import { Face } from "./bits";
import { useUI } from "./ui";
import { ROOM_LABEL } from "./who";

const TABS = [
  ["spec", "Spec"],
  ["rules", "Rules"],
  ["board", "Board"],
  ["channel", "Channel"],
  ["memory", "Memory"],
  ["members", "Members"],
] as const;

export function RoomBar({ room }: { room: string | null }) {
  const { s } = useSim();
  const ui = useUI();
  const cfg = room ? (s.rooms[room] ?? null) : null;
  const live = s.data.meetings.find((m) => m.state === "live");
  const next = s.data.meetings.find((m) => m.state === "scheduled" || m.state === "requested");
  const slot = room && ["dev", "marketing", "sales", "legal", "finance"].includes(room);

  return (
    <div className="pointer-events-none absolute left-1/2 top-[68px] z-30 -translate-x-1/2">
      <AnimatePresence mode="wait">
        {room && (
          <motion.div
            key={room}
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.25 }}
            data-tour="roombar"
            className="pointer-events-auto flex items-center gap-2 rounded-full bg-white/95 py-1.5 pl-2 pr-1.5 shadow-[var(--shadow-card)] ring-1 ring-black/[0.06] backdrop-blur"
          >
            {cfg && <Face id={cfg.head} size={26} />}
            <span className="pl-1 text-[13px] font-semibold text-ink">{ROOM_LABEL[room]}</span>
            {cfg && <span className="text-[12px] text-muted">· {cfg.members.length} agent{cfg.members.length === 1 ? "" : "s"}</span>}
            <span className="mx-1 h-4 w-px bg-black/10" />
            {cfg &&
              TABS.map(([k, l]) => (
                <button key={k} onClick={() => ui.openWin({ kind: "room", id: cfg.id, tab: k })} className="rounded-full px-2.5 py-1 text-[12px] font-semibold text-ink-2 hover:bg-black/5">
                  {l}
                </button>
              ))}
            {room === "meeting" && (
              <>
                <span className="text-[12px] text-muted">{live ? `Now: ${live.title}` : next ? `Next: ${next.title}` : "Free"}</span>
                <button onClick={() => ui.openWin({ kind: "meeting", id: live?.id ?? next?.id ?? "new:ada" })} className="rounded-full bg-ink px-3 py-1 text-[12px] font-semibold text-white">
                  {live ? "Join" : next ? "Open" : "Call a meeting"}
                </button>
              </>
            )}
            {room === "ceo" && (
              <>
                <span className="text-[12px] text-muted">Ada is here</span>
                <button onClick={() => ui.openPanel("inbox")} className="rounded-full px-2.5 py-1 text-[12px] font-semibold text-ink-2 hover:bg-black/5">
                  Inbox
                </button>
                <button onClick={() => ui.openPanel("calendar")} className="rounded-full px-2.5 py-1 text-[12px] font-semibold text-ink-2 hover:bg-black/5">
                  Calendar
                </button>
              </>
            )}
            {slot && !cfg && (
              <>
                <span className="text-[12px] text-muted">Empty space</span>
                <button onClick={() => ui.openPanel("team", "add-room")} className="rounded-full bg-ink px-3 py-1 text-[12px] font-semibold text-white">
                  Add a room here
                </button>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
