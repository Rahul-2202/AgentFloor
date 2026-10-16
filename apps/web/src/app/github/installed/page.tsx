"use client";

import { useEffect, useState } from "react";
import { chooseRepo, connectGithub, githubRepos } from "@/lib/api";
import { supabase } from "@/lib/supabase";

/** GitHub sends the CEO here after installing the AgentFloor app (with installation_id). */
export default function Installed() {
  const [step, setStep] = useState<"connecting" | "pick" | "done" | "error">("connecting");
  const [repos, setRepos] = useState<{ fullName: string; private: boolean }[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("installation_id");
    const { data } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event !== "INITIAL_SESSION") return;
      if (!session) return void (window.location.href = "/");
      try {
        if (!id) throw new Error("GitHub didn't say which installation this is. Install the app again from the office's Setup tab.");
        await connectGithub(id);
        setRepos((await githubRepos()).repos);
        setStep("pick");
      } catch (err) {
        setError((err as Error).message);
        setStep("error");
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const pick = async (repo: string) => {
    try {
      await chooseRepo(repo);
      setStep("done");
      setTimeout(() => (window.location.href = "/"), 1500);
    } catch (err) {
      setError((err as Error).message);
      setStep("error");
    }
  };

  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-md rounded-2xl bg-surface p-8 shadow-[var(--shadow-card)]">
        <h1 className="font-display text-xl font-semibold">GitHub</h1>
        {step === "connecting" && <p className="mt-4 text-faint">Connecting your installation…</p>}
        {step === "pick" && (
          <>
            <p className="mt-2 text-muted">Which repo should your agents work on? Each agent gets its own branch; nothing merges without you.</p>
            <ul className="mt-4 space-y-2">
              {repos.map((r) => (
                <li key={r.fullName}>
                  <button onClick={() => pick(r.fullName)} className="w-full rounded-xl px-4 py-3 text-left ring-1 ring-line-2 hover:bg-surface-2">
                    {r.fullName} {r.private && <span className="text-xs text-muted">private</span>}
                  </button>
                </li>
              ))}
              {!repos.length && <p className="text-sm text-muted">The installation has no repos. Add one on GitHub, then come back.</p>}
            </ul>
          </>
        )}
        {step === "done" && <p className="mt-4 text-ok">Connected. The office is cloning it now…</p>}
        {step === "error" && <p className="mt-4 text-bad">{error}</p>}
      </div>
    </main>
  );
}
