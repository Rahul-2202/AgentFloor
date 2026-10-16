"use client";

import { useState } from "react";
import { CAST } from "@/office/layout";
import { useSim } from "@/sim/store";
import type { RoomKey } from "@/sim/types";
import { Btn, Empty, Face, Segmented, Window } from "../bits";
import { useUI } from "../ui";
import { nameOf } from "../who";

const EXAMPLES = ["Add a health-check endpoint and a test for it", "Write a README section on running the project locally", "Fix the failing CI job", "Add input validation to the signup form"];

export function AssignWindow({ agent }: { agent?: string }) {
  const { s, act } = useSim();
  const ui = useUI();
  const rooms = Object.values(s.rooms);
  const presetRoom = agent ? (CAST[agent]?.room as RoomKey | undefined) : undefined;
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [roomPick, setRoomPick] = useState<RoomKey | undefined>(presetRoom);
  const room: RoomKey = roomPick ?? rooms[0]?.id ?? "";
  const cfg = s.rooms[room];
  const [owner, setOwner] = useState<string | undefined>(agent);
  const who = cfg && owner && cfg.members.includes(owner) ? owner : cfg?.head;
  const [dod, setDod] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!title.trim() || !who || busy) return;
    setBusy(true);
    const ok = await act.assign(who, title.trim(), details.trim(), dod.trim());
    setBusy(false);
    if (!ok) return;
    act.toast(who === cfg?.head ? `${nameOf(who)} has it and will plan it into the room's work.` : `${nameOf(who)} has it. ${nameOf(cfg!.head)} is copied.`, who);
    ui.closeWin();
  };

  return (
    <Window
      width={580}
      onClose={ui.closeWin}
      title="Assign a task"
      sub={agent ? `To ${nameOf(agent)}${cfg && agent !== cfg.head ? ` · ${nameOf(cfg.head)} is copied` : ""}` : "Work goes through the room's head"}
      footer={
        cfg && (
          <div className="flex items-center justify-between gap-3 border-t border-black/[0.06] px-4 py-3">
            <span className="flex items-center gap-2 text-[12px] text-muted">
              <Face id={who!} size={22} /> {who === cfg.head ? `${nameOf(who!)} will plan it into the room's work` : `${nameOf(who!)} gets it, ${nameOf(cfg.head)} is copied`}
            </span>
            <Btn tone="dark" onClick={() => void submit()} disabled={!title.trim() || busy}>
              {busy ? "Assigning…" : "Assign"}
            </Btn>
          </div>
        )
      }
    >
      {!cfg ? (
        <div className="p-4">
          <Empty>Set up a room first: tell Ada what you&apos;re building, or add one in Agents &amp; teams.</Empty>
        </div>
      ) : (
        <div className="flex flex-col gap-4 p-4">
          <div>
            <textarea
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
              }}
              placeholder="What needs doing?"
              className="h-20 w-full resize-none rounded-[16px] bg-[#f6f5f2] p-3.5 text-[15px] outline-none ring-1 ring-black/[0.06] focus:ring-black/20"
            />
            {!title && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {EXAMPLES.map((e) => (
                  <button key={e} onClick={() => setTitle(e)} className="rounded-full bg-white px-2.5 py-1 text-[12px] text-ink-2 ring-1 ring-black/[0.08] hover:bg-[#f6f5f2]">
                    {e}
                  </button>
                ))}
              </div>
            )}
          </div>
          <textarea
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            placeholder="Details, links, constraints (optional)"
            className="h-16 w-full resize-none rounded-[12px] bg-[#f6f5f2] p-3 text-[13px] outline-none ring-1 ring-black/[0.06] focus:ring-black/20"
          />
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="mb-1.5 text-[12px] font-semibold text-muted">Room</div>
              {rooms.length <= 3 ? (
                <Segmented
                  value={room}
                  onChange={(v) => {
                    setRoomPick(v);
                    setOwner(undefined);
                  }}
                  options={rooms.map((r) => ({ v: r.id, l: r.name }))}
                />
              ) : (
                <select
                  value={room}
                  onChange={(e) => {
                    setRoomPick(e.target.value);
                    setOwner(undefined);
                  }}
                  className="h-9 rounded-full bg-[#f2f0ec] px-3 text-[12.5px] font-semibold outline-none"
                >
                  {rooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div>
              <div className="mb-1.5 text-[12px] font-semibold text-muted">Owner</div>
              <div className="flex flex-wrap gap-1">
                {[cfg.head, ...cfg.members.filter((m) => m !== cfg.head)].map((m) => (
                  <button key={m} onClick={() => setOwner(m)} title={nameOf(m)} className={`rounded-[10px] p-0.5 ring-2 transition-all ${who === m ? "ring-ink" : "ring-transparent opacity-60 hover:opacity-100"}`}>
                    <Face id={m} size={28} />
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-[12px] font-semibold text-muted">Definition of done</div>
            <input value={dod} onChange={(e) => setDod(e.target.value)} placeholder={cfg.dod || "e.g. a PR with tests passing"} className="h-10 w-full rounded-[12px] bg-[#f6f5f2] px-3 text-[13px] outline-none ring-1 ring-black/[0.06]" />
          </div>
          {s.machine !== "started" && <div className="rounded-[12px] bg-[#fdf3e0] px-3 py-2 text-[12px] text-[#8a5a10]">The office computer is asleep: start it from the top bar so the task reaches {nameOf(who!)}.</div>}
        </div>
      )}
    </Window>
  );
}
