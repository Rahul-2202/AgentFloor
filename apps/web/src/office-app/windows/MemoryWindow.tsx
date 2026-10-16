"use client";

import { useState } from "react";
import { CAST } from "@/office/layout";
import { acceptMemory, editMemory, flagMemory, rejectMemory } from "@/lib/api";
import { useSim } from "@/sim/store";
import type { MemItem } from "@/sim/types";
import { Btn, Empty, Face, Segmented, Window } from "../bits";
import { useUI } from "../ui";
import { nameOf } from "../who";

export function MemCard({ m, editable = true }: { m: MemItem; editable?: boolean }) {
  const { s, d, act } = useSim();
  const [edit, setEdit] = useState(false);
  const [title, setTitle] = useState(m.title);
  const [body, setBody] = useState(m.body);
  const [flagging, setFlagging] = useState(false);
  const [reason, setReason] = useState("");
  const flags = s.data.flags.filter((f) => f.item_id === m.id);
  const run = (p: Promise<unknown>, ok: string) => p.then(() => act.toast(ok), (e) => act.toast((e as Error).message));
  const tone = m.status === "superseded" ? "opacity-55" : "";
  return (
    <div className={`rounded-[14px] bg-white p-3.5 ring-1 ${m.pending ? "ring-[#f1d9a6]" : "ring-black/[0.06]"} ${tone}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-[#f2f0ec] px-1.5 py-[1px] text-[10px] font-bold uppercase tracking-wide text-muted">{m.type}</span>
            {m.pending && <span className="rounded-full bg-[#fdf3e0] px-1.5 py-[1px] text-[10px] font-bold uppercase tracking-wide text-[#8a5a10]">Proposed</span>}
            {m.status !== "active" && <span className={`rounded-full px-1.5 py-[1px] text-[10px] font-bold uppercase tracking-wide ${m.status === "stale" ? "bg-[#fdf3e0] text-[#8a5a10]" : "bg-[#f0efed] text-muted"}`}>{m.status}</span>}
            {flags.length > 0 && m.status !== "stale" && <span className="rounded-full bg-[#fdf3e0] px-1.5 py-[1px] text-[10px] font-bold uppercase tracking-wide text-[#8a5a10]">Flagged</span>}
            {m.confidence && <span className="text-[11px] text-faint">confidence: {m.confidence}</span>}
            {m.version && m.version > 1 && <span className="text-[11px] text-faint">v{m.version}</span>}
          </div>
          {edit ? (
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 w-full rounded-[8px] bg-[#f6f5f2] px-2 py-1 text-[13.5px] font-semibold outline-none ring-1 ring-black/[0.08]" />
          ) : (
            <div className={`mt-1 text-[13.5px] font-semibold text-ink ${m.status === "superseded" ? "line-through decoration-black/30" : ""}`}>{m.title}</div>
          )}
        </div>
        <Face id={m.owner} size={22} />
      </div>
      {edit ? (
        <div className="mt-2">
          <textarea value={body} onChange={(e) => setBody(e.target.value)} className="h-24 w-full rounded-[10px] bg-[#f6f5f2] p-2 text-[13px] outline-none ring-1 ring-black/[0.08]" />
          <div className="mt-1.5 flex gap-1.5">
            <Btn
              tone="dark"
              onClick={() => {
                d({ type: "memory", id: m.id, patch: { title, body } });
                void run(editMemory(m.id, { title, body }), "Saved. Anything derived from it is flagged for a refresh.");
                setEdit(false);
              }}
            >
              Save
            </Btn>
            <Btn onClick={() => setEdit(false)}>Cancel</Btn>
          </div>
        </div>
      ) : (
        <div className="mt-1 whitespace-pre-wrap text-[12.5px] leading-[1.5] text-ink-2">{m.body}</div>
      )}
      {flags.map((f) => (
        <div key={f.id} className="mt-2 rounded-[10px] bg-[#fdf3e0] px-2.5 py-1.5 text-[11.5px] text-[#8a5a10]">
          Flagged by {f.flagged_by.map(nameOf).join(", ")}: {f.reasons.join("; ")}
        </div>
      ))}
      {m.pending && (
        <div className="mt-2 flex gap-1.5">
          <Btn tone="dark" className="!py-1 !text-[12px]" onClick={() => void run(acceptMemory(m.id), "Accepted into memory.")}>
            Accept
          </Btn>
          <Btn className="!py-1 !text-[12px]" onClick={() => void run(rejectMemory(m.id, "Rejected by the CEO"), "Rejected.")}>
            Reject
          </Btn>
        </div>
      )}
      {flagging && (
        <div className="mt-2 flex gap-1.5">
          <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What's wrong with it?" className="min-w-0 flex-1 rounded-full bg-[#f6f5f2] px-3 py-1 text-[12.5px] outline-none ring-1 ring-black/[0.08]" />
          <Btn
            tone="dark"
            className="!py-1 !text-[12px]"
            onClick={() => {
              if (!reason.trim()) return;
              void run(flagMemory(m.id, reason.trim()), "Flagged for its owner.");
              setFlagging(false);
              setReason("");
            }}
          >
            Flag
          </Btn>
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted">
        <span>
          {nameOf(m.owner)}
          {m.source ? ` · ${m.source}` : ""} · {m.date}
        </span>
        {editable && !edit && m.status !== "superseded" && (
          <span className="flex gap-2">
            <button onClick={() => setEdit(true)} className="font-semibold text-ink hover:underline">
              Edit
            </button>
            {!flagging && m.status === "active" && (
              <button onClick={() => setFlagging(true)} className="font-semibold text-[#8a5a10] hover:underline">
                Flag stale
              </button>
            )}
          </span>
        )}
      </div>
    </div>
  );
}

export function MemoryWindow({ id }: { id: string }) {
  const { s } = useSim();
  const ui = useUI();
  const [tab, setTab] = useState<"own" | "reads">("own");
  const room = `room:${CAST[id]?.room ?? ""}`;
  const own = s.memory.filter((m) => m.layer === `agent:${id}`);
  const reads = s.memory.filter((m) => m.layer === room || m.layer === "company" || (m.layer === "ceo" && m.status === "active"));
  const groups: [string, MemItem[]][] = [
    ["Role card", own.filter((m) => m.type === "role")],
    ["Lessons", own.filter((m) => m.type === "lesson")],
    ["Scratchpad and notes", own.filter((m) => m.type !== "role" && m.type !== "lesson")],
  ];
  return (
    <Window width={600} onClose={ui.closeWin} icon={<Face id={id} size={32} />} title={`${nameOf(id)}'s memory`} sub="Everything this agent remembers. You can edit any of it.">
      <div className="flex items-center justify-between gap-3 border-b border-black/[0.05] bg-[#fbfaf8] px-4 py-2.5">
        <Segmented
          size="sm"
          value={tab}
          onChange={setTab}
          options={[
            { v: "own", l: "Own memory" },
            { v: "reads", l: "What it reads" },
          ]}
        />
        <span className="text-[11.5px] text-muted">Written into its CLAUDE.md each turn: the index, then only what&apos;s relevant</span>
      </div>
      <div className="flex max-h-[min(520px,60vh)] flex-col gap-4 overflow-y-auto p-4">
        {tab === "own" ? (
          groups.map(([t, items]) => (
            <div key={t}>
              <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-faint">{t}</div>
              {items.length ? (
                <div className="flex flex-col gap-2">
                  {items.map((m) => (
                    <MemCard key={m.id} m={m} />
                  ))}
                </div>
              ) : (
                t === "Role card" ? (
                  <div className="rounded-[14px] bg-white p-3.5 text-[12.5px] text-ink-2 ring-1 ring-black/[0.06]">
                    <b className="font-semibold text-ink">{s.configs[id]?.roleCard || "No role written yet."}</b>
                    <div className="mt-1 text-[11.5px] text-muted">From its setup. Change it in Config, or tell Ada.</div>
                  </div>
                ) : (
                  <Empty>Nothing yet. {t === "Lessons" ? "Lessons are added as the agent learns from your corrections." : ""}</Empty>
                )
              )}
            </div>
          ))
        ) : (
          <div className="flex flex-col gap-2">
            <div className="text-[12.5px] text-muted">Derived from room and company memory, plus your preferences filtered to this room. It reads the index first and pulls only what a task needs.</div>
            {reads.map((m) => (
              <MemCard key={m.id} m={m} editable={false} />
            ))}
          </div>
        )}
      </div>
    </Window>
  );
}
