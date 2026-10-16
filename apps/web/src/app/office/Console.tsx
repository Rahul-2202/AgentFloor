"use client";

/**
 * The working office console for M2–M5: every real feature, plainly laid out.
 * M6 replaces it with the pixel office from the demo, on the same data.
 */
import { useEffect, useMemo, useState } from "react";
import {
  chooseRepo,
  getPr,
  getSetup,
  getSpend,
  githubRepos,
  githubStatus,
  mergePr,
  adaBriefing,
  answerPermission,
  officeCall,
  releaseAgent,
  requestChanges,
  resolveInbox,
  setupVersions,
  type GitHubStatus,
  type OfficeSetupView,
  type PullRequestView,
} from "@/lib/api";
import { useLive } from "@/lib/live";
import { useOfficeData, type AgentRow, type OfficeData, type TaskRow } from "@/lib/office-data";
import { AdaPanel } from "./Ada";
import { Audit } from "./Audit";
import { Meetings } from "./Meetings";
import { Memory } from "./Memory";
import { ReadbackDialog } from "./Readback";
import { Rules } from "./Rules";

const TABS = ["Team", "Work", "Conversations", "Inbox", "Meetings", "Memory", "Rules", "Setup", "Spend", "Audit"] as const;
type Tab = (typeof TABS)[number];

export function Console({ officeId, running, onboarded }: { officeId: string; running: boolean; onboarded: boolean }) {
  const data = useOfficeData(officeId);
  const live = useLive(true);
  const [tab, setTab] = useState<Tab>("Team");
  const [agent, setAgent] = useState<string | null>(null);
  const [ops, setOps] = useState<object[] | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // A new office starts with Ada's interview.
  const [ada, setAda] = useState(!onboarded);
  const openInbox = data.inbox.filter((i) => i.state === "open").length;

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };
  const change = (o: object[]) => setOps(o);

  return (
    <div className="mt-6">
      <button onClick={() => setAda(true)} className="fixed bottom-5 right-5 z-30 rounded-full bg-ink px-5 py-3 text-sm font-medium text-white shadow-[var(--shadow-float)]">
        Ada
      </button>
      <nav className="flex flex-wrap gap-1 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === t ? "border-ink font-medium" : "border-transparent text-muted"}`}
          >
            {t}
            {t === "Inbox" && openInbox > 0 && <span className="ml-1.5 rounded-full bg-accent px-1.5 text-xs text-white">{openInbox}</span>}
          </button>
        ))}
      </nav>

      {!running && <p className="mt-4 rounded-lg bg-accent-soft px-3 py-2 text-sm">The office computer isn&apos;t running, so agents won&apos;t act on anything until you start it.</p>}
      {live.error && (
        <p className="mt-4 rounded-lg bg-surface-2 px-3 py-2 text-sm text-bad" onClick={live.clearError}>
          {live.error}
        </p>
      )}

      <div className="mt-4">
        {tab === "Team" && <Team data={data} live={live} onOpen={setAgent} />}
        {tab === "Work" && <Work data={data} onDone={flash} />}
        {tab === "Conversations" && <Conversations data={data} />}
        {tab === "Inbox" && <Inbox data={data} onDone={flash} change={change} />}
        {tab === "Meetings" && <Meetings data={data} onDone={flash} />}
        {tab === "Memory" && <Memory data={data} officeId={officeId} onDone={flash} />}
        {tab === "Rules" && <Rules data={data} change={change} />}
        {tab === "Setup" && <Setup data={data} change={change} />}
        {tab === "Spend" && <Spend data={data} />}
        {tab === "Audit" && <Audit data={data} />}
      </div>

      {ada && <AdaPanel officeId={officeId} onboarding={!onboarded} onClose={() => setAda(false)} onDone={flash} />}
      {agent && <AgentPanel data={data} id={agent} live={live} change={change} onClose={() => setAgent(null)} onDone={flash} />}
      {ops && (
        <ReadbackDialog
          ops={ops}
          onClose={() => setOps(null)}
          onApplied={(v) => {
            setOps(null);
            flash(`Applied. The office is now on setup version ${v}.`);
          }}
        />
      )}
      {toast && <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-ink px-4 py-2 text-sm text-white shadow-[var(--shadow-float)]">{toast}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ team */

const DOT: Record<string, string> = { working: "bg-ok", waiting: "bg-warn", idle: "bg-faint", stopped: "bg-bad", offline: "bg-line-2" };

function Team({ data, live, onOpen }: { data: OfficeData; live: ReturnType<typeof useLive>; onOpen: (id: string) => void }) {
  if (!data.loaded) return <p className="text-faint">Loading…</p>;
  if (!data.rooms.length) return <p className="text-faint">No rooms yet. Ada sets up your office with you: open Ada to start.</p>;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {data.rooms.map((room) => (
        <section key={room.id} className="rounded-2xl bg-surface p-4 shadow-[var(--shadow-card)]">
          <h3 className="font-display font-semibold">{room.name}</h3>
          {room.purpose && <p className="text-sm text-muted">{room.purpose}</p>}
          <ul className="mt-3 space-y-1">
            {data.agents
              .filter((a) => a.room_id === room.id)
              .sort((a, b) => (a.role === "head" ? -1 : b.role === "head" ? 1 : 0))
              .map((a) => (
                <li key={a.id}>
                  <button onClick={() => onOpen(a.id)} className="flex w-full items-start gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-surface-2">
                    <span className={`mt-1.5 size-2 shrink-0 rounded-full ${a.held_reason ? "bg-bad" : DOT[a.status] ?? "bg-faint"}`} />
                    <span className="min-w-0">
                      <span className="font-medium">{a.name}</span>
                      {a.role === "head" && <span className="ml-1.5 text-xs text-muted">head</span>}
                      <span className="block truncate text-sm text-muted">
                        {a.held_reason ? `On hold: ${a.held_reason}` : live.activity[a.id] ?? a.activity ?? a.title}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function AgentPanel({
  data,
  id,
  live,
  change,
  onClose,
  onDone,
}: {
  data: OfficeData;
  id: string;
  live: ReturnType<typeof useLive>;
  change: (ops: object[]) => void;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const a = data.agents.find((x) => x.id === id);
  const [text, setText] = useState("");
  const [model, setModel] = useState(a?.model ?? "haiku");
  const [effort, setEffort] = useState(a?.effort ?? "low");
  const [keys, setKeys] = useState("");
  const lines = live.lines[id] ?? [];
  const takenOver = live.terminal?.agent === id;
  // The live stream only has what happened since the page loaded; the office keeps the recent past.
  useEffect(() => {
    officeCall<{ at: number; kind: string; text: string }[]>("agent_output", { agent: id }).then((earlier) => live.seed(id, earlier), () => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  if (!a) return null;

  const send = async () => {
    if (!text.trim()) return;
    await officeCall("ceo_message", { to: id, text }).then(() => onDone(`Sent to ${a.name}.`), (e) => onDone(e.message));
    setText("");
  };

  return (
    <aside className="fixed inset-y-0 right-0 z-40 flex w-full max-w-lg flex-col bg-surface shadow-[var(--shadow-float)]">
      <header className="flex items-center justify-between border-b border-line p-4">
        <div>
          <h2 className="font-display text-lg font-semibold">{a.name}</h2>
          <p className="text-sm text-muted">{a.title}</p>
        </div>
        <button onClick={onClose} className="text-muted">
          Close
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {a.held_reason && !takenOver && (
          <div className="mb-4 flex items-center justify-between gap-3 rounded-lg bg-accent-soft px-3 py-2 text-sm">
            <span>
              {a.name} is on hold: {a.held_reason}.
            </span>
            <button
              onClick={() => releaseAgent(id).then(() => onDone(`${a.name} carries on.`), (e) => onDone(e.message))}
              className="shrink-0 rounded-lg bg-ink px-3 py-1 font-medium text-white"
            >
              {a.held_reason.includes("took over") ? "Hand back" : "Let them carry on"}
            </button>
          </div>
        )}
        <h3 className="text-sm font-medium">Live session</h3>
        <pre className="mt-2 h-56 overflow-y-auto whitespace-pre-wrap rounded-lg bg-ink p-3 font-mono text-xs text-white/85">
          {lines.length ? lines.map((l) => `${l.kind === "tool" ? "› " : l.kind === "error" ? "! " : ""}${l.text}`).join("\n") : "Nothing yet. Lines appear here while the agent works."}
        </pre>

        {takenOver ? (
          <div className="mt-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">Your terminal (the agent is paused)</h3>
              <button onClick={live.handBack} className="text-sm text-accent">
                Hand back
              </button>
            </div>
            <pre className="mt-2 h-56 overflow-y-auto whitespace-pre-wrap rounded-lg bg-ink p-3 font-mono text-xs text-white">{live.terminal!.text || "Connecting…"}</pre>
            {live.terminal!.closed && <p className="mt-1 text-sm text-muted">Closed: {live.terminal!.closed}</p>}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                live.input(`${keys}\n`);
                setKeys("");
              }}
            >
              <input value={keys} onChange={(e) => setKeys(e.target.value)} placeholder="Type a command and press Enter" className="mt-2 w-full rounded-lg bg-surface-2 px-3 py-2 font-mono text-sm" />
            </form>
          </div>
        ) : (
          <button onClick={() => live.takeOver(id)} className="mt-3 text-sm text-accent">
            Take over its terminal (pauses {a.name} until you hand back)
          </button>
        )}

        <h3 className="mt-6 text-sm font-medium">Message {a.name}</h3>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} className="mt-2 w-full rounded-lg bg-surface-2 p-3 text-sm" placeholder="Their head is copied." />
        <button onClick={send} className="mt-2 rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-white">
          Send
        </button>

        <h3 className="mt-6 text-sm font-medium">Model</h3>
        <div className="mt-2 flex gap-2">
          <select value={model} onChange={(e) => setModel(e.target.value)} className="rounded-lg bg-surface-2 px-2 py-1.5 text-sm">
            <option value="haiku">Claude Haiku</option>
            <option value="sonnet">Claude Sonnet</option>
            <option value="opus">Claude Opus</option>
          </select>
          <select value={effort} onChange={(e) => setEffort(e.target.value)} className="rounded-lg bg-surface-2 px-2 py-1.5 text-sm">
            {["low", "medium", "high"].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
          <button onClick={() => change([{ op: "update_agent", id, model, effort }])} className="rounded-lg px-3 py-1.5 text-sm ring-1 ring-line-2">
            Change…
          </button>
        </div>
        <p className="mt-1 text-xs text-faint">
          Now: {a.model}, {a.effort} effort · {a.status}
        </p>
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------ work */

const STATUS_ORDER = ["blocked", "ongoing", "review", "queued", "done"];

function Work({ data, onDone }: { data: OfficeData; onDone: (msg: string) => void }) {
  const [to, setTo] = useState("");
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [dod, setDod] = useState("");
  const name = (id: string) => (id === "ceo" ? "You" : data.agents.find((a) => a.id === id)?.name ?? id);
  const roots = data.tasks.filter((t) => !t.parent_id || !data.tasks.some((p) => p.id === t.parent_id));
  roots.sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));

  const assign = async () => {
    if (!to || !title.trim()) return;
    await officeCall("ceo_assign", { to, title, details: details || undefined, done_means: dod || undefined }).then(
      () => onDone(`Assigned to ${name(to)}.`),
      (e) => onDone(e.message),
    );
    setTitle("");
    setDetails("");
    setDod("");
  };

  const Task = ({ t, depth }: { t: TaskRow; depth: number }) => (
    <li className={depth ? "ml-5 border-l border-line pl-3" : ""}>
      <div className="rounded-xl bg-surface p-3 shadow-[var(--shadow-card)]">
        <div className="flex items-center justify-between gap-3">
          <span className="font-medium">{t.title}</span>
          <span className={`text-xs ${t.status === "blocked" ? "text-bad" : t.status === "done" ? "text-ok" : "text-muted"}`}>{t.status}</span>
        </div>
        <p className="text-sm text-muted">
          {name(t.owner_id)} · from {name(t.created_by)}
          {t.step ? ` · ${t.step}` : ""}
        </p>
        <div className="mt-2 h-1.5 rounded-full bg-surface-2">
          <div className="h-1.5 rounded-full bg-ok" style={{ width: `${t.progress}%` }} />
        </div>
        {t.blocker && <p className="mt-2 text-sm text-bad">Blocked: {t.blocker}</p>}
        {t.definition_of_done && <p className="mt-1 text-sm">Done means: {t.definition_of_done}</p>}
        {t.note && <p className="mt-1 text-sm text-muted">{t.note}</p>}
        {t.checklist.length > 0 && (
          <ul className="mt-2 text-sm">
            {t.checklist.map((c) => (
              <li key={c.text}>
                {c.done ? "☑" : "☐"} {c.text}
              </li>
            ))}
          </ul>
        )}
        {t.outputs.length > 0 && (
          <p className="mt-2 flex flex-wrap gap-2 text-sm">
            {t.outputs.map((o) =>
              o.url ? (
                <a key={o.title} href={o.url} target="_blank" rel="noreferrer" className="text-accent underline">
                  {o.kind === "pr" ? "PR: " : ""}
                  {o.title}
                </a>
              ) : (
                <span key={o.title}>{o.title}</span>
              ),
            )}
          </p>
        )}
      </div>
      {data.tasks.some((c) => c.parent_id === t.id) && (
        <ul className="mt-2 space-y-2">
          {data.tasks
            .filter((c) => c.parent_id === t.id)
            .map((c) => (
              <Task key={c.id} t={c} depth={depth + 1} />
            ))}
        </ul>
      )}
    </li>
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <ul className="space-y-3">
        {roots.length ? roots.map((t) => <Task key={t.id} t={t} depth={0} />) : <p className="text-faint">No work yet. Assign something.</p>}
      </ul>
      <section className="h-fit rounded-2xl bg-surface p-4 shadow-[var(--shadow-card)]">
        <h3 className="font-display font-semibold">Assign work</h3>
        <select value={to} onChange={(e) => setTo(e.target.value)} className="mt-3 w-full rounded-lg bg-surface-2 px-2 py-2 text-sm">
          <option value="">To…</option>
          {data.agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} ({data.rooms.find((r) => r.id === a.room_id)?.name}
              {a.role === "head" ? ", head" : ""})
            </option>
          ))}
        </select>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" className="mt-2 w-full rounded-lg bg-surface-2 px-3 py-2 text-sm" />
        <textarea value={details} onChange={(e) => setDetails(e.target.value)} placeholder="Details" rows={3} className="mt-2 w-full rounded-lg bg-surface-2 px-3 py-2 text-sm" />
        <input value={dod} onChange={(e) => setDod(e.target.value)} placeholder="Done means…" className="mt-2 w-full rounded-lg bg-surface-2 px-3 py-2 text-sm" />
        <button onClick={assign} className="mt-3 w-full rounded-lg bg-ink py-2 text-sm font-medium text-white">
          Assign
        </button>
        <p className="mt-2 text-xs text-faint">A head plans it into subtasks for their room.</p>
      </section>
    </div>
  );
}

/* ---------------------------------------------------------- conversations */

function Conversations({ data }: { data: OfficeData }) {
  const [open, setOpen] = useState<string | null>(null);
  const name = (id: string) => (id === "ceo" ? "You" : id === "office" ? "Office" : data.agents.find((a) => a.id === id)?.name ?? id);
  const thread = data.threads.find((t) => t.id === open);
  // One row per sent message (a message to three people is stored three times).
  const msgs = useMemo(() => {
    const seen = new Set<string>();
    return data.messages
      .filter((m) => m.thread_id === open)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .filter((m) => {
        const k = `${m.from}|${m.body}|${m.created_at}`;
        return seen.has(k) ? false : (seen.add(k), true);
      });
  }, [data.messages, open]);

  return (
    <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
      <ul className="space-y-1">
        {data.threads.map((t) => (
          <li key={t.id}>
            <button onClick={() => setOpen(t.id)} className={`w-full rounded-lg px-3 py-2 text-left ${open === t.id ? "bg-surface shadow-[var(--shadow-card)]" : "hover:bg-surface-2"}`}>
              <span className="block truncate text-sm font-medium">{t.topic}</span>
              <span className="text-xs text-muted">
                {t.kind === "huddle" ? "Huddle · " : ""}
                {t.participants.map(name).join(", ")} · {t.state}
              </span>
            </button>
          </li>
        ))}
        {!data.threads.length && <p className="text-faint">No conversations yet.</p>}
      </ul>
      {thread && (
        <section className="rounded-2xl bg-surface p-4 shadow-[var(--shadow-card)]">
          <h3 className="font-display font-semibold">{thread.topic}</h3>
          <ul className="mt-3 space-y-3">
            {msgs.map((m) => (
              <li key={m.id}>
                <p className="text-xs text-muted">
                  {name(m.from)} → {name(m.to)} · {m.type}
                  {m.urgency !== "normal" ? ` · ${m.urgency}` : ""}
                </p>
                <p className="whitespace-pre-wrap text-sm">{m.body}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ inbox */

function Inbox({ data, onDone, change }: { data: OfficeData; onDone: (msg: string) => void; change: (ops: object[]) => void }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const name = (id: string) => (id === "office" ? "Office" : id === "ada" ? "Ada" : data.agents.find((a) => a.id === id)?.name ?? id);
  // Ada's triage: what needs the CEO first.
  const items = data.inbox.filter((i) => i.state === "open").sort((a, b) => a.priority - b.priority || b.created_at.localeCompare(a.created_at));
  const PRIORITY: Record<number, string> = { 1: "Needs you first", 2: "Today", 3: "FYI" };

  const reply = async (threadId: string, id: string) => {
    const text = answers[id];
    if (!text?.trim()) return;
    await officeCall("ceo_reply", { thread_id: threadId, text, resolves: true }).then(() => onDone("Answered."), (e) => onDone(e.message));
  };

  if (!items.length)
    return (
      <div className="text-faint">
        Nothing needs you right now.{" "}
        <button onClick={() => adaBriefing().then(() => onDone("Ada's briefing is in your inbox."), (e) => onDone(e.message))} className="underline">
          Ask Ada for a briefing
        </button>
      </div>
    );
  return (
    <ul className="space-y-3">
      {items.map((i) => (
        <li key={i.id} className="rounded-2xl bg-surface p-4 shadow-[var(--shadow-card)]">
          <p className="text-xs text-muted">
            <span className={i.priority === 1 ? "font-medium text-accent" : ""}>{PRIORITY[i.priority] ?? ""}</span> · {i.kind.replaceAll("_", " ")} · from {name(i.from)} ·{" "}
            {new Date(i.created_at).toLocaleString()}
          </p>
          {i.ada_note && <p className="mt-1 rounded-lg bg-surface-2 px-2 py-1 text-sm">Ada: {i.ada_note}</p>}
          <p className="mt-1 font-medium">{i.title}</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-ink-2">{i.body}</p>
          {i.action?.type === "permission" && (
            <div className="mt-3 flex gap-2">
              <button onClick={() => answerPermission(i.id, true).then(() => onDone("Allowed."), (e) => onDone(e.message))} className="rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-white">
                {i.action.firstUse ? "Allow from now on" : "Allow once"}
              </button>
              <button onClick={() => answerPermission(i.id, false).then(() => onDone("Refused."), (e) => onDone(e.message))} className="rounded-lg px-3 py-1.5 text-sm ring-1 ring-line-2">
                Refuse
              </button>
            </div>
          )}
          {i.action?.type === "permission_request" && (
            <button
              onClick={() => {
                const a = i.action as { agent: string; permission: string };
                change([{ op: "set_permission", scope: "agent", id: a.agent, permission: a.permission, level: "free" }]);
                void resolveInbox(i.id);
              }}
              className="mt-3 rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-white"
            >
              Grant (review the change)…
            </button>
          )}
          {i.kind === "meeting_request" && <p className="mt-2 text-sm text-muted">Ada books it or answers; see Meetings.</p>}
          {i.kind === "approval" && i.action?.type === "merge" ? (
            <MergeApproval pr={i.action.pr} inboxId={i.id} onDone={onDone} />
          ) : i.thread_id && i.kind !== "permission" && (
            <div className="mt-3 flex gap-2">
              <input
                value={answers[i.id] ?? ""}
                onChange={(e) => setAnswers({ ...answers, [i.id]: e.target.value })}
                placeholder="Your answer"
                className="flex-1 rounded-lg bg-surface-2 px-3 py-2 text-sm"
              />
              <button onClick={() => reply(i.thread_id!, i.id)} className="rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-white">
                Answer
              </button>
            </div>
          )}
          <button onClick={() => resolveInbox(i.id).then(() => onDone("Done."), (e) => onDone(e.message))} className="mt-2 text-sm text-muted underline">
            Mark done
          </button>
        </li>
      ))}
    </ul>
  );
}

/** A merge request from a head: the PR, its checks, and the CEO's call. Only the CEO merges. */
function MergeApproval({ pr, inboxId, onDone }: { pr: number; inboxId: string; onDone: (msg: string) => void }) {
  const [view, setView] = useState<PullRequestView | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => {
    getPr(pr).then((r) => setView(r.pr), (e) => setErr(e.message));
  }, [pr]);
  const act = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    await fn().then(() => onDone(msg), (e) => setErr(e.message));
    setBusy(false);
  };
  const failing = view?.checks.filter((c) => c.conclusion && !["success", "neutral", "skipped"].includes(c.conclusion)) ?? [];
  return (
    <div className="mt-3 rounded-xl bg-surface-2 p-3 text-sm">
      {!view && !err && <p className="text-faint">Loading PR #{pr}…</p>}
      {view && (
        <>
          <a href={view.url} target="_blank" rel="noreferrer" className="font-medium text-accent underline">
            #{view.number} {view.title}
          </a>
          <p className="text-muted">
            {view.head} → {view.base} · {view.changedFiles} files · <span className="text-ok">+{view.additions}</span> <span className="text-bad">−{view.deletions}</span>
            {view.merged ? " · merged" : view.mergeable === false ? " · has conflicts" : ""}
          </p>
          <p className="mt-1">
            {view.checks.length === 0 ? (
              <span className="text-muted">No checks ran.</span>
            ) : failing.length ? (
              <span className="text-bad">Failing: {failing.map((c) => c.name).join(", ")}</span>
            ) : (
              <span className="text-ok">{view.checks.every((c) => c.status === "completed") ? "All checks passed." : "Checks running…"}</span>
            )}
          </p>
          {!view.merged && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button disabled={busy} onClick={() => act(() => mergePr(pr, inboxId), `Merged PR #${pr}.`)} className="rounded-lg bg-ink px-3 py-1.5 font-medium text-white disabled:opacity-50">
                Merge
              </button>
              <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="What needs to change?" className="min-w-0 flex-1 rounded-lg bg-surface px-3 py-1.5" />
              <button disabled={busy || !comment.trim()} onClick={() => act(() => requestChanges(pr, comment, inboxId), "Sent back with your comments.")} className="rounded-lg px-3 py-1.5 ring-1 ring-line-2 disabled:opacity-50">
                Request changes
              </button>
            </div>
          )}
        </>
      )}
      {err && <p className="text-bad">{err}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ setup */

function GitHubCard() {
  const [status, setStatus] = useState<GitHubStatus | null>(null);
  const [repos, setRepos] = useState<{ fullName: string }[] | null>(null);
  const [err, setErr] = useState("");
  const load = () => githubStatus().then(setStatus, (e) => setErr(e.message));
  useEffect(() => {
    void load();
  }, []);
  if (!status) return null;
  return (
    <div className="rounded-2xl bg-surface p-4 shadow-[var(--shadow-card)]">
      <h3 className="font-display font-semibold">GitHub</h3>
      {!status.configured && <p className="mt-2 text-sm text-muted">GitHub isn&apos;t set up on this server yet.</p>}
      {status.configured && !status.link && (
        <>
          <p className="mt-2 text-sm text-muted">Agents work on your repo in their own branches and open PRs. Only you merge.</p>
          <a href={status.installUrl} className="mt-3 inline-block rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-white">
            Connect GitHub
          </a>
        </>
      )}
      {status.link && (
        <div className="mt-2 text-sm">
          <p>
            Connected as <span className="font-medium">{status.link.account}</span>
            {status.link.repo ? (
              <>
                {" "}· agents work on <span className="font-medium">{status.link.repo}</span> ({status.link.defaultBranch})
              </>
            ) : (
              " · no repo chosen yet"
            )}
          </p>
          {repos ? (
            <select
              defaultValue=""
              onChange={(e) => e.target.value && chooseRepo(e.target.value).then(() => (setRepos(null), load()), (er) => setErr(er.message))}
              className="mt-2 w-full rounded-lg bg-surface-2 px-2 py-2"
            >
              <option value="">Choose a repo…</option>
              {repos.map((r) => (
                <option key={r.fullName}>{r.fullName}</option>
              ))}
            </select>
          ) : (
            <button onClick={() => githubRepos().then((r) => setRepos(r.repos), (er) => setErr(er.message))} className="mt-2 text-muted underline">
              {status.link.repo ? "Change repo" : "Choose a repo"}
            </button>
          )}
          <a href={status.installUrl} className="ml-3 text-muted underline">
            Add repos on GitHub
          </a>
        </div>
      )}
      {err && <p className="mt-2 text-sm text-bad">{err}</p>}
    </div>
  );
}


function Setup({ data, change }: { data: OfficeData; change: (ops: object[]) => void }) {
  const [setup, setSetup] = useState<OfficeSetupView | null>(null);
  const [version, setVersion] = useState(0);
  const [versions, setVersions] = useState<Awaited<ReturnType<typeof setupVersions>>["versions"]>([]);
  const [hire, setHire] = useState({ room: "", name: "", title: "" });
  const [room, setRoom] = useState({ name: "", purpose: "", head: "", headTitle: "" });
  const [budget, setBudget] = useState({ soft: "", hard: "" });

  // Reload when the agents table changes (an applied setup changes it).
  useEffect(() => {
    getSetup().then((s) => {
      setSetup(s.setup);
      setVersion(s.version);
      const b = s.setup.budgets.find((x) => x.scope === "office");
      setBudget({ soft: String(b?.dailyUsdSoft ?? ""), hard: String(b?.dailyUsdHard ?? "") });
    });
    setupVersions().then((v) => setVersions(v.versions));
  }, [data.agents, data.rooms]);

  if (!setup) return <p className="text-faint">Loading…</p>;
  const num = (s: string) => (s.trim() === "" ? null : Number(s));

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="space-y-4">
        <div className="rounded-2xl bg-surface p-4 shadow-[var(--shadow-card)]">
          <h3 className="font-display font-semibold">
            {setup.name} <span className="text-sm font-normal text-muted">· version {version}</span>
          </h3>
          {setup.rooms.map((r) => (
            <div key={r.id} className="mt-3">
              <div className="flex items-center justify-between">
                <span className="font-medium">{r.name}</span>
                <button onClick={() => change([{ op: "remove_room", id: r.id }])} className="text-xs text-muted underline">
                  Close room
                </button>
              </div>
              <ul className="text-sm">
                {setup.agents
                  .filter((a) => a.room === r.id)
                  .map((a) => (
                    <li key={a.id} className="flex items-center justify-between py-0.5">
                      <span>
                        {a.name}
                        {a.id === r.head ? " (head)" : ""} <span className="text-muted">· {a.model}</span>
                      </span>
                      {a.id !== r.head && (
                        <span className="flex gap-2">
                          <button onClick={() => change([{ op: "update_room", id: r.id, head: a.id }])} className="text-xs text-muted underline">
                            Make head
                          </button>
                          <button onClick={() => change([{ op: "remove_agent", id: a.id }])} className="text-xs text-muted underline">
                            Let go
                          </button>
                        </span>
                      )}
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="rounded-2xl bg-surface p-4 shadow-[var(--shadow-card)]">
          <h3 className="font-display font-semibold">Hire an agent</h3>
          <select value={hire.room} onChange={(e) => setHire({ ...hire, room: e.target.value })} className="mt-3 w-full rounded-lg bg-surface-2 px-2 py-2 text-sm">
            <option value="">Into room…</option>
            {setup.rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <input value={hire.name} onChange={(e) => setHire({ ...hire, name: e.target.value })} placeholder="Name" className="mt-2 w-full rounded-lg bg-surface-2 px-3 py-2 text-sm" />
          <input value={hire.title} onChange={(e) => setHire({ ...hire, title: e.target.value })} placeholder="What they do" className="mt-2 w-full rounded-lg bg-surface-2 px-3 py-2 text-sm" />
          <button onClick={() => change([{ op: "hire_agent", ...hire }])} className="mt-3 rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-white">
            Review hire…
          </button>
        </div>

        <div className="rounded-2xl bg-surface p-4 shadow-[var(--shadow-card)]">
          <h3 className="font-display font-semibold">Open a room</h3>
          <input value={room.name} onChange={(e) => setRoom({ ...room, name: e.target.value })} placeholder="Room name" className="mt-3 w-full rounded-lg bg-surface-2 px-3 py-2 text-sm" />
          <input value={room.purpose} onChange={(e) => setRoom({ ...room, purpose: e.target.value })} placeholder="What it's for" className="mt-2 w-full rounded-lg bg-surface-2 px-3 py-2 text-sm" />
          <input value={room.head} onChange={(e) => setRoom({ ...room, head: e.target.value })} placeholder="Head's name" className="mt-2 w-full rounded-lg bg-surface-2 px-3 py-2 text-sm" />
          <input value={room.headTitle} onChange={(e) => setRoom({ ...room, headTitle: e.target.value })} placeholder="Head's job" className="mt-2 w-full rounded-lg bg-surface-2 px-3 py-2 text-sm" />
          <button
            onClick={() => change([{ op: "add_room", name: room.name, purpose: room.purpose || undefined, head: { name: room.head, title: room.headTitle } }])}
            className="mt-3 rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-white"
          >
            Review room…
          </button>
        </div>
      </section>

      <section className="space-y-4">
        <GitHubCard />
        <div className="rounded-2xl bg-surface p-4 shadow-[var(--shadow-card)]">
          <h3 className="font-display font-semibold">Daily budget (whole office)</h3>
          <div className="mt-3 flex gap-2">
            <input value={budget.soft} onChange={(e) => setBudget({ ...budget, soft: e.target.value })} placeholder="Warn at $" className="w-28 rounded-lg bg-surface-2 px-3 py-2 text-sm" />
            <input value={budget.hard} onChange={(e) => setBudget({ ...budget, hard: e.target.value })} placeholder="Stop at $" className="w-28 rounded-lg bg-surface-2 px-3 py-2 text-sm" />
            <button
              onClick={() => change([{ op: "set_budget", scope: "office", id: "", dailyUsdSoft: num(budget.soft), dailyUsdHard: num(budget.hard) }])}
              className="rounded-lg px-3 py-1.5 text-sm ring-1 ring-line-2"
            >
              Change…
            </button>
          </div>
          <p className="mt-1 text-xs text-faint">API-equivalent cost; agents run on the company&apos;s Claude login.</p>
        </div>

        <div className="rounded-2xl bg-surface p-4 shadow-[var(--shadow-card)]">
          <h3 className="font-display font-semibold">History</h3>
          <ul className="mt-2 space-y-2 text-sm">
            {versions.map((v) => (
              <li key={v.v} className="flex items-start justify-between gap-3">
                <span>
                  <span className="text-muted">v{v.v} · {v.by} · </span>
                  {v.summary}
                </span>
                {v.v !== version && (
                  <button onClick={() => change([{ op: "restore_version", version: v.v }])} className="shrink-0 text-xs text-muted underline">
                    Restore
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ spend */

function Spend({ data }: { data: OfficeData }) {
  const [days, setDays] = useState(1);
  const [spend, setSpend] = useState<Awaited<ReturnType<typeof getSpend>> | null>(null);
  useEffect(() => {
    void getSpend(days).then(setSpend);
  }, [days, data.agents]);
  const name = (id: string) => data.agents.find((a: AgentRow) => a.id === id)?.name ?? id;
  const room = (id: string | null) => data.rooms.find((r) => r.id === id)?.name ?? "Other";
  if (!spend) return <p className="text-faint">Loading…</p>;
  return (
    <div className="max-w-xl">
      <div className="flex gap-2">
        {[1, 7, 30].map((d) => (
          <button key={d} onClick={() => setDays(d)} className={`rounded-lg px-3 py-1 text-sm ${days === d ? "bg-ink text-white" : "ring-1 ring-line-2"}`}>
            {d === 1 ? "Today" : `${d} days`}
          </button>
        ))}
      </div>
      <p className="mt-4 font-display text-3xl font-semibold">${spend.total.costUsd.toFixed(2)}</p>
      <p className="text-sm text-muted">
        {spend.total.calls} model calls · {(spend.total.tokens / 1000).toFixed(0)}k tokens · API-equivalent
      </p>
      <h3 className="mt-6 text-sm font-medium">By room</h3>
      <ul className="mt-2 text-sm">
        {spend.rooms.map((r) => (
          <li key={r.roomId ?? "other"} className="flex justify-between py-0.5">
            <span>{room(r.roomId)}</span>
            <span>${r.costUsd.toFixed(2)}</span>
          </li>
        ))}
      </ul>
      <h3 className="mt-6 text-sm font-medium">By agent</h3>
      <ul className="mt-2 text-sm">
        {spend.agents
          .sort((a, b) => b.costUsd - a.costUsd)
          .map((a) => (
            <li key={a.agentId} className="flex justify-between py-0.5">
              <span>{name(a.agentId)}</span>
              <span>
                ${a.costUsd.toFixed(2)} <span className="text-muted">· {a.calls} calls</span>
              </span>
            </li>
          ))}
      </ul>
    </div>
  );
}
