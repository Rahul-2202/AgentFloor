import { supabase } from "./supabase";

export interface Office {
  id: string;
  name: string;
  onboardedAt: string | null;
  sandboxState: string;
  daemonConnected: boolean;
}

export class ApiError extends Error {
  readonly status: number;
  readonly problems: string[];
  readonly code: string | undefined;
  constructor(status: number, message: string, problems: string[], code?: string) {
    super(message);
    this.status = status;
    this.problems = problems;
    this.code = code;
  }
}

/** Calls the Control API as the signed-in user. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}${path}`, {
    ...init,
    headers: { ...init.headers, authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.error ?? res.statusText, body.problems ?? [], body.code);
  }
  return res.json() as Promise<T>;
}

/** Creates the office on first sign-in; returns it either way. */
export const ensureOffice = () => api<{ office: Office; created: boolean }>("/office", { method: "POST" });

/** Starts the office computer (creates it the first time); resolves when its daemon is connected. */
export const startOffice = () => api<{ state: string }>("/office/start", { method: "POST" });
export const pauseOffice = () => api<{ state: string }>("/office/pause", { method: "POST" });

/** One of the office's own calls, as the CEO (message, assign, reply, ...). */
export const officeCall = <T = unknown>(name: string, args: object) =>
  api<{ result: T }>("/office/call", { method: "POST", body: JSON.stringify({ name, args }), headers: { "content-type": "application/json" } }).then((r) => r.result);

export interface Readback {
  baseVersion: number;
  readback: string[];
  summary: string;
}

/** What a setup change would do; nothing changes yet. Errors carry every reason. */
export const proposeSetup = (ops: object[]) => post<Readback>("/office/setup/propose", { ops });
export const applySetup = (ops: object[], baseVersion: number) => post<{ version: number; readback: string[] }>("/office/setup/apply", { ops, baseVersion });
export const setupVersions = () => api<{ versions: { v: number; by: string; summary: string; readback: string[]; createdAt: string }[] }>("/office/setup/versions");
export const getSetup = () => api<{ setup: OfficeSetupView; version: number; pushed: number }>("/office/setup");
export const getSpend = (days = 1) =>
  api<{ total: SpendSum; rooms: (SpendSum & { roomId: string | null })[]; agents: { agentId: string; roomId: string | null; calls: number; tokens: number; costUsd: number }[] }>(
    `/office/spend?days=${days}`,
  );
export const resolveInbox = (id: string) => post<unknown>(`/office/inbox/${encodeURIComponent(id)}/resolve`, {});

export interface SpendSum {
  calls: number;
  tokens: number;
  costUsd: number;
}

export interface OfficeSetupView {
  name: string;
  policy: Record<string, number | string>;
  rooms: {
    id: string;
    name: string;
    head: string;
    purpose?: string;
    responsibilities?: string;
    dod?: string;
    permissions?: Record<string, "free" | "ask" | "never">;
    whenBlocked?: string;
    publish?: string;
  }[];
  agents: { id: string; name: string; room: string; role: string; title: string; runtime: string; model?: string; effort?: string; permissions?: Record<string, "free" | "ask" | "never"> }[];
  budgets: { scope: string; id: string; dailyUsdSoft?: number | null; dailyUsdHard?: number | null }[];
  locks: ("merge" | "permissions" | "budgets" | "protocol" | "when_blocked" | "publish")[];
}

async function post<T>(path: string, body: object): Promise<T> {
  return api<T>(path, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
}

export interface GitHubStatus {
  configured: boolean;
  installUrl?: string;
  link?: { installationId: string; account: string; repo: string | null; defaultBranch: string | null } | null;
  /** The app is already installed on your GitHub account: connect it directly. */
  existing?: { installationId: string; account: string } | null;
}
export interface PullRequestView {
  number: number;
  url: string;
  title: string;
  state: string;
  merged: boolean;
  mergeable: boolean | null;
  head: string;
  base: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  checks: { name: string; status: string; conclusion: string | null }[];
}

export const githubStatus = () => api<GitHubStatus>("/office/github");
export const connectGithub = (installationId: string) => post<unknown>("/office/github/connect", { installationId });
export const githubRepos = () => api<{ repos: { fullName: string; defaultBranch: string; private: boolean }[] }>("/office/github/repos");
export const chooseRepo = (repo: string) => post<unknown>("/office/github/repo", { repo });
export const getPr = (n: number) => api<{ pr: PullRequestView }>(`/office/prs/${n}`);
export const mergePr = (n: number, inboxId?: string) => post<{ sha: string }>(`/office/prs/${n}/merge`, { inboxId });
export const requestChanges = (n: number, comment: string, inboxId?: string) => post<unknown>(`/office/prs/${n}/changes`, { comment, inboxId });

/** Lets a parked agent carry on. */
export const releaseAgent = (id: string) => post<unknown>(`/office/agents/${encodeURIComponent(id)}/release`, {});

/* ------------------------------------------------------------------ M3–M5 */

export interface AdaCard {
  id: string;
  type: "proposal";
  readback: string[];
  summary: string;
  state: "pending" | "applied" | "dismissed" | "stale";
  version?: number;
}
export type AdaEvent = { type: "text"; delta: string } | { type: "card"; card: AdaCard } | { type: "done"; message: { content: string; cards: AdaCard[] } } | { type: "error"; message: string };

/** Talks to Ada; her reply streams back event by event. */
export async function adaChat(message: string, onEvent: (e: AdaEvent) => void): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/office/ada/chat`, {
    method: "POST",
    headers: { authorization: `Bearer ${data.session?.access_token}`, "content-type": "application/json" },
    body: JSON.stringify({ message }),
  });
  if (!res.ok || !res.body) throw new ApiError(res.status, (await res.json().catch(() => ({}))).error ?? res.statusText, []);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      if (chunk.startsWith("data: ")) onEvent(JSON.parse(chunk.slice(6)));
    }
  }
}
export const confirmAdaCard = (id: string) => post<{ version: number }>(`/office/ada/cards/${id}/confirm`, {});
export const dismissAdaCard = (id: string) => post<unknown>(`/office/ada/cards/${id}/dismiss`, {});
export const adaBriefing = () => post<{ briefing: string }>("/office/ada/briefing", {});

export const scheduleMeeting = (m: { title: string; attendees: string[]; agenda: string[]; chair?: "ada" | "ceo" }) => post<{ meeting: { id: string } }>("/office/meetings", m);
export const startMeeting = (id: string) => post<unknown>(`/office/meetings/${id}/start`, {});
export const endMeeting = (id: string) => post<unknown>(`/office/meetings/${id}/end`, {});
export const meetingMinutes = (id: string) =>
  api<{ minutes: { summary: string; decisions: { text: string; rationale?: string }[]; actionItems: { text: string; owner: string; taskId?: string; status: string }[] } | null }>(`/office/meetings/${id}/minutes`);

export const writeMemory = (item: { layer: string; scopeId?: string; type: string; title: string; body: string; tags?: string[]; replaces?: string }) => post<unknown>("/office/memory", item);
export const editMemory = (id: string, patch: { title?: string; body?: string }) =>
  api<unknown>(`/office/memory/${id}`, { method: "PATCH", body: JSON.stringify(patch), headers: { "content-type": "application/json" } });
export const flagMemory = (id: string, reason: string) => post<unknown>(`/office/memory/${id}/flag`, { reason });
export const acceptMemory = (id: string) => post<unknown>(`/office/memory/${id}/accept`, {});
export const rejectMemory = (id: string, why: string) => post<unknown>(`/office/memory/${id}/reject`, { why });

export const answerPermission = (inboxId: string, allow: boolean, note?: string) => post<unknown>(`/office/permissions/${encodeURIComponent(inboxId)}`, { allow, note });

/* ------------------------------------------------------------------ Linear */

export interface LinearStatus {
  configured: boolean;
  link?: { teamId: string; teamKey: string; teamName: string; projectUrl: string | null; webhookId: string | null } | null;
  teams?: { id: string; key: string; name: string }[];
}
export const linearStatus = () => api<LinearStatus>("/office/linear");
export const linearConnect = (teamId: string, projectId?: string | null) => post<{ link: NonNullable<LinearStatus["link"]> & { warning?: string } }>("/office/linear/connect", { teamId, projectId: projectId || null });
export const linearProjects = (teamId: string) => api<{ projects: { id: string; name: string; url: string }[] }>(`/office/linear/projects?teamId=${encodeURIComponent(teamId)}`);
export const linearDisconnect = () => post<unknown>("/office/linear/disconnect", {});

/* -------------------------------------------------------------------- ops */

export const getMe = () => api<{ user: { githubLogin: string | null }; admin: boolean }>("/me");

/** Reports a browser error (best effort, never throws). */
export async function reportError(message: string, stack?: string, context?: object) {
  try {
    const { data } = await supabase.auth.getSession();
    if (!data.session) return;
    await fetch(`${process.env.NEXT_PUBLIC_API_URL}/errors`, {
      method: "POST",
      headers: { authorization: `Bearer ${data.session.access_token}`, "content-type": "application/json" },
      body: JSON.stringify({ message, stack, context }),
      keepalive: true,
    });
  } catch {
    /* reporting must never break the page */
  }
}

/** Downloads everything the office remembers as a JSON file. */
export async function downloadMemory() {
  const { data } = await supabase.auth.getSession();
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/office/memory/export`, { headers: { authorization: `Bearer ${data.session?.access_token}` } });
  if (!res.ok) throw new ApiError(res.status, (await res.json().catch(() => ({}))).error ?? res.statusText, []);
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement("a"), { href: url, download: `agentfloor-memory-${new Date().toISOString().slice(0, 10)}.json` });
  a.click();
  URL.revokeObjectURL(url);
}

export interface AdminOverview {
  offices: {
    id: string;
    name: string;
    owner: string | null;
    createdAt: string;
    onboarded: boolean;
    machine: string;
    connected: boolean;
    seenAt: string | null;
    spend: { today: number; week: number; month: number };
    machineHours: { week: number; month: number };
    errors24h: number;
  }[];
  totals: { offices: number; running: number; spend: { today: number; week: number; month: number }; machineHours: { week: number; month: number }; errors24h: number };
}
export interface AdminError {
  id: number;
  source: "web" | "api" | "office";
  office_id: string | null;
  message: string;
  stack: string | null;
  context: Record<string, unknown>;
  count: number;
  first_seen: string;
  last_seen: string;
}
export interface AllowEntry {
  id: number;
  githubLogin: string | null;
  email: string | null;
  note: string | null;
  admin: boolean;
}
export const adminOverview = () => api<AdminOverview>("/admin/overview");
export const adminErrors = () => api<{ errors: AdminError[] }>("/admin/errors?limit=150");
export const adminAllowlist = () => api<{ entries: AllowEntry[] }>("/admin/allowlist");
export const adminAllow = (e: { githubLogin?: string; email?: string; note?: string; admin?: boolean }) => post<{ entries: AllowEntry[] }>("/admin/allowlist", e);
export const adminDisallow = (id: number) => api<{ entries: AllowEntry[] }>(`/admin/allowlist/${id}`, { method: "DELETE" });
export const adminBackup = () => post<{ offices: number }>("/admin/backup", {});

/* ------------------------------------------------------------------ Claude */

export interface ClaudeStatus {
  set: boolean;
  last4: string | null;
  status: "ok" | "invalid" | null;
  setAt: string | null;
  problem?: string | null;
  /** Whether this server needs one (offices run on their CEO's own Claude login). */
  required: boolean;
}
export const claudeStatus = () => api<ClaudeStatus>("/office/claude");
export const setClaudeToken = (token: string) => post<ClaudeStatus>("/office/claude", { token });
