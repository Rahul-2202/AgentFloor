"use client";

/**
 * The pixel office's store, on the office's real data.
 *
 * Same shape as the demo's (`useSim() → { s, d }`), so its screens port with
 * little change: `s` is built from Supabase (kept live by Realtime) plus the
 * office's live stream; `d` takes the demo's actions. Cosmetic ones (speech
 * bubbles, toasts, a card's open state) stay in the browser; ones that change
 * the office go to the Control API, and Realtime brings the result back.
 * `act` holds the real actions by name.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import {
  adaChat,
  answerPermission,
  claudeStatus,
  setClaudeToken,
  type ClaudeStatus,
  applySetup,
  ApiError,
  confirmAdaCard,
  dismissAdaCard,
  endMeeting,
  getSetup,
  getSpend,
  mergePr,
  officeCall,
  pauseOffice,
  proposeSetup,
  releaseAgent,
  requestChanges,
  resolveInbox,
  scheduleMeeting,
  setupVersions,
  startMeeting,
  startOffice,
  type Office,
  type OfficeSetupView,
} from "@/lib/api";
import { useLive } from "@/lib/live";
import { useOfficeData, type OfficeData } from "@/lib/office-data";
import { supabase } from "@/lib/supabase";
import { syncCast } from "@/office-app/who";
import { buildState, layoutOf, time, type Layout, type RealInputs } from "./real";
import type { AgentConfig, AgentLive, CalEvent, ChatMsg, Conversation, InboxItem, LockedRule, MemItem, Output, Pending, RoomConfig, RoomKey, Task, Toast, Version } from "./types";

export interface SimState {
  officeId: string;
  office: Office;
  /** Everything has loaded once. */
  loaded: boolean;
  /** The office computer: none, creating, starting, started, stopped, error… */
  machine: string;
  setup: OfficeSetupView | null;
  setupVersion: number;
  layout: Layout;
  /** The office's rows, as read. */
  data: OfficeData;

  live: Record<string, AgentLive>;
  configs: Record<string, AgentConfig>;
  rooms: Record<RoomKey, RoomConfig>;
  locked: LockedRule[];
  tasks: Task[];
  outputs: Output[];
  calendar: CalEvent[];
  conversations: Conversation[];
  memory: MemItem[];
  inbox: InboxItem[];
  versions: Version[];
  chats: Record<string, ChatMsg[]>;
  spend: { today: number; budget: number };

  toasts: Toast[];
  pending: Pending | null;
  /** Ada is replying. */
  adaBusy: boolean;
  /** Ada's past conversation has loaded. */
  adaReady: boolean;
  /** The office's own Claude login (null until checked). */
  claude: ClaudeStatus | null;
  /** The "add your Claude token" window is open. */
  askClaude: boolean;
  /** Always the CEO in v1. */
  me: "you";
  /** Now, refreshed every half minute (for "x minutes ago" and the clock). */
  now: number;
}

export type Action =
  | { type: "live"; id: string; patch: Partial<AgentLive> }
  | { type: "task"; id: string; patch: Partial<Task> }
  | { type: "output"; id: string; patch: Partial<Output> }
  | { type: "event"; id: string; patch: Partial<CalEvent> }
  | { type: "inbox"; id: string; patch: Partial<InboxItem> }
  | { type: "memory"; id: string; patch: Partial<MemItem> }
  | { type: "toast"; toast: Toast }
  | { type: "dismissToast"; id: string }
  | { type: "chat"; agent: string; msg: ChatMsg }
  | { type: "chatPatch"; agent: string; id: string; patch: Partial<ChatMsg> }
  | { type: "propose"; pending: Pending }
  | { type: "cancelPending" }
  /** Confirms the pending read-back: applies it to the office. */
  | { type: "applyPending" }
  /** Asks for a read-back of going back to an earlier setup version. */
  | { type: "rollback"; v: number };

/* ----------------------------------------------------------- local overlay */

type PatchKind = "task" | "output" | "event" | "inbox" | "memory";
interface Overlay {
  live: Record<string, Partial<AgentLive>>;
  patches: Record<PatchKind, Record<string, object>>;
  toasts: Toast[];
  pending: Pending | null;
  /** Ada's chat (seeded from the database) and messages to agents still on their way. */
  chats: Record<string, ChatMsg[]>;
  /** What you said in threads, shown until the office has it. */
  echoes: Record<string, { id: string; text: string; at: number; failed?: string }[]>;
  adaBusy: boolean;
  adaReady: boolean;
}
type Local =
  | Action
  | { type: "clearPatches"; kind: PatchKind }
  | { type: "adaSeed"; msgs: ChatMsg[] }
  | { type: "adaBusy"; on: boolean }
  | { type: "echo"; thread: string; echo: { id: string; text: string; at: number } }
  | { type: "echoFailed"; thread: string; id: string; why: string };

const EMPTY_OVERLAY: Overlay = { live: {}, patches: { task: {}, output: {}, event: {}, inbox: {}, memory: {} }, toasts: [], pending: null, chats: {}, echoes: {}, adaBusy: false, adaReady: false };

function overlay(o: Overlay, a: Local): Overlay {
  switch (a.type) {
    case "live": {
      // An undefined value removes the override (the agent goes back to where the office puts it).
      const cur: Record<string, unknown> = { ...o.live[a.id], ...a.patch };
      for (const k of Object.keys(cur)) if (cur[k] === undefined) delete cur[k];
      return { ...o, live: { ...o.live, [a.id]: cur as Partial<AgentLive> } };
    }
    case "task":
    case "output":
    case "event":
    case "inbox":
    case "memory":
      return { ...o, patches: { ...o.patches, [a.type]: { ...o.patches[a.type], [a.id]: { ...o.patches[a.type][a.id], ...a.patch } } } };
    case "clearPatches":
      return Object.keys(o.patches[a.kind]).length ? { ...o, patches: { ...o.patches, [a.kind]: {} } } : o;
    case "toast":
      return { ...o, toasts: [...o.toasts.filter((t) => t.id !== a.toast.id), a.toast].slice(-4) };
    case "dismissToast":
      return { ...o, toasts: o.toasts.filter((t) => t.id !== a.id) };
    case "chat":
      return { ...o, chats: { ...o.chats, [a.agent]: [...(o.chats[a.agent] ?? []), a.msg] } };
    case "chatPatch":
      return { ...o, chats: { ...o.chats, [a.agent]: (o.chats[a.agent] ?? []).map((m) => (m.id === a.id ? { ...m, ...a.patch } : m)) } };
    case "adaSeed":
      return { ...o, adaReady: true, chats: { ...o.chats, ada: [...a.msgs, ...(o.chats.ada ?? [])] } };
    case "adaBusy":
      return { ...o, adaBusy: a.on };
    case "echo":
      return { ...o, echoes: { ...o.echoes, [a.thread]: [...(o.echoes[a.thread] ?? []), a.echo] } };
    case "echoFailed":
      return { ...o, echoes: { ...o.echoes, [a.thread]: (o.echoes[a.thread] ?? []).map((e) => (e.id === a.id ? { ...e, failed: a.why } : e)) } };
    case "propose":
      return { ...o, pending: a.pending };
    case "cancelPending":
      return { ...o, pending: null };
    case "applyPending":
    case "rollback":
      return o; // handled by the provider (they call the office)
  }
}

const patched = <T extends { id: string }>(xs: T[], p: Record<string, object>) => (Object.keys(p).length ? xs.map((x) => (p[x.id] ? { ...x, ...p[x.id] } : x)) : xs);

/* ------------------------------------------------------------------ store */

export interface Acts {
  /** Proposes a setup change: shows its read-back for the CEO to confirm. */
  change: (ops: object[], summary?: string) => Promise<void>;
  /** Applies the pending read-back; resolves to the new setup version (null if it failed). */
  apply: () => Promise<number | null>;
  assign: (to: string, title: string, details?: string, doneMeans?: string) => Promise<boolean>;
  /** "urgent" is read at the agent's next safe point; "normal" queues for its next break. */
  message: (to: string, text: string, urgency?: "normal" | "urgent") => Promise<boolean>;
  reply: (threadId: string, text: string, resolves?: boolean) => Promise<boolean>;
  resolve: (inboxId: string) => Promise<boolean>;
  permission: (inboxId: string, allow: boolean, note?: string) => Promise<boolean>;
  merge: (pr: number, inboxId?: string) => Promise<boolean>;
  changes: (pr: number, comment: string, inboxId?: string) => Promise<boolean>;
  hold: (agent: string, reason: string) => Promise<boolean>;
  release: (agent: string) => Promise<boolean>;
  ada: (text: string) => Promise<void>;
  adaCard: (cardId: string, confirm: boolean) => Promise<void>;
  meeting: (m: { title: string; attendees: string[]; agenda: string[]; chair?: "ada" | "ceo" }) => Promise<boolean>;
  startMeeting: (id: string) => Promise<boolean>;
  endMeeting: (id: string) => Promise<boolean>;
  start: () => Promise<void>;
  pause: () => Promise<void>;
  /** Saves the CEO's Claude token; resolves to an error message, or null when it's saved. */
  setClaude: (token: string) => Promise<string | null>;
  askClaude: (on: boolean) => void;
  /** Reloads the setup (after anything that changes it). */
  refresh: () => void;
  toast: (text: string, who?: string) => void;
}

interface Ctx {
  s: SimState;
  d: (a: Action) => void;
  act: Acts;
  live: ReturnType<typeof useLive>;
}
const Context = createContext<Ctx | null>(null);

const errText = (e: unknown) => (e instanceof ApiError && e.problems.length ? e.problems.join(" ") : (e as Error).message);

/** Fixed data instead of the network (the development preview). */
export interface Fixture {
  data: OfficeData;
  setup: OfficeSetupView;
  version: number;
  spend: RealInputs["spend"];
}

export function SimProvider({ office, fixture, children }: { office: Office; fixture?: Fixture; children: ReactNode }) {
  const officeId = office.id;
  const fetched = useOfficeData(officeId, !fixture);
  const data = fixture?.data ?? fetched;
  const live = useLive(!fixture);
  const [o, local] = useReducer(overlay, EMPTY_OVERLAY);
  const [setup, setSetup] = useState<{ setup: OfficeSetupView; version: number } | null>(null);
  const [versions, setVersions] = useState<RealInputs["versions"]>([]);
  const [spend, setSpend] = useState<RealInputs["spend"]>([]);
  const [machine, setMachine] = useState(office.sandboxState);
  const [now, setNow] = useState(() => Date.now());
  const [bubbles, setBubbles] = useState<Record<string, string>>({});
  const [visits, setVisits] = useState<Record<string, string>>({});
  // (The development preview: a brand-new office hasn't added its token yet.)
  const [claude, setClaude] = useState<ClaudeStatus | null>(fixture ? { set: fixture.setup.agents.length > 0, last4: "abcd", status: "ok", setAt: null, required: true } : null);
  const [askClaudeOpen, setAskClaude] = useState(false);
  // The office's Claude login: checked now and then (agents can find it's stopped working).
  useEffect(() => {
    if (fixture) return;
    const load = () => void claudeStatus().then(setClaude, () => {});
    load();
    const t = setInterval(load, 120_000);
    return () => clearInterval(t);
  }, [fixture]);
  // Outputs you've opened, remembered in this browser.
  const [viewed, setViewed] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    try {
      setViewed(new Set(JSON.parse(window.localStorage.getItem(`af-viewed-${officeId}`) ?? "[]") as string[]));
    } catch {
      /* storage unavailable */
    }
  }, [officeId]);
  const markViewed = useCallback(
    (id: string) =>
      setViewed((v) => {
        if (v.has(id)) return v;
        const next = new Set(v).add(id);
        try {
          window.localStorage.setItem(`af-viewed-${officeId}`, JSON.stringify([...next].slice(-500)));
        } catch {
          /* storage unavailable */
        }
        return next;
      }),
    [officeId],
  );

  /* -------- reads */

  const refresh = useCallback(() => {
    if (fixture) return setSetup({ setup: fixture.setup, version: fixture.version });
    void getSetup().then((r) => setSetup({ setup: r.setup, version: r.version }), () => {});
    void setupVersions().then((r) => setVersions(r.versions), () => {});
  }, [fixture]);
  // The setup changes with its rooms and agents (Realtime tells us when).
  useEffect(() => {
    refresh();
  }, [refresh, data.rooms, data.agents.length]);

  useEffect(() => {
    if (fixture) return setSpend(fixture.spend);
    const load = () => void getSpend().then((r) => setSpend(r.agents.map((a) => ({ agentId: a.agentId, costUsd: a.costUsd }))), () => {});
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [fixture]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  // Ada's conversation so far.
  const adaSeeded = useRef(false);
  useEffect(() => {
    if (adaSeeded.current) return;
    adaSeeded.current = true;
    if (fixture) return local({ type: "adaSeed", msgs: [] });
    void supabase
      .from("ada_messages")
      .select("role, content, cards, created_at, mode")
      .eq("office_id", officeId)
      .neq("mode", "job")
      .order("id")
      .limit(120)
      .then(({ data: rows }) => {
        const msgs = (rows ?? []).map((m, n) => adaMsg(m as AdaRow, `ada-db-${n}`));
        local({ type: "adaSeed", msgs });
      });
  }, [officeId, fixture]);

  // Optimistic patches give way to the real rows when they change.
  useEffect(() => {
    local({ type: "clearPatches", kind: "task" });
    local({ type: "clearPatches", kind: "output" });
  }, [data.tasks]);
  useEffect(() => {
    local({ type: "clearPatches", kind: "inbox" });
  }, [data.inbox]);
  useEffect(() => {
    local({ type: "clearPatches", kind: "memory" });
  }, [data.memory]);
  useEffect(() => {
    local({ type: "clearPatches", kind: "event" });
  }, [data.meetings]);

  // New messages between agents: a speech bubble for a few seconds; asking
  // someone walks the asker over to their desk for a moment.
  const seen = useRef<Set<string> | null>(null);
  const layout = useMemo(() => layoutOf(setup?.setup ?? null, data.rooms), [setup, data.rooms]);
  useEffect(() => {
    if (!data.loaded) return;
    if (!seen.current) {
      seen.current = new Set(data.messages.map((m) => m.id));
      return;
    }
    const fresh = data.messages.filter((m) => !seen.current!.has(m.id));
    fresh.forEach((m) => seen.current!.add(m.id));
    for (const m of fresh) {
      if (m.from === "ceo" || m.from === "office") continue;
      const text = m.body.length > 70 ? `${m.body.slice(0, 68)}…` : m.body;
      setBubbles((b) => ({ ...b, [m.from]: text }));
      setTimeout(() => setBubbles((b) => (b[m.from] === text ? omit(b, m.from) : b)), 6000);
      const target = layout.homes[m.to];
      if (target && (m.type === "ask" || m.type === "huddle") && m.to !== "ceo") {
        setVisits((v) => ({ ...v, [m.from]: `beside:${target}` }));
        setTimeout(() => setVisits((v) => (v[m.from] === `beside:${target}` ? omit(v, m.from) : v)), 12_000);
      }
    }
  }, [data.messages, data.loaded, layout]);

  /* -------- the state */

  const s: SimState = useMemo(() => {
    const inputs: RealInputs = {
      setup: setup?.setup ?? null,
      version: setup?.version ?? 0,
      versions,
      data,
      spend,
      activity: live.activity,
      bubbles,
      ada: [],
      visits,
    };
    syncCast(inputs.setup, layout);
    const b = buildState(inputs, layout);
    const liveMerged: Record<string, AgentLive> = { ...b.live };
    for (const [id, patch] of Object.entries(o.live)) if (liveMerged[id]) liveMerged[id] = { ...liveMerged[id], ...patch };
    // Messages to agents still on their way show until the office has them.
    const chats: Record<string, ChatMsg[]> = { ...b.chats, ada: o.chats.ada ?? [] };
    for (const [agent, mine] of Object.entries(o.chats)) {
      if (agent === "ada") continue;
      const real = new Set((b.chats[agent] ?? []).filter((m) => m.from === "you").map((m) => m.text));
      chats[agent] = [...(b.chats[agent] ?? []), ...mine.filter((m) => !real.has(m.text))];
    }
    const today = spend.reduce((n, x) => n + x.costUsd, 0);
    const budget = setup?.setup.budgets.find((x) => x.scope === "office")?.dailyUsdHard ?? 0;
    return {
      officeId,
      office,
      loaded: data.loaded && !!setup,
      machine,
      setup: setup?.setup ?? null,
      setupVersion: setup?.version ?? 0,
      layout,
      data,
      live: liveMerged,
      configs: b.configs,
      rooms: b.rooms,
      locked: b.locked,
      tasks: patched(b.tasks, o.patches.task),
      outputs: patched(b.outputs.map((x) => (viewed.has(x.id) ? { ...x, viewed: true } : x)), o.patches.output),
      calendar: patched(b.calendar, o.patches.event),
      // Your messages show at once; each gives way to the office's copy when it arrives.
      conversations: b.conversations.map((c) => {
        const mine = o.echoes[c.id];
        if (!mine?.length) return c;
        const real = c.messages.filter((m) => m.who === "you").map((m) => m.text);
        const waiting = mine.filter((e) => !real.includes(e.text));
        return waiting.length ? { ...c, messages: [...c.messages, ...waiting.map((e) => ({ who: "you", text: e.text, t: time(new Date(e.at).toISOString()), sending: !e.failed, failed: e.failed }))] } : c;
      }),
      memory: patched(b.memory, o.patches.memory),
      inbox: patched(b.inbox, o.patches.inbox),
      versions: b.versions,
      chats,
      spend: { today, budget: budget ?? 0 },
      toasts: o.toasts,
      pending: o.pending,
      adaBusy: o.adaBusy,
      adaReady: o.adaReady,
      claude,
      askClaude: askClaudeOpen,
      me: "you",
      now,
    };
  }, [officeId, office, setup, versions, data, spend, live.activity, bubbles, visits, layout, o, machine, now, viewed, claude, askClaudeOpen]);

  /* -------- actions */

  const ref = useRef(s);
  useEffect(() => {
    ref.current = s;
  });

  const act: Acts = useMemo(() => {
    const toast = (text: string, who = "ada") => local({ type: "toast", toast: { id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, who, text } });
    const attempt = async (p: Promise<unknown>, ok?: string) => {
      try {
        await p;
        if (ok) toast(ok);
      } catch (e) {
        toast(errText(e));
        throw e;
      }
    };
    /** Resolves to whether it worked (the error is already shown as a toast). */
    const quiet = (p: Promise<void>) => p.then(
      () => true,
      () => false,
    );
    return {
      toast,
      refresh,
      change: async (ops, summary) => {
        try {
          const r = await proposeSetup(ops);
          local({ type: "propose", pending: { id: `p-${Date.now()}`, summary: summary ?? r.summary, items: r.readback, ops, baseVersion: r.baseVersion, apply: {} } });
        } catch (e) {
          local({ type: "propose", pending: { id: `p-${Date.now()}`, summary: summary ?? "This change can't be made", items: [], ops, problems: e instanceof ApiError && e.problems.length ? e.problems : [errText(e)], apply: {} } });
        }
      },
      apply: async () => {
        const p = ref.current.pending;
        if (!p?.ops || p.baseVersion == null || p.problems?.length) return null;
        try {
          const r = await applySetup(p.ops, p.baseVersion);
          refresh();
          return r.version;
        } catch (e) {
          local({ type: "propose", pending: { ...p, problems: [errText(e)] } });
          return null;
        }
      },
      assign: (to, title, details, doneMeans) => quiet(attempt(officeCall("ceo_assign", { to, title, details: details || undefined, done_means: doneMeans || undefined }))),
      message: async (to, text, urgency) => {
        local({ type: "chat", agent: to, msg: { id: `local-${Date.now()}`, from: "you", text, t: time(new Date().toISOString()) } });
        return quiet(attempt(officeCall("ceo_message", { to, text, urgency })));
      },
      reply: async (threadId, text, resolves) => {
        const id = `echo-${Date.now()}`;
        local({ type: "echo", thread: threadId, echo: { id, text, at: Date.now() } });
        try {
          await officeCall("ceo_reply", { thread_id: threadId, text, resolves: resolves || undefined });
          return true;
        } catch (e) {
          local({ type: "echoFailed", thread: threadId, id, why: errText(e) });
          toast(errText(e));
          return false;
        }
      },
      resolve: (id) => {
        local({ type: "inbox", id, patch: { resolved: true } });
        return quiet(attempt(resolveInbox(id)));
      },
      permission: (id, allow, note) => {
        local({ type: "inbox", id, patch: { resolved: true } });
        return quiet(attempt(answerPermission(id, allow, note), allow ? "Allowed." : "Declined."));
      },
      merge: (pr, inboxId) => quiet(attempt(mergePr(pr, inboxId), `PR #${pr} merged.`)),
      changes: (pr, comment, inboxId) => quiet(attempt(requestChanges(pr, comment, inboxId), "Sent your notes back.")),
      hold: (agent, reason) => quiet(attempt(officeCall("ceo_hold_agent", { agent, reason }))),
      release: (agent) => quiet(attempt(releaseAgent(agent))),
      ada: async (text) => {
        const id = `ada-${Date.now()}`;
        if (text) local({ type: "chat", agent: "ada", msg: { id: `${id}-q`, from: "you", text, t: time(new Date().toISOString()) } });
        local({ type: "chat", agent: "ada", msg: { id, from: "agent", text: "", t: time(new Date().toISOString()) } });
        local({ type: "adaBusy", on: true });
        let content = "";
        try {
          await adaChat(text, (e) => {
            if (e.type === "text") {
              content += e.delta;
              local({ type: "chatPatch", agent: "ada", id, patch: { text: content } });
            }
            if (e.type === "card") local({ type: "chatPatch", agent: "ada", id, patch: { card: cardOf(e.card) } });
            if (e.type === "done") local({ type: "chatPatch", agent: "ada", id, patch: { text: e.message.content, card: e.message.cards[0] ? cardOf(e.message.cards[0]) : undefined } });
            if (e.type === "error") local({ type: "chatPatch", agent: "ada", id, patch: { text: content || `Sorry, something went wrong: ${e.message}` } });
          });
        } catch (e) {
          local({ type: "chatPatch", agent: "ada", id, patch: { text: `I couldn't answer just now: ${errText(e)}` } });
        } finally {
          local({ type: "adaBusy", on: false });
        }
      },
      adaCard: async (cardId, confirm) => {
        const patch = (p: { applied?: boolean; cancelled?: boolean }) =>
          (ref.current.chats.ada ?? []).forEach((m) => {
            if (m.card?.kind === "readback" && m.card.actionId === cardId) local({ type: "chatPatch", agent: "ada", id: m.id, patch: { card: { ...m.card, ...p } } });
          });
        try {
          if (confirm) {
            const r = await confirmAdaCard(cardId);
            patch({ applied: true });
            toast(`Done. Your office is on setup version ${r.version}.`);
            refresh();
          } else {
            await dismissAdaCard(cardId);
            patch({ cancelled: true });
          }
        } catch (e) {
          toast(errText(e));
        }
      },
      meeting: (m) => quiet(attempt(scheduleMeeting(m), "Meeting requested. Ada is preparing the pre-read.")),
      startMeeting: (id) => quiet(attempt(startMeeting(id))),
      endMeeting: (id) => quiet(attempt(endMeeting(id), "Meeting ended. Ada is writing the minutes.")),
      start: async () => {
        setMachine(ref.current.machine === "none" ? "creating" : "starting");
        try {
          setMachine((await startOffice()).state);
        } catch (e) {
          // No Claude token yet: ask for it instead of failing.
          if (e instanceof ApiError && e.code === "claude_token") {
            setMachine(ref.current.office.sandboxState);
            setAskClaude(true);
            return;
          }
          setMachine("error");
          toast(errText(e));
        }
      },
      setClaude: async (token) => {
        try {
          const st = await setClaudeToken(token);
          setClaude({ ...st, required: true });
          setAskClaude(false);
          return null;
        } catch (e) {
          return errText(e);
        }
      },
      askClaude: (on) => setAskClaude(on),
      pause: async () => {
        setMachine("stopped");
        try {
          setMachine((await pauseOffice()).state);
        } catch (e) {
          toast(errText(e));
        }
      },
    };
  }, [refresh]);

  const d = useCallback(
    (a: Action) => {
      if (a.type === "applyPending") {
        void act.apply().then((v) => {
          if (v == null) return;
          local({ type: "cancelPending" });
          act.toast(`Done. Your office is on setup version ${v}.`);
        });
        return;
      }
      if (a.type === "output" && a.patch.viewed) markViewed(a.id);
      if (a.type === "rollback") {
        void act.change([{ op: "restore_version", version: a.v }], `Go back to version ${a.v}`);
        return;
      }
      local(a);
    },
    [act, markViewed],
  );

  const value = useMemo(() => ({ s, d, act, live }), [s, d, act, live]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useSim() {
  const v = useContext(Context);
  if (!v) throw new Error("useSim outside SimProvider");
  return v;
}

/* ---------------------------------------------------------------- helpers */

interface AdaRow {
  role: "ceo" | "ada";
  content: string;
  cards: { id: string; readback: string[]; summary: string; state: string }[] | null;
  created_at: string;
}
const cardOf = (c: { id: string; readback: string[]; summary: string; state: string }): ChatMsg["card"] => ({
  kind: "readback",
  title: c.summary,
  items: c.readback,
  actionId: c.id,
  applied: c.state === "applied",
  cancelled: c.state === "dismissed" || c.state === "stale",
});
const adaMsg = (m: AdaRow, id: string): ChatMsg => ({ id, from: m.role === "ceo" ? "you" : "agent", text: m.content, t: time(m.created_at), card: m.cards?.[0] ? cardOf(m.cards[0]) : undefined });

function omit<T>(r: Record<string, T>, k: string): Record<string, T> {
  const rest = { ...r };
  delete rest[k];
  return rest;
}

/** The time now (the demo's sim clock is the real one here). */
export function clockLabel(now: number = Date.now(), withDay = true) {
  const d = new Date(now);
  return `${withDay ? `${d.toLocaleDateString([], { weekday: "short" })} ` : ""}${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

/** A room's name from its slot. */
export const roomName = (r: string | null | undefined, s?: Pick<SimState, "rooms">) =>
  r ? (s?.rooms[r]?.name ?? ({ ceo: "your office", meeting: "the meeting room" } as Record<string, string>)[r] ?? r) : "the lobby";
