"use client";

import type { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { ensureOffice, type Office } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { OfficeApp } from "@/office-app/OfficeApp";
import { SignIn } from "./SignIn";

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
    <SignIn
      state={state.kind}
      error={"error" in state ? state.error : undefined}
      onSignIn={() => void signIn()}
      onSignOut={() => void supabase.auth.signOut()}
    />
  );
}
