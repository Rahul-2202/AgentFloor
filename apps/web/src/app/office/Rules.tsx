"use client";

import { LOCK_TARGETS, PERMISSIONS, WHEN_BLOCKED, type Level, type LockTarget } from "@agentfloor/shared/governance";
import { useEffect, useState } from "react";
import { getSetup, type OfficeSetupView } from "@/lib/api";
import type { OfficeData } from "@/lib/office-data";

type Setup = OfficeSetupView;

/**
 * Rules and settings: who may do what (free, ask, never), what agents do when
 * blocked, drafts or direct, and locks. Every change is a read-back; locks can
 * only be lifted here, never from chat.
 */
export function Rules({ data, change }: { data: OfficeData; change: (ops: object[]) => void }) {
  const [setup, setSetup] = useState<Setup | null>(null);
  useEffect(() => {
    void getSetup().then((s) => setSetup(s.setup));
  }, [data.agents, data.rooms]);
  if (!setup) return <p className="text-faint">Loading…</p>;

  const roomLevel = (roomId: string, p: string): Level => (setup.rooms.find((r) => r.id === roomId)?.permissions?.[p] as Level) ?? PERMISSIONS.find((x) => x.id === p)!.default;
  const cell = (level: Level, inherited: boolean) =>
    `rounded-md px-2 py-1 text-xs ${level === "free" ? "bg-ok/15 text-ok" : level === "ask" ? "bg-warn/15 text-warn" : "bg-bad/15 text-bad"} ${inherited ? "opacity-60" : ""}`;

  return (
    <div className="space-y-6">
      <section className="overflow-x-auto rounded-2xl bg-surface p-4 shadow-[var(--shadow-card)]">
        <h3 className="font-display font-semibold">Permissions</h3>
        <p className="text-sm text-muted">Free: just do it. Ask: you approve each time. Never: refused. Faded cells come from the room. The first use of a powerful permission always asks you once.</p>
        <table className="mt-3 w-full min-w-[40rem] text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="py-1 pr-3">Who</th>
              {PERMISSIONS.map((p) => (
                <th key={p.id} className="px-1 py-1" title={p.covers}>
                  {p.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {setup.rooms.map((r) => (
              <>
                <tr key={r.id} className="border-t border-line">
                  <td className="py-2 pr-3 font-medium">{r.name} (room)</td>
                  {PERMISSIONS.map((p) => (
                    <td key={p.id} className="px-1">
                      <select
                        value={r.permissions?.[p.id] ?? ""}
                        onChange={(e) => change([{ op: "set_permission", scope: "room", id: r.id, permission: p.id, level: e.target.value || null }])}
                        className={cell(roomLevel(r.id, p.id), !r.permissions?.[p.id])}
                      >
                        <option value="">default ({p.default})</option>
                        <option value="free">free</option>
                        <option value="ask">ask</option>
                        <option value="never">never</option>
                      </select>
                    </td>
                  ))}
                </tr>
                {setup.agents
                  .filter((a) => a.room === r.id)
                  .map((a) => (
                    <tr key={a.id}>
                      <td className="py-1 pl-4 pr-3 text-muted">{a.name}</td>
                      {PERMISSIONS.map((p) => (
                        <td key={p.id} className="px-1">
                          <select
                            value={a.permissions?.[p.id] ?? ""}
                            onChange={(e) => change([{ op: "set_permission", scope: "agent", id: a.id, permission: p.id, level: e.target.value || null }])}
                            className={cell((a.permissions?.[p.id] as Level) ?? roomLevel(r.id, p.id), !a.permissions?.[p.id])}
                          >
                            <option value="">room ({roomLevel(r.id, p.id)})</option>
                            <option value="free">free</option>
                            <option value="ask">ask</option>
                            <option value="never">never</option>
                          </select>
                        </td>
                      ))}
                    </tr>
                  ))}
              </>
            ))}
          </tbody>
        </table>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl bg-surface p-4 shadow-[var(--shadow-card)]">
          <h3 className="font-display font-semibold">Each room</h3>
          {setup.rooms.map((r) => (
            <div key={r.id} className="mt-3 text-sm">
              <p className="font-medium">{r.name}</p>
              <label className="mt-1 flex items-center justify-between gap-2">
                <span className="text-muted">When blocked</span>
                <select value={r.whenBlocked ?? "park_and_switch"} onChange={(e) => change([{ op: "set_when_blocked", room: r.id, policy: e.target.value }])} className="rounded-lg bg-surface-2 px-2 py-1">
                  {Object.keys(WHEN_BLOCKED).map((k) => (
                    <option key={k} value={k}>
                      {k.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </label>
              <label className="mt-1 flex items-center justify-between gap-2">
                <span className="text-muted">Pull requests</span>
                <select value={r.publish ?? "drafts"} onChange={(e) => change([{ op: "set_publish", room: r.id, mode: e.target.value }])} className="rounded-lg bg-surface-2 px-2 py-1">
                  <option value="drafts">as drafts for you</option>
                  <option value="direct">ready for review</option>
                </select>
              </label>
            </div>
          ))}
        </div>
        <div className="rounded-2xl bg-surface p-4 shadow-[var(--shadow-card)]">
          <h3 className="font-display font-semibold">Locked rules</h3>
          <p className="text-sm text-muted">Locked settings can&apos;t be changed from chat (not even by Ada). Only you unlock them, here.</p>
          <ul className="mt-3 space-y-2 text-sm">
            {(Object.keys(LOCK_TARGETS) as LockTarget[]).map((t) => {
              const locked = setup.locks.includes(t);
              return (
                <li key={t} className="flex items-center justify-between gap-3">
                  <span>{LOCK_TARGETS[t]}</span>
                  {t === "merge" ? (
                    <span className="text-xs text-muted">always locked</span>
                  ) : (
                    <button onClick={() => change([{ op: locked ? "unlock" : "lock", target: t }])} className={`rounded-lg px-2 py-1 text-xs ${locked ? "bg-ink text-white" : "ring-1 ring-line-2"}`}>
                      {locked ? "Locked · unlock" : "Lock"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </section>
    </div>
  );
}
