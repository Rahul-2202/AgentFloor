"use client";

import { useMemo, useState } from "react";
import type { OfficeData } from "@/lib/office-data";

/** Everything the CEO, Ada, agents and the office did: who, what, when, and the detail. */
export function Audit({ data }: { data: OfficeData }) {
  const [who, setWho] = useState("");
  const [what, setWhat] = useState("");
  const name = (actor: string) => {
    if (actor.startsWith("agent:")) return data.agents.find((a) => a.id === actor.slice(6))?.name ?? actor.slice(6);
    return { ceo: "You", ada: "Ada", system: "The office", office: "The office", github: "GitHub" }[actor] ?? actor;
  };
  const actions = useMemo(() => [...new Set(data.audit.map((a) => a.action))].sort(), [data.audit]);
  const rows = data.audit.filter((a) => (!who || a.actor === who) && (!what || a.action === what));
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <select value={who} onChange={(e) => setWho(e.target.value)} className="rounded-lg bg-surface px-2 py-1.5 text-sm ring-1 ring-line">
          <option value="">Anyone</option>
          {[...new Set(data.audit.map((a) => a.actor))].map((a) => (
            <option key={a} value={a}>
              {name(a)}
            </option>
          ))}
        </select>
        <select value={what} onChange={(e) => setWhat(e.target.value)} className="rounded-lg bg-surface px-2 py-1.5 text-sm ring-1 ring-line">
          <option value="">Any action</option>
          {actions.map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
      </div>
      <ul className="mt-3 divide-y divide-line rounded-2xl bg-surface shadow-[var(--shadow-card)]">
        {rows.map((a) => (
          <li key={a.id} className="grid gap-1 px-4 py-2 text-sm sm:grid-cols-[9rem_8rem_1fr]">
            <span className="text-muted">{new Date(a.created_at).toLocaleString()}</span>
            <span>{name(a.actor)}</span>
            <span>
              {a.action}
              {a.target ? ` · ${a.target}` : ""}
              {typeof a.detail?.summary === "string" ? <span className="block text-muted">{a.detail.summary}</span> : null}
            </span>
          </li>
        ))}
        {!rows.length && <li className="px-4 py-3 text-faint">Nothing yet.</li>}
      </ul>
    </div>
  );
}
