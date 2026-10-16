"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { LogoMark } from "@/components/Logo";
import { Office } from "@/office/Office";
import type { AgentScene, RoomId, RoomState, Scene } from "@/office/types";
import { Face } from "@/office-app/bits";
import { GitHubCard } from "@/office-app/real/GitHubCard";
import { SLOTS } from "@/sim/real";
import { useSim } from "@/sim/store";
import type { ChatCard, ChatMsg } from "@/sim/types";

/** The interview, as Ada runs it (see the API's onboarding prompt). */
const STEPS = ["Meet Ada", "Your company", "Rooms and agents", "Rules", "Budget", "Read-back", "Opening the office"];

function ReadbackCard({ card }: { card: Extract<ChatCard, { kind: "readback" }> }) {
  const { act } = useSim();
  const [busy, setBusy] = useState(false);
  return (
    <div className="mt-2 w-full rounded-[16px] bg-white p-3.5 ring-1 ring-black/[0.08]">
      <div className="text-[13px] font-semibold text-ink">{card.title}</div>
      <div className="mt-2 flex flex-col gap-1.5">
        {card.items.map((it, i) => (
          <motion.div key={i} initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.08 }} className="flex items-start gap-2 text-[12.5px] text-ink-2">
            <span className={`mt-[1px] grid h-4 w-4 shrink-0 place-items-center rounded-full text-[10px] font-bold text-white ${card.applied ? "bg-ok" : "bg-black/25"}`}>✓</span>
            {it}
          </motion.div>
        ))}
      </div>
      {card.applied ? (
        <div className="mt-2.5 text-[12px] font-semibold text-[#24603a]">✓ Applied. Your office is building itself.</div>
      ) : card.cancelled ? (
        <div className="mt-2.5 text-[12px] font-semibold text-muted">Not applied. Tell Ada what to change.</div>
      ) : (
        <div className="mt-3 flex gap-2">
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await act.adaCard(card.actionId, true);
              setBusy(false);
            }}
            className="rounded-full bg-ink px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-40"
          >
            {busy ? "Building…" : "Confirm and apply"}
          </button>
          <button disabled={busy} onClick={() => void act.adaCard(card.actionId, false)} className="rounded-full px-3 py-2 text-[13px] font-semibold text-muted hover:text-ink">
            Change something
          </button>
        </div>
      )}
    </div>
  );
}

function Line({ m }: { m: ChatMsg }) {
  if (!m.text && !m.card) return null;
  const mine = m.from === "you";
  return (
    <div className={`flex items-end gap-2 ${mine ? "justify-end" : ""}`}>
      {!mine && <Face id="ada" size={26} />}
      <div className={`flex max-w-[88%] flex-col ${mine ? "items-end" : "items-start"}`}>
        {m.text && (
          <div className={`whitespace-pre-wrap rounded-[18px] px-3.5 py-2.5 text-[14px] leading-[1.45] ${mine ? "rounded-br-[6px] bg-ink text-white" : "rounded-bl-[6px] bg-white text-ink ring-1 ring-black/[0.06]"}`}>{m.text}</div>
        )}
        {m.card?.kind === "readback" && <ReadbackCard card={m.card} />}
      </div>
    </div>
  );
}

/**
 * A new office: Ada's onboarding interview on the left, the office on the
 * right. The floor shows empty plots until the CEO confirms Ada's read-back;
 * then the rooms build and the agents walk in.
 */
export function Onboarding({ onDone }: { onDone: () => void }) {
  const { s, act } = useSim();
  const [text, setText] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const started = useRef(false);
  const msgs = s.chats.ada ?? [];
  const last = msgs[msgs.length - 1];
  const built = Object.keys(s.rooms).length > 0;
  const cards = msgs.flatMap((m) => (m.card?.kind === "readback" ? [m.card] : []));
  const applied = cards.some((c) => c.applied) || (built && !!s.office.onboardedAt);
  const pendingCard = cards.some((c) => !c.applied && !c.cancelled);
  const answers = msgs.filter((m) => m.from === "you").length;
  const step = applied ? 6 : pendingCard ? 5 : Math.min(4, answers);

  // Ada opens the interview (once her past messages have loaded).
  useEffect(() => {
    if (started.current || !s.adaReady) return;
    started.current = true;
    if (!msgs.length) void act.ada("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.adaReady]);

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" });
  }, [msgs.length, last?.text, last?.card]);

  const send = () => {
    const q = text.trim();
    if (!q || s.adaBusy) return;
    setText("");
    void act.ada(q);
  };

  // The floor: plots until the setup is applied, then the real rooms and agents.
  const sc = useMemo<Scene>(() => {
    const rooms: Partial<Record<RoomId, RoomState>> = { ceo: "built", meeting: built ? "built" : "blueprint" };
    for (const slot of SLOTS) rooms[slot] = s.rooms[slot] ? "built" : step >= 2 && !built ? "ghost" : "blueprint";
    const agents: Record<string, AgentScene> = {
      you: { at: "seat:you" },
      ada: { at: "ada:home", bubble: s.adaBusy ? { text: "…", tone: "ada" } : { text: ["Hi! I'm Ada.", "Tell me about the company.", "Let's plan the rooms.", "Now the rules.", "And a budget.", "Here's the read-back.", "Your office is open."][step], tone: "ada" } },
    };
    Object.entries(s.live)
      .filter(([id]) => id !== "ada" && id !== "you")
      .forEach(([id, l], i) => (agents[id] = { at: l.at, status: "idle", from: "ceo:outside", delay: 0.6 + i * 0.4, speed: 1.4 }));
    return { rooms, agents, camera: built ? undefined : step >= 2 ? undefined : "ceo", labels: true };
  }, [s.rooms, s.live, s.adaBusy, step, built]);

  return (
    <div className="fixed inset-0 overflow-hidden bg-[#e9e3d8]">
      <div className="absolute inset-0 lg:left-[440px]">
        <Office scene={sc} rounded={false} />
      </div>

      <div className="absolute left-3 top-3 z-20 flex items-center gap-2 rounded-full bg-white/95 py-1.5 pl-1.5 pr-3 shadow-[var(--shadow-card)] ring-1 ring-black/[0.06] lg:left-[456px]">
        <LogoMark size={26} />
        <span className="text-[13px] font-semibold text-ink">Set up your office</span>
      </div>
      {built && (
        <button onClick={onDone} className="absolute right-3 top-3 z-20 rounded-full bg-white/95 px-3.5 py-2 text-[12.5px] font-semibold text-ink-2 shadow-[var(--shadow-card)] ring-1 ring-black/[0.06] hover:text-ink">
          Skip to the office →
        </button>
      )}

      <div className="absolute inset-x-3 bottom-3 z-30 flex max-h-[62vh] flex-col overflow-hidden rounded-[26px] bg-[#f7f6f3] shadow-[var(--shadow-float)] ring-1 ring-black/[0.06] lg:inset-y-3 lg:left-3 lg:right-auto lg:max-h-none lg:w-[424px]">
        <div className="flex items-center gap-3 border-b border-black/[0.06] bg-white px-4 py-3">
          <Face id="ada" size={36} />
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold text-ink">Ada</div>
            <div className="text-[11.5px] text-muted">
              Step {step + 1} of {STEPS.length} · {STEPS[step]}
            </div>
          </div>
        </div>
        <div className="h-1 w-full bg-black/[0.05]">
          <motion.div className="h-full bg-accent" animate={{ width: `${((step + 1) / STEPS.length) * 100}%` }} transition={{ type: "spring", stiffness: 160, damping: 26 }} />
        </div>

        <div ref={list} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
          {!msgs.length && <div className="m-auto text-[13px] text-faint">Ada is on her way…</div>}
          {msgs.map((m) => (
            <Line key={m.id} m={m} />
          ))}
          <AnimatePresence>
            {s.adaBusy && !last?.text && (
              <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex items-end gap-2">
                <Face id="ada" size={26} />
                <div className="flex h-9 items-center gap-1 rounded-[16px] rounded-bl-[6px] bg-white px-3 ring-1 ring-black/[0.06]">
                  {[0, 1, 2].map((i) => (
                    <span key={i} className="typing-dot h-[5px] w-[5px] rounded-full bg-[#8d8b86]" style={{ animationDelay: `${i * 0.15}s` }} />
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          {applied && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-2">
              <div className="text-[12px] font-semibold text-muted">So agents can work on code, connect a repo:</div>
              <GitHubCard />
            </motion.div>
          )}
        </div>

        <div className="border-t border-black/[0.06] bg-white px-3 py-3">
          {applied ? (
            <button onClick={onDone} className="w-full rounded-full bg-ink px-5 py-2.5 text-[13.5px] font-semibold text-white">
              Walk into your office →
            </button>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}
              className="flex items-center gap-2"
            >
              <input
                autoFocus
                value={text}
                onChange={(e) => setText(e.target.value)}
                disabled={s.adaBusy}
                placeholder={s.adaBusy ? "Ada is replying…" : "Answer Ada…"}
                className="h-11 flex-1 rounded-full bg-[#f6f5f2] px-4 text-[14px] outline-none ring-1 ring-black/[0.05] focus:ring-black/20 disabled:opacity-60"
              />
              <button type="submit" disabled={s.adaBusy || !text.trim()} className="grid h-11 w-11 place-items-center rounded-full bg-ink text-white disabled:opacity-40" aria-label="Send">
                ↑
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
