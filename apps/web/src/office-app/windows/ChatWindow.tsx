"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { CAST } from "@/office/layout";
import { useSim } from "@/sim/store";
import type { ChatCard, ChatMsg } from "@/sim/types";
import { ADA_SUGGESTIONS } from "../cards/AdaCard";
import { Btn, Face, Segmented, StateChip, Window } from "../bits";
import { useUI } from "../ui";
import { nameOf } from "../who";

const AGENT_CHIPS = ["What are you working on?", "Anything blocking you?", "What's next after this?"];

function CardView({ card }: { card: ChatCard }) {
  const { s, act } = useSim();
  const ui = useUI();
  const [busy, setBusy] = useState(false);
  if (card.kind === "task") {
    const t = s.tasks.find((x) => x.id === card.taskId);
    if (!t) return null;
    return (
      <button onClick={() => ui.openWin({ kind: "task", id: t.id })} className="mt-2 flex w-full items-center gap-2 rounded-[14px] bg-white p-3 text-left ring-1 ring-black/[0.08]">
        <Face id={t.owner} size={26} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] font-semibold text-ink">{t.title}</div>
          <div className="text-[11.5px] text-muted">{nameOf(t.owner)}</div>
        </div>
        <StateChip state={t.state} />
      </button>
    );
  }
  if (card.kind !== "readback") return null;
  // Ada's read-back: nothing changes until you confirm.
  return (
    <div className="mt-2 w-full rounded-[14px] bg-white p-3 ring-1 ring-black/[0.08]">
      <div className="text-[12.5px] font-semibold text-ink">{card.title}</div>
      <div className="mt-2 flex flex-col gap-1.5">
        {card.items.map((it, i) => (
          <div key={i} className="flex items-start gap-2 text-[12.5px] text-ink-2">
            <span className={`mt-[1px] grid h-4 w-4 shrink-0 place-items-center rounded-full text-[10px] font-bold text-white ${card.applied ? "bg-ok" : "bg-black/25"}`}>✓</span>
            {it}
          </div>
        ))}
      </div>
      {card.applied ? (
        <div className="mt-2.5 text-[12px] font-semibold text-[#24603a]">✓ Applied · saved as a new version</div>
      ) : card.cancelled ? (
        <div className="mt-2.5 text-[12px] font-semibold text-muted">Not applied. Nothing changed.</div>
      ) : (
        <div className="mt-3 flex gap-2">
          <Btn
            tone="dark"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await act.adaCard(card.actionId, true);
              setBusy(false);
            }}
          >
            {busy ? "Applying…" : "Confirm"}
          </Btn>
          <Btn disabled={busy} onClick={() => void act.adaCard(card.actionId, false)}>
            Cancel
          </Btn>
        </div>
      )}
    </div>
  );
}

function Bubble({ m, agent }: { m: ChatMsg; agent: string }) {
  if (m.from === "system")
    return (
      <div className="flex justify-center">
        <span className="rounded-full bg-[#f2f0ec] px-3 py-1 text-[11.5px] font-medium text-muted">{m.text}</span>
      </div>
    );
  if (!m.text && !m.card) return null;
  const mine = m.from === "you";
  return (
    <div className={`flex items-end gap-2 ${mine ? "justify-end" : ""}`}>
      {!mine && <Face id={agent} size={26} />}
      <div className={`flex max-w-[82%] flex-col ${mine ? "items-end" : "items-start"}`}>
        {m.text && <div className={`whitespace-pre-wrap rounded-[18px] px-3.5 py-2.5 text-[13.5px] leading-[1.45] ${mine ? "rounded-br-[6px] bg-ink text-white" : "rounded-bl-[6px] bg-[#f2f0ec] text-ink"}`}>{m.text}</div>}
        {m.card && <CardView card={m.card} />}
        <span className="mt-1 text-[10.5px] text-faint">{m.t}</span>
      </div>
    </div>
  );
}

export function ChatWindow({ id, mode: initialMode, tab }: { id: string; mode?: "now" | "queue"; tab?: string }) {
  const { s, act } = useSim();
  const ui = useUI();
  const isAda = id === "ada";
  const [mode, setMode] = useState<"now" | "queue">(initialMode ?? "now");
  const [text, setText] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const msgs = s.chats[id] ?? [];
  const started = useRef(false);
  const l = s.live[id];
  const last = msgs[msgs.length - 1];
  const typing = isAda ? s.adaBusy && !last?.text : last?.from === "you" && (l?.status === "thinking" || l?.status === "working");

  const send = (raw: string) => {
    const q = raw.trim();
    if (!q) return;
    setText("");
    if (isAda) void act.ada(q);
    else void act.message(id, q, mode === "now" ? "urgent" : "normal");
  };

  // Openers: a briefing, a suggested line, or (for a new office) Ada's interview.
  useEffect(() => {
    if (started.current || (isAda && !s.adaReady)) return;
    started.current = true;
    const t = setTimeout(() => {
      if (tab === "briefing") send("What needs me today?");
      else if (tab?.startsWith("say:")) send(tab.slice(4));
      else if (isAda && !s.office.onboardedAt && !msgs.length && !s.adaBusy) void act.ada("");
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.adaReady]);

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" });
  }, [msgs.length, last?.text, typing]);

  const chips = isAda ? ADA_SUGGESTIONS : AGENT_CHIPS;

  return (
    <Window
      title={isAda ? "Ada" : nameOf(id)}
      sub={isAda ? "Office manager · chief of staff" : `${CAST[id]?.role ?? ""}${l?.step ? ` · ${l.step}` : ""}`}
      icon={<Face id={id} size={34} />}
      onClose={ui.closeWin}
      width={520}
      footer={
        <div className="border-t border-black/[0.06] p-3">
          <div className="mb-2 flex flex-wrap gap-1.5">
            {chips.slice(0, isAda ? 4 : 3).map((c) => (
              <button key={c} onClick={() => send(c)} className="rounded-full bg-[#f6f5f2] px-2.5 py-1 text-[12px] font-medium text-ink-2 ring-1 ring-black/[0.05] hover:bg-[#efede8]">
                {c}
              </button>
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(text);
            }}
            className="flex items-center gap-2"
          >
            <input
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={isAda && s.adaBusy}
              placeholder={isAda ? (s.adaBusy ? "Ada is replying…" : "Ask Ada anything, or tell her what to do…") : mode === "now" ? `Message ${nameOf(id)} now…` : `Queue a message for ${nameOf(id)}…`}
              className="h-11 flex-1 rounded-full bg-[#f6f5f2] px-4 text-[13.5px] outline-none ring-1 ring-black/[0.05] focus:ring-black/20 disabled:opacity-60"
            />
            <button type="submit" disabled={isAda && s.adaBusy} className="grid h-11 w-11 place-items-center rounded-full bg-ink text-white disabled:opacity-40" aria-label="Send">
              ↑
            </button>
          </form>
        </div>
      }
    >
      <div className="flex items-center justify-between gap-2 border-b border-black/[0.05] bg-[#fbfaf8] px-4 py-2">
        {isAda ? (
          <span className="text-[12px] text-muted">Ada acts with your permissions. Any change is read back to you before it applies.</span>
        ) : (
          <>
            <Segmented
              size="sm"
              value={mode}
              onChange={setMode}
              options={[
                { v: "now", l: "Now" },
                { v: "queue", l: "Queue" },
              ]}
            />
            <span className="text-right text-[11.5px] text-muted">{mode === "now" ? "Read at its next safe point" : "Read at its next break: a finished step or task"}</span>
          </>
        )}
      </div>
      {!isAda && s.machine !== "started" && (
        <div className="border-b border-black/[0.05] bg-[#fdf3e0] px-4 py-2 text-[12px] text-[#8a5a10]">The office computer is asleep. Messages wait until you start it.</div>
      )}
      <div ref={list} className="flex h-[min(420px,50vh)] flex-col gap-3 overflow-y-auto px-4 py-4">
        {!msgs.length && (
          <div className="my-auto text-center text-[13px] text-faint">
            {isAda ? "Hi! Ask me what needs you, or tell me what to change in the office." : `Say hi, ask what ${nameOf(id)} is working on, or give them something to do. Their head is copied.`}
          </div>
        )}
        {msgs.map((m) => (
          <Bubble key={m.id} m={m} agent={id} />
        ))}
        <AnimatePresence>
          {typing && (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex items-end gap-2">
              <Face id={id} size={26} />
              <div className="flex h-9 items-center gap-1 rounded-[16px] rounded-bl-[6px] bg-[#f2f0ec] px-3">
                {[0, 1, 2].map((i) => (
                  <span key={i} className="typing-dot h-[5px] w-[5px] rounded-full bg-[#8d8b86]" style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Window>
  );
}
