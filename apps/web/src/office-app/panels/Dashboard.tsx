"use client";

import { useEffect, useState } from "react";
import { getSpend } from "@/lib/api";
import { useSim } from "@/sim/store";
import type { RoomKey, Task, TaskState } from "@/sim/types";
import { Bar, Btn, Empty, Face, Section, Segmented, StateChip } from "../bits";
import { useUI } from "../ui";
import { nameOf } from "../who";

function TaskRow({ t }: { t: Task }) {
  const ui = useUI();
  return (
    <div className="rounded-[16px] bg-white p-3 ring-1 ring-black/[0.06]">
      <button onClick={() => ui.openWin({ kind: "task", id: t.id })} className="flex w-full items-start gap-2.5 text-left">
        <Face id={t.owner} size={30} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[10.5px] text-faint">{t.key}</span>
            {t.priority === "P1" && <span className="rounded bg-[#fdecea] px-1 text-[9.5px] font-bold text-[#9b2c24]">P1</span>}
            {t.linear && <span className="font-mono text-[10.5px] text-[#4a55a8]">{t.linear.identifier}</span>}
            <span className="ml-auto">
              <StateChip state={t.state} />
            </span>
          </div>
          <div className="mt-0.5 text-[13.5px] font-semibold leading-snug text-ink">{t.title}</div>
          <div className="mt-0.5 text-[12px] text-muted">
            {nameOf(t.owner)}{t.step ? ` · ${t.step}` : ""}
          </div>
          {t.state !== "done" && t.state !== "queued" && (
            <div className="mt-2">
              <Bar value={t.progress} color={t.state === "question" || t.state === "blocked" ? "#d99a2b" : t.state === "review" ? "#7b6cd9" : "#3f9b5f"} />
            </div>
          )}
        </div>
      </button>
      {t.state === "blocked" && t.blocker && (
        <div className="mt-2.5 rounded-[12px] bg-[#fdf3e0]/70 p-2.5">
          <div className="text-[12.5px] font-semibold text-ink">{t.blocker}</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Btn tone="dark" className="!py-1 !text-[12px]" onClick={() => ui.openWin({ kind: "chat", id: t.owner, mode: "now" })}>
              Message {nameOf(t.owner)}
            </Btn>
          </div>
        </div>
      )}
      {t.state === "review" && t.outputs?.length ? (
        <div className="mt-2.5 flex justify-end">
          <Btn tone="dark" className="!py-1 !text-[12px]" onClick={() => ui.openWin({ kind: "output", id: t.outputs![t.outputs!.length - 1] })}>
            Review output
          </Btn>
        </div>
      ) : null}
    </div>
  );
}

const GROUPS: { k: string; l: string; states: TaskState[] }[] = [
  { k: "b", l: "Blockers", states: ["blocked"] },
  { k: "r", l: "Waiting for your review", states: ["review"] },
  { k: "o", l: "Ongoing", states: ["ongoing"] },
  { k: "u", l: "Queued", states: ["queued"] },
  { k: "d", l: "Completed", states: ["done"] },
];

function Spend() {
  const { s } = useSim();
  const [days, setDays] = useState<"1" | "7" | "30">("1");
  const [data, setData] = useState<Awaited<ReturnType<typeof getSpend>> | null>(null);
  useEffect(() => {
    void getSpend(Number(days)).then(setData, () => {});
  }, [days, s.data.agents.length]);
  const roomName = (id: string | null) => Object.values(s.rooms).find((r) => r.realId === id)?.name ?? "Other";
  return (
    <Section title="Spend" right={<Segmented size="sm" value={days} onChange={setDays} options={[{ v: "1", l: "Today" }, { v: "7", l: "7 days" }, { v: "30", l: "30 days" }]} />}>
      <div className="rounded-[14px] bg-white p-3 ring-1 ring-black/[0.05]">
        <div className="text-[22px] font-semibold tracking-[-0.02em] text-ink" style={{ fontFamily: "var(--font-display)" }}>
          ${(data?.total.costUsd ?? 0).toFixed(2)}
        </div>
        <div className="text-[11.5px] text-muted">
          {data?.total.calls ?? 0} model calls · {Math.round((data?.total.tokens ?? 0) / 1000)}k tokens · API-equivalent
        </div>
        <div className="mt-2.5 flex flex-col gap-1">
          {(data?.rooms ?? []).map((r) => (
            <div key={r.roomId ?? "other"} className="flex justify-between text-[12px] text-ink-2">
              <span>{roomName(r.roomId)}</span>
              <span>${r.costUsd.toFixed(2)}</span>
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}

export function DashboardPanel() {
  const { s } = useSim();
  const [room, setRoom] = useState<"all" | RoomKey>("all");
  const tasks = s.tasks.filter((t) => room === "all" || t.room === room);
  const count = (st: TaskState[]) => tasks.filter((t) => st.includes(t.state)).length;
  const stats = [
    { l: "Ongoing", v: count(["ongoing"]), c: "#3f9b5f" },
    { l: "Blocked", v: count(["blocked", "question"]), c: "#d99a2b" },
    { l: "In review", v: count(["review"]), c: "#7b6cd9" },
    { l: "Completed", v: count(["done"]), c: "#3b7be8" },
  ];
  return (
    <div className="flex flex-col gap-5">
      <Segmented
        value={room}
        onChange={setRoom}
        options={[{ v: "all", l: "All rooms" }, ...Object.values(s.rooms).map((r) => ({ v: r.id, l: r.name }))]}
      />
      <div className="grid grid-cols-4 gap-2">
        {stats.map((x) => (
          <div key={x.l} className="rounded-[14px] bg-white px-3 py-2.5 ring-1 ring-black/[0.05]">
            <div className="text-[11px] font-semibold text-muted">{x.l}</div>
            <div className="text-[22px] font-semibold tracking-[-0.02em]" style={{ color: x.c, fontFamily: "var(--font-display)" }}>
              {x.v}
            </div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {Object.keys(s.rooms)
          .filter((r) => room === "all" || r === room)
          .map((r) => {
            const cfg = s.rooms[r];
            return (
              <div key={r} className="rounded-[14px] bg-white p-3 ring-1 ring-black/[0.05]">
                <div className="flex items-center justify-between text-[12px]">
                  <span className="font-semibold text-ink">{cfg.name} today</span>
                  <span className="text-muted">
                    ${cfg.spent.toFixed(2)}
                    {cfg.budget ? ` / $${cfg.budget}` : ""}
                  </span>
                </div>
                <div className="mt-2">
                  <Bar value={cfg.budget ? (cfg.spent / cfg.budget) * 100 : 0} color={cfg.budget && cfg.spent / cfg.budget > 0.8 ? "#d99a2b" : "#0a0a0a"} />
                </div>
              </div>
            );
          })}
      </div>
      <Spend />
      {!tasks.length && <Empty>No work yet. Assign a task, or ask Ada to plan some.</Empty>}
      {GROUPS.map((g) => {
        const items = tasks.filter((t) => g.states.includes(t.state));
        if (!items.length) return null;
        return (
          <Section key={g.k} title={`${g.l} · ${items.length}`}>
            <div className="flex flex-col gap-2">
              {items.map((t) => (
                <TaskRow key={t.id} t={t} />
              ))}
            </div>
          </Section>
        );
      })}
    </div>
  );
}
