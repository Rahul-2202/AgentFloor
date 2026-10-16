"use client";

import { motion } from "motion/react";
import { useSim } from "@/sim/store";
import { Btn, Dot, Face, STATUS } from "../bits";
import { nameOf, roleOf } from "../who";

export function HoverTag({ id, far, onCall, onOpen }: { id: string; far: boolean; onCall: () => void; onOpen: () => void }) {
  const { s } = useSim();
  const l = s.live[id];
  const status = l?.paused ? "away" : (l?.status ?? "idle");
  return (
    <motion.div
      initial={{ opacity: 0, y: 6, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 4, scale: 0.97 }}
      transition={{ type: "spring", stiffness: 420, damping: 30 }}
      className="mb-1 flex w-[250px] items-center gap-2.5 rounded-[16px] bg-white p-2.5 shadow-[0_12px_32px_-10px_rgba(0,0,0,0.35)] ring-1 ring-black/[0.06]"
    >
      <Face id={id} size={36} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
          {nameOf(id)} <Dot status={status} />
        </div>
        <div className="truncate text-[11.5px] text-muted">{l?.step ?? roleOf(id) ?? STATUS[status].l}</div>
      </div>
      <div className="flex flex-col gap-1">
        {far && (
          <Btn tone="dark" onClick={onCall} className="!px-2.5 !py-1 !text-[11.5px]">
            Call to me
          </Btn>
        )}
        <Btn onClick={onOpen} className="!px-2.5 !py-1 !text-[11.5px]">
          Open
        </Btn>
      </div>
    </motion.div>
  );
}
