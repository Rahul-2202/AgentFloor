"use client";

import { useEffect, useState } from "react";
import { BrandIcon } from "@/components/brands";
import { linearConnect, linearDisconnect, linearProjects, linearStatus, type LinearStatus } from "@/lib/api";
import { useSim } from "@/sim/store";
import { Btn } from "../bits";

/** The office's Linear: which team its tasks mirror into. */
export function LinearCard() {
  const { act } = useSim();
  const [status, setStatus] = useState<LinearStatus | null>(null);
  const [team, setTeam] = useState("");
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [project, setProject] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const load = () =>
    linearStatus().then((s) => {
      setStatus(s);
      setTeam((t) => t || s.teams?.[0]?.id || "");
    }, (e) => setErr((e as Error).message));
  useEffect(() => {
    void load();
  }, []);
  // The team's projects, to put the office's issues in one (or a new one).
  useEffect(() => {
    setProjects([]);
    setProject("");
    if (team && !status?.link) void linearProjects(team).then((r) => setProjects(r.projects), () => {});
  }, [team, status?.link]);
  const link = status?.link;

  return (
    <div className="rounded-[16px] bg-white p-3.5 ring-1 ring-black/[0.06]">
      <div className="flex items-center gap-2.5">
        <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-[#f2f0ec]">
          <BrandIcon name="Linear" size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-ink">Linear</div>
          <div className="truncate text-[12px] text-muted">
            {!status
              ? "Checking…"
              : !status.configured
                ? "Not set up on this server yet"
                : link
                  ? `${link.teamName} (${link.teamKey}) · every task has an issue${link.webhookId ? "; changes in Linear come back" : ""}`
                  : "Mirror the office's tasks as Linear issues, both ways."}
          </div>
        </div>
        {link && (
          <Btn
            className="!py-1 !text-[12px]"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await linearDisconnect().then(load, (e) => setErr((e as Error).message));
              setBusy(false);
            }}
          >
            Disconnect
          </Btn>
        )}
      </div>
      {status?.configured && !link && (
        <div className="mt-2.5 flex gap-1.5">
          <select value={team} onChange={(e) => setTeam(e.target.value)} className="min-w-0 flex-1 rounded-[12px] bg-[#f6f5f2] px-3 py-2 text-[13px] outline-none ring-1 ring-black/[0.06]">
            {(status.teams ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.key})
              </option>
            ))}
          </select>
          <select value={project} onChange={(e) => setProject(e.target.value)} className="min-w-0 flex-1 rounded-[12px] bg-[#f6f5f2] px-3 py-2 text-[13px] outline-none ring-1 ring-black/[0.06]">
            <option value="">New project for this office</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <Btn
            tone="dark"
            className="!py-1 !text-[12px]"
            disabled={!team || busy}
            onClick={async () => {
              setBusy(true);
              setErr("");
              try {
                const r = await linearConnect(team, project || null);
                act.toast(r.link.warning ?? `Connected to ${r.link.teamName}. Open tasks are getting issues now.`);
                await load();
              } catch (e) {
                setErr((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Connecting…" : "Connect"}
          </Btn>
        </div>
      )}
      {link?.projectUrl && (
        <a href={link.projectUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block text-[11.5px] font-semibold text-muted hover:text-ink">
          The office&apos;s project in Linear ↗
        </a>
      )}
      {status?.configured && !link && <div className="mt-2 text-[11.5px] text-faint">Pick your own project, or a new one named after your office is made. Label an issue &quot;AgentFloor&quot; in Linear to hand it to a room.</div>}
      {err && <div className="mt-2 text-[12px] text-bad">{err}</div>}
    </div>
  );
}
