"use client";

import type { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { ensureOffice, type Office } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { OfficeApp } from "@/office-app/OfficeApp";

type State =
  | { kind: "loading" }
  | { kind: "signed-out"; error?: string }
  | { kind: "office"; session: Session; office: Office }
  | { kind: "error"; session: Session; error: string }
  | { kind: "not-allowed"; session: Session; error: string };

export default function Home() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    async function load(session: Session | null) {
      if (!session) return setState({ kind: "signed-out" });
      try {
        const { office } = await ensureOffice();
        if (!cancelled) setState({ kind: "office", session, office });
      } catch (err) {
        // The sign-in this browser holds is for an account that's gone (or expired): start over.
        if ((err as { status?: number }).status === 401) {
          await supabase.auth.signOut();
          if (!cancelled) setState({ kind: "signed-out", error: "Please sign in again." });
          return;
        }
        if ((err as { code?: string }).code === "not_allowed") {
          if (!cancelled) setState({ kind: "not-allowed", session, error: (err as Error).message });
          return;
        }
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

  if (state.kind === "office") return <OfficeApp key={state.office.id} office={state.office} />;

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

        {state.kind === "not-allowed" && (
          <div className="mt-8 space-y-3">
            <p className="text-sm text-ink-2">{state.error}</p>
            <button onClick={() => supabase.auth.signOut()} className="text-sm text-muted underline">
              Sign out
            </button>
          </div>
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
