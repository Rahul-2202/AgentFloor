"use client";

import { useState } from "react";
import { RuntimeBadge } from "@/components/ui";
import { CAST, ROOMS } from "@/office/layout";
import type { RoomId } from "@/office/types";
import { ROLE_TEMPLATES, ROOM_TEMPLATES } from "@/sim/catalog";
import { SLOTS } from "@/sim/real";
import { useSim } from "@/sim/store";
import { Btn, Dot, Empty, Face, Section, Segmented } from "../bits";
import { useUI } from "../ui";
import { nameOf, roleOf } from "../who";

const MODELS = [
  { v: "haiku", l: "Haiku" },
  { v: "sonnet", l: "Sonnet" },
  { v: "opus", l: "Opus" },
] as const;
type Model = (typeof MODELS)[number]["v"];

const input = "w-full rounded-[12px] bg-[#f6f5f2] px-3 py-2 text-[13px] text-ink outline-none ring-1 ring-black/[0.06] focus:ring-black/20";

function AgentRow({ id }: { id: string }) {
  const { s } = useSim();
  const ui = useUI();
  const l = s.live[id];
  return (
    <div className="flex items-center gap-2.5 rounded-[14px] px-2 py-2 hover:bg-[#f6f5f2]">
      <Face id={id} size={32} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
          {nameOf(id)}
          {CAST[id]?.head && <span className="rounded bg-ink px-1 text-[9px] font-bold uppercase text-white">Head</span>}
          <Dot status={l?.paused ? "away" : (l?.status ?? "idle")} />
        </div>
        <div className="truncate text-[11.5px] text-muted">{l?.step ?? roleOf(id)}</div>
      </div>
      {id !== "ada" && <RuntimeBadge runtime={s.configs[id]?.runtime} />}
      <div className="flex gap-1">
        {id !== "ada" && (
          <button onClick={() => ui.openWin({ kind: "config", id })} className="rounded-full px-2 py-1 text-[11.5px] font-semibold text-ink-2 hover:bg-black/5">
            Config
          </button>
        )}
        <button onClick={() => ui.openWin({ kind: "chat", id, mode: "queue" })} className="rounded-full px-2 py-1 text-[11.5px] font-semibold text-ink-2 hover:bg-black/5">
          Message
        </button>
        <button
          onClick={() => {
            ui.closePanel();
            ui.summon(id);
          }}
          className="rounded-full bg-ink px-2.5 py-1 text-[11.5px] font-semibold text-white"
        >
          Call
        </button>
      </div>
    </div>
  );
}

export function TeamPanel({ initial }: { initial?: string }) {
  const { s, act } = useSim();
  const ui = useUI();
  const rooms = Object.values(s.rooms);
  const [mode, setMode] = useState<"org" | "hire" | "room">(initial === "hire" ? "hire" : initial?.startsWith("add-room") ? "room" : "org");

  // Hire
  const [title, setTitle] = useState<string>(ROLE_TEMPLATES[0]);
  const [name, setName] = useState("");
  const [hireRoom, setHireRoom] = useState<string>(rooms[0]?.id ?? "");
  const [model, setModel] = useState<Model>("haiku");

  // Add a room
  const [tpl, setTpl] = useState(0);
  const [roomName, setRoomName] = useState(ROOM_TEMPLATES[0].name);
  const [purpose, setPurpose] = useState(ROOM_TEMPLATES[0].purpose);
  const [headTitle, setHeadTitle] = useState(ROOM_TEMPLATES[0].head);
  const [headName, setHeadName] = useState("");
  const full = rooms.length >= SLOTS.length;
  const nextSlot = SLOTS.find((x) => !s.rooms[x]);

  const pickTpl = (n: number) => {
    const t = ROOM_TEMPLATES[n];
    setTpl(n);
    setRoomName(t.name);
    setPurpose(t.purpose);
    setHeadTitle(t.head);
  };

  return (
    <div className="relative flex flex-col gap-5">
      <Segmented
        value={mode}
        onChange={setMode}
        options={[
          { v: "org", l: "Org chart" },
          { v: "hire", l: "Hire an agent" },
          { v: "room", l: "Add a room" },
        ]}
      />

      {mode === "org" && (
        <>
          <div className="rounded-[18px] bg-[linear-gradient(135deg,#fff4ec,#ffffff)] p-3 ring-1 ring-[#f3cfb6]">
            <div className="flex items-center gap-3">
              <Face id="you" size={36} />
              <div className="flex-1">
                <div className="text-[13.5px] font-semibold text-ink">You · CEO</div>
                <div className="text-[11.5px] text-muted">Decides. Locked rules, merges, new agents, meetings.</div>
              </div>
            </div>
            <div className="mt-2 border-t border-[#f3cfb6] pt-2">
              <AgentRow id="ada" />
            </div>
          </div>
          {!rooms.length && <Empty>No rooms yet. Add one here, or tell Ada what you&apos;re building and she&apos;ll set it up.</Empty>}
          {rooms.map((r) => (
            <Section
              key={r.id}
              title={`${r.name} · ${r.members.length} agent${r.members.length === 1 ? "" : "s"}`}
              right={
                <button onClick={() => ui.openWin({ kind: "room", id: r.id, tab: "spec" })} className="text-[12px] font-semibold text-ink hover:underline">
                  Room settings →
                </button>
              }
            >
              <div className="rounded-[18px] bg-white p-1.5 ring-1 ring-black/[0.06]">
                {r.purpose && <div className="px-2 pb-1 pt-1 text-[12px] text-muted">{r.purpose}</div>}
                <AgentRow id={r.head} />
                <div className="ml-6 border-l-2 border-black/[0.06] pl-1.5">
                  {r.members
                    .filter((m) => m !== r.head)
                    .map((m) => (
                      <AgentRow key={m} id={m} />
                    ))}
                </div>
              </div>
            </Section>
          ))}
        </>
      )}

      {mode === "hire" && (
        <div className="flex flex-col gap-4">
          {!rooms.length ? (
            <Empty>Add a room first: every agent works in one.</Empty>
          ) : (
            <>
              <Section title="Role">
                <div className="grid grid-cols-2 gap-2">
                  {ROLE_TEMPLATES.map((t) => (
                    <button
                      key={t}
                      onClick={() => setTitle(t)}
                      className={`rounded-[14px] p-3 text-left text-[13px] font-semibold ring-1 transition-colors ${title === t ? "bg-ink text-white ring-ink" : "bg-white text-ink ring-black/[0.08] hover:bg-[#f6f5f2]"}`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
                <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Or describe the role" className={`${input} mt-2`} />
              </Section>
              <Section title="Name">
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder={title || "Their name"} className={input} />
              </Section>
              <div className="grid grid-cols-2 gap-3">
                <Section title="Room">
                  <select value={hireRoom} onChange={(e) => setHireRoom(e.target.value)} className={input}>
                    {rooms.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name} ({r.members.length}/6)
                      </option>
                    ))}
                  </select>
                </Section>
                <Section title="Model">
                  <Segmented size="sm" value={model} onChange={setModel} options={MODELS.map((m) => ({ v: m.v, l: m.l }))} />
                </Section>
              </div>
              <div className="text-[12px] text-muted">Runs on Claude Code. Haiku is the cheapest; use Sonnet or Opus for harder work.</div>
              <Btn
                tone="dark"
                className="!py-2.5"
                disabled={!title.trim() || !s.rooms[hireRoom]}
                onClick={() => {
                  const room = s.rooms[hireRoom];
                  if (!room) return;
                  void act.change(
                    [{ op: "hire_agent", room: room.realId, name: name.trim() || title.trim(), title: title.trim(), runtime: "claude-code", model }],
                    `Hire ${name.trim() || `a ${title.trim().toLowerCase()}`} into ${room.name}`,
                  );
                }}
              >
                Review and hire
              </Btn>
              <div className="text-[12px] text-muted">Or just tell Ada: “Add a tester to {rooms[0].name}”.</div>
            </>
          )}
        </div>
      )}

      {mode === "room" && (
        <div className="flex flex-col gap-3">
          {full ? (
            <Empty>The floor is full: an office has five rooms in this version. Remove one to add another.</Empty>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                {ROOM_TEMPLATES.map((t, n) => (
                  <button
                    key={t.name}
                    onClick={() => pickTpl(n)}
                    className={`rounded-[16px] p-3 text-left ring-1 transition-colors ${tpl === n ? "bg-ink text-white ring-ink" : "bg-white ring-black/[0.08] hover:bg-[#f6f5f2]"}`}
                  >
                    <div className="text-[13.5px] font-semibold">{t.name}</div>
                    <div className={`mt-0.5 text-[11.5px] ${tpl === n ? "text-white/65" : "text-muted"}`}>
                      {t.head} · {t.members.join(" · ")}
                    </div>
                  </button>
                ))}
              </div>
              <Section title="Room">
                <input value={roomName} onChange={(e) => setRoomName(e.target.value)} placeholder="Room name" className={input} />
                <input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="What it's for" className={`${input} mt-2`} />
              </Section>
              <Section title="Its head">
                <div className="grid grid-cols-2 gap-2">
                  <input value={headTitle} onChange={(e) => setHeadTitle(e.target.value)} placeholder="Job" className={input} />
                  <input value={headName} onChange={(e) => setHeadName(e.target.value)} placeholder={headTitle || "Name"} className={input} />
                </div>
              </Section>
              <Btn
                tone="dark"
                className="!py-2.5"
                disabled={!roomName.trim() || !headTitle.trim()}
                onClick={() => {
                  const head = headName.trim() || headTitle.trim();
                  void act.change(
                    [{ op: "add_room", name: roomName.trim(), purpose: purpose.trim() || undefined, head: { name: head, title: headTitle.trim(), runtime: "claude-code", model: "haiku" } }],
                    `Add ${roomName.trim()}, headed by ${head}${nextSlot ? ` (it goes where ${ROOMS[nextSlot as RoomId].name} is drawn)` : ""}`,
                  );
                }}
              >
                Review and set up
              </Btn>
              <div className="text-[12px] text-muted">Add the rest of the team from Hire, or tell Ada and she&apos;ll staff it.</div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
