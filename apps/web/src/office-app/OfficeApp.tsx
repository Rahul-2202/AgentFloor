"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { Office } from "@/lib/api";
import { Onboarding } from "@/onboarding/Onboarding";
import { Tour } from "@/onboarding/Tour";
import { SimProvider, type Fixture } from "@/sim/store";
import { MobileOffice } from "./MobileOffice";
import { PanelRouter } from "./panels";
import { Toasts } from "./Toasts";
import { TopBar } from "./TopBar";
import { UIProvider, useUI } from "./ui";
import { WindowRouter } from "./windows";
import { ReadBackHost } from "./windows/ReadBack";
import { World } from "./World";

function Shell({ overlay, onboarding, onOnboarded }: { overlay?: ReactNode; onboarding: boolean; onOnboarded: () => void }) {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 899px)");
    const on = () => setMobile(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  // A new office starts with Ada's interview; the office builds itself from it.
  if (onboarding) return <Onboarding onDone={onOnboarded} />;
  return mobile ? <MobileOffice /> : <DesktopShell overlay={overlay} />;
}

function DesktopShell({ overlay }: { overlay?: ReactNode }) {
  const ui = useUI();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (ui.win) ui.closeWin();
      else if (ui.panel) ui.closePanel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ui]);

  return (
    <div className="fixed inset-0 overflow-hidden bg-[#e9e3d8]">
      <World />
      <TopBar />
      <Toasts />
      <PanelRouter />
      <WindowRouter />
      <ReadBackHost />
      {overlay}
    </div>
  );
}

/** The office, on its real data. `overlay` renders inside the app (used by the guided tour). */
export function OfficeApp({ office, overlay, fixture }: { office: Office; overlay?: ReactNode; fixture?: Fixture }) {
  const [ok, setOk] = useState(false);
  const [onboarding, setOnboarding] = useState(!office.onboardedAt);
  // The guide opens by itself right after onboarding; later it's a button.
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setOk(true), 0);
    return () => clearTimeout(t);
  }, []);
  return (
    <SimProvider office={office} fixture={fixture}>
      <UIProvider>{ok ? <Shell overlay={overlay ?? <Tour key={String(fresh)} startOpen={fresh} />} onboarding={onboarding} onOnboarded={() => (setOnboarding(false), setFresh(true))} /> : <div className="fixed inset-0 bg-[#e9e3d8]" />}</UIProvider>
    </SimProvider>
  );
}
