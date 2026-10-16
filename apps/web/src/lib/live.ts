"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";

export interface OutputLine {
  at: number;
  kind: string;
  text: string;
}

/**
 * The live connection to the office (through the Control API): agents'
 * session output and "thinking" as they happen, and taking over an agent's
 * terminal.
 */
export function useLive(enabled: boolean) {
  const [lines, setLines] = useState<Record<string, OutputLine[]>>({});
  const [activity, setActivity] = useState<Record<string, string | null>>({});
  const [terminal, setTerminal] = useState<{ agent: string; text: string; closed?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ws = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let retry: ReturnType<typeof setTimeout>;
    const connect = async () => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token || stopped) return;
      const socket = new WebSocket(`${process.env.NEXT_PUBLIC_API_URL!.replace(/^http/, "ws")}/office/live`);
      ws.current = socket;
      socket.onopen = () => socket.send(JSON.stringify({ t: "auth", token }));
      socket.onmessage = (e) => {
        const msg = JSON.parse(String(e.data));
        if (msg.t === "live") {
          const ev = msg.event;
          if (ev.type === "agent.output") {
            setLines((all) => ({ ...all, [ev.data.agent]: [...(all[ev.data.agent] ?? []), ev.data].slice(-400) }));
          } else if (ev.type === "agent.activity") {
            setActivity((a) => ({ ...a, [ev.data.agent]: ev.data.activity }));
          }
        } else if (msg.t === "terminal") {
          setTerminal((t) => (t ? { ...t, text: (t.text + msg.data).slice(-60_000) } : t));
        } else if (msg.t === "terminal_closed") {
          setTerminal((t) => (t ? { ...t, closed: msg.reason } : t));
        } else if (msg.t === "error") {
          setError(msg.message);
        }
      };
      socket.onclose = () => {
        if (!stopped) retry = setTimeout(connect, 3000);
      };
    };
    void connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      ws.current?.close();
    };
  }, [enabled]);

  const send = useCallback((msg: object) => ws.current?.readyState === WebSocket.OPEN && ws.current.send(JSON.stringify(msg)), []);
  return {
    lines,
    activity,
    terminal,
    error,
    clearError: () => setError(null),
    takeOver: (agent: string) => {
      setTerminal({ agent, text: "" });
      send({ t: "takeover", agent, cols: 100, rows: 30 });
    },
    input: (data: string) => send({ t: "input", data }),
    handBack: () => {
      send({ t: "handback" });
      setTerminal(null);
    },
  };
}
