"use client";

import { useEffect } from "react";
import { reportError } from "@/lib/api";

/** A crash in the page: reported, with a way to carry on. */
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    void reportError(`page crashed: ${error.message}`, error.stack, { digest: error.digest });
  }, [error]);
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-sm rounded-2xl bg-surface p-8 text-center shadow-[var(--shadow-card)]">
        <h1 className="font-display text-xl font-semibold">Something broke</h1>
        <p className="mt-2 text-sm text-muted">It&apos;s been reported. Your office is fine: agents keep working.</p>
        <button onClick={reset} className="mt-6 rounded-xl bg-ink px-4 py-2.5 text-sm font-medium text-white">
          Try again
        </button>
      </div>
    </main>
  );
}
