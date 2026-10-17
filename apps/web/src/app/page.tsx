"use client";

import type { Session } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import { ensureOffice, type Office } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { OfficeApp } from "@/office-app/OfficeApp";
import { SignIn, Splash } from "./SignIn";

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

  // Waiting to be let in: check now and then, and open the office the moment an admin does.
  const [checking, setChecking] = useState(false);
  const checkAgain = useCallback(async () => {
    if (state.kind !== "not-allowed") return;
    setChecking(true);
    try {
      const { office } = await ensureOffice();
      setState({ kind: "office", session: state.session, office });
    } catch {
      // still waiting
    } finally {
      setChecking(false);
    }
  }, [state]);
  useEffect(() => {
    if (state.kind !== "not-allowed") return;
    const t = setInterval(() => void checkAgain(), 20_000);
    return () => clearInterval(t);
  }, [state.kind, checkAgain]);

  const signIn = () =>
    supabase.auth.signInWithOAuth({ provider: "github", options: { redirectTo: window.location.origin } });

  if (state.kind === "office") return <OfficeApp key={state.office.id} office={state.office} />;
  // Until we know whether this browser is signed in (and while the office loads), show nothing that
  // looks like the sign-in page: a refresh of a signed-in office shouldn't flash the landing.
  if (state.kind === "loading") return <Splash />;

  return (
    <SignIn
      state={state.kind}
      error={"error" in state ? state.error : undefined}
      onSignIn={() => void signIn()}
      onSignOut={() => void supabase.auth.signOut()}
      who={"session" in state ? whoOf(state.session) : undefined}
      checking={checking}
      onCheckAgain={() => void checkAgain()}
    />
  );
}

/** The GitHub account someone signed in with (for the waiting page). */
function whoOf(session: Session) {
  const m = session.user.user_metadata as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  return { login: str(m.user_name), name: str(m.full_name) ?? str(m.name), avatar: str(m.avatar_url), email: session.user.email ?? null };
}
