"use client";

import { useEffect, useRef, useState } from "react";
import { adaChat, confirmAdaCard, dismissAdaCard, type AdaCard } from "@/lib/api";
import { supabase } from "@/lib/supabase";

interface Line {
  role: "ceo" | "ada";
  content: string;
  cards: AdaCard[];
}

/**
 * Ada, the office manager. Her replies stream in; setup changes she proposes
 * arrive as read-back cards that only the CEO confirms. For a new office she
 * runs the onboarding interview.
 */
export function AdaPanel({ officeId, onboarding, onClose, onDone }: { officeId: string; onboarding: boolean; onClose?: () => void; onDone: (msg: string) => void }) {
  const [lines, setLines] = useState<Line[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  const send = async (message: string) => {
    setBusy(true);
    setError(null);
    setLines((l) => [...l, ...(message ? [{ role: "ceo" as const, content: message, cards: [] }] : []), { role: "ada", content: "", cards: [] }]);
    const patchLast = (fn: (x: Line) => Line) => setLines((l) => [...l.slice(0, -1), fn(l.at(-1)!)]);
    try {
      await adaChat(message, (e) => {
        if (e.type === "text") patchLast((x) => ({ ...x, content: x.content + e.delta }));
        if (e.type === "card") patchLast((x) => ({ ...x, cards: [...x.cards, e.card] }));
        if (e.type === "done") patchLast(() => ({ role: "ada", content: e.message.content, cards: e.message.cards }));
        if (e.type === "error") setError(e.message);
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Her conversation so far; a new office starts the interview.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void supabase
      .from("ada_messages")
      .select("role, content, cards, mode")
      .eq("office_id", officeId)
      .neq("mode", "job")
      .order("id")
      .limit(80)
      .then(({ data }) => {
        const past = (data ?? []) as Line[];
        setLines(past);
        if (!past.length && onboarding) void send("");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [officeId]);

  useEffect(() => bottom.current?.scrollIntoView({ behavior: "smooth" }), [lines]);

  const settle = (card: AdaCard, state: AdaCard["state"], version?: number) =>
    setLines((l) => l.map((x) => ({ ...x, cards: x.cards.map((c) => (c.id === card.id ? { ...c, state, version } : c)) })));

  return (
    <aside className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col bg-surface shadow-[var(--shadow-float)]">
      <header className="flex items-center justify-between border-b border-line p-4">
        <div>
          <h2 className="font-display text-lg font-semibold">Ada</h2>
          <p className="text-sm text-muted">{onboarding ? "Setting up your office" : "Your office manager"}</p>
        </div>
        {onClose && (
          <button onClick={onClose} className="text-muted">
            Close
          </button>
        )}
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {lines.map((l, i) => (
          <div key={i} className={l.role === "ceo" ? "ml-10 rounded-2xl bg-ink px-3 py-2 text-sm text-white" : "mr-6 text-sm"}>
            {l.content ? <p className="whitespace-pre-wrap">{l.content}</p> : l.role === "ada" && busy && i === lines.length - 1 ? <p className="text-faint">Ada is thinking…</p> : null}
            {l.cards.map((c) => (
              <div key={c.id} className="mt-2 rounded-xl bg-surface-2 p-3 text-ink">
                <p className="text-xs font-medium uppercase tracking-wide text-muted">Read-back · {c.summary}</p>
                <ul className="mt-2 space-y-1">
                  {c.readback.map((r) => (
                    <li key={r} className="flex gap-2">
                      <span className="text-ok">✓</span>
                      <span>{r}</span>
                    </li>
                  ))}
                </ul>
                {c.state === "pending" ? (
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() =>
                        confirmAdaCard(c.id).then(
                          (r) => (settle(c, "applied", r.version), onDone(`Applied. The office is on version ${r.version}.`)),
                          (e) => setError(e.message),
                        )
                      }
                      className="rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-white"
                    >
                      Confirm
                    </button>
                    <button onClick={() => dismissAdaCard(c.id).then(() => settle(c, "dismissed"))} className="rounded-lg px-3 py-1.5 text-sm ring-1 ring-line-2">
                      Not now
                    </button>
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-muted">{c.state === "applied" ? `Applied (version ${c.version})` : c.state === "stale" ? "The office changed since; ask Ada again." : "Not applied"}</p>
                )}
              </div>
            ))}
          </div>
        ))}
        {error && <p className="text-sm text-bad">{error}</p>}
        <div ref={bottom} />
      </div>
      <form
        className="border-t border-line p-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.trim() || busy) return;
          const m = draft;
          setDraft("");
          void send(m);
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={busy}
          placeholder={onboarding ? "Answer Ada…" : "Ask Ada anything about the office…"}
          className="w-full rounded-xl bg-surface-2 px-4 py-3 text-sm"
        />
      </form>
    </aside>
  );
}
