"use client";

import { useEffect, useState } from "react";
import { ApiError, applySetup, proposeSetup, type Readback } from "@/lib/api";

/**
 * Every setup change goes through here: the API writes the read-back from the
 * change itself, the CEO confirms it, and only then is it applied.
 */
export function ReadbackDialog({ ops, onClose, onApplied }: { ops: object[]; onClose: () => void; onApplied: (version: number) => void }) {
  const [rb, setRb] = useState<Readback | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    proposeSetup(ops).then(setRb, (err) => setProblems(err instanceof ApiError && err.problems.length ? err.problems : [(err as Error).message]));
  }, [ops]);

  const confirm = async () => {
    if (!rb) return;
    setBusy(true);
    try {
      const r = await applySetup(ops, rb.baseVersion);
      onApplied(r.version);
    } catch (err) {
      setProblems(err instanceof ApiError && err.problems.length ? err.problems : [(err as Error).message]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/20 px-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-surface p-6 shadow-[var(--shadow-float)]" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display text-lg font-semibold">Read-back</h2>
        {!rb && !problems.length && <p className="mt-4 text-faint">Working out what this changes…</p>}
        {rb && (
          <>
            <p className="mt-1 text-sm text-muted">This is exactly what will change. Nothing happens until you confirm.</p>
            <ul className="mt-4 space-y-2">
              {rb.readback.map((line) => (
                <li key={line} className="flex gap-2 text-sm">
                  <span className="mt-0.5 text-ok">✓</span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        {problems.length > 0 && (
          <ul className="mt-4 space-y-1 text-sm text-bad">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-muted ring-1 ring-line-2">
            Cancel
          </button>
          {rb && !problems.length && (
            <button disabled={busy} onClick={confirm} className="rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
              {busy ? "Applying…" : "Confirm"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
