"use client";

import { useEffect, useState } from "react";
import { BrandIcon } from "@/components/brands";
import { useSim } from "@/sim/store";
import type { Output } from "@/sim/types";
import { Empty, Face, Segmented } from "../bits";
import { useUI } from "../ui";
import { KIND_LABEL, StatusTag } from "../windows/OutputWindow";
import { nameOf } from "../who";

const ICON: Record<Output["kind"], React.ReactNode> = {
  pr: <BrandIcon name="GitHub" size={16} />,
  ticket: <BrandIcon name="Linear" size={16} />,
  post: <BrandIcon name="LinkedIn" size={16} />,
  video: <span className="text-[13px]">▶</span>,
  report: <BrandIcon name="Google Sheets" size={16} />,
  design: <BrandIcon name="Figma" size={16} />,
  blog: <BrandIcon name="Google Docs" size={16} />,
  deploy: <BrandIcon name="Vercel" size={16} />,
};

export function OutputsPanel({ initial }: { initial?: string }) {
  const { s } = useSim();
  const ui = useUI();
  const by = initial?.startsWith("by:") ? initial.slice(3) : null;
  const [filter, setFilter] = useState<"all" | "unviewed" | "review">(by ? "all" : "unviewed");
  const [kind, setKind] = useState<Output["kind"] | "all">("all");

  useEffect(() => {
    if (initial && s.outputs.some((o) => o.id === initial)) ui.openWin({ kind: "output", id: initial });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  const list = s.outputs
    .filter((o) => !by || o.by === by)
    .filter((o) => (filter === "unviewed" ? !o.viewed : filter === "review" ? o.status === "review" : true))
    .filter((o) => kind === "all" || o.kind === kind);
  const kinds = Array.from(new Set(s.outputs.map((o) => o.kind)));

  return (
    <div className="flex flex-col gap-4">
      {by && (
        <div className="flex items-center gap-2 rounded-[14px] bg-white p-2.5 ring-1 ring-black/[0.06]">
          <Face id={by} size={24} />
          <span className="text-[13px] font-semibold text-ink">From {nameOf(by)}</span>
        </div>
      )}
      <Segmented
        value={filter}
        onChange={setFilter}
        options={[
          { v: "unviewed", l: `Unviewed · ${s.outputs.filter((o) => !o.viewed && (!by || o.by === by)).length}` },
          { v: "review", l: "Needs review" },
          { v: "all", l: "All" },
        ]}
      />
      <div className="flex flex-wrap gap-1.5">
        {(["all", ...kinds] as const).map((k) => (
          <button key={k} onClick={() => setKind(k as Output["kind"] | "all")} className={`rounded-full px-2.5 py-1 text-[12px] font-semibold ${kind === k ? "bg-ink text-white" : "bg-white text-ink-2 ring-1 ring-black/[0.08]"}`}>
            {k === "all" ? "Everything" : KIND_LABEL[k as Output["kind"]]}
          </button>
        ))}
      </div>
      {list.length ? (
        <div className="flex flex-col gap-2">
          {list.map((o) => (
            <button key={o.id} onClick={() => ui.openWin({ kind: "output", id: o.id })} className="flex items-start gap-3 rounded-[16px] bg-white p-3 text-left ring-1 ring-black/[0.06] hover:ring-black/15">
              <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-[#f6f5f2]">
                {ICON[o.kind]}
                {!o.viewed && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-accent ring-2 ring-white" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block text-[13.5px] leading-snug text-ink ${o.viewed ? "font-medium" : "font-semibold"}`}>{o.title}</span>
                <span className="mt-0.5 block truncate text-[12px] text-muted">{o.summary}</span>
                <span className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-muted">
                  <Face id={o.by} size={16} /> {nameOf(o.by)} · {o.at}
                  <span className="ml-auto">
                    <StatusTag o={o} />
                  </span>
                </span>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <Empty>{filter === "unviewed" ? "You're all caught up." : "Nothing here yet."}</Empty>
      )}
    </div>
  );
}
