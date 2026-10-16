"use client";

import { LOCK_TARGETS, PERMISSIONS, type Level, type LockTarget } from "@agentfloor/shared/governance";
import { useEffect, useRef, useState } from "react";
import { NORMS, PERM_COVERS, PERM_LABEL } from "@/sim/catalog";
import { useSim } from "@/sim/store";
import type { PermKey } from "@/sim/types";
import { Bar, Btn, Empty, Face, Section, Toggle } from "../bits";
import { GitHubCard } from "../real/GitHubCard";
import { useUI } from "../ui";
import { nameOf } from "../who";

const NEXT: Record<Level, Level> = { never: "ask", ask: "free", free: "never" };
const CELL: Record<Level, { l: string; c: string }> = {
  free: { l: "Free", c: "bg-[#eaf6ee] text-[#24603a]" },
  ask: { l: "Ask", c: "bg-[#fdf3e0] text-[#8a5a10]" },
  never: { l: "—", c: "bg-[#f6f5f2] text-faint" },
};
const SAY: Record<Level, string> = { free: "free", ask: "asks you", never: "never" };
const SHORT: Record<PermKey, string> = { push: "Push", open_pr: "PRs", network: "Web", outside_worktree: "Outside", close_tickets: "Close" };
const BLOCKED = { park: "Park and switch", guess: "Best guess, flag it", wait: "Stop and wait" } as const;

export function GovernancePanel({ initial }: { initial?: string }) {
  const { s, d, act } = useSim();
  const ui = useUI();
  const root = useRef<HTMLDivElement>(null);
  const office = s.setup?.budgets.find((b) => b.scope === "office");
  const [soft, setSoft] = useState(String(office?.dailyUsdSoft ?? ""));
  const [hard, setHard] = useState(String(office?.dailyUsdHard ?? ""));

  useEffect(() => {
    if (!initial) return;
    const t = setTimeout(() => root.current?.querySelector(`[data-anchor="${initial}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 200);
    return () => clearTimeout(t);
  }, [initial]);

  const rooms = Object.values(s.rooms);
  const locked = (t: LockTarget) => s.locked.find((l) => l.id === t)?.locked;
  const setupRoom = (realId: string) => s.setup?.rooms.find((r) => r.id === realId);
  const setupAgent = (id: string) => s.setup?.agents.find((a) => a.id === id);

  const cycle = (scope: "agent" | "room", id: string, name: string, k: PermKey, cur: Level) => {
    const nxt = NEXT[cur];
    void act.change([{ op: "set_permission", scope, id, permission: k, level: nxt }], `${name}: ${PERM_LABEL[k].toLowerCase()} → ${SAY[nxt]}`);
  };
  const num = (v: string) => (v.trim() === "" ? null : Number(v));

  return (
    <div ref={root} className="relative flex flex-col gap-6">
      <div data-anchor="permissions">
        <Section title="Permissions · click a cell to change it">
          {!rooms.length ? (
            <Empty>No agents yet.</Empty>
          ) : (
            <div className="overflow-x-auto rounded-[16px] bg-white ring-1 ring-black/[0.06]">
              <table className="w-full text-[11.5px]">
                <thead>
                  <tr className="text-faint">
                    <th className="px-2 py-2 text-left font-semibold">Who</th>
                    {PERMISSIONS.map((p) => (
                      <th key={p.id} className="px-1 py-2 font-semibold" title={`${p.label}: ${p.covers}`}>
                        {SHORT[p.id]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rooms.map((r) => {
                    const sr = setupRoom(r.realId);
                    return [
                      <tr key={r.id} className="border-t border-black/[0.08] bg-[#fbfaf8]">
                        <td className="px-2 py-1.5 font-semibold text-ink">{r.name}</td>
                        {PERMISSIONS.map((p) => {
                          const own = sr?.permissions?.[p.id] as Level | undefined;
                          const v = own ?? p.default;
                          return (
                            <td key={p.id} className="px-0.5 py-1 text-center">
                              <button
                                disabled={locked("permissions")}
                                onClick={() => cycle("room", r.realId, r.name, p.id, v)}
                                className={`w-full rounded-[6px] px-1 py-1 font-semibold disabled:cursor-not-allowed ${CELL[v].c} ${own ? "" : "opacity-60"}`}
                                title={own ? PERM_LABEL[p.id] : `${PERM_LABEL[p.id]} (the default)`}
                              >
                                {CELL[v].l}
                              </button>
                            </td>
                          );
                        })}
                      </tr>,
                      ...r.members.map((id) => {
                        const a = setupAgent(id);
                        return (
                          <tr key={`${r.id}-${id}`} className="border-t border-black/[0.05]">
                            <td className="px-2 py-1.5 pl-4">
                              <span className="flex items-center gap-1.5 whitespace-nowrap font-semibold text-ink">
                                <Face id={id} size={18} /> {nameOf(id)}
                              </span>
                            </td>
                            {PERMISSIONS.map((p) => {
                              const own = a?.permissions?.[p.id] as Level | undefined;
                              const v = s.configs[id]?.permissions[p.id] ?? p.default;
                              return (
                                <td key={p.id} className="px-0.5 py-1 text-center">
                                  <button
                                    disabled={locked("permissions")}
                                    onClick={() => cycle("agent", id, nameOf(id), p.id, v)}
                                    className={`w-full rounded-[6px] px-1 py-1 font-semibold disabled:cursor-not-allowed ${CELL[v].c} ${own ? "" : "opacity-60"}`}
                                    title={own ? PERM_LABEL[p.id] : `${PERM_LABEL[p.id]} (from the room)`}
                                  >
                                    {CELL[v].l}
                                  </button>
                                </td>
                              );
                            })}
                          </tr>
                        );
                      }),
                    ];
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="mt-2 text-[11.5px] text-muted">
            Free · Ask (you approve each time) · — (never). Faded cells come from the room or the default. The first use of a powerful permission always asks you once. Merging is always yours.
            {locked("permissions") && " Permissions are locked: unlock them below to change them."}
          </div>
          <div className="mt-2 grid grid-cols-1 gap-1">
            {PERMISSIONS.map((p) => (
              <div key={p.id} className="text-[11px] text-faint">
                <b className="font-semibold text-muted">{SHORT[p.id]}</b> · {PERM_COVERS[p.id]}
              </div>
            ))}
          </div>
        </Section>
      </div>

      <div data-anchor="locked">
        <Section title="Locked rules · only you can change these">
          <div className="flex flex-col gap-2">
            {(Object.keys(LOCK_TARGETS) as LockTarget[]).map((t) => {
              const on = !!locked(t);
              return (
                <div key={t} className="flex items-center gap-3 rounded-[14px] bg-white p-3 ring-1 ring-black/[0.06]">
                  <span className={`grid h-8 w-8 place-items-center rounded-[10px] text-[14px] ${on ? "bg-ink text-white" : "bg-[#f2f0ec] text-muted"}`}>{on ? "🔒" : "🔓"}</span>
                  <span className="flex-1">
                    <span className="block text-[13px] font-semibold text-ink">{LOCK_TARGETS[t]}</span>
                    {t === "merge" && <span className="block text-[11.5px] text-muted">Always locked in this version</span>}
                  </span>
                  <Toggle on={on} disabled={t === "merge"} onChange={(v) => void act.change([{ op: v ? "lock" : "unlock", target: t }], `${v ? "Lock" : "Unlock"}: ${LOCK_TARGETS[t].toLowerCase()}`)} />
                </div>
              );
            })}
            <div className="text-[11.5px] text-muted">Locked settings can&apos;t be changed from chat, not even by Ada. Only you unlock them, here.</div>
          </div>
        </Section>
      </div>

      <div data-anchor="approvals">
        <Section title="Approval gates">
          <div className="flex flex-col gap-2">
            {rooms.map((r) => (
              <button key={r.id} onClick={() => ui.openWin({ kind: "room", id: r.id, tab: "rules" })} className="flex items-center justify-between rounded-[14px] bg-white p-3 text-left ring-1 ring-black/[0.06] hover:ring-black/15">
                <span>
                  <span className="block text-[13px] font-semibold text-ink">{r.name}</span>
                  <span className="block text-[12px] text-muted">{r.publishing === "drafts" ? "PRs open as drafts for you" : "PRs open ready for review"} · you approve every merge</span>
                </span>
                <span className="text-[12px] font-semibold text-ink">Edit →</span>
              </button>
            ))}
            {!rooms.length && <Empty>Every merge comes to you. Rooms add their own gates.</Empty>}
          </div>
        </Section>
      </div>

      <div data-anchor="budgets">
        <Section title="Budgets · per day">
          <div className="flex flex-col gap-2">
            <div className="rounded-[14px] bg-white p-3 ring-1 ring-black/[0.06]">
              <div className="flex items-center justify-between text-[13px]">
                <span className="font-semibold text-ink">Whole office</span>
                <span className="text-muted">
                  ${s.spend.today.toFixed(2)} today{s.spend.budget ? ` of $${s.spend.budget}` : ""}
                </span>
              </div>
              <div className="mt-2">
                <Bar value={s.spend.budget ? (s.spend.today / s.spend.budget) * 100 : 0} color={s.spend.budget && s.spend.today / s.spend.budget > 0.8 ? "#d99a2b" : "#0a0a0a"} />
              </div>
              <div className="mt-2.5 flex items-center gap-1.5 text-[12px]">
                <span className="text-muted">Warn at $</span>
                <input value={soft} onChange={(e) => setSoft(e.target.value)} className="w-14 rounded-[8px] bg-[#f6f5f2] px-2 py-1 outline-none ring-1 ring-black/[0.06]" />
                <span className="text-muted">stop at $</span>
                <input value={hard} onChange={(e) => setHard(e.target.value)} className="w-14 rounded-[8px] bg-[#f6f5f2] px-2 py-1 outline-none ring-1 ring-black/[0.06]" />
                <Btn
                  className="ml-auto !py-1 !text-[11.5px]"
                  disabled={locked("budgets")}
                  onClick={() => void act.change([{ op: "set_budget", scope: "office", id: "", dailyUsdSoft: num(soft), dailyUsdHard: num(hard) }], "Change the office's daily budget")}
                >
                  Change…
                </Btn>
              </div>
            </div>
            {rooms.map((c) => (
              <div key={c.id} className="rounded-[14px] bg-white p-3 ring-1 ring-black/[0.06]">
                <div className="flex items-center justify-between text-[13px]">
                  <span className="font-semibold text-ink">{c.name}</span>
                  <span className="text-muted">
                    ${c.spent.toFixed(2)} today{c.budget ? ` of $${c.budget}` : ""} · {c.convBudget} messages a thread
                  </span>
                </div>
                <div className="mt-2">
                  <Bar value={c.budget ? (c.spent / c.budget) * 100 : 0} color={c.budget && c.spent / c.budget > 0.8 ? "#d99a2b" : "#0a0a0a"} />
                </div>
              </div>
            ))}
            <div className="text-[11.5px] text-muted">API-equivalent cost of the agents&apos; model calls. Set a room&apos;s budget in its rules, or tell Ada: “Cap Development at $5 a day”.</div>
          </div>
        </Section>
      </div>

      <div data-anchor="blocked">
        <Section title="When blocked">
          <div className="grid grid-cols-2 gap-2">
            {rooms.map((r) => (
              <button key={r.id} onClick={() => ui.openWin({ kind: "room", id: r.id, tab: "rules" })} className="rounded-[14px] bg-white p-3 text-left ring-1 ring-black/[0.06]">
                <div className="text-[13px] font-semibold text-ink">{r.name}</div>
                <div className="text-[12px] text-muted">{BLOCKED[r.whenBlocked]}</div>
              </button>
            ))}
          </div>
        </Section>
      </div>

      <div data-anchor="norms">
        <Section title="How the office talks">
          <div className="flex flex-col gap-1.5">
            {NORMS.map((n, i) => (
              <div key={n.t} className="flex gap-2.5 rounded-[12px] bg-white p-2.5 ring-1 ring-black/[0.05]">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-ink text-[10.5px] font-bold text-white">{i + 1}</span>
                <div>
                  <div className="text-[12.5px] font-semibold text-ink">{n.t}</div>
                  <div className="text-[11.5px] text-muted">{n.d}</div>
                </div>
              </div>
            ))}
          </div>
        </Section>
      </div>

      <div data-anchor="github">
        <Section title="Integrations">
          <GitHubCard />
        </Section>
      </div>

      <div data-anchor="audit">
        <Section title="Activity log · every action by you, Ada and the agents">
          <div className="flex max-h-[320px] flex-col gap-1 overflow-y-auto rounded-[14px] bg-white p-2 ring-1 ring-black/[0.06]">
            {s.data.audit.slice(0, 120).map((x) => (
              <div key={x.id} className="flex items-start gap-2 rounded-[8px] px-1.5 py-1 text-[11.5px] hover:bg-[#f6f5f2]">
                <Face id={x.actor === "ceo" ? "you" : x.actor === "office" || x.actor === "github" ? "ada" : x.actor} size={16} />
                <span className="min-w-0 flex-1 text-ink-2">
                  <b className="font-semibold text-ink">{x.actor === "ceo" ? "You" : x.actor === "github" ? "GitHub" : nameOf(x.actor)}</b> {x.action.replaceAll("_", " ").replaceAll(".", " ")}
                  {x.target ? <span className="text-muted"> · {x.target}</span> : null}
                </span>
                <span className="shrink-0 text-faint">{new Date(x.created_at).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })}</span>
              </div>
            ))}
            {!s.data.audit.length && <div className="p-2 text-[12px] text-muted">Nothing yet.</div>}
          </div>
        </Section>
      </div>

      <div data-anchor="versions">
        <Section title="Version history">
          <div className="flex flex-col gap-1.5">
            {s.versions.map((v) => (
              <div key={v.v} className="flex items-center gap-2.5 rounded-[12px] bg-white p-2.5 ring-1 ring-black/[0.05]">
                <span className="rounded-[6px] bg-[#f6f5f2] px-1.5 py-0.5 font-mono text-[11px] font-semibold text-ink-2">v{v.v}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-semibold text-ink">{v.summary}</span>
                  <span className="block text-[11px] text-muted">
                    {v.who} · {v.at}
                  </span>
                </span>
                {v.v === s.setupVersion ? (
                  <span className="rounded-full bg-[#eaf6ee] px-2 py-0.5 text-[10.5px] font-bold text-[#24603a]">Current</span>
                ) : (
                  <Btn className="!py-1 !text-[11.5px]" onClick={() => d({ type: "rollback", v: v.v })}>
                    Roll back
                  </Btn>
                )}
              </div>
            ))}
            {!s.versions.length && <Empty>No changes yet.</Empty>}
          </div>
        </Section>
      </div>
    </div>
  );
}
