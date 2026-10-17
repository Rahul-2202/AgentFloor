"use client";

import { motion } from "motion/react";
import { useSim } from "@/sim/store";
import type { PanelKey } from "@/sim/types";
import { Face } from "../bits";
import { useUI, type Win } from "../ui";

type Act = { l: string; panel?: [PanelKey, string?]; win?: Win };

const GROUPS: { t: string; acts: Act[] }[] = [
  {
    t: "Company",
    acts: [
      { l: "Hire an agent", panel: ["team", "hire"] },
      { l: "Add a room", panel: ["team", "add-room"] },
      { l: "Org chart", panel: ["team"] },
    ],
  },
  {
    t: "Governance",
    acts: [
      { l: "Permissions", panel: ["governance", "permissions"] },
      { l: "Budgets", panel: ["governance", "budgets"] },
      { l: "Locked rules", panel: ["governance", "locked"] },
      { l: "When blocked", panel: ["governance", "blocked"] },
      { l: "Comms norms", panel: ["governance", "norms"] },
      { l: "Version history", panel: ["governance", "versions"] },
    ],
  },
  {
    t: "Chief of staff",
    acts: [
      { l: "Today's briefing", win: { kind: "chat", id: "ada", tab: "briefing" } },
      { l: "Triage inbox", panel: ["inbox"] },
      { l: "Meeting requests", panel: ["inbox", "meeting"] },
      { l: "My calendar", panel: ["calendar"] },
    ],
  },
  {
    t: "Meetings",
    acts: [
      { l: "Call a meeting", win: { kind: "meeting", id: "new:ada" } },
      { l: "Minutes & actions", panel: ["conversations", "meetings"] },
    ],
  },
  {
    t: "Memory",
    acts: [
      { l: "Company memory", panel: ["memory", "company"] },
      { l: "Your preferences", panel: ["memory", "ceo"] },
      { l: "Decision log", panel: ["memory", "decisions"] },
    ],
  },
];

export const ADA_SUGGESTIONS = [
  "What needs me today?",
  "What's blocked right now?",
  "Add a tester to the dev room",
  "Set up a meeting with the heads",
  "Raise the daily budget to $10",
  "What have we decided so far?",
];

export function AdaCard({ onClose }: { onClose: () => void }) {
  const { s } = useSim();
  const ui = useUI();
  const needs = s.inbox.filter((i) => !i.resolved && !i.batched).length;
  const pendingMeetings = s.calendar.filter((e) => e.status === "pending").length;
  const blocked = s.tasks.filter((t) => t.state === "blocked" || t.state === "question").length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 6, scale: 0.97 }}
      transition={{ type: "spring", stiffness: 380, damping: 30 }}
      data-tour="ada-card"
      className="mb-2 max-h-[calc(100dvh-110px)] w-[min(440px,calc(100vw-24px))] overflow-y-auto overscroll-contain rounded-[24px] bg-white shadow-[0_24px_60px_-16px_rgba(0,0,0,0.4)] ring-1 ring-black/[0.06]"
    >
      <div className="flex items-start gap-3 bg-[linear-gradient(135deg,#fff4ec,#ffffff)] p-4">
        <Face id="ada" size={48} />
        <div className="min-w-0 flex-1">
          <div className="text-[16px] font-semibold text-ink">Ada</div>
          <div className="text-[12px] text-muted">Office manager · chief of staff</div>
          <div className="mt-2 flex flex-wrap gap-1.5 text-[11.5px] font-semibold">
            <button onClick={() => ui.openPanel("inbox")} className="rounded-full bg-[#fdecea] px-2 py-[2px] text-[#9b2c24]">
              {needs} need you
            </button>
            <button onClick={() => ui.openPanel("inbox", "meeting")} className="rounded-full bg-[#f1eefd] px-2 py-[2px] text-[#4a3fa8]">
              {pendingMeetings} meeting request{pendingMeetings === 1 ? "" : "s"}
            </button>
            <button onClick={() => ui.openPanel("dashboard")} className="rounded-full bg-[#fdf3e0] px-2 py-[2px] text-[#8a5a10]">
              {blocked} blocked
            </button>
          </div>
        </div>
        <button onClick={onClose} className="-mr-1 -mt-1 grid h-7 w-7 place-items-center rounded-full text-muted hover:bg-black/5" aria-label="Close">
          ✕
        </button>
      </div>

      <div className="flex max-h-[min(300px,30vh)] flex-col gap-3 overflow-y-auto px-4 py-3" onWheel={(e) => e.stopPropagation()}>
        {GROUPS.map((g) => (
          <div key={g.t}>
            <div className="mb-1.5 text-[10.5px] font-bold uppercase tracking-[0.08em] text-faint">{g.t}</div>
            <div className="flex flex-wrap gap-1.5">
              {g.acts.map((a) => (
                <button
                  key={a.l}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (a.panel) ui.openPanel(a.panel[0], a.panel[1]);
                    if (a.win) ui.openWin(a.win);
                  }}
                  className="rounded-full bg-[#f6f5f2] px-2.5 py-1 text-[12px] font-semibold text-ink ring-1 ring-black/[0.05] hover:bg-[#efede8]"
                >
                  {a.l}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-black/[0.06] p-3">
        <div className="mb-2 text-[11px] font-semibold text-muted">Or just tell Ada</div>
        <div className="mb-2 flex flex-wrap gap-1">
          {ADA_SUGGESTIONS.slice(0, 4).map((q) => (
            <button
              key={q}
              onClick={(e) => {
                e.stopPropagation();
                ui.openWin({ kind: "chat", id: "ada", tab: `say:${q}` });
              }}
              className="rounded-full bg-[#fff4ec] px-2 py-[3px] text-[11.5px] font-medium text-[#a24d1f] ring-1 ring-[#f3cfb6] hover:bg-[#fde9da]"
            >
              “{q}”
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              ui.openWin({ kind: "chat", id: "ada" });
            }}
            className="flex flex-1 items-center gap-2 rounded-full bg-[#f6f5f2] px-4 py-2.5 text-left text-[13px] text-faint ring-1 ring-black/[0.05] hover:bg-[#efede8]"
          >
            Message Ada…
          </button>
        </div>
      </div>
    </motion.div>
  );
}
