"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { useSim } from "@/sim/store";
import { Btn, Face } from "../bits";

/**
 * Ada's plain-language read-back before any setting changes. The checklist
 * comes from the change itself (the policy engine's diff), so it says exactly
 * what will happen; nothing changes until the CEO confirms.
 */
export function ReadBackHost() {
  const { s, d, act } = useSim();
  const [done, setDone] = useState<{ v: number; items: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const p = s.pending;
  const open = !!p || !!done;
  const close = () => {
    setDone(null);
    d({ type: "cancelPending" });
  };
  const items = done ? done.items : (p?.items ?? []);
  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[80] grid place-items-center bg-white/70 p-6 backdrop-blur-sm" onClick={close}>
          <motion.div initial={{ y: 12, scale: 0.98 }} animate={{ y: 0, scale: 1 }} onClick={(e) => e.stopPropagation()} className="w-full max-w-[460px] rounded-[20px] bg-white p-5 shadow-[var(--shadow-float)] ring-1 ring-black/[0.08]">
            <div className="flex items-center gap-2.5">
              <Face id="ada" size={30} />
              <div className="min-w-0">
                <div className="text-[14px] font-semibold text-ink">{done ? "Applied" : p?.problems?.length ? "This can't be applied" : "Ada read this back before applying"}</div>
                {!done && p?.summary && <div className="truncate text-[12px] text-muted">{p.summary}</div>}
              </div>
            </div>
            <div className="mt-3 flex max-h-[50vh] flex-col gap-2 overflow-y-auto">
              {items.map((x, n) => (
                <div key={`${n}-${x}`} className="flex items-start gap-2 text-[13px] text-ink-2">
                  <span className={`mt-[2px] grid h-4 w-4 shrink-0 place-items-center rounded-full text-[10px] font-bold text-white ${done ? "bg-ok" : "bg-black/25"}`}>✓</span>
                  {x}
                </div>
              ))}
              {!done && !items.length && !p?.problems?.length && <div className="text-[13px] text-muted">Nothing would change.</div>}
              {!done &&
                p?.problems?.map((x) => (
                  <div key={x} className="flex items-start gap-2 rounded-[12px] bg-[#fdecea] px-3 py-2 text-[12.5px] text-[#9b2c24]">
                    {x}
                  </div>
                ))}
            </div>
            {done ? (
              <div className="mt-4 flex items-center justify-between">
                <span className="text-[12.5px] font-semibold text-[#24603a]">Saved as v{done.v}. You can roll back any time.</span>
                <Btn tone="dark" onClick={close}>
                  Done
                </Btn>
              </div>
            ) : (
              <div className="mt-4 flex justify-end gap-2">
                <Btn onClick={close}>{p?.problems?.length ? "Close" : "Back"}</Btn>
                {!p?.problems?.length && !!items.length && (
                  <Btn
                    tone="dark"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      const keep = p?.items ?? [];
                      const v = await act.apply();
                      setBusy(false);
                      if (v != null) {
                        d({ type: "cancelPending" });
                        setDone({ v, items: keep });
                      }
                    }}
                  >
                    {busy ? "Applying…" : "Confirm and apply"}
                  </Btn>
                )}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
