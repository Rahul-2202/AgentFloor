"use client";

import type { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { ensureOffice, pauseOffice, startOffice, type Office } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { Console } from "./office/Console";

type State =
  | { kind: "loading" }
  | { kind: "signed-out"; error?: string }
  | { kind: "office"; session: Session; office: Office; created: boolean }
  | { kind: "error"; session: Session; error: string };

export default function Home() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    async function load(session: Session | null) {
      if (!session) return setState({ kind: "signed-out" });
      try {
        const { office, created } = await ensureOffice();
        if (!cancelled) setState({ kind: "office", session, office, created });
      } catch (err) {
        if (!cancelled) setState({ kind: "error", session, error: (err as Error).message });
      }
    }
    const params = new URLSearchParams(window.location.search);
    if (params.get("error_description")) setState({ kind: "signed-out", error: params.get("error_description")! });
    // Fires once with the current session (after the GitHub redirect is exchanged), then on changes.
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "INITIAL_SESSION" || event === "SIGNED_IN" || event === "SIGNED_OUT") void load(session);
    });
    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, []);

  const signIn = () =>
    supabase.auth.signInWithOAuth({ provider: "github", options: { redirectTo: window.location.origin } });

  if (state.kind === "office") {
    return (
      <main className="mx-auto min-h-dvh max-w-5xl px-4 py-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-semibold">{state.office.name}</h1>
            <p className="text-sm text-muted">
              {state.created ? "Your office is ready." : "AgentFloor"} · signed in as {state.session.user.user_metadata.user_name ?? state.session.user.email}
            </p>
          </div>
          <button onClick={() => supabase.auth.signOut()} className="text-sm text-muted underline">
            Sign out
          </button>
        </header>
        <div className="mt-4">
          <Machine office={state.office} />
        </div>
        <Console officeId={state.office.id} running />
      </main>
    );
  }

  return (
    <main className="min-h-dvh grid place-items-center px-4">
      <div className="w-full max-w-sm rounded-2xl bg-surface p-8 shadow-[var(--shadow-card)]">
        <h1 className="font-display text-2xl font-semibold">AgentFloor</h1>
        <p className="mt-1 text-muted">Run a company of AI agents from a pixel office.</p>

        {state.kind === "loading" && <p className="mt-8 text-faint">Loading…</p>}

        {state.kind === "signed-out" && (
          <>
            <button
              onClick={signIn}
              className="mt-8 w-full rounded-xl bg-ink px-4 py-3 font-medium text-white transition hover:bg-ink-2"
            >
              Sign in with GitHub
            </button>
            {state.error && <p className="mt-3 text-sm text-bad">{state.error}</p>}
          </>
        )}

        {state.kind === "error" && (
          <div className="mt-8 space-y-3">
            <p className="text-sm text-bad">Couldn&apos;t open your office: {state.error}</p>
            <button onClick={() => supabase.auth.signOut()} className="text-sm text-muted underline">
              Sign out
            </button>
          </div>
        )}
      </div>
    </main>
  );
}

const LABELS: Record<string, string> = {
  none: "not created yet",
  creating: "setting up (first time takes a minute)",
  starting: "starting",
  started: "running",
  pausing: "pausing",
  paused: "paused",
  stopped: "asleep",
  archived: "asleep",
  error: "needs attention",
};

/** The office computer: its state, and starting or pausing it. */
function Machine({ office }: { office: Office }) {
  const [state, setState] = useState(office.sandboxState);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (action: () => Promise<{ state: string }>, during: string) => {
    setBusy(true);
    setError(null);
    setState(during);
    try {
      setState((await action()).state);
    } catch (err) {
      setState("error");
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const running = state === "started";
  return (
    <div className="rounded-xl bg-surface-2 p-4 text-sm">
      <div className="flex items-center justify-between gap-3">
        <span>
          <span className="text-muted">Office computer: </span>
          <span className={running ? "text-ok" : state === "error" ? "text-bad" : ""}>{LABELS[state] ?? state}</span>
        </span>
        {running ? (
          <button disabled={busy} onClick={() => run(pauseOffice, "stopped")} className="rounded-lg px-3 py-1.5 text-muted ring-1 ring-line-2 disabled:opacity-50">
            Stop
          </button>
        ) : (
          <button disabled={busy} onClick={() => run(startOffice, state === "none" ? "creating" : "starting")} className="rounded-lg bg-ink px-3 py-1.5 font-medium text-white disabled:opacity-50">
            Start office
          </button>
        )}
      </div>
      {error && <p className="mt-2 text-bad">{error}</p>}
      <p className="mt-2 text-faint">It goes to sleep after 15 quiet minutes. Starting it again takes a few seconds, and agents pick up their conversations.</p>
    </div>
  );
}
