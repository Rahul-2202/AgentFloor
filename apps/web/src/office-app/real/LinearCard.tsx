"use client";

import { useEffect, useState } from "react";
import { BrandIcon } from "@/components/brands";
import { linearConnect, linearDisconnect, linearStatus, type LinearStatus } from "@/lib/api";
import { useSim } from "@/sim/store";
import { Btn } from "../bits";

/** The office's Linear: which team its tasks mirror into. */
export function LinearCard() {
  const { act } = useSim();
  const [status, setStatus] = useState<LinearStatus | null>(null);
  const [team, setTeam] = useState("");
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
          <Btn
            tone="dark"
            className="!py-1 !text-[12px]"
            disabled={!team || busy}
            onClick={async () => {
              setBusy(true);
              setErr("");
              try {
                const r = await linearConnect(team);
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
      {status?.configured && !link && <div className="mt-2 text-[11.5px] text-faint">Issues go into a new project named after the office. Label an issue &quot;AgentFloor&quot; in Linear to hand it to a room.</div>}
      {err && <div className="mt-2 text-[12px] text-bad">{err}</div>}
    </div>
  );
}
