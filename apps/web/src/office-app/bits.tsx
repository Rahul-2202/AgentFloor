"use client";

import { motion } from "motion/react";
import type { ReactNode } from "react";
import { Portrait } from "@/office/Avatar";
import { CAST } from "@/office/layout";
import type { AgentStatus } from "@/office/types";
import type { TaskState } from "@/sim/types";

export const STATUS: Record<AgentStatus, { c: string; l: string }> = {
  idle: { c: "#a19d96", l: "Idle" },
  working: { c: "#3f9b5f", l: "Working" },
  blocked: { c: "#d99a2b", l: "Blocked" },
  meeting: { c: "#7b6cd9", l: "In a meeting" },
  away: { c: "#c7c3bc", l: "Paused" },
  thinking: { c: "#3b7be8", l: "Thinking" },
};

export function Dot({ status }: { status: AgentStatus }) {
  const st = STATUS[status];
  const live = status === "working" || status === "thinking";
  return (
    <span className="relative inline-grid h-2 w-2 place-items-center">
      {live && <span className="absolute inset-0 rounded-full" style={{ background: st.c, animation: "pulse-ring 1.8s ease-out infinite" }} />}
      <span className="relative h-2 w-2 rounded-full" style={{ background: st.c }} />
    </span>
  );
}

export function Face({ id, size = 28 }: { id: string; size?: number }) {
  const m = CAST[id];
  if (!m) return <span className="grid place-items-center rounded-[9px] bg-ink text-[11px] font-bold text-white" style={{ width: size, height: size }}>?</span>;
  return <Portrait look={m.look} size={size} bg={id === "ada" ? "#fbe9de" : id === "you" ? "#e9e6df" : undefined} />;
}

export const TASK_STATE: Record<TaskState, { l: string; cls: string }> = {
  queued: { l: "Queued", cls: "bg-[#f0efed] text-muted" },
  ongoing: { l: "Ongoing", cls: "bg-[#eaf6ee] text-[#24603a]" },
  blocked: { l: "Blocked", cls: "bg-[#fdf3e0] text-[#8a5a10]" },
  question: { l: "Needs you", cls: "bg-[#fdecea] text-[#9b2c24]" },
  review: { l: "In review", cls: "bg-[#f1eefd] text-[#4a3fa8]" },
  done: { l: "Done", cls: "bg-[#e8eefb] text-[#2c56b0]" },
};

export function StateChip({ state }: { state: TaskState }) {
  return <span className={`rounded-full px-1.5 py-[1px] text-[10.5px] font-bold uppercase tracking-wide ${TASK_STATE[state].cls}`}>{TASK_STATE[state].l}</span>;
}

export function Bar({ value, color = "#3f9b5f" }: { value: number; color?: string }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-black/[0.07]">
      <motion.div className="h-full rounded-full" initial={false} animate={{ width: `${value}%` }} transition={{ type: "spring", stiffness: 120, damping: 24 }} style={{ background: color }} />
    </div>
  );
}

export function Btn({
  children,
  onClick,
  tone = "light",
  className = "",
  title,
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  tone?: "dark" | "light" | "accent" | "ghost" | "danger" | "ok";
  className?: string;
  title?: string;
  disabled?: boolean;
}) {
  const cls = {
    dark: "bg-ink text-white hover:bg-black",
    light: "bg-[#f2f0ec] text-ink hover:bg-[#e9e6df]",
    accent: "bg-[#fff4ec] text-[#a24d1f] ring-1 ring-[#f3cfb6] hover:bg-[#fde9da]",
    ghost: "text-ink-2 hover:bg-black/5",
    danger: "bg-[#fdecea] text-[#9b2c24] hover:bg-[#fbdcd9]",
    ok: "bg-ok text-white hover:brightness-95",
  }[tone];
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      className={`inline-flex items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-semibold transition-colors disabled:opacity-40 ${cls} ${className}`}
    >
      {children}
    </button>
  );
}

export function Pill({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`inline-flex items-center gap-1 rounded-full bg-[#f2f0ec] px-2 py-[2px] text-[11px] font-semibold text-ink-2 ${className}`}>{children}</span>;
}

export function Section({ title, right, children, className = "" }: { title: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-faint">{title}</div>
        {right}
      </div>
      {children}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-[14px] border border-dashed border-black/10 px-4 py-6 text-center text-[13px] text-faint">{children}</div>;
}

/** Right-hand slide-over used by every toolbar panel. */
export function SidePanel({ title, sub, onClose, children, actions, wide }: { title: ReactNode; sub?: ReactNode; onClose: () => void; children: ReactNode; actions?: ReactNode; wide?: boolean }) {
  return (
    <motion.aside
      initial={{ x: 40, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 40, opacity: 0 }}
      transition={{ type: "spring", stiffness: 320, damping: 34 }}
      className={`absolute bottom-3 right-3 top-[68px] z-40 flex ${wide ? "w-[min(640px,calc(100%-24px))]" : "w-[min(460px,calc(100%-24px))]"} flex-col overflow-hidden rounded-[24px] bg-[#f7f6f3] shadow-[var(--shadow-float)] ring-1 ring-black/[0.06]`}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-start justify-between gap-3 border-b border-black/[0.06] bg-white px-5 py-4">
        <div className="min-w-0">
          <div className="text-[17px] font-semibold tracking-[-0.01em] text-ink" style={{ fontFamily: "var(--font-display)" }}>
            {title}
          </div>
          {sub && <div className="mt-0.5 text-[12.5px] text-muted">{sub}</div>}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {actions}
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full text-[16px] text-muted hover:bg-black/5" aria-label="Close">
            ✕
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">{children}</div>
    </motion.aside>
  );
}

/** Centered floating window (chat, terminal, config…). */
export function Window({ title, sub, icon, onClose, children, width = 560, dark, footer }: { title: ReactNode; sub?: ReactNode; icon?: ReactNode; onClose: () => void; children: ReactNode; width?: number; dark?: boolean; footer?: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 10, scale: 0.98 }}
      transition={{ type: "spring", stiffness: 340, damping: 32 }}
      className={`pointer-events-auto flex max-h-[calc(100vh-120px)] flex-col overflow-hidden rounded-[22px] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.45)] ring-1 ${dark ? "bg-[#16151a] text-white ring-white/10" : "bg-white ring-black/[0.06]"}`}
      style={{ width: `min(${width}px, calc(100vw - 24px))` }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className={`flex items-center justify-between gap-3 px-4 py-3 ${dark ? "border-b border-white/10" : "border-b border-black/[0.06]"}`}>
        <div className="flex min-w-0 items-center gap-2.5">
          {icon}
          <div className="min-w-0">
            <div className={`truncate text-[14.5px] font-semibold ${dark ? "text-white" : "text-ink"}`}>{title}</div>
            {sub && <div className={`truncate text-[12px] ${dark ? "text-white/50" : "text-muted"}`}>{sub}</div>}
          </div>
        </div>
        <button onClick={onClose} className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-[15px] ${dark ? "text-white/60 hover:bg-white/10" : "text-muted hover:bg-black/5"}`} aria-label="Close">
          ✕
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
      {footer}
    </motion.div>
  );
}

export function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors disabled:opacity-40 ${on ? "bg-ink" : "bg-black/15"}`}
    >
      <motion.span className="absolute top-[3px] h-4 w-4 rounded-full bg-white shadow" animate={{ left: on ? 19 : 3 }} transition={{ type: "spring", stiffness: 500, damping: 34 }} />
    </button>
  );
}

export function Segmented<T extends string>({ value, options, onChange, size = "md" }: { value: T; options: { v: T; l: string }[]; onChange: (v: T) => void; size?: "sm" | "md" }) {
  return (
    <div className="inline-flex rounded-full bg-[#f2f0ec] p-0.5">
      {options.map((o) => (
        <button
          key={o.v}
          onClick={() => onChange(o.v)}
          className={`relative rounded-full font-semibold transition-colors ${size === "sm" ? "px-2.5 py-1 text-[11.5px]" : "px-3 py-1.5 text-[12.5px]"} ${value === o.v ? "bg-white text-ink shadow-sm" : "text-muted hover:text-ink"}`}
        >
          {o.l}
        </button>
      ))}
    </div>
  );
}
