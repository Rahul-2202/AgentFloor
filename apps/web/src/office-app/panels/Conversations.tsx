"use client";

import { useEffect, useState } from "react";
import { meetingMinutes } from "@/lib/api";
import { useSim } from "@/sim/store";
import type { Conversation } from "@/sim/types";
import { Btn, Empty, Face, Segmented } from "../bits";
import { nameOf } from "../who";
import { Linked } from "../real/Linked";

type Minutes = Awaited<ReturnType<typeof meetingMinutes>>["minutes"];

function Detail({ c, onBack }: { c: Conversation; onBack: () => void }) {
  const { s, act } = useSim();
  const [minutes, setMinutes] = useState<Minutes>(null);
  const [text, setText] = useState("");
  const meeting = s.data.meetings.find((m) => m.thread_id === c.id);
  const ended = meeting?.state === "ended";
  useEffect(() => {
    if (meeting && ended) void meetingMinutes(meeting.id).then((r) => setMinutes(r.minutes), () => {});
  }, [meeting, ended]);
  const send = () => {
    if (!text.trim()) return;
    void act.reply(c.id, text.trim());
    setText("");
  };
  return (
    <div className="flex flex-col gap-3">
      <button onClick={onBack} className="self-start text-[12.5px] font-semibold text-ink hover:underline">
        ← All conversations
      </button>
      <div>
        <div className="text-[16px] font-semibold text-ink">{c.title}</div>
        <div className="mt-1 flex items-center gap-2 text-[12px] text-muted">
          <span className="flex -space-x-1.5">
            {c.participants.map((p) => (
              <span key={p} className="rounded-[8px] ring-2 ring-[#f7f6f3]">
                <Face id={p} size={20} />
              </span>
            ))}
          </span>
          {c.at}
        </div>
      </div>
      {minutes && (
        <div className="rounded-[16px] bg-white p-3.5 ring-1 ring-black/[0.06]">
          <div className="text-[10.5px] font-bold uppercase tracking-wide text-faint">Minutes</div>
          <div className="mt-1 text-[13px] leading-snug text-ink-2">{minutes.summary}</div>
          {minutes.decisions.map((x, i) => (
            <div key={i} className="mt-2">
              <div className="text-[13.5px] font-semibold text-ink">{x.text}</div>
              {x.rationale && <div className="text-[12px] text-muted">Why: {x.rationale}</div>}
            </div>
          ))}
          {minutes.actionItems.length > 0 && (
            <div className="mt-2 flex flex-col gap-1">
              {minutes.actionItems.map((a, i) => (
                <div key={i} className="flex items-center gap-2 text-[12.5px] text-ink-2">
                  <Face id={a.owner} size={16} /> {a.text} <span className="text-faint">· {a.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {(
        <div className="flex flex-col gap-3 rounded-[16px] bg-white p-3.5 ring-1 ring-black/[0.06]">
          <div className="text-[10.5px] font-bold uppercase tracking-wide text-faint">Transcript</div>
          {c.messages.map((m, i) => (
            <div key={i} className="flex gap-2.5">
              <Face id={m.who} size={26} />
              <div>
                <div className="text-[12px]">
                  <span className="font-semibold text-ink">{nameOf(m.who)}</span> <span className="text-faint">{m.t}</span>
                </div>
                <div className="whitespace-pre-wrap text-[13px] leading-snug text-ink-2"><Linked text={m.text} who={m.who} /></div>
                {m.sending && <div className="text-[11px] text-faint">Sending…</div>}
                {m.failed && <div className="text-[11px] text-bad">Not sent: {m.failed}</div>}
              </div>
            </div>
          ))}
          {!c.messages.length && <div className="text-[12.5px] text-muted">No messages yet.</div>}
        </div>
      )}
      {!ended && (
        <div className="flex gap-1.5">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder="Reply in this thread"
            className="min-w-0 flex-1 rounded-full bg-white px-3.5 py-2 text-[13px] outline-none ring-1 ring-black/[0.08] focus:ring-black/20"
          />
          <Btn tone="dark" onClick={send}>
            Send
          </Btn>
        </div>
      )}
    </div>
  );
}

export function ConversationsPanel({ initial }: { initial?: string }) {
  const { s } = useSim();
  const withWho = initial?.startsWith("with:") ? initial.slice(5) : null;
  const [tab, setTab] = useState<"meetings" | "channels" | "dms">(initial === "meetings" ? "meetings" : withWho || !s.conversations.some((c) => c.kind === "meeting") ? "dms" : "meetings");
  const [open, setOpen] = useState<string | null>(initial && s.conversations.some((c) => c.id === initial) ? initial : null);
  const conv = s.conversations.find((c) => c.id === open);
  if (conv) return <Detail c={conv} onBack={() => setOpen(null)} />;

  const list = s.conversations
    .filter((c) => (tab === "meetings" ? c.kind === "meeting" : tab === "channels" ? c.kind === "channel" || c.kind === "cross" : c.kind === "dm"))
    .filter((c) => !withWho || c.participants.includes(withWho));

  return (
    <div className="flex flex-col gap-4">
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { v: "meetings", l: "Meetings" },
          { v: "channels", l: "Across rooms" },
          { v: "dms", l: "Direct" },
        ]}
      />
      {withWho && <div className="text-[12.5px] text-muted">Showing conversations with {nameOf(withWho)}</div>}
      {list.length ? (
        <div className="flex flex-col gap-2">
          {list.map((c) => (
            <button key={c.id} onClick={() => setOpen(c.id)} className="rounded-[16px] bg-white p-3 text-left ring-1 ring-black/[0.06] hover:ring-black/15">
              <div className="flex items-center gap-2">
                <span className="flex -space-x-1.5">
                  {c.participants.slice(0, 4).map((p) => (
                    <span key={p} className="rounded-[8px] ring-2 ring-white">
                      <Face id={p} size={22} />
                    </span>
                  ))}
                </span>
                <span className="flex-1 truncate text-[13.5px] font-semibold text-ink">{c.title}</span>
                {c.voice && <span className="rounded-full bg-[#f1eefd] px-1.5 text-[10.5px] font-bold text-[#4a3fa8]">voice</span>}
                <span className="text-[11px] text-faint">{c.at}</span>
              </div>
              <div className="mt-1.5 truncate text-[12.5px] text-muted">
                {`${nameOf(c.messages[c.messages.length - 1]?.who ?? "")}: ${c.messages[c.messages.length - 1]?.text ?? ""}`}
              </div>
            </button>
          ))}
        </div>
      ) : (
        <Empty>No conversations yet.</Empty>
      )}
    </div>
  );
}
