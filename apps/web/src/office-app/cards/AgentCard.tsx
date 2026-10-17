"use client";

import { motion } from "motion/react";
import type { ReactNode } from "react";
import { CAST } from "@/office/layout";
import { RuntimeBadge } from "@/components/ui";
import { useSim } from "@/sim/store";
import { Bar, Dot, Face, STATUS, StateChip } from "../bits";
import { Icon } from "../icons";
import { useUI } from "../ui";
import { nameOf, ROOM_LABEL } from "../who";

function Action({ icon, label, onClick, note }: { icon: ReactNode; label: string; onClick: () => void; note?: string }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="flex items-center gap-2.5 rounded-[14px] px-2.5 py-1.5 text-left transition-colors hover:bg-[#f6f5f2]"
    >
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[9px] bg-[#f2f0ec] text-ink-2">{icon}</span>
      <span className="min-w-0">
        <span className="block whitespace-nowrap text-[13px] font-semibold text-ink">{label}</span>
        {note && <span className="block whitespace-nowrap text-[11px] text-muted">{note}</span>}
      </span>
    </button>
  );
}

export function AgentCard({ id, summoned, onSendBack, onClose }: { id: string; summoned: boolean; onSendBack: () => void; onClose: () => void }) {
  const { s, act } = useSim();
  const ui = useUI();
  const m = CAST[id];
  const l = s.live[id];
  const cfg = s.configs[id];
  const task = s.tasks.find((t) => t.id === l.taskId);
  const next = l.upNext.map((tid) => s.tasks.find((t) => t.id === tid)).filter(Boolean);
  const outputs = s.outputs.filter((o) => o.by === id);
  const unviewed = outputs.filter((o) => !o.viewed).length;
  const isHead = !!m?.head;
  const status = l.paused ? "away" : l.status;
  const roomKey = m?.room ?? "dev";
  const room = s.rooms[roomKey];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 6, scale: 0.97 }}
      transition={{ type: "spring", stiffness: 380, damping: 30 }}
      data-tour="agent-card"
      className="my-2 max-h-[calc(100dvh-110px)] w-[min(440px,calc(100vw-24px))] overflow-y-auto overscroll-contain rounded-[24px] bg-white shadow-[0_24px_60px_-16px_rgba(0,0,0,0.4)] ring-1 ring-black/[0.06]"
    >
      {/* header */}
      <div className="flex items-center gap-3.5 px-5 pb-3.5 pt-4">
        <Face id={id} size={48} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[17px] font-semibold tracking-[-0.01em] text-ink">{nameOf(id)}</span>
            {isHead && <span className="rounded-[5px] bg-ink px-1.5 py-[2px] text-[9.5px] font-bold uppercase tracking-wide text-white">Head</span>}
          </div>
          <div className="mt-0.5 text-[12.5px] text-muted">
            {m?.role} · {ROOM_LABEL[m?.room ?? "dev"]}
            {room && (
              <>
                {" · reports to "}
                <b className="font-semibold text-ink-2">{isHead ? "you" : nameOf(room.head)}</b>
              </>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#f6f5f2] px-2.5 py-[3px] text-[11.5px] font-semibold text-ink-2">
              <Dot status={status} /> {STATUS[status].l}
            </span>
            <RuntimeBadge runtime={cfg?.runtime} />
            {l.queued > 0 && <span className="rounded-full bg-[#fdf3e0] px-2.5 py-[3px] text-[11.5px] font-semibold text-[#8a5a10]">{l.queued} queued</span>}
          </div>
        </div>
        <button onClick={onClose} className="grid h-8 w-8 shrink-0 place-items-center self-start rounded-full text-muted hover:bg-black/5" aria-label="Close">
          ✕
        </button>
      </div>

      {l.paused && (
        <div className="mx-5 mb-3 flex items-center justify-between rounded-[14px] bg-[#f0efed] px-3.5 py-2.5 text-[12.5px] text-ink-2">
          <span className="min-w-0 pr-2">{l.step ?? "On hold. Work is saved."}</span>
          <button onClick={() => void act.release(id)} className="rounded-full bg-ink px-3 py-1 text-[12px] font-semibold text-white">
            Resume
          </button>
        </div>
      )}

      {/* now / next */}
      <div className="mx-5 rounded-[18px] bg-[#f6f5f2] px-4 py-3">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-faint">Working on</span>
          {task && <StateChip state={task.state} />}
        </div>
        {task ? (
          <button className="block w-full text-left" onClick={() => ui.openWin({ kind: "task", id: task.id })}>
            <div className="text-[14px] font-semibold leading-snug text-ink">{task.title}</div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[12px] text-muted">
              <span className="font-mono text-[11px] text-faint">{task.key}</span>
              {(l.step ?? task.step) && <>· {l.step ?? task.step}</>}
            </div>
            <div className="mt-2.5 flex items-center gap-2.5">
              <div className="flex-1">
                <Bar value={task.progress} color={task.state === "question" || task.state === "blocked" ? "#d99a2b" : "#3f9b5f"} />
              </div>
              <span className="text-[11.5px] font-semibold text-muted">{task.progress}%</span>
            </div>
          </button>
        ) : (
          <div className="text-[13px] text-muted">{l.step ?? "Free for new work"}</div>
        )}
        {next.length > 0 && (
          <div className="mt-3 border-t border-black/[0.06] pt-2.5">
            <div className="mb-1 text-[10.5px] font-bold uppercase tracking-[0.08em] text-faint">Up next</div>
            {next.slice(0, 2).map((t) => (
              <div key={t!.id} className="flex items-center gap-1.5 py-0.5 text-[12.5px] text-ink-2">
                <span className="font-mono text-[11px] text-faint">{t!.key}</span>
                <span className="truncate">{t!.title}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* message */}
      <div className="grid grid-cols-2 gap-2 px-5 pt-3">
        <button
          onClick={() => ui.openWin({ kind: "chat", id, mode: "now" })}
          className="flex items-center gap-3 rounded-[16px] bg-ink px-3.5 py-2.5 text-left text-white hover:bg-black"
        >
          {Icon.chat}
          <span>
            <span className="block text-[13px] font-semibold">Message now</span>
            <span className="block text-[11px] text-white/60">Stops at a safe point</span>
          </span>
        </button>
        <button
          onClick={() => ui.openWin({ kind: "chat", id, mode: "queue" })}
          className="flex items-center gap-3 rounded-[16px] bg-[#f6f5f2] px-3.5 py-2.5 text-left ring-1 ring-black/[0.05] hover:bg-[#efede8]"
        >
          {Icon.clock}
          <span>
            <span className="block text-[13px] font-semibold text-ink">Queue a message</span>
            <span className="block text-[11px] text-muted">Read at the next break</span>
          </span>
        </button>
      </div>

      {/* actions */}
      <div className="grid grid-cols-2 gap-x-1 gap-y-0.5 px-3 pb-3 pt-2.5">
        <Action icon={Icon.terminal} label="Live session" note={`${cfg?.runtime} · ${cfg?.model}`} onClick={() => ui.openWin({ kind: "terminal", id })} />
        <Action icon={Icon.memory} label="Memory" note="Lessons, role card, notes" onClick={() => ui.openWin({ kind: "memory", id })} />
        <Action icon={Icon.file} label="Files" note="What it has written" onClick={() => ui.openWin({ kind: "files", id })} />
        <Action icon={Icon.settings} label="Config" note="Tools, permissions, budget" onClick={() => ui.openWin({ kind: "config", id })} />
        <Action icon={Icon.outputs} label="Outputs" note={unviewed ? `${unviewed} new of ${outputs.length}` : `${outputs.length} delivered`} onClick={() => ui.openPanel("outputs", `by:${id}`)} />
        <Action icon={Icon.plus} label="Assign a task" note="Head is copied" onClick={() => ui.openWin({ kind: "assign", id })} />
        {isHead ? (
          <>
            <Action icon={Icon.board} label="Room plan" note="Board and priorities" onClick={() => ui.openWin({ kind: "room", id: roomKey, tab: "board" })} />
            <Action icon={Icon.calendar} label="Request a meeting" note="Booked through Ada" onClick={() => ui.openWin({ kind: "meeting", id: `new:${id}` })} />
          </>
        ) : (
          <Action icon={Icon.convo} label="Conversations" note="DMs and channel" onClick={() => ui.openPanel("conversations", `with:${id}`)} />
        )}
        <Action
          icon={l.paused ? Icon.play : Icon.pause}
          label={l.paused ? "Resume" : "Pause agent"}
          note={l.paused ? "Picks up where it left off" : "Saves work, stops spend"}
          onClick={() => void (l.paused ? act.release(id) : act.hold(id, "Paused by the CEO"))}
        />
      </div>

      <div className="flex items-center justify-between border-t border-black/[0.06] bg-[#fbfaf8] px-5 py-2.5 text-[12px] text-muted">
        <span>
          Today ${(cfg?.spent ?? 0).toFixed(2)}
          {cfg?.budget ? ` of $${cfg.budget}` : ""}
        </span>
        {summoned ? (
          <button onClick={onSendBack} className="flex items-center gap-1 font-semibold text-ink hover:underline">
            Send back to desk
          </button>
        ) : (
          <span>{cfg?.model}</span>
        )}
      </div>
    </motion.div>
  );
}
