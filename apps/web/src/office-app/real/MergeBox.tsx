"use client";

import { useEffect, useState } from "react";
import { getPr, type PullRequestView } from "@/lib/api";
import { useSim } from "@/sim/store";
import { Btn } from "../bits";

/** A pull request waiting on the CEO: what changed, its checks, and merge or send back. Only the CEO merges. */
export function MergeBox({ pr, inboxId, compact }: { pr: number; inboxId?: string; compact?: boolean }) {
  const { act } = useSim();
  const [view, setView] = useState<PullRequestView | null>(null);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    getPr(pr).then((r) => setView(r.pr), (e) => setErr(e.message));
  }, [pr]);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    await fn();
    setBusy(false);
    getPr(pr).then((r) => setView(r.pr), () => {});
  };
  const failing = view?.checks.filter((c) => c.conclusion && !["success", "neutral", "skipped"].includes(c.conclusion)) ?? [];
  const running = view?.checks.some((c) => c.status !== "completed");

  return (
    <div className={`rounded-[14px] bg-[#f6f5f2] ${compact ? "p-2.5" : "p-3.5"} text-[12.5px]`}>
      {!view && !err && <div className="text-faint">Loading PR #{pr}…</div>}
      {err && <div className="text-bad">{err}</div>}
      {view && (
        <>
          <a href={view.url} target="_blank" rel="noreferrer" className="font-semibold text-ink hover:underline">
            #{view.number} {view.title} ↗
          </a>
          <div className="mt-0.5 text-muted">
            <span className="font-mono text-[11px]">{view.head}</span> → <span className="font-mono text-[11px]">{view.base}</span> · {view.changedFiles} files ·{" "}
            <span className="text-ok">+{view.additions}</span> <span className="text-bad">−{view.deletions}</span>
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {view.merged ? (
              <span className="rounded-full bg-[#e8f4ec] px-2 py-[1px] text-[11px] font-semibold text-[#2d7a4a]">Merged</span>
            ) : view.mergeable === false ? (
              <span className="rounded-full bg-[#fdecea] px-2 py-[1px] text-[11px] font-semibold text-[#9b2c24]">Has conflicts</span>
            ) : null}
            {view.checks.length === 0 ? (
              <span className="rounded-full bg-white px-2 py-[1px] text-[11px] font-semibold text-muted">No checks ran</span>
            ) : failing.length ? (
              <span className="rounded-full bg-[#fdecea] px-2 py-[1px] text-[11px] font-semibold text-[#9b2c24]">Failing: {failing.map((c) => c.name).join(", ")}</span>
            ) : (
              <span className="rounded-full bg-[#e8f4ec] px-2 py-[1px] text-[11px] font-semibold text-[#2d7a4a]">{running ? "Checks running…" : "All checks passed"}</span>
            )}
          </div>
          {!view.merged && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              <Btn tone="dark" className="!py-1 !text-[12px]" onClick={() => void run(() => act.merge(pr, inboxId))}>
                {busy ? "…" : "Merge"}
              </Btn>
              <Btn className="!py-1 !text-[12px]" onClick={() => setAsking((v) => !v)}>
                Request changes
              </Btn>
            </div>
          )}
          {asking && !view.merged && (
            <div className="mt-2 flex gap-1.5">
              <input
                autoFocus
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="What needs to change?"
                className="min-w-0 flex-1 rounded-full bg-white px-3 py-1.5 text-[12.5px] outline-none ring-1 ring-black/[0.08]"
              />
              <Btn
                tone="dark"
                className="!py-1 !text-[12px]"
                onClick={() =>
                  note.trim() &&
                  void run(async () => {
                    await act.changes(pr, note.trim(), inboxId);
                    setAsking(false);
                    setNote("");
                  })
                }
              >
                Send
              </Btn>
            </div>
          )}
        </>
      )}
    </div>
  );
}
