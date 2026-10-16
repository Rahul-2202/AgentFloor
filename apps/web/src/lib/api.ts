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
  constructor(status: number, message: string, problems: string[]) {
    super(message);
    this.status = status;
    this.problems = problems;
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
    throw new ApiError(res.status, body.error ?? res.statusText, body.problems ?? []);
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
  rooms: { id: string; name: string; head: string; purpose?: string; responsibilities?: string; dod?: string }[];
  agents: { id: string; name: string; room: string; role: string; title: string; runtime: string; model?: string; effort?: string }[];
  budgets: { scope: string; id: string; dailyUsdSoft?: number | null; dailyUsdHard?: number | null }[];
}

async function post<T>(path: string, body: object): Promise<T> {
  return api<T>(path, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
}

export interface GitHubStatus {
  configured: boolean;
  installUrl?: string;
  link?: { installationId: string; account: string; repo: string | null; defaultBranch: string | null } | null;
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
