"use client";

import { PERMISSIONS, type Level } from "@agentfloor/shared/governance";
import { useState } from "react";
import { PERM_LABEL } from "@/sim/catalog";
import { useSim } from "@/sim/store";
import type { PermKey } from "@/sim/types";
import { Btn, Face, Segmented, Window } from "../bits";
import { useUI } from "../ui";
import { nameOf, roleOf } from "../who";

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-black/[0.05] py-3 last:border-0">
      <div className="min-w-0">
        <div className="text-[13px] font-semibold text-ink">{label}</div>
        {hint && <div className="text-[11.5px] text-muted">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

const field = "rounded-[12px] bg-[#f6f5f2] px-2.5 py-1.5 text-[12.5px] outline-none ring-1 ring-black/[0.06] focus:ring-black/20";

export function ConfigWindow({ id }: { id: string }) {
  const { s, act } = useSim();
  const ui = useUI();
  const a = s.setup?.agents.find((x) => x.id === id);
  const room = s.setup?.rooms.find((r) => r.id === a?.room);
  const isHead = room?.head === id;
  const budget0 = s.setup?.budgets.find((b) => b.scope === "agent" && b.id === id)?.dailyUsdHard ?? null;
  const roomLevel = (p: PermKey): Level => (room?.permissions?.[p] as Level | undefined) ?? PERMISSIONS.find((x) => x.id === p)!.default;

  const [name, setName] = useState(a?.name ?? "");
  const [title, setTitle] = useState(a?.title ?? "");
  const [roomId, setRoomId] = useState(a?.room ?? "");
  const [model, setModel] = useState(a?.model ?? "haiku");
  const [effort, setEffort] = useState(a?.effort ?? "low");
  const [perms, setPerms] = useState<Partial<Record<PermKey, Level>>>({ ...(a?.permissions ?? {}) } as Partial<Record<PermKey, Level>>);
  const [budget, setBudget] = useState(budget0 == null ? "" : String(budget0));
  if (!a) return null;

  const permLocked = !!s.locked.find((l) => l.id === "permissions")?.locked;
  const budgetLocked = !!s.locked.find((l) => l.id === "budgets")?.locked;

  // The change, as the policy engine's operations; the read-back is worked out from them.
  const ops: object[] = [];
  const agentPatch: Record<string, string> = {};
  if (name.trim() && name.trim() !== a.name) agentPatch.name = name.trim();
  if (title.trim() !== (a.title ?? "")) agentPatch.title = title.trim();
  if (roomId !== a.room) agentPatch.room = roomId;
  if (model !== (a.model ?? "haiku")) agentPatch.model = model;
  if (effort !== (a.effort ?? "low")) agentPatch.effort = effort;
  if (Object.keys(agentPatch).length) ops.push({ op: "update_agent", id, ...agentPatch });
  for (const p of PERMISSIONS) {
    const before = (a.permissions?.[p.id] as Level | undefined) ?? null;
    const after = perms[p.id] ?? null;
    if (before !== after) ops.push({ op: "set_permission", scope: "agent", id, permission: p.id, level: after });
  }
  const nb = budget.trim() === "" ? null : Number(budget);
  if (nb !== budget0 && (nb === null || Number.isFinite(nb))) ops.push({ op: "set_budget", scope: "agent", id, dailyUsdHard: nb });

  const reset = () => {
    setName(a.name);
    setTitle(a.title ?? "");
    setRoomId(a.room);
    setModel(a.model ?? "haiku");
    setEffort(a.effort ?? "low");
    setPerms({ ...(a.permissions ?? {}) } as Partial<Record<PermKey, Level>>);
    setBudget(budget0 == null ? "" : String(budget0));
  };

  return (
    <Window
      width={620}
      onClose={ui.closeWin}
      icon={<Face id={id} size={32} />}
      title={`${nameOf(id)} · configuration`}
      sub={`${roleOf(id)} · changes are read back, then saved as a new version`}
      footer={
        <div className="flex items-center justify-between gap-3 border-t border-black/[0.06] px-4 py-3">
          <span className="text-[12px] text-muted">{ops.length ? `${ops.length} change${ops.length > 1 ? "s" : ""}` : "No changes yet"}</span>
          <div className="flex gap-2">
            <Btn onClick={reset} disabled={!ops.length}>
              Reset
            </Btn>
            <Btn tone="dark" disabled={!ops.length} onClick={() => void act.change(ops, `Change ${a.name}'s setup`)}>
              Review changes
            </Btn>
          </div>
        </div>
      }
    >
      <div className="max-h-[min(540px,62vh)] overflow-y-auto px-4 pb-2">
        <Row label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} className={`${field} w-[300px]`} />
        </Row>
        <Row label="Role card" hint="What the agent reads first, every turn">
          <textarea value={title} onChange={(e) => setTitle(e.target.value)} className={`${field} h-20 w-[300px]`} />
        </Row>
        <Row label="Room" hint={isHead ? "Heads stay with their room: make someone else head to move them" : undefined}>
          <select disabled={isHead} value={roomId} onChange={(e) => setRoomId(e.target.value)} className={`${field} w-[200px] disabled:opacity-60`}>
            {s.setup?.rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Runtime" hint="The engine behind this agent">
          <span className="rounded-full bg-[#f2f0ec] px-3 py-1.5 text-[12.5px] font-semibold">Claude Code</span>
        </Row>
        <Row label="Model" hint="Haiku is cheapest; Sonnet and Opus think harder">
          <Segmented
            size="sm"
            value={model}
            onChange={setModel}
            options={[
              { v: "haiku", l: "Haiku" },
              { v: "sonnet", l: "Sonnet" },
              { v: "opus", l: "Opus" },
            ]}
          />
        </Row>
        <Row label="Effort" hint="How long it thinks before acting">
          <Segmented
            size="sm"
            value={effort}
            onChange={setEffort}
            options={[
              { v: "low", l: "Low" },
              { v: "medium", l: "Medium" },
              { v: "high", l: "High" },
            ]}
          />
        </Row>
        <div className="border-b border-black/[0.05] py-3">
          <div className="text-[13px] font-semibold text-ink">Permissions</div>
          <div className="text-[11.5px] text-muted">
            {permLocked ? "Locked by you: unlock permissions in Rules & settings to change them." : "Unset follows the room. The first use of a powerful permission always asks you once."}
          </div>
          <div className="mt-1">
            {PERMISSIONS.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 py-1.5">
                <span className="min-w-0 text-[12.5px] text-ink-2" title={p.covers}>
                  {PERM_LABEL[p.id]}
                </span>
                <Segmented
                  size="sm"
                  value={perms[p.id] ?? "room"}
                  onChange={(v) => !permLocked && setPerms({ ...perms, [p.id]: v === "room" ? undefined : (v as Level) })}
                  options={[
                    { v: "room", l: `Room (${roomLevel(p.id)})` },
                    { v: "free", l: "Free" },
                    { v: "ask", l: "Ask" },
                    { v: "never", l: "Never" },
                  ]}
                />
              </div>
            ))}
          </div>
        </div>
        <Row label="Daily budget" hint={`$${(s.configs[id]?.spent ?? 0).toFixed(2)} spent today · empty means only the room and office limits apply`}>
          <div className="flex items-center gap-1.5 text-[13px]">
            $
            <input disabled={budgetLocked} value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="none" className={`${field} w-20 disabled:opacity-60`} />
          </div>
        </Row>
        <div className="flex flex-wrap gap-2 py-3">
          {!isHead && room && (
            <Btn className="!py-1 !text-[12px]" onClick={() => void act.change([{ op: "update_room", id: room.id, head: id }], `Make ${a.name} head of ${room.name}`)}>
              Make head of {room.name}
            </Btn>
          )}
          {!isHead && (
            <Btn tone="ghost" className="!py-1 !text-[12px] !text-bad" onClick={() => void act.change([{ op: "remove_agent", id }], `Let ${a.name} go`)}>
              Let {a.name} go
            </Btn>
          )}
        </div>
      </div>
    </Window>
  );
}
