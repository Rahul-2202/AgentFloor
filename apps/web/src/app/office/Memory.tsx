"use client";

import { useEffect, useMemo, useState } from "react";
import { acceptMemory, editMemory, flagMemory, rejectMemory, writeMemory } from "@/lib/api";
import type { MemoryRow, OfficeData } from "@/lib/office-data";
import { supabase } from "@/lib/supabase";

const LAYERS = [
  ["company", "Company"],
  ["ceo", "Your preferences"],
  ["room", "Rooms"],
  ["agent", "Agents"],
  ["conversation", "Conversations"],
  ["short_term", "Scratchpads"],
] as const;

/** Everything the company remembers. The CEO sees and edits all of it. */
export function Memory({ data, officeId, onDone }: { data: OfficeData; officeId: string; onDone: (m: string) => void }) {
  const [layer, setLayer] = useState<string>("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<MemoryRow | null>(null);
  const [decisionsOnly, setDecisionsOnly] = useState(false);
  const [measures, setMeasures] = useState<Record<string, number>>({});
  const name = (id: string) => (id === "ada" ? "Ada" : id === "ceo" ? "You" : id === "system" ? "The office" : data.agents.find((a) => a.id === id)?.name ?? data.rooms.find((r) => r.id === id)?.name ?? id);
  const flagged = new Set(data.flags.map((f) => f.item_id));

  useEffect(() => {
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
    void supabase
      .from("memory_measures")
      .select("metric, value")
      .eq("office_id", officeId)
      .gte("day", since)
      .then(({ data: rows }) => {
        const m: Record<string, number> = {};
        for (const r of rows ?? []) m[r.metric] = (m[r.metric] ?? 0) + Number(r.value);
        setMeasures(m);
      });
  }, [officeId, data.memory.length]);

  const items = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return data.memory.filter(
      (i) =>
        i.status !== "superseded" &&
        (layer === "all" || i.layer === layer) &&
        (!decisionsOnly || i.type === "decision") &&
        words.every((w) => `${i.title} ${i.body} ${i.tags.join(" ")}`.toLowerCase().includes(w)),
    );
  }, [data.memory, layer, q, decisionsOnly]);
  const waiting = data.memory.filter((i) => i.status === "proposed");

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <section>
        <div className="flex flex-wrap items-center gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search memory" className="w-56 rounded-lg bg-surface px-3 py-1.5 text-sm ring-1 ring-line" />
          <select value={layer} onChange={(e) => setLayer(e.target.value)} className="rounded-lg bg-surface px-2 py-1.5 text-sm ring-1 ring-line">
            <option value="all">All layers</option>
            {LAYERS.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1 text-sm text-muted">
            <input type="checkbox" checked={decisionsOnly} onChange={(e) => setDecisionsOnly(e.target.checked)} /> Decision log
          </label>
        </div>
        {waiting.length > 0 && (
          <p className="mt-3 rounded-lg bg-accent-soft px-3 py-2 text-sm">
            {waiting.length} waiting for their owner&apos;s approval (lessons with low confidence or conflicts, and Ada&apos;s suggestions).
          </p>
        )}
        <ul className="mt-3 space-y-2">
          {items.map((i) => (
            <li key={i.id}>
              <button onClick={() => setOpen(i)} className="w-full rounded-xl bg-surface p-3 text-left shadow-[var(--shadow-card)]">
                <span className="flex items-center justify-between gap-3">
                  <span className="font-medium">{i.title}</span>
                  <span className="shrink-0 text-xs text-muted">
                    {LAYERS.find((l) => l[0] === i.layer)?.[1]}
                    {i.layer === "room" || i.layer === "agent" ? ` · ${name(i.scope_id)}` : ""} · {i.type}
                  </span>
                </span>
                <span className="mt-1 line-clamp-2 block text-sm text-muted">{i.body}</span>
                <span className="mt-1 block text-xs">
                  {i.status === "proposed" && <span className="text-warn">Waiting for {name(i.owner)} · </span>}
                  {(i.status === "stale" || flagged.has(i.id)) && <span className="text-bad">Flagged stale · </span>}
                  <span className="text-faint">by {name(i.source.by ?? i.owner)} · v{i.version}</span>
                </span>
              </button>
            </li>
          ))}
          {!items.length && <p className="text-faint">Nothing here yet.</p>}
        </ul>
      </section>

      <section className="space-y-4">
        {open ? <ItemCard item={open} flags={data.flags.filter((f) => f.item_id === open.id)} name={name} onClose={() => setOpen(null)} onDone={onDone} /> : <NewItem rooms={data.rooms} onDone={onDone} />}
        <div className="rounded-2xl bg-surface p-4 text-sm shadow-[var(--shadow-card)]">
          <h3 className="font-display font-semibold">How memory is doing (7 days)</h3>
          <dl className="mt-2 grid grid-cols-[1fr_auto] gap-y-1">
            <dt className="text-muted">You repeated a preference</dt>
            <dd>{measures.repeated_corrections ?? 0}</dd>
            <dt className="text-muted">Agents read stale items</dt>
            <dd>{measures.stale_reads ?? 0}</dd>
            <dt className="text-muted">Agents asked what memory knew</dt>
            <dd>{measures.asked_known ?? 0}</dd>
            <dt className="text-muted">Memory tokens loaded</dt>
            <dd>{Math.round((measures.memory_tokens ?? 0) / 1000)}k</dd>
          </dl>
        </div>
      </section>
    </div>
  );
}

function ItemCard({ item, flags, name, onClose, onDone }: { item: MemoryRow; flags: { reasons: string[]; flagged_by: string[] }[]; name: (id: string) => string; onClose: () => void; onDone: (m: string) => void }) {
  const [title, setTitle] = useState(item.title);
  const [body, setBody] = useState(item.body);
  const [reason, setReason] = useState("");
  useEffect(() => {
    setTitle(item.title);
    setBody(item.body);
  }, [item]);
  const act = (p: Promise<unknown>, msg: string) => p.then(() => onDone(msg), (e) => onDone(e.message));
  return (
    <div className="rounded-2xl bg-surface p-4 shadow-[var(--shadow-card)]">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted">
          {item.layer} · {item.type} · owner {name(item.owner)}
        </p>
        <button onClick={onClose} className="text-sm text-muted">
          Close
        </button>
      </div>
      <input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-2 w-full rounded-lg bg-surface-2 px-3 py-2 font-medium" />
      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={8} className="mt-2 w-full rounded-lg bg-surface-2 px-3 py-2 text-sm" />
      {flags.map((f, i) => (
        <p key={i} className="mt-2 text-sm text-bad">
          Flagged by {f.flagged_by.map(name).join(", ")}: {f.reasons.join("; ")}
        </p>
      ))}
      <div className="mt-3 flex flex-wrap gap-2">
        <button onClick={() => act(editMemory(item.id, { title, body }), "Saved; anything derived from it is flagged for refresh.")} className="rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-white">
          Save
        </button>
        {item.status === "proposed" && (
          <>
            <button onClick={() => act(acceptMemory(item.id), "Accepted.")} className="rounded-lg px-3 py-1.5 text-sm ring-1 ring-line-2">
              Accept
            </button>
            <button onClick={() => act(rejectMemory(item.id, "Rejected by the CEO"), "Rejected.")} className="rounded-lg px-3 py-1.5 text-sm ring-1 ring-line-2">
              Reject
            </button>
          </>
        )}
      </div>
      <div className="mt-3 flex gap-2">
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What's wrong with it?" className="min-w-0 flex-1 rounded-lg bg-surface-2 px-3 py-1.5 text-sm" />
        <button disabled={!reason} onClick={() => act(flagMemory(item.id, reason), "Flagged for its owner.")} className="rounded-lg px-3 py-1.5 text-sm ring-1 ring-line-2 disabled:opacity-50">
          Flag stale
        </button>
      </div>
    </div>
  );
}

function NewItem({ rooms, onDone }: { rooms: { id: string; name: string }[]; onDone: (m: string) => void }) {
  const [f, setF] = useState({ layer: "company", scopeId: "", type: "fact", title: "", body: "" });
  return (
    <div className="rounded-2xl bg-surface p-4 shadow-[var(--shadow-card)]">
      <h3 className="font-display font-semibold">Add to memory</h3>
      <div className="mt-3 flex gap-2">
        <select value={f.layer} onChange={(e) => setF({ ...f, layer: e.target.value })} className="rounded-lg bg-surface-2 px-2 py-1.5 text-sm">
          <option value="company">Company</option>
          <option value="ceo">Your preference</option>
          <option value="room">A room</option>
        </select>
        {f.layer === "room" && (
          <select value={f.scopeId} onChange={(e) => setF({ ...f, scopeId: e.target.value })} className="rounded-lg bg-surface-2 px-2 py-1.5 text-sm">
            <option value="">Room…</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        )}
        <input value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} className="w-24 rounded-lg bg-surface-2 px-2 py-1.5 text-sm" />
      </div>
      <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Title" className="mt-2 w-full rounded-lg bg-surface-2 px-3 py-2 text-sm" />
      <textarea value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} placeholder="What should the office know?" rows={4} className="mt-2 w-full rounded-lg bg-surface-2 px-3 py-2 text-sm" />
      <button
        onClick={() => writeMemory({ ...f, scopeId: f.scopeId || undefined }).then(() => (setF({ ...f, title: "", body: "" }), onDone("Saved to memory.")), (e) => onDone(e.message))}
        className="mt-2 rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-white"
      >
        Save
      </button>
    </div>
  );
}
