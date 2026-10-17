"use client";

import { useEffect, useState } from "react";
import { downloadMemory, writeMemory } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { useSim } from "@/sim/store";
import type { MemItem } from "@/sim/types";
import { Btn, Empty, Section, Segmented } from "../bits";
import { MemCard } from "../windows/MemoryWindow";

type Tab = "company" | "ceo" | "decisions" | "rooms" | "agents";

export function MemoryPanel({ initial }: { initial?: string }) {
  const { s, act } = useSim();
  const target = s.memory.find((m) => m.id === initial);
  const [tab, setTab] = useState<Tab>(target ? (target.layer.startsWith("agent") ? "agents" : target.layer.startsWith("room") ? "rooms" : target.layer === "ceo" ? "ceo" : "company") : ((initial as Tab) ?? "company"));
  const [q, setQ] = useState("");
  const match = (m: MemItem) => !q || (m.title + m.body + m.source).toLowerCase().includes(q.toLowerCase());
  const pick: Record<Tab, (m: MemItem) => boolean> = {
    company: (m) => m.layer === "company",
    ceo: (m) => m.layer === "ceo",
    decisions: (m) => m.type === "decision",
    rooms: (m) => m.layer.startsWith("room:") || m.layer.startsWith("conversation:"),
    agents: (m) => m.layer.startsWith("agent:"),
  };
  const list = s.memory.filter((m) => pick[tab](m) && match(m));
  const counts = { active: s.memory.filter((m) => m.status === "active" && !m.pending).length, proposed: s.memory.filter((m) => m.pending).length, stale: s.memory.filter((m) => m.status === "stale").length };
  const [measures, setMeasures] = useState<Record<string, number>>({});
  useEffect(() => {
    void supabase
      .from("memory_measures")
      .select("metric, value")
      .eq("office_id", s.officeId)
      .gte("day", new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10))
      .then(({ data }) => {
        const sum: Record<string, number> = {};
        for (const r of (data ?? []) as { metric: string; value: number }[]) sum[r.metric] = (sum[r.metric] ?? 0) + Number(r.value);
        setMeasures(sum);
      });
  }, [s.officeId, s.data.memory]);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-2">
        {Object.entries(counts).map(([k, v]) => (
          <div key={k} className="rounded-[14px] bg-white px-3 py-2 ring-1 ring-black/[0.05]">
            <div className="text-[11px] font-semibold capitalize text-muted">{k}</div>
            <div className="text-[20px] font-semibold text-ink">{v}</div>
          </div>
        ))}
      </div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search everything the company remembers…" className="h-10 rounded-full bg-white px-4 text-[13px] outline-none ring-1 ring-black/[0.08] focus:ring-black/20" />
      <div className="overflow-x-auto">
        <Segmented
          size="sm"
          value={tab}
          onChange={setTab}
          options={[
            { v: "company", l: "Company" },
            { v: "ceo", l: "Your preferences" },
            { v: "decisions", l: "Decision log" },
            { v: "rooms", l: "Rooms & meetings" },
            { v: "agents", l: "Agents" },
          ]}
        />
      </div>
      <div className="text-[12px] text-muted">
        {tab === "ceo"
          ? "What Ada has learned about how you decide. Heads see only what's relevant to their room."
          : tab === "decisions"
            ? "Every decision links to the meeting or message it came from. Old ones are superseded, never deleted."
            : "Memory distills up from conversations and is derived down to rooms and agents. You can edit anything."}
      </div>
      <div className="flex items-center justify-between gap-2">
        <NewItem />
        <button
          onClick={() => downloadMemory().catch((e) => act.toast((e as Error).message))}
          className="shrink-0 self-start text-[12.5px] font-semibold text-muted hover:text-ink"
          title="Everything the office remembers, as a JSON file"
        >
          Export ↓
        </button>
      </div>
      {list.length ? (
        <div className="flex flex-col gap-2">
          {list.map((m) => (
            <div key={m.id} className={m.id === initial ? "rounded-[16px] ring-2 ring-accent" : ""}>
              <MemCard m={m} />
            </div>
          ))}
        </div>
      ) : (
        <Empty>{q ? "Nothing matches." : "Nothing here yet. Memory fills up as the office works: decisions from meetings, lessons from your corrections."}</Empty>
      )}
      <Section title="How well memory is working · last 7 days">
        <div className="grid grid-cols-2 gap-2 text-[12px]">
          {[
            ["Corrections repeated", measures.repeated_corrections ?? 0],
            ["Stale items read", measures.stale_reads ?? 0],
            ["Asked what memory knew", measures.asked_known ?? 0],
            ["Memory tokens", `${Math.round((measures.memory_tokens ?? 0) / 1000)}k`],
          ].map(([l, v]) => (
            <div key={l} className="rounded-[12px] bg-white px-3 py-2 ring-1 ring-black/[0.05]">
              <div className="text-muted">{l}</div>
              <div className="text-[16px] font-semibold text-ink">{v}</div>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

function NewItem() {
  const { s, act } = useSim();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ layer: "company", scopeId: "", type: "fact", title: "", body: "" });
  const field = "rounded-[10px] bg-[#f6f5f2] px-2.5 py-1.5 text-[12.5px] outline-none ring-1 ring-black/[0.06]";
  if (!open)
    return (
      <button onClick={() => setOpen(true)} className="self-start text-[12.5px] font-semibold text-ink hover:underline">
        + Add something the office should know
      </button>
    );
  return (
    <div className="rounded-[14px] bg-white p-3 ring-1 ring-black/[0.08]">
      <div className="flex flex-wrap gap-1.5">
        <select value={f.layer} onChange={(e) => setF({ ...f, layer: e.target.value })} className={field}>
          <option value="company">Company</option>
          <option value="ceo">Your preference</option>
          <option value="room">A room</option>
        </select>
        {f.layer === "room" && (
          <select value={f.scopeId} onChange={(e) => setF({ ...f, scopeId: e.target.value })} className={field}>
            <option value="">Room…</option>
            {Object.values(s.rooms).map((r) => (
              <option key={r.id} value={r.realId}>
                {r.name}
              </option>
            ))}
          </select>
        )}
        <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} className={field}>
          {["fact", "decision", "preference", "lesson", "how_to_work"].map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </div>
      <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Title" className={`${field} mt-2 w-full`} />
      <textarea value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} placeholder="What should the office know?" rows={3} className={`${field} mt-2 w-full`} />
      <div className="mt-2 flex gap-1.5">
        <Btn
          tone="dark"
          disabled={!f.title.trim() || !f.body.trim() || (f.layer === "room" && !f.scopeId)}
          onClick={() =>
            writeMemory({ ...f, scopeId: f.scopeId || undefined }).then(
              () => {
                act.toast("Saved to memory.");
                setF({ ...f, title: "", body: "" });
                setOpen(false);
              },
              (e) => act.toast((e as Error).message),
            )
          }
        >
          Save
        </Btn>
        <Btn onClick={() => setOpen(false)}>Cancel</Btn>
      </div>
    </div>
  );
}
