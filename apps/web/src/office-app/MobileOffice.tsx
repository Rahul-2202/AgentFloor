"use client";

import Link from "next/link";
import { useState } from "react";
import { LogoMark } from "@/components/Logo";
import { clockLabel, useSim } from "@/sim/store";
import { Dot, Empty, Face } from "./bits";
import { ConversationsPanel } from "./panels/Conversations";
import { DashboardPanel } from "./panels/Dashboard";
import { InboxPanel } from "./panels/Inbox";
import { useUI } from "./ui";
import { WindowRouter } from "./windows";
import { ReadBackHost } from "./windows/ReadBack";
import { nameOf } from "./who";

type Tab = "needs" | "rooms" | "work" | "ada";

/** Phones get the list view from the spec: what needs you, rooms and meetings, Ada. */
export function MobileOffice() {
  const { s, act } = useSim();
  const ui = useUI();
  const [tab, setTab] = useState<Tab>(s.office.onboardedAt ? "needs" : "ada");
  const needs = s.inbox.filter((i) => !i.resolved && !i.batched).length;
  const asleep = s.machine !== "started";

  return (
    <div className="fixed inset-0 flex flex-col bg-[#f7f6f3]">
      <div className="flex items-center gap-2.5 border-b border-black/[0.06] bg-white px-4 py-3">
        <Link href="/">
          <LogoMark size={26} />
        </Link>
        <div className="flex-1 leading-tight">
          <div className="text-[14px] font-semibold text-ink">{s.setup?.name ?? s.office.name}</div>
          <div className="text-[11px] text-muted">
            {asleep ? "Asleep" : "Live"} · {clockLabel(s.now)}
            {asleep && (
              <button onClick={() => void act.start()} className="ml-1.5 font-semibold text-ink underline">
                Start
              </button>
            )}
          </div>
        </div>
        <button onClick={() => ui.openWin({ kind: "assign" })} className="rounded-full bg-ink px-3 py-1.5 text-[12.5px] font-semibold text-white">
          + Task
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {tab === "needs" && <InboxPanel />}
        {tab === "work" && <DashboardPanel />}
        {tab === "rooms" && (
          <div className="flex flex-col gap-5">
            {!Object.keys(s.rooms).length && <Empty>No rooms yet. Ask Ada to set up your office.</Empty>}
            {Object.keys(s.rooms).map((r) => {
              const cfg = s.rooms[r];
              return (
                <div key={r}>
                  <button onClick={() => ui.openWin({ kind: "room", id: r, tab: "channel" })} className="mb-2 flex w-full items-center justify-between">
                    <span className="text-[13px] font-semibold text-ink">
                      {cfg.name} <span className="font-normal text-muted">{cfg.purpose}</span>
                    </span>
                    <span className="text-[12px] font-semibold text-ink">Open →</span>
                  </button>
                  <div className="overflow-hidden rounded-[16px] bg-white ring-1 ring-black/[0.06]">
                    {[cfg.head, ...cfg.members.filter((m) => m !== cfg.head)].map((m) => (
                      <button key={m} onClick={() => ui.openWin({ kind: "chat", id: m, mode: "queue" })} className="flex w-full items-center gap-2.5 border-b border-black/[0.04] px-3 py-2.5 text-left last:border-0">
                        <Face id={m} size={30} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
                            {nameOf(m)} <Dot status={s.live[m]?.status ?? "idle"} />
                          </div>
                          <div className="truncate text-[11.5px] text-muted">{s.live[m]?.step}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
            <div>
              <div className="mb-2 text-[13px] font-semibold text-ink">Meetings and threads</div>
              <ConversationsPanel />
            </div>
          </div>
        )}
        {tab === "ada" && (
          <div className="flex flex-col items-center gap-4 pt-8 text-center">
            <Face id="ada" size={72} />
            <div>
              <div className="text-[17px] font-semibold text-ink">Ada</div>
              <div className="text-[13px] text-muted">{s.office.onboardedAt ? "Your office manager." : "She'll set up your office with you: a few questions, then a read-back."}</div>
            </div>
            <button onClick={() => ui.openWin({ kind: "chat", id: "ada" })} className="rounded-full bg-ink px-4 py-2.5 text-[13.5px] font-semibold text-white">
              {s.office.onboardedAt ? "Message Ada" : "Start with Ada"}
            </button>
            <div className="mt-2 rounded-[14px] bg-white p-3 text-[12.5px] text-muted ring-1 ring-black/[0.06]">The walkable office is on desktop. Open this page on a laptop to walk around.</div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-4 border-t border-black/[0.06] bg-white pb-[env(safe-area-inset-bottom)]">
        {(
          [
            ["needs", "Needs you", needs],
            ["rooms", "Rooms", 0],
            ["work", "Work", 0],
            ["ada", "Ada", 0],
          ] as [Tab, string, number][]
        ).map(([k, l, n]) => (
          <button key={k} onClick={() => setTab(k)} className={`relative py-3 text-[12px] font-semibold ${tab === k ? "text-ink" : "text-faint"}`}>
            {l}
            {n > 0 && <span className="absolute right-[18%] top-2 grid h-4 min-w-4 place-items-center rounded-full bg-bad px-1 text-[9.5px] font-bold text-white">{n}</span>}
          </button>
        ))}
      </div>
      <WindowRouter />
      <ReadBackHost />
    </div>
  );
}
