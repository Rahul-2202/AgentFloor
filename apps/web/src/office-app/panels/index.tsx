"use client";

import { AnimatePresence } from "motion/react";
import { useSim } from "@/sim/store";
import type { PanelKey } from "@/sim/types";
import { SidePanel } from "../bits";
import { useUI } from "../ui";
import { CalendarPanel } from "./Calendar";
import { ConversationsPanel } from "./Conversations";
import { DashboardPanel } from "./Dashboard";
import { GovernancePanel } from "./Governance";
import { InboxPanel } from "./Inbox";
import { MemoryPanel } from "./Memory";
import { OutputsPanel } from "./Outputs";
import { TeamPanel } from "./Team";

export function PanelRouter() {
  const ui = useUI();
  const { s } = useSim();
  const p = ui.panel;
  const ref = ui.panelRef;

  const meta: Record<PanelKey, [string, string]> = {
    assign: ["Assign a task", ""],
    room: ["Room", ""],
    dashboard: ["Dashboard", "Everything in flight, by state"],
    team: ["Agents & teams", "See, configure and call anyone. No need to ask Ada."],
    calendar: ["Meetings", "Ada books them, prepares the pre-read and writes the minutes"],
    outputs: ["Outputs", `${s.outputs.length} delivered · ${s.outputs.filter((o) => o.status === "review").length} need your review`],
    conversations: ["Transcripts & chats", "Meetings, channels and direct messages"],
    memory: ["Company memory", "Everything the company knows, with sources"],
    inbox: ["Needs your attention", "Triaged by Ada"],
    governance: ["Rules & settings", "Permissions, budgets, locks, GitHub and versions"],
  };

  return (
    <AnimatePresence>
      {p && p !== "assign" && p !== "room" && (
        <SidePanel key={`${p}-${ref ?? ""}`} title={meta[p][0]} sub={meta[p][1]} onClose={ui.closePanel} wide={p === "calendar" || p === "governance"}>
          {p === "dashboard" && <DashboardPanel />}
          {p === "team" && <TeamPanel initial={ref} />}
          {p === "calendar" && <CalendarPanel initial={ref} />}
          {p === "outputs" && <OutputsPanel initial={ref} />}
          {p === "conversations" && <ConversationsPanel initial={ref} />}
          {p === "memory" && <MemoryPanel initial={ref} />}
          {p === "inbox" && <InboxPanel initial={ref} />}
          {p === "governance" && <GovernancePanel initial={ref} />}
        </SidePanel>
      )}
    </AnimatePresence>
  );
}
