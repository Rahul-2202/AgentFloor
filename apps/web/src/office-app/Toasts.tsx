"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect } from "react";
import { useSim } from "@/sim/store";
import { Face } from "./bits";
import { useUI } from "./ui";
import { nameOf } from "./who";

export function Toasts() {
  const { s, d } = useSim();
  const ui = useUI();

  useEffect(() => {
    if (!s.toasts.length) return;
    const t = setTimeout(() => d({ type: "dismissToast", id: s.toasts[0].id }), 8000);
    return () => clearTimeout(t);
  }, [s.toasts, d]);

  return (
    <div data-tour="toasts" className={`pointer-events-none absolute top-[68px] z-[45] flex w-[340px] flex-col gap-2 transition-[right] duration-300 ${ui.panel ? "right-[484px]" : "right-3"}`}>
      <AnimatePresence initial={false}>
        {s.toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, x: 30, scale: 0.97 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 20, transition: { duration: 0.2 } }}
            transition={{ type: "spring", stiffness: 360, damping: 30 }}
            className="pointer-events-auto flex items-start gap-2.5 rounded-[16px] bg-white p-3 shadow-[0_16px_40px_-14px_rgba(0,0,0,0.35)] ring-1 ring-black/[0.06]"
          >
            <Face id={t.who} size={30} />
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-semibold text-ink">{nameOf(t.who)}</div>
              <div className="text-[12.5px] leading-snug text-ink-2">{t.text}</div>
              {t.action && (
                <button
                  onClick={() => {
                    ui.openPanel(t.action!.panel, t.action!.ref);
                    d({ type: "dismissToast", id: t.id });
                  }}
                  className="mt-1.5 rounded-full bg-ink px-2.5 py-1 text-[11.5px] font-semibold text-white"
                >
                  {t.action.label}
                </button>
              )}
            </div>
            <button onClick={() => d({ type: "dismissToast", id: t.id })} className="text-[12px] text-faint hover:text-ink" aria-label="Dismiss">
              ✕
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
