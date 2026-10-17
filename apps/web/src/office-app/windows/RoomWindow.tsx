"use client";

import { useState } from "react";
import { RuntimeBadge } from "@/components/ui";
import { NORMS } from "@/sim/catalog";
import { useSim } from "@/sim/store";
import type { RoomKey, TaskState, WhenBlocked } from "@/sim/types";
import { Bar, Btn, Dot, Empty, Face, Section, Segmented, Window } from "../bits";
import { useUI } from "../ui";
import { nameOf, roleOf } from "../who";
import { MemCard } from "./MemoryWindow";
import { Linked } from "../real/Linked";

type Tab = "spec" | "rules" | "board" | "channel" | "memory" | "members";
const WHEN: Record<WhenBlocked, string> = { park: "park_and_switch", guess: "best_guess_and_flag", wait: "stop_and_wait" };

const COLS: { k: string; l: string; states: TaskState[] }[] = [
  { k: "q", l: "Queued", states: ["queued"] },
  { k: "o", l: "Ongoing", states: ["ongoing"] },
  { k: "w", l: "Needs you", states: ["question", "blocked", "review"] },
  { k: "d", l: "Done", states: ["done"] },
];

const field = "h-10 w-full rounded-[12px] bg-[#f6f5f2] px-3 text-[13px] outline-none ring-1 ring-black/[0.05] focus:ring-black/20";

export function RoomWindow({ id, tab: initial }: { id: RoomKey; tab?: string }) {
  const { s, act } = useSim();
  const ui = useUI();
  const [tab, setTab] = useState<Tab>((initial as Tab) ?? "spec");
  const base = s.rooms[id];
  const sr = s.setup?.rooms.find((x) => x.id === base?.realId);
  const budget0 = s.setup?.budgets.find((b) => b.scope === "room" && b.id === base?.realId);
  const [name, setName] = useState(base?.name ?? "");
  const [purpose, setPurpose] = useState(base?.purpose ?? "");
  const [resp, setResp] = useState<string[]>(base?.responsibilities ?? []);
  const [dod, setDod] = useState(base?.dod ?? "");
  const [when, setWhen] = useState<WhenBlocked>(base?.whenBlocked ?? "park");
  const [publish, setPublish] = useState<"drafts" | "direct">(base?.publishing ?? "drafts");
  const [soft, setSoft] = useState(budget0?.dailyUsdSoft == null ? "" : String(budget0.dailyUsdSoft));
  const [hard, setHard] = useState(budget0?.dailyUsdHard == null ? "" : String(budget0.dailyUsdHard));
  const [msg, setMsg] = useState("");
  if (!base || !sr) return null;

  const locked = (t: string) => !!s.locked.find((l) => l.id === t)?.locked;
  const num = (v: string) => (v.trim() === "" ? null : Number(v));

  // The edits, as the policy engine's operations.
  const ops: object[] = [];
  const patch: Record<string, string> = {};
  if (name.trim() && name.trim() !== base.name) patch.name = name.trim();
  if (purpose.trim() !== (base.purpose ?? "")) patch.purpose = purpose.trim();
  const respText = resp.map((x) => x.trim()).filter(Boolean).join("\n");
  if (respText !== (sr.responsibilities ?? "").split(/\n|; /).filter(Boolean).join("\n")) patch.responsibilities = respText;
  if (dod.trim() !== (base.dod ?? "")) patch.dod = dod.trim();
  if (Object.keys(patch).length) ops.push({ op: "update_room", id: base.realId, ...patch });
  if (when !== base.whenBlocked) ops.push({ op: "set_when_blocked", room: base.realId, policy: WHEN[when] });
  if (publish !== base.publishing) ops.push({ op: "set_publish", room: base.realId, mode: publish });
  if (num(soft) !== (budget0?.dailyUsdSoft ?? null) || num(hard) !== (budget0?.dailyUsdHard ?? null)) ops.push({ op: "set_budget", scope: "room", id: base.realId, dailyUsdSoft: num(soft), dailyUsdHard: num(hard) });

  const reset = () => {
    setName(base.name);
    setPurpose(base.purpose ?? "");
    setResp(base.responsibilities);
    setDod(base.dod ?? "");
    setWhen(base.whenBlocked);
    setPublish(base.publishing);
    setSoft(budget0?.dailyUsdSoft == null ? "" : String(budget0.dailyUsdSoft));
    setHard(budget0?.dailyUsdHard == null ? "" : String(budget0.dailyUsdHard));
  };

  const tasks = s.tasks.filter((t) => t.room === id);
  const threads = s.conversations.filter((c) => c.room === id && c.kind !== "meeting");
  const channel = threads.flatMap((c) => c.messages.map((m) => ({ ...m, topic: c.title }))).slice(-60);
  const post = () => {
    const text = msg.trim();
    if (!text) return;
    setMsg("");
    void act.message(base.head, text, "normal");
  };

  return (
    <Window
      width={720}
      onClose={ui.closeWin}
      icon={<Face id={base.head} size={32} />}
      title={`${base.name} room`}
      sub={`Head: ${nameOf(base.head)} · ${base.members.length} agent${base.members.length === 1 ? "" : "s"}${base.purpose ? ` · ${base.purpose}` : ""}`}
      footer={
        tab === "spec" || tab === "rules" ? (
          <div className="flex items-center justify-between gap-2 border-t border-black/[0.06] px-4 py-3">
            <span className="text-[12px] text-muted">
              {ops.length ? `${ops.length} unsaved change${ops.length > 1 ? "s" : ""}` : "Edit anything here, no need to ask Ada. Every change is versioned."}
            </span>
            <div className="flex gap-2">
              <Btn onClick={reset} disabled={!ops.length}>
                Reset
              </Btn>
              <Btn tone="dark" onClick={() => void act.change(ops, `Change ${base.name}`)} disabled={!ops.length}>
                Review changes
              </Btn>
            </div>
          </div>
        ) : tab === "channel" ? (
          <form
            className="flex gap-2 border-t border-black/[0.06] p-3"
            onSubmit={(e) => {
              e.preventDefault();
              post();
            }}
          >
            <input value={msg} onChange={(e) => setMsg(e.target.value)} placeholder={`Message ${nameOf(base.head)}, who runs ${base.name}`} className="h-10 flex-1 rounded-full bg-[#f6f5f2] px-4 text-[13px] outline-none ring-1 ring-black/[0.06]" />
            <Btn tone="dark">Send</Btn>
          </form>
        ) : undefined
      }
    >
      <div className="flex gap-1 overflow-x-auto border-b border-black/[0.05] bg-[#fbfaf8] px-3 py-2">
        {(["spec", "rules", "board", "channel", "memory", "members"] as Tab[]).map((k) => (
          <button key={k} onClick={() => setTab(k)} className={`rounded-full px-3 py-1.5 text-[12.5px] font-semibold capitalize ${tab === k ? "bg-ink text-white" : "text-ink-2 hover:bg-black/5"}`}>
            {k}
          </button>
        ))}
      </div>
      <div className="relative">
        <div className="max-h-[min(540px,60vh)] overflow-y-auto p-4">
          {tab === "spec" && (
            <div className="flex flex-col gap-5">
              <Section title="Name and purpose">
                <input value={name} onChange={(e) => setName(e.target.value)} className={field} />
                <input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="What the room is for" className={`${field} mt-2`} />
              </Section>
              <Section title="Responsibilities">
                <div className="flex flex-col gap-1.5">
                  {resp.map((x, i) => (
                    <input key={i} value={x} onChange={(e) => setResp(resp.map((y, j) => (j === i ? e.target.value : y)))} className={field} />
                  ))}
                  <button onClick={() => setResp([...resp, ""])} className="self-start text-[12.5px] font-semibold text-ink hover:underline">
                    + Add responsibility
                  </button>
                </div>
              </Section>
              <Section title="Definition of done">
                <input value={dod} onChange={(e) => setDod(e.target.value)} placeholder="e.g. a PR with tests passing, reviewed by the head" className={field} />
              </Section>
              <Section title="Outputs">
                <div className="flex flex-wrap gap-1.5">
                  {["Pull requests", "Branches on the office repo"].map((o) => (
                    <span key={o} className="rounded-full bg-[#f2f0ec] px-2.5 py-1 text-[12.5px] font-semibold text-ink-2">
                      {o}
                    </span>
                  ))}
                </div>
              </Section>
              <div className="flex justify-end">
                <Btn tone="ghost" className="!py-1 !text-[12px] !text-bad" onClick={() => void act.change([{ op: "remove_room", id: base.realId }], `Close ${base.name}`)}>
                  Close this room…
                </Btn>
              </div>
            </div>
          )}

          {tab === "rules" && (
            <div className="flex flex-col gap-4">
              <div className="rounded-[16px] bg-[#f6f5f2] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">When blocked {locked("when_blocked") && <span className="rounded-full bg-ink px-1.5 text-[10px] font-bold text-white">🔒 locked</span>}</div>
                    <div className="text-[11.5px] text-muted">For gaps the spec didn&apos;t cover</div>
                  </div>
                  <Segmented
                    size="sm"
                    value={when}
                    onChange={(v) => !locked("when_blocked") && setWhen(v)}
                    options={[
                      { v: "park", l: "Park" },
                      { v: "guess", l: "Best guess" },
                      { v: "wait", l: "Wait" },
                    ]}
                  />
                </div>
                <div className="mt-3 flex items-center justify-between gap-3 border-t border-black/[0.06] pt-3">
                  <div>
                    <div className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">Pull requests {locked("publish") && <span className="rounded-full bg-ink px-1.5 text-[10px] font-bold text-white">🔒 locked</span>}</div>
                    <div className="text-[11.5px] text-muted">Open as drafts for you, or ready for review</div>
                  </div>
                  <Segmented
                    size="sm"
                    value={publish}
                    onChange={(v) => !locked("publish") && setPublish(v)}
                    options={[
                      { v: "drafts", l: "Drafts to you" },
                      { v: "direct", l: "Ready" },
                    ]}
                  />
                </div>
                <div className="mt-3 flex items-center justify-between gap-3 border-t border-black/[0.06] pt-3">
                  <div>
                    <div className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
                      Merging <span className="rounded-full bg-ink px-1.5 text-[10px] font-bold text-white">🔒 locked</span>
                    </div>
                    <div className="text-[11.5px] text-muted">Every merge needs your approval</div>
                  </div>
                  <span className="rounded-full bg-white px-3 py-1 text-[12px] font-semibold text-ink-2">You approve</span>
                </div>
                <div className="mt-3 flex items-center justify-between gap-3 border-t border-black/[0.06] pt-3">
                  <div>
                    <div className="text-[13px] font-semibold text-ink">Permissions</div>
                    <div className="text-[11.5px] text-muted">Push, PRs, the web, outside its folder, tickets</div>
                  </div>
                  <Btn className="!py-1 !text-[12px]" onClick={() => (ui.closeWin(), ui.openPanel("governance", "permissions"))}>
                    Open the grid →
                  </Btn>
                </div>
              </div>
              <div className="rounded-[16px] bg-[#f6f5f2] p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">Daily budget {locked("budgets") && <span className="rounded-full bg-ink px-1.5 text-[10px] font-bold text-white">🔒 locked</span>}</div>
                  <span className="text-[12px] text-muted">${base.spent.toFixed(2)} spent today</span>
                </div>
                <div className="mt-2">
                  <Bar value={num(hard) ? (base.spent / num(hard)!) * 100 : 0} color={num(hard) && base.spent / num(hard)! > 0.8 ? "#d99a2b" : "#3f9b5f"} />
                </div>
                <div className="mt-2.5 flex items-center gap-1.5 text-[12.5px]">
                  <span className="text-muted">Warn at $</span>
                  <input disabled={locked("budgets")} value={soft} onChange={(e) => setSoft(e.target.value)} placeholder="none" className="w-16 rounded-[8px] bg-white px-2 py-1 outline-none ring-1 ring-black/[0.06]" />
                  <span className="text-muted">stop at $</span>
                  <input disabled={locked("budgets")} value={hard} onChange={(e) => setHard(e.target.value)} placeholder="none" className="w-16 rounded-[8px] bg-white px-2 py-1 outline-none ring-1 ring-black/[0.06]" />
                </div>
                <div className="mt-3 border-t border-black/[0.06] pt-3 text-[11.5px] text-muted">A thread stops and comes to you after {base.convBudget} messages (office-wide).</div>
              </div>
              <Section title="How the office talks">
                <div className="flex flex-col gap-2">
                  {NORMS.map((n, i) => (
                    <div key={n.t} className="flex gap-2.5 rounded-[12px] bg-white p-3 ring-1 ring-black/[0.06]">
                      <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-ink text-[10.5px] font-bold text-white">{i + 1}</span>
                      <div>
                        <div className="text-[13px] font-semibold text-ink">{n.t}</div>
                        <div className="text-[12px] text-muted">{n.d}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </Section>
            </div>
          )}

          {tab === "board" && (
            <div className="grid grid-cols-4 gap-2.5">
              {COLS.map((c) => {
                const items = tasks.filter((t) => c.states.includes(t.state));
                return (
                  <div key={c.k} className="rounded-[14px] bg-[#f6f5f2] p-2">
                    <div className="mb-2 flex items-center justify-between px-1 text-[11.5px] font-bold uppercase tracking-wide text-faint">
                      {c.l} <span>{items.length}</span>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      {items.map((t) => (
                        <button key={t.id} onClick={() => ui.openWin({ kind: "task", id: t.id })} className="rounded-[10px] bg-white p-2 text-left ring-1 ring-black/[0.05] hover:ring-black/15">
                          <div className="text-[12px] font-semibold leading-snug text-ink">{t.title}</div>
                          <div className="mt-1.5 flex items-center justify-between">
                            <Face id={t.owner} size={18} />
                            {t.state !== "done" && <span className="text-[10.5px] text-muted">{t.progress}%</span>}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {tab === "channel" && (
            <div className="flex flex-col gap-3">
              {!channel.length && <Empty>Nothing yet. The room&apos;s conversations show here.</Empty>}
              {channel.map((m, i) => (
                <div key={i} className="flex gap-2.5">
                  <Face id={m.who} size={28} />
                  <div>
                    <div className="text-[12px]">
                      <span className="font-semibold text-ink">{nameOf(m.who)}</span> <span className="text-faint">{m.t}</span>
                    </div>
                    <div className="whitespace-pre-wrap text-[13px] text-ink-2"><Linked text={m.text} who={m.who} /></div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === "memory" && (
            <div className="flex flex-col gap-2">
              {!s.memory.some((m) => m.layer === `room:${id}`) && <Empty>Nothing yet. The head keeps the room&apos;s agreements and decisions here.</Empty>}
              {s.memory
                .filter((m) => m.layer === `room:${id}`)
                .map((m) => (
                  <MemCard key={m.id} m={m} />
                ))}
            </div>
          )}

          {tab === "members" && (
            <div className="flex flex-col gap-2">
              {[base.head, ...base.members.filter((m) => m !== base.head)].map((m) => (
                <div key={m} className="flex items-center gap-3 rounded-[14px] bg-white p-3 ring-1 ring-black/[0.06]">
                  <Face id={m} size={36} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-[13.5px] font-semibold text-ink">
                      {nameOf(m)} <Dot status={s.live[m]?.status ?? "idle"} />
                    </div>
                    <div className="truncate text-[12px] text-muted">
                      {roleOf(m)}
                      {s.live[m]?.step ? ` · ${s.live[m]?.step}` : ""}
                    </div>
                  </div>
                  <RuntimeBadge runtime={s.configs[m]?.runtime} />
                  <Btn onClick={() => ui.openWin({ kind: "config", id: m })}>Config</Btn>
                  <Btn
                    tone="dark"
                    onClick={() => {
                      ui.closeWin();
                      ui.summon(m);
                    }}
                  >
                    Call
                  </Btn>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Window>
  );
}
