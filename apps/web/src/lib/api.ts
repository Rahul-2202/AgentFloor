import { supabase } from "./supabase";

export interface Office {
  id: string;
  name: string;
  onboardedAt: string | null;
  sandboxState: string;
  daemonConnected: boolean;
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
  if (!res.ok) throw new Error(`${res.status}: ${(await res.json().catch(() => ({}))).error ?? res.statusText}`);
  return res.json() as Promise<T>;
}

/** Creates the office on first sign-in; returns it either way. */
export const ensureOffice = () => api<{ office: Office; created: boolean }>("/office", { method: "POST" });

/** Starts the office computer (creates it the first time); resolves when its daemon is connected. */
export const startOffice = () => api<{ state: string }>("/office/start", { method: "POST" });
export const pauseOffice = () => api<{ state: string }>("/office/pause", { method: "POST" });
