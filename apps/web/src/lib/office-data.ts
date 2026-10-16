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
  action: InboxAction | null;
  priority: number;
  ada_note: string | null;
}

export type InboxAction =
  | { type: "merge"; pr: number; url: string; repo: string }
  | { type: "permission"; agent: string; permission: string; detail: string; firstUse: boolean }
  | { type: "permission_request"; agent: string; permission: string; why: string }
  | { type: "meeting"; topic: string; why: string; attendees: string[]; options?: string[] };

export interface MemoryRow {
  id: string;
  layer: string;
  scope_id: string;
  type: string;
  title: string;
  body: string;
  owner: string;
  status: string;
  tags: string[];
  confidence: number | null;
  version: number;
  source: { by?: string; threadId?: string; meetingId?: string; participants?: string[] };
  updated_at: string;
}
export interface MeetingRow {
  id: string;
  title: string;
  requested_by: string;
  chair: string;
  attendees: string[];
  agenda: string[];
  pre_read: string | null;
  thread_id: string | null;
  state: string;
  created_at: string;
}
export interface AuditRow {
  id: number;
  actor: string;
  action: string;
  target: string | null;
  detail: Record<string, unknown>;
  created_at: string;
}
export interface FlagRow {
  id: string;
  item_id: string;
  reasons: string[];
  flagged_by: string[];
  state: string;
}

export interface OfficeData {
  agents: AgentRow[];
  rooms: RoomRow[];
  tasks: TaskRow[];
  threads: ThreadRow[];
  messages: MessageRow[];
  inbox: InboxRow[];
  memory: MemoryRow[];
  flags: FlagRow[];
  meetings: MeetingRow[];
  audit: AuditRow[];
  loaded: boolean;
}

const EMPTY: OfficeData = { agents: [], rooms: [], tasks: [], threads: [], messages: [], inbox: [], memory: [], flags: [], meetings: [], audit: [], loaded: false };

/** How each table is read; Realtime changes reload just that table. */
const TABLES = {
  agents: (o: string) => supabase.from("agents").select("*").eq("office_id", o).order("created_at"),
  rooms: (o: string) => supabase.from("rooms").select("*").eq("office_id", o).order("slot"),
  tasks: (o: string) => supabase.from("tasks").select("*").eq("office_id", o).order("updated_at", { ascending: false }).limit(200),
  threads: (o: string) => supabase.from("threads").select("*").eq("office_id", o).order("updated_at", { ascending: false }).limit(100),
  messages: (o: string) => supabase.from("messages").select("*").eq("office_id", o).order("created_at", { ascending: false }).limit(400),
  inbox: (o: string) => supabase.from("inbox_items").select("*").eq("office_id", o).order("created_at", { ascending: false }).limit(100),
  memory: (o: string) => supabase.from("memory_items").select("*").eq("office_id", o).order("updated_at", { ascending: false }).limit(500),
  flags: (o: string) => supabase.from("memory_flags").select("*").eq("office_id", o).eq("state", "open"),
  meetings: (o: string) => supabase.from("meetings").select("*").eq("office_id", o).order("created_at", { ascending: false }).limit(50),
  audit: (o: string) => supabase.from("audit_log").select("*").eq("office_id", o).order("created_at", { ascending: false }).limit(300),
} as const;
const REALTIME: Record<string, keyof typeof TABLES> = {
  agents: "agents",
  rooms: "rooms",
  tasks: "tasks",
  threads: "threads",
  messages: "messages",
  inbox_items: "inbox",
  memory_items: "memory",
  memory_flags: "flags",
  meetings: "meetings",
  audit_log: "audit",
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
