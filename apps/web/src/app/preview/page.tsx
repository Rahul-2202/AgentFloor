"use client";

import { notFound } from "next/navigation";
import { useEffect, useState } from "react";
import { EMPTY_FIXTURE, FIXTURE } from "@/office-app/fixture";
import { OfficeApp } from "@/office-app/OfficeApp";

/** Development only: the office on made-up data, to look at the UI without signing in. */
export default function Preview() {
  if (process.env.NODE_ENV === "production") notFound();
  // Rendered in the browser only, like the real office (it reads the clock).
  // ?new shows a brand-new office (Ada's onboarding).
  const [mode, setMode] = useState<"office" | "new" | null>(null);
  useEffect(() => {
    setMode(new URLSearchParams(window.location.search).has("new") ? "new" : "office");
  }, []);
  if (!mode) return null;
  const fresh = mode === "new";
  return (
    <OfficeApp
      office={{ id: "preview", name: "Acme Robotics", onboardedAt: fresh ? null : "2026-10-17T00:00:00Z", sandboxState: fresh ? "none" : "started", daemonConnected: !fresh }}
      fixture={fresh ? EMPTY_FIXTURE : FIXTURE}
    />
  );
}
