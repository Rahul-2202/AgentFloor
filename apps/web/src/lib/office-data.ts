"use client";

import { useEffect, useState } from "react";
import { supabase } from "./supabase";

export interface AgentRow {
  id: string;
  room_id: string;
  name: string;
  role: string;
  title: string;
  runtime: string;
  model: string;
  effort: string | null;
  status: string;
  activity: string | null;
  held_reason: string | null;
}
export interface RoomRow {
  id: string;
  name: string;
  head_id: string;
  purpose: string | null;
  slot: number | null;
}
export interface TaskRow {
  id: string;
  title: string;
  details: string;
  definition_of_done: string | null;
  room_id: string;
  owner_id: string;
  created_by: string;
  status: string;
  progress: number;
  note: string | null;
  step: string | null;
  blocker: string | null;
  checklist: { text: string; done: boolean }[];
  outputs: { kind: string; title: string; url?: string }[];
  parent_id: string | null;
  updated_at: string;
}
export interface ThreadRow {
  id: string;
  kind: string;
  topic: string;
  created_by: string;
  participants: string[];
  state: string;
  task_id: string | null;
  updated_at: string;
}
export interface MessageRow {
  id: string;
  thread_id: string;
  from: string;
  to: string;
  type: string;
  urgency: string;
  body: string;
  created_at: string;
}
export interface InboxRow {
  id: string;
  kind: string;
  from: string;
  thread_id: string | null;
  title: string;
  body: string;
  state: string;
  created_at: string;
  action: { type: "merge"; pr: number; url: string; repo: string } | null;
}

export interface OfficeData {
  agents: AgentRow[];
  rooms: RoomRow[];
  tasks: TaskRow[];
  threads: ThreadRow[];
  messages: MessageRow[];
  inbox: InboxRow[];
  loaded: boolean;
}

const EMPTY: OfficeData = { agents: [], rooms: [], tasks: [], threads: [], messages: [], inbox: [], loaded: false };

/** How each table is read; Realtime changes reload just that table. */
const TABLES = {
  agents: (o: string) => supabase.from("agents").select("*").eq("office_id", o).order("created_at"),
  rooms: (o: string) => supabase.from("rooms").select("*").eq("office_id", o).order("slot"),
  tasks: (o: string) => supabase.from("tasks").select("*").eq("office_id", o).order("updated_at", { ascending: false }).limit(200),
  threads: (o: string) => supabase.from("threads").select("*").eq("office_id", o).order("updated_at", { ascending: false }).limit(100),
  messages: (o: string) => supabase.from("messages").select("*").eq("office_id", o).order("created_at", { ascending: false }).limit(400),
  inbox: (o: string) => supabase.from("inbox_items").select("*").eq("office_id", o).order("created_at", { ascending: false }).limit(100),
} as const;
const REALTIME: Record<string, keyof typeof TABLES> = {
  agents: "agents",
  rooms: "rooms",
  tasks: "tasks",
  threads: "threads",
  messages: "messages",
  inbox_items: "inbox",
};

/**
 * The office's rows (read under row-level security), kept current with
 * Supabase Realtime. The browser only reads; actions go to the Control API.
 */
export function useOfficeData(officeId: string): OfficeData {
  const [data, setData] = useState<OfficeData>(EMPTY);

  useEffect(() => {
    let cancelled = false;
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const load = async (key: keyof typeof TABLES) => {
      const { data: rows } = await TABLES[key](officeId);
      if (!cancelled && rows) setData((d) => ({ ...d, [key]: rows }));
    };
    // Bursts of changes (an agent's turn) reload a table once.
    const reload = (key: keyof typeof TABLES) => {
      clearTimeout(timers.get(key));
      timers.set(key, setTimeout(() => void load(key), 150));
    };
    void Promise.all((Object.keys(TABLES) as (keyof typeof TABLES)[]).map(load)).then(() => !cancelled && setData((d) => ({ ...d, loaded: true })));

    const channel = supabase.channel(`office-${officeId}`);
    for (const [table, key] of Object.entries(REALTIME)) {
      channel.on("postgres_changes", { event: "*", schema: "public", table, filter: `office_id=eq.${officeId}` }, () => reload(key));
    }
    channel.subscribe();
    return () => {
      cancelled = true;
      for (const t of timers.values()) clearTimeout(t);
      void supabase.removeChannel(channel);
    };
  }, [officeId]);

  return data;
}
