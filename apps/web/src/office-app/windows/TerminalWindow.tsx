"use client";

import { useEffect, useRef, useState } from "react";
import { officeCall } from "@/lib/api";
import type { OutputLine } from "@/lib/live";
import { useSim } from "@/sim/store";
import { Face, Window } from "../bits";
import { useUI } from "../ui";
import { nameOf } from "../who";

function Line({ l }: { l: OutputLine }) {
  switch (l.kind) {
    case "input":
      return (
        <div className="mt-2 flex gap-2 rounded-[8px] bg-white/[0.06] px-2 py-1.5">
          <span className="text-[#f0a37a]">›</span>
          <span className="whitespace-pre-wrap font-semibold text-white">{l.text}</span>
        </div>
      );
    case "tool": {
      const [verb, ...rest] = l.text.split(" ");
      return (
        <div className="whitespace-pre-wrap">
          <span className="text-[#6fe39a]">⏺</span> <span className="font-semibold text-[#9ec5ff]">{verb}</span> <span className="text-white/80">{rest.join(" ")}</span>
        </div>
      );
    }
    case "result":
      return <div className="whitespace-pre-wrap text-white/45">⎿ {l.text}</div>;
    case "error":
      return <div className="whitespace-pre-wrap text-[#ff8a80]">{l.text}</div>;
    case "info":
      return <div className="whitespace-pre-wrap text-white/35">— {l.text}</div>;
    default:
      return <div className="whitespace-pre-wrap text-white/85">{l.text}</div>;
  }
}

export function TerminalWindow({ id }: { id: string }) {
  const { s, act, live } = useSim();
  const ui = useUI();
  const cfg = s.configs[id];
  const l = s.live[id];
  const lines = live.lines[id] ?? [];
  const mine = live.terminal?.agent === id;
  const [keys, setKeys] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const working = l?.status === "working" || l?.status === "thinking";

  // The live stream has only what happened since the page loaded; the office keeps the recent past.
  useEffect(() => {
    officeCall<OutputLine[]>("agent_output", { agent: id }).then((earlier) => live.seed(id, earlier), () => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight, behavior: "smooth" });
  }, [lines.length, live.terminal?.text]);

  const spent = s.configs[id]?.spent ?? 0;

  return (
    <Window
      dark
      width={720}
      onClose={ui.closeWin}
      icon={<Face id={id} size={30} />}
      title={`${nameOf(id)} · ${mine ? "your terminal" : "live session"}`}
      sub={`${cfg?.runtime ?? "Claude Code"} · ${cfg?.model ?? ""}${l?.step ? ` · ${l.step}` : ""}`}
      footer={
        <div className="flex items-center justify-between gap-2 border-t border-white/10 px-4 py-2.5 text-[11.5px] text-white/50">
          <span className="flex items-center gap-1.5">
            <span className={`h-1.5 w-1.5 rounded-full ${working ? "bg-[#6fe39a]" : "bg-white/40"}`} style={working ? { animation: "led 1.4s steps(2) infinite" } : undefined} />
            {mine ? `${nameOf(id)} is paused while you drive` : working ? "Streaming" : l?.paused ? "On hold" : "Waiting for work"}
          </span>
          <span>${spent.toFixed(2)} today</span>
          <span className="flex gap-1.5">
            {mine ? (
              <button onClick={live.handBack} className="rounded-full bg-[#f0a37a] px-3 py-1 font-semibold text-[#1d1d1f] hover:brightness-110">
                Hand back
              </button>
            ) : (
              <>
                <button onClick={() => ui.openWin({ kind: "chat", id, mode: "now" })} className="rounded-full bg-white/10 px-3 py-1 font-semibold text-white hover:bg-white/20">
                  Message
                </button>
                <button onClick={() => ui.openWin({ kind: "files", id })} className="rounded-full bg-white/10 px-3 py-1 font-semibold text-white hover:bg-white/20">
                  Files
                </button>
                <button
                  disabled={s.machine !== "started"}
                  onClick={() => live.takeOver(id)}
                  title="Pauses the agent and gives you its terminal until you hand back"
                  className="rounded-full bg-white/10 px-3 py-1 font-semibold text-white hover:bg-white/20 disabled:opacity-40"
                >
                  Take over
                </button>
              </>
            )}
          </span>
        </div>
      }
    >
      <div className="border-b border-white/10 px-4 py-3 font-mono text-[12px]">
        <div className="inline-flex items-center gap-2 rounded-[8px] border border-[#f0a37a]/50 px-2.5 py-1 text-[#f0a37a]">✻ Claude Code · {nameOf(id)}</div>
        <span className="ml-3 text-white/40">its CLAUDE.md is rebuilt from memory every turn</span>
      </div>
      {l?.paused && !mine && (
        <div className="flex items-center justify-between gap-3 border-b border-white/10 bg-[#f0a37a]/10 px-4 py-2 text-[12px] text-[#f0a37a]">
          <span>{l.step ?? "On hold"}</span>
          <button onClick={() => void act.release(id)} className="rounded-full bg-[#f0a37a] px-3 py-1 font-semibold text-[#1d1d1f]">
            {l.step?.includes("took over") ? "Hand back" : "Let them carry on"}
          </button>
        </div>
      )}
      {live.error && (
        <div className="border-b border-white/10 bg-[#ff8a80]/10 px-4 py-2 text-[12px] text-[#ff8a80]" onClick={live.clearError}>
          {live.error}
        </div>
      )}
      <div ref={box} className="h-[min(440px,55vh)] overflow-y-auto px-4 py-3 font-mono text-[12.5px] leading-[1.7]">
        {mine ? (
          <>
            <pre className="whitespace-pre-wrap text-white">{live.terminal!.text || "Connecting…"}</pre>
            {live.terminal!.closed && <div className="mt-2 text-white/40">— closed: {live.terminal!.closed}</div>}
          </>
        ) : lines.length ? (
          lines.map((x, i) => <Line key={`${x.at}-${i}`} l={x} />)
        ) : (
          <div className="text-white/40">{s.machine === "started" ? "Nothing yet. Lines appear here while the agent works." : "The office computer is asleep. Start it to see agents work."}</div>
        )}
        {working && !mine && <span className="inline-block h-4 w-2 translate-y-0.5 bg-white/70" style={{ animation: "led 1s steps(2) infinite" }} />}
      </div>
      {mine && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            live.input(`${keys}\n`);
            setKeys("");
          }}
          className="border-t border-white/10 px-4 py-2.5"
        >
          <input
            autoFocus
            value={keys}
            onChange={(e) => setKeys(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "c" && e.ctrlKey) {
                e.preventDefault();
                live.input("\u0003");
              }
            }}
            placeholder="Type a command and press Enter (Ctrl+C to interrupt)"
            className="w-full rounded-[10px] bg-white/[0.06] px-3 py-2 font-mono text-[12.5px] text-white outline-none ring-1 ring-white/10 focus:ring-white/25"
          />
        </form>
      )}
    </Window>
  );
}
