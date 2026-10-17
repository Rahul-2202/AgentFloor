"use client";

import { useEffect } from "react";
import { BrandIcon } from "@/components/brands";
import { MergeBox } from "../real/MergeBox";
import { useSim } from "@/sim/store";
import type { Output } from "@/sim/types";
import { Btn, Face, Window } from "../bits";
import { useUI } from "../ui";
import { nameOf, ROOM_LABEL } from "../who";

export const KIND_LABEL: Record<Output["kind"], string> = {
  pr: "Pull request",
  ticket: "Ticket closed",
  post: "Social drafts",
  video: "Video draft",
  report: "Report",
  design: "Design",
  blog: "Writing",
  deploy: "Deploy",
};

const STATUS: Record<Output["status"], { l: string; c: string }> = {
  review: { l: "In review", c: "bg-[#fdecea] text-[#9b2c24]" },
  approved: { l: "Done", c: "bg-[#eaf6ee] text-[#24603a]" },
  merged: { l: "Merged", c: "bg-[#f1eefd] text-[#4a3fa8]" },
  closed: { l: "Closed", c: "bg-[#e8eefb] text-[#2c56b0]" },
  changes: { l: "Changes requested", c: "bg-[#fdf3e0] text-[#8a5a10]" },
  shipped: { l: "Shipped", c: "bg-[#eaf6ee] text-[#24603a]" },
};

export function StatusTag({ o }: { o: Output }) {
  return <span className={`rounded-full px-2 py-[2px] text-[11px] font-bold ${STATUS[o.status].c}`}>{STATUS[o.status].l}</span>;
}

function Preview({ o }: { o: Output }) {
  const ui = useUI();
  if (o.pr) return <MergeBox pr={o.pr} />;
  if (o.file)
    return (
      <button onClick={() => ui.openWin({ kind: "files", id: o.by, tab: o.file })} className="flex w-full items-center gap-3 rounded-[14px] bg-white p-3.5 text-left ring-1 ring-black/[0.08] hover:ring-black/20">
        <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-[#f2f0ec] text-ink-2">▤</span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-[13px] font-semibold text-ink">{o.file}</div>
          <div className="text-[12px] text-muted">In {nameOf(o.by)}&apos;s folder on the office computer</div>
        </div>
        <span className="text-[12px] font-semibold text-ink">Open →</span>
      </button>
    );
  if (o.url)
    return (
      <a href={o.url} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-[14px] bg-white p-3.5 ring-1 ring-black/[0.08] hover:ring-black/20">
        <BrandIcon name="GitHub" size={20} />
        <div className="min-w-0">
          <div className="truncate text-[13.5px] font-semibold text-ink">{o.title}</div>
          <div className="truncate text-[12px] text-muted">{o.url}</div>
        </div>
      </a>
    );
  return <div className="rounded-[14px] bg-[#f6f5f2] p-3.5 text-[12.5px] text-muted">No link was attached to this output.</div>;
}

export function OutputWindow({ id }: { id: string }) {
  const { s, d } = useSim();
  const ui = useUI();
  const o = s.outputs.find((x) => x.id === id);
  useEffect(() => {
    if (o && !o.viewed) d({ type: "output", id: o.id, patch: { viewed: true } });
  }, [o, d]);
  if (!o) return null;
  return (
    <Window
      width={620}
      onClose={ui.closeWin}
      icon={<Face id={o.by} size={32} />}
      title={o.title}
      sub={`${KIND_LABEL[o.kind]} · ${nameOf(o.by)} · ${ROOM_LABEL[o.room]} · ${o.at}`}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-black/[0.06] px-4 py-3">
          <StatusTag o={o} />
          <div className="flex gap-2">
            <Btn onClick={() => ui.openWin({ kind: "task", id: o.taskId! })}>The task</Btn>
            <Btn onClick={() => ui.openWin({ kind: "chat", id: o.by, mode: "queue" })}>Message {nameOf(o.by)}</Btn>
          </div>
        </div>
      }
    >
      <div className="flex max-h-[min(560px,62vh)] flex-col gap-3 overflow-y-auto p-4">
        <div className="text-[13.5px] leading-[1.5] text-ink-2">{o.summary}</div>
        {o.meta && (
          <div className="flex flex-wrap gap-1.5">
            {o.meta.map(([k, v]) => (
              <span key={k} className="rounded-full bg-[#f6f5f2] px-2.5 py-1 text-[12px] text-ink-2">
                <span className="text-muted">{k}: </span>
                {v}
              </span>
            ))}
          </div>
        )}
        <Preview o={o} />
      </div>
    </Window>
  );
}
