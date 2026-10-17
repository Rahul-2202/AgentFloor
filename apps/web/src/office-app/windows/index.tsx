"use client";

import { AnimatePresence, motion } from "motion/react";
import type { RoomKey } from "@/sim/types";
import { useUI } from "../ui";
import { AssignWindow } from "./AssignWindow";
import { ChatWindow } from "./ChatWindow";
import { ConfigWindow } from "./ConfigWindow";
import { FilesWindow } from "./FilesWindow";
import { LiveMeeting, MeetingPlanner } from "./MeetingWindow";
import { MemoryWindow } from "./MemoryWindow";
import { OutputWindow } from "./OutputWindow";
import { RoomWindow } from "./RoomWindow";
import { TaskWindow } from "./TaskWindow";
import { TerminalWindow } from "./TerminalWindow";

export function WindowRouter() {
  const ui = useUI();
  const w = ui.win;
  const live = w?.kind === "meeting" && w.id && !w.id.startsWith("new:");
  const key = w ? `${w.kind}-${w.id ?? ""}-${w.tab ?? ""}` : "none";

  const body = !w ? null : w.kind === "chat" ? (
    <ChatWindow id={w.id ?? "ada"} mode={w.mode} tab={w.tab} />
  ) : w.kind === "terminal" ? (
    <TerminalWindow id={w.id!} />
  ) : w.kind === "files" ? (
    <FilesWindow id={w.id!} />
  ) : w.kind === "memory" ? (
    <MemoryWindow id={w.id!} />
  ) : w.kind === "config" ? (
    <ConfigWindow id={w.id!} />
  ) : w.kind === "assign" ? (
    <AssignWindow agent={w.id} />
  ) : w.kind === "task" ? (
    <TaskWindow id={w.id!} />
  ) : w.kind === "output" ? (
    <OutputWindow id={w.id!} />
  ) : w.kind === "room" ? (
    <RoomWindow id={(w.id as RoomKey) ?? "dev"} tab={w.tab} />
  ) : w.kind === "meeting" ? (
    live ? <LiveMeeting id={w.id!} /> : <MeetingPlanner from={w.id?.slice(4) ?? "ada"} />
  ) : null;

  return (
    <AnimatePresence>
      {w &&
        (live ? (
          <motion.div key={key} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="pointer-events-none absolute bottom-3 right-3 top-[68px] z-[55] flex items-start">
            {body}
          </motion.div>
        ) : (
          <motion.div
            key={key}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-[60] grid place-items-center bg-black/20 p-3 backdrop-blur-[2px]"
            onClick={ui.closeWin}
          >
            {body}
          </motion.div>
        ))}
    </AnimatePresence>
  );
}
