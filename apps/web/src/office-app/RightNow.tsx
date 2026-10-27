"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { useSim } from "@/sim/store";
import { Face } from "./bits";
import { member } from "./who";

const LABEL: Record<string, string> = { working: "Working", thinking: "Thinking", blocked: "Blocked", meeting: "In a meeting" };
const DOT: Record<string, string> = { working: "#3f9b5f", thinking: "#3b7be8", blocked: "#d99a2b", meeting: "#7b6cd9" };

/** What each busy agent is doing at this moment, floating over the office. */
export function RightNow({ hidden, onOpen }: { hidden?: boolean; onOpen: (id: string) => void }) {
  const { s } = useSim();
  const [open, setOpen] = useState(true);
  useEffect(() => {
    try {
      if (localStorage.getItem("af:rightnow") === "closed") setOpen(false);
    } catch {
      // private window: start open
    }
  }, []);
  const toggle = () => {
    setOpen((o) => {
      try {
        localStorage.setItem("af:rightnow", o ? "closed" : "open");
      } catch {
        // not kept; fine
      }
      return !o;
    });
  };

  const rows = Object.entries(s.live)
    .filter(([id, l]) => id !== "you" && member(id) && LABEL[l.status])
    .map(([id, l]) => ({ id, status: l.status, line: l.step || s.tasks.find((t) => t.id === l.taskId)?.title || LABEL[l.status]! }))
    .slice(0, 6);

  return (
    <div className={`absolute right-3 top-[64px] z-20 hidden w-[272px] transition-opacity duration-200 md:block ${hidden ? "pointer-events-none opacity-0" : ""}`}>
      <div className="overflow-hidden rounded-[18px] bg-white/95 shadow-[var(--shadow-card)] ring-1 ring-black/[0.06] backdrop-blur">
        <button onClick={toggle} className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left">
          <span className="relative grid h-2 w-2 place-items-center">
            <span className="absolute inset-0 rounded-full bg-[#3f9b5f]" style={{ animation: rows.length ? "pulse-ring 1.8s ease-out infinite" : undefined }} />
            <span className="relative h-2 w-2 rounded-full bg-[#3f9b5f]" />
          </span>
          <span className="flex-1 text-[13px] font-semibold text-ink">Right now</span>
          {!open && rows.length > 0 && <span className="text-[11.5px] text-muted">{rows.length} busy</span>}
          <svg width="12" height="12" viewBox="0 0 12 12" className={`text-muted transition-transform ${open ? "" : "-rotate-90"}`}>
            <path d="M2.5 4.5 6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <AnimatePresence initial={false}>
          {open && (
            <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }} className="overflow-hidden">
              <div className="flex flex-col gap-0.5 px-1.5 pb-2">
                {rows.map((r) => (
                  <button key={r.id} onClick={() => onOpen(r.id)} className="flex items-center gap-2.5 rounded-[12px] px-2 py-1.5 text-left hover:bg-black/[0.04]">
                    <span className="relative">
                      <Face id={r.id} size={30} />
                      <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-white" style={{ background: DOT[r.status] }} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-semibold text-ink">{member(r.id)?.name}</span>
                      <span className="block truncate text-[12px] text-muted">{r.line}</span>
                    </span>
                  </button>
                ))}
                {!rows.length && <p className="px-2 py-1.5 text-[12px] text-faint">Nobody's busy. Hand someone a task.</p>}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
