"use client";

import { useEffect } from "react";
import { reportError } from "@/lib/api";

/** Sends uncaught browser errors to the API, where they're tracked with everything else. */
export function ErrorReporter() {
  useEffect(() => {
    const seen = new Set<string>();
    const send = (message: string, stack?: string) => {
      if (!message || seen.has(message) || seen.size > 50) return;
      seen.add(message);
      void reportError(message, stack, { url: window.location.pathname });
    };
    const onError = (e: ErrorEvent) => send(e.message, (e.error as Error | undefined)?.stack);
    const onRejection = (e: PromiseRejectionEvent) => {
      const err = e.reason instanceof Error ? e.reason : new Error(String(e.reason));
      // Failed API calls are already shown to the user and tracked by the API.
      if ((err as { status?: number }).status) return;
      send(`unhandled: ${err.message}`, err.stack);
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
