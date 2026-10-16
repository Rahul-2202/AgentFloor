"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { PanelKey } from "@/sim/types";

export type WindowKind = "chat" | "terminal" | "memory" | "config" | "assign" | "output" | "meeting" | "room" | "task";

export interface Win {
  kind: WindowKind;
  id?: string;
  /** For chat: how the message is delivered. */
  mode?: "now" | "queue";
  tab?: string;
}

interface UI {
  panel: PanelKey | null;
  panelRef?: string;
  openPanel: (p: PanelKey, ref?: string) => void;
  closePanel: () => void;
  card: string | null;
  setCard: (id: string | null) => void;
  win: Win | null;
  openWin: (w: Win) => void;
  closeWin: () => void;
  /** Ask the world to walk the player somewhere (set by World). */
  walkTo: (x: number, y: number) => void;
  setWalkTo: (fn: (x: number, y: number) => void) => void;
  summon: (id: string) => void;
  setSummon: (fn: (id: string) => void) => void;
  /** The room you're standing in. */
  here: string | null;
  setHere: (r: string | null) => void;
}

const Ctx = createContext<UI | null>(null);

export function UIProvider({ children }: { children: ReactNode }) {
  const [panel, setPanel] = useState<PanelKey | null>(null);
  const [panelRef, setPanelRef] = useState<string | undefined>();
  const [card, setCard] = useState<string | null>(null);
  const [win, setWin] = useState<Win | null>(null);
  const [walker, setWalker] = useState<{ fn: (x: number, y: number) => void }>({ fn: () => {} });
  const [summoner, setSummoner] = useState<{ fn: (id: string) => void }>({ fn: () => {} });
  const [here, setHere] = useState<string | null>("ceo");

  const openPanel = useCallback((p: PanelKey, ref?: string) => {
    setPanel(p);
    setPanelRef(ref);
  }, []);
  const closePanel = useCallback(() => setPanel(null), []);
  const openWin = useCallback((w: Win) => setWin(w), []);
  const closeWin = useCallback(() => setWin(null), []);

  const value = useMemo<UI>(
    () => ({
      panel,
      panelRef,
      openPanel,
      closePanel,
      card,
      setCard,
      win,
      openWin,
      closeWin,
      walkTo: walker.fn,
      setWalkTo: (fn) => setWalker({ fn }),
      summon: summoner.fn,
      setSummon: (fn) => setSummoner({ fn }),
      here,
      setHere,
    }),
    [panel, panelRef, openPanel, closePanel, card, win, openWin, closeWin, walker, summoner, here],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useUI() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useUI outside UIProvider");
  return v;
}
